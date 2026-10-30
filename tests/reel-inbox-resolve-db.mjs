import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.user_roles(user_id uuid,role text);
    grant select on public.user_roles to service_role;
    create type public.scanner_run_status as enum ('queued','running','completed','failed');
    create table public.scanner_runs(
      id uuid primary key default gen_random_uuid(),
      status public.scanner_run_status not null default 'queued',
      created_by uuid references auth.users(id), triggered_by uuid,
      account_id uuid, location_id uuid, phase text, phase_detail text,
      started_at timestamptz, completed_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table public.provider_budget(id boolean primary key check(id),monthly_cap integer not null check(monthly_cap>0));
    grant all on public.scanner_runs,public.provider_budget to service_role;
    insert into public.provider_budget values(true,10);
    create schema storage;
    create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const name of [
    "20261006020101_reel_inbox.sql",
    "20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql",
    "20261011114403_model_pipeline_queue.sql",
    "20261030113943_reel_inbox_api_resolve_lease.sql",
  ]) {
    await db.exec(
      await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"),
    );
  }

  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const instance = crypto.randomUUID();
  const hash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  const source = {
    canonical_url: "https://www.instagram.com/reel/ResolveReel01/",
    shortcode: "ResolveReel01",
  };
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("insert into public.user_roles values($1,'owner'),($2,'cofounder')", [
    owner,
    other,
  ]);
  await db.query("insert into public.model_pipeline_settings(user_id,enabled) values($1,true)", [
    owner,
  ]);
  await db.query(
    "insert into public.model_pipeline_profiles(user_id,model,sender_username) values($1,'kiikii','kiikii.bat')",
    [owner],
  );
  const command = async (action, user, payload = {}, token = null) =>
    (
      await db.query("select public.reel_inbox_command($1,$2,$3,$4) as value", [
        action,
        user,
        JSON.stringify(payload),
        token,
      ])
    ).rows[0].value;
  const resolve = async (job, token = hash) =>
    (
      await db.query("select public.reel_inbox_resolve_source($1,$2,$3) as value", [
        job.id,
        job.lease_id,
        token,
      ])
    ).rows[0].value;
  const row = async (id) =>
    (await db.query("select * from public.reel_inbox_items where id=$1", [id])).rows[0];

  const functionInfo = (
    await db.query(
      "select prosecdef, proconfig from pg_proc where oid='public.reel_inbox_resolve_source(uuid,uuid,text)'::regprocedure",
    )
  ).rows[0];
  assert.equal(functionInfo.prosecdef, false, "resolver must not elevate privileges");
  assert.deepEqual(functionInfo.proconfig, ['search_path=""']);

  await db.exec("set role service_role");
  await command("pair", owner, { hash });
  await command("pair", other, { hash: otherHash });
  await command("submit", owner, {
    links: [{ shortcode: source.shortcode, url: source.canonical_url }],
    test: true,
  });
  let job = await command("claim", null, { instance }, hash);
  const original = await row(job.id);
  for (const token of [null, "unknown", "c".repeat(64), otherHash]) {
    await assert.rejects(resolve(job, token));
  }
  await assert.rejects(resolve({ ...job, id: crypto.randomUUID() }));
  await assert.rejects(resolve({ ...job, lease_id: crypto.randomUUID() }));
  await assert.rejects(resolve({ ...job, lease_id: null }));
  assert.deepEqual(await row(job.id), original, "failed authorization must not reserve or renew");

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(resolve(job), /permission denied for function/);
  }
  await db.exec("reset role; set role service_role");

  await command("revoke", owner);
  await assert.rejects(resolve(job), /unauthorized device/);
  await db.query(
    "update public.reel_inbox_devices set revoked=false,expires_at=now()-interval '1 second' where user_id=$1",
    [owner],
  );
  await assert.rejects(resolve(job), /unauthorized device/);
  await db.query(
    "update public.reel_inbox_devices set expires_at=now()+interval '1 day' where user_id=$1",
    [owner],
  );
  assert.equal((await row(job.id)).api_resolve_lease, null);

  const reservations = await Promise.all([resolve(job), resolve(job)]);
  assert.equal(reservations.filter(Boolean).length, 1, "only one reservation returns a URL");
  const reservation = reservations.find(Boolean);
  assert.deepEqual(reservation, { ...source, run_id: reservation.run_id });
  assert.match(reservation.run_id, /^[a-f0-9-]{36}$/);
  const run = (
    await db.query("select * from public.scanner_runs where id=$1", [reservation.run_id])
  ).rows[0];
  assert.equal(run.status, "completed", "reservation must not be picked up by the scanner");
  assert.equal(run.created_by, owner);
  assert.equal(run.phase, "inbox_resolve");
  assert.equal(run.phase_detail, "Reel download fallback request reserved");
  assert.ok(run.started_at && run.completed_at);
  assert.equal(run.account_id, null);
  assert.equal(run.location_id, null);
  assert.equal(run.triggered_by, null);
  assert.equal((await row(job.id)).api_resolve_lease, job.lease_id);
  assert.equal(await resolve(job), null, "same lease cannot spend again");

  await db.query(
    "update public.reel_inbox_items set lease_until=now()-interval '1 second' where id=$1",
    [job.id],
  );
  await assert.rejects(resolve(job), /expired lease/);
  const oldJob = job;
  job = await command("claim", null, { instance }, hash);
  assert.notEqual(job.lease_id, oldJob.lease_id);
  await assert.rejects(resolve(oldJob), /stale lease/);
  const reclaimed = await resolve(job);
  assert.deepEqual(
    reclaimed,
    { ...source, run_id: reclaimed.run_id },
    "a reclaimed lease can reserve one new request",
  );
  assert.notEqual(reclaimed.run_id, reservation.run_id);
  assert.equal(await resolve(job), null);

  await command("fail", null, { id: job.id, lease: job.lease_id, code: "unavailable" }, hash);
  await assert.rejects(resolve(job), /expired lease/);
  await command("retry", owner, { id: job.id });
  job = await command("claim", null, { instance }, hash);
  await db.exec("update public.provider_budget set monthly_cap=2");
  const beforeCap = (await row(job.id)).api_resolve_lease;
  assert.deepEqual(
    await resolve(job),
    { error: "setup" },
    "exhausted shared budget blocks a new reservation",
  );
  assert.equal(
    (await row(job.id)).api_resolve_lease,
    beforeCap,
    "budget block must not consume the lease reservation",
  );
  assert.equal((await db.query("select count(*)::int as n from public.scanner_runs")).rows[0].n, 2);
  // An old-month request must not exhaust this month's capacity.
  await db.query(
    "update public.scanner_runs set created_at=(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')-interval '1 second' where id=$1",
    [reservation.run_id],
  );
  const retried = await resolve(job);
  assert.deepEqual(
    retried,
    { ...source, run_id: retried.run_id },
    "an explicit retry receives a fresh reservation",
  );
  assert.notEqual(retried.run_id, reclaimed.run_id);
  assert.equal(await resolve(job), null, "duplicates remain free even when the budget is now full");

  // The documented default is also enforced if no provider_budget row exists.
  await command("fail", null, { id: job.id, lease: job.lease_id, code: "unavailable" }, hash);
  await command("retry", owner, { id: job.id });
  job = await command("claim", null, { instance }, hash);
  await db.exec(
    "delete from public.provider_budget; insert into public.scanner_runs(status) select 'failed' from generate_series(1,14998)",
  );
  const beforeDefaultCap = (await row(job.id)).api_resolve_lease;
  assert.deepEqual(await resolve(job), { error: "setup" });
  assert.equal((await row(job.id)).api_resolve_lease, beforeDefaultCap);

  const current = await row(job.id);
  assert.equal(current.status, "working", "resolving alone must not confirm a downloaded file");
  assert.equal(current.receipt, null);
  assert.equal(current.confirmed_stage, null);
  assert.equal(
    (await db.query("select count(*)::int as n from public.reel_inbox_items")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select count(*)::int as n from public.model_pipeline_jobs")).rows[0].n,
    0,
    "source resolution must never create generation jobs",
  );
  assert.equal(
    (await db.query("select count(*)::int as n from public.content_review_items")).rows[0].n,
    0,
  );
  console.log(
    "PASS: service-only invoker, device ownership/revocation/expiry, active lease, one reservation per lease, shared monthly accounting/cap, explicit retry and no generation jobs",
  );
} finally {
  await db.close();
}
