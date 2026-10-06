import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; create table public.user_roles(user_id uuid,role text); grant select on public.user_roles to service_role;`,
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261006020101_reel_inbox.sql", import.meta.url),
    "utf8",
  ),
);
const a = crypto.randomUUID(),
  b = crypto.randomUUID(),
  instance = crypto.randomUUID(),
  hash = "a".repeat(64);
await db.query(`insert into auth.users values($1),($2);`, [a, b]);
await db.query(`insert into public.user_roles values($1,'owner'),($2,'cofounder')`, [a, b]);
const call = async (action, user, payload = {}, token = null) =>
  (
    await db.query("select public.reel_inbox_command($1,$2,$3,$4) as value", [
      action,
      user,
      JSON.stringify(payload),
      token,
    ])
  ).rows[0].value;
await db.exec("set role service_role");
const submit = () =>
  call("submit", a, {
    links: [{ shortcode: "DdQN9krAjJn", url: "https://www.instagram.com/p/DdQN9krAjJn/" }],
    test: true,
  });
let [first] = await submit();
let [dup] = await submit();
assert.equal(dup.duplicate, true);
assert.equal(first.id, dup.id);
assert.equal((await call("list", b)).items.length, 0);
await assert.rejects(call("claim", a, { instance }));
await call("pair", a, { hash });
let job = await call("claim", null, { instance }, hash);
assert.equal(job.id, first.id);
assert.equal(await call("claim", null, { instance }, hash), null);
await assert.rejects(call("claim", null, { instance: crypto.randomUUID() }, hash));
await assert.rejects(
  call("ack", null, { id: job.id, lease: crypto.randomUUID(), receipt: {} }, hash),
);
await assert.rejects(call("move", b, { id: job.id, stage: "Verwendet" }));
await db.exec("reset role");
await db.query(
  "update public.reel_inbox_items set lease_until=now()-interval '1 second' where id=$1",
  [job.id],
);
await db.exec("set role service_role");
const old = job;
job = await call("claim", null, { instance }, hash);
assert.notEqual(job.lease_id, old.lease_id);
await assert.rejects(call("renew", null, { id: old.id, lease: old.lease_id }, hash));
const receipt = {
  stage: "Neu",
  folder: `Neu/DdQN9krAjJn_${job.id}`,
  sha256: "b".repeat(64),
  bytes: 500,
};
await call("ack", null, { id: job.id, lease: job.lease_id, receipt }, hash);
await call("ack", null, { id: job.id, lease: job.lease_id, receipt }, hash); // lost acknowledgment response
await call("move", a, { id: job.id, stage: "In Arbeit" });
let current = (await call("list", a)).items[0];
assert.equal(current.confirmed_stage, "Neu");
assert.equal(current.status, "queued");
job = await call("claim", null, { instance }, hash);
await call("fail", null, { id: job.id, lease: job.lease_id, code: "conflict" }, hash);
current = (await call("list", a)).items[0];
assert.equal(current.confirmed_stage, "Neu");
await call("retry", a, { id: job.id });
job = await call("claim", null, { instance }, hash);
await call(
  "ack",
  null,
  {
    id: job.id,
    lease: job.lease_id,
    receipt: { ...receipt, stage: "In Arbeit", folder: `In Arbeit/DdQN9krAjJn_${job.id}` },
  },
  hash,
);
await call("revoke", a);
await assert.rejects(call("claim", null, { instance }, hash));
await db.exec("reset role");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
await db.exec("set role authenticated");
assert.equal((await db.query("select * from public.reel_inbox_items")).rows.length, 0);
await assert.rejects(db.exec("select * from public.reel_inbox_devices"));
await assert.rejects(call("list", a));
await assert.rejects(db.exec("update public.reel_inbox_items set status='ready'"));
await db.exec("reset role");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
await db.exec("set role authenticated");
assert.equal((await db.query("select * from public.reel_inbox_items")).rows.length, 1);
await db.exec("reset role; set role anon");
await assert.rejects(db.exec("select * from public.reel_inbox_items"));
await assert.rejects(call("list", a));
await db.exec("reset role");
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261006025347_reel_inbox_dm.sql", import.meta.url),
    "utf8",
  ),
);
await db.query(
  "insert into public.reel_inbox_dm_sources(user_id,receiver_id,enabled) values($1,'10',true)",
  [a],
);
const dm = async (
  sender,
  username,
  hash = "b".repeat(64),
  links = [{ shortcode: "NewReel123", url: "https://www.instagram.com/reel/NewReel123/" }],
) =>
  (
    await db.query("select public.reel_inbox_dm_ingest('10',$1,$2,$3,$4) as value", [
      sender,
      username,
      hash,
      JSON.stringify(links),
    ])
  ).rows[0].value;
await db.exec("set role authenticated");
await assert.rejects(dm("20", "kiikii.bat"));
for (const table of ["sources", "senders", "receipts"])
  await assert.rejects(db.exec(`select * from public.reel_inbox_dm_${table}`));
await db.exec("reset role; set role service_role");
assert.equal((await dm("20", "stranger")).ignored, true);
await dm("20", "kiikii.bat");
assert.equal((await dm("20", "kiikii.bat")).duplicate, true);
assert.equal((await dm("21", "kiikii.bat")).ignored, true);
assert.equal((await dm("20", "thundeerr999")).ignored, true);
await dm("21", "thundeerr999", "c".repeat(64), []);
assert.equal(
  (
    await db.query("select status from reel_inbox_dm_receipts where message_hash=$1", [
      "c".repeat(64),
    ])
  ).rows[0].status,
  "no_reel_link",
);
assert.equal(
  (await db.query("select status from reel_inbox_items where shortcode='NewReel123'")).rows[0]
    .status,
  "queued",
);
await assert.rejects(
  dm("20", "kiikii.bat", "d".repeat(64), [{ shortcode: "BadReel123", url: "https://evil.test/" }]),
);
assert.equal(
  (await db.query("select count(*)::int as n from reel_inbox_dm_receipts")).rows[0].n,
  2,
);
await db.exec("update reel_inbox_dm_sources set enabled=false");
assert.equal((await dm("20", "kiikii.bat", "e".repeat(64))).ignored, true);
await db.close();
console.log(
  "PASS: DM sender allowlist, pinned identity, replay dedupe, atomic rollback, offline queue, pause and service-only grants",
);
console.log(
  "PASS: transactional queue, dedupe, cross-user isolation, role grants, leases, offline reclaim, stale receipt, move acknowledgment, retry, revocation",
);
