import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(),
  owner = crypto.randomUUID(),
  other = crypto.randomUUID(),
  hash = "a".repeat(64);
const migration = (name) =>
  readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8");
try {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;grant usage on schema auth to authenticated;create table user_roles(user_id uuid,role text);grant select on user_roles to service_role;create schema storage;create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of [
    "20261006020101_reel_inbox.sql",
    "20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql",
    "20261011114403_model_pipeline_queue.sql",
  ])
    await db.exec(await migration(file));
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'cofounder')", [owner, other]);
  await db.query("insert into model_pipeline_settings(user_id) values($1)", [owner]);
  await db.query(
    "insert into model_pipeline_profiles(user_id,model,sender_username) values($1,'kiikii','kiikii.bat'),($1,'tuuva','tuuva.test')",
    [owner],
  );
  await db.query(
    "insert into reel_inbox_dm_sources(user_id,receiver_id,enabled) values($1,'10',true)",
    [owner],
  );
  const call = async (action, data = {}, user = null, token = hash) =>
    (
      await db.query("select model_pipeline_command($1,$2,$3,$4) value", [
        action,
        user,
        JSON.stringify(data),
        token,
      ])
    ).rows[0].value;
  const ingest = async (sender, name, code, key) =>
    (
      await db.query("select reel_inbox_dm_ingest($1,$2,$3,$4,$5) value", [
        "10",
        sender,
        name,
        key.repeat(64),
        JSON.stringify([{ shortcode: code, url: "https://www.instagram.com/reel/" + code + "/" }]),
      ])
    ).rows[0].value;
  await db.exec("set role authenticated");
  await assert.rejects(call("status", {}, owner, null));
  await db.exec("reset role;set role service_role");
  await assert.rejects(call("status", {}, other, null));
  await assert.rejects(call("claim"));
  await call("pair", { hash }, owner, null);
  assert.equal(await call("claim"), null);
  await call("enable", {}, owner, null);
  assert.deepEqual(await ingest("99", "stranger", "ReelAlpha", "1"), { ignored: true });
  await ingest("20", "kiikii.bat", "ReelAlpha", "2");
  await ingest("30", "tuuva.test", "ReelAlpha", "3");
  assert.deepEqual(await ingest("20", "kiikii.bat", "ReelAlpha", "2"), { duplicate: true });
  assert.deepEqual(await ingest("22", "kiikii.bat", "ReelBeta", "4"), { ignored: true });
  await ingest("40", "thundeerr999", "ReelOther", "5");
  let status = await call("status", {}, owner, null);
  assert.equal(status.jobs.length, 2);
  assert.equal(status.daily_cents, 300);
  assert.equal(status.resolution, "720p");
  const a = await call("claim"),
    b = await call("claim");
  assert.notEqual(a.model, b.model);
  assert.equal(a.inbox_id, b.inbox_id);
  const ref = (j) => ({ id: j.id, lease: j.lease });
  await assert.rejects(call("reserve", { ...ref(a), lease: crypto.randomUUID(), seconds: 9 }));
  await assert.rejects(call("reserve", { ...ref(a), seconds: 16 }));
  let reserved = await call("reserve", { ...ref(a), seconds: 9 });
  assert.equal(reserved.reserved_cents, 180);
  let wait = await call("reserve", { ...ref(b), seconds: 9 });
  assert.equal(wait.budget_wait, true);
  assert.equal(wait.remaining_cents, 120);
  await assert.rejects(call("reserve", { ...ref(a), seconds: 9 }));
  assert.equal(await call("claim"), null);
  await call("submitted", { ...ref(a), provider_id: "b".repeat(32) });
  await call("submitted", { ...ref(a), provider_id: "b".repeat(32) });
  await assert.rejects(call("submitted", { ...ref(a), provider_id: "c".repeat(32) }));
  let review = await call("review", { ...ref(a), caption: "Draft #test" });
  let twice = await call("review", { ...ref(a), caption: "Wrong replacement" });
  assert.equal(review.review_id, twice.review_id);
  const item = (
    await db.query("select * from content_review_items where id=$1", [review.review_id])
  ).rows[0];
  assert.equal(item.status, "uploading");
  assert.equal(item.model, a.model);
  assert.equal(item.caption, "Draft #test");
  await assert.rejects(call("publish", { ...ref(a) }));
  await assert.rejects(call("enable"));
  await call("pause", {}, owner, null);
  assert.equal(await call("claim"), null);
  await db.exec("reset role");
  await db.query(
    "update model_pipeline_jobs set state='budget_wait',updated_at=now()-interval '2 days' where id=$1",
    [b.id],
  );
  await db.query(
    "insert into model_pipeline_external_spend values($1,(now() at time zone 'Europe/Berlin')::date,'manual',90)",
    [owner],
  );
  await db.exec("set role service_role");
  await call("enable", {}, owner, null);
  const next = await call("claim");
  assert.equal(next.id, b.id);
  const denied = await call("reserve", { ...ref(next), seconds: 2 });
  assert.equal(denied.budget_wait, true);
  assert.equal(denied.remaining_cents, 30);
  console.log(
    "Pipeline DB: sender binding, cross-model dedupe, worker scope, shared 720p budget, external spend, pause, paid retry and review handoff passed",
  );
} finally {
  await db.close();
}
