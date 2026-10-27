import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    grant usage on schema auth to authenticated;
    create table user_roles(user_id uuid,role text); grant select on user_roles to service_role;
    create schema storage; create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const name of [
    "20261006020101_reel_inbox.sql",
    "20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql",
    "20261011114403_model_pipeline_queue.sql",
    "20261010122517_reel_card_diagnostics.sql",
    "20261027180000_dm_model_collection.sql",
  ]) {
    await db.exec(
      await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"),
    );
  }
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID();
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'owner')", [owner, other]);
  await db.query("insert into model_pipeline_settings(user_id,enabled) values($1,true)", [owner]);
  await db.query(
    "insert into model_pipeline_profiles(user_id,model,sender_username) values($1,'kiikii','kiikii.bat'),($1,'tuuva','tuuva.test')",
    [owner],
  );
  await db.query(
    "insert into reel_inbox_dm_sources(user_id,receiver_id,enabled) values($1,'10',true),($2,'11',true)",
    [owner, other],
  );
  const diagnostic = {
    outcome: "link_found",
    attachment_count: 1,
    share_count: 1,
    url_count: 1,
    unsupported: false,
    text: "DO NOT STORE",
  };
  let n = 0;
  const call = async ({
    model = "kiikii",
    sender = "20",
    username = "thundeerr999",
    receiver = "10",
    hash = (++n).toString(16).padStart(64, "0"),
    links = [{ shortcode: "TestReel01", url: "https://www.instagram.com/reel/TestReel01/" }],
  } = {}) =>
    (
      await db.query("select reel_inbox_dm_ingest_v3($1,$2,$3,$4,$5,$6,$7) as value", [
        receiver,
        sender,
        username,
        hash,
        JSON.stringify(links),
        JSON.stringify(diagnostic),
        model,
      ])
    ).rows[0].value;
  await db.exec("set role authenticated");
  await assert.rejects(call());
  await assert.rejects(db.query("select * from reel_inbox_dm_candidates"));
  await db.exec("reset role; set role service_role");
  const first = await call({ hash: "a".repeat(64) });
  assert.equal(first.model, "kiikii");
  assert.equal((await call({ hash: "a".repeat(64), model: "tuuva" })).duplicate, true);
  await call(); // Same reel in a different DM must still dedupe per model.
  assert.equal((await db.query("select * from reel_inbox_dm_candidates")).rows.length, 1);
  await call({ model: "tuuva" });
  assert.deepEqual(
    (await db.query("select model from reel_inbox_dm_candidates order by model")).rows.map(
      (x) => x.model,
    ),
    ["kiikii", "tuuva"],
  );
  assert.equal((await call({ sender: "99" })).ignored, true);
  assert.equal((await call({ username: "stranger" })).ignored, true);
  await assert.rejects(call({ model: "other" }));
  await assert.rejects(call({ links: [{ shortcode: "BadCode", url: "https://evil.test/" }] }));
  await call({ username: "kiikii.bat", sender: "30" });
  assert.equal(
    (await db.query("select * from model_pipeline_jobs")).rows.length,
    0,
    "even enabled pipeline and model sender create no jobs",
  );
  await call({ receiver: "11" });
  assert.equal(
    (await db.query("select * from reel_inbox_dm_candidates where user_id=$1", [other])).rows
      .length,
    1,
  );
  assert.ok(
    (await db.query("select diagnostics from reel_inbox_dm_receipts")).rows.every(
      (x) => !JSON.stringify(x).includes("DO NOT STORE"),
    ),
  );
  const before = (await db.query("select count(*)::int n from reel_inbox_dm_candidates")).rows[0].n;
  await call({ links: [] });
  assert.equal(
    (await db.query("select count(*)::int n from reel_inbox_dm_candidates")).rows[0].n,
    before,
    "a separate Tuuva note cannot relabel another reel",
  );
  await db.query("update reel_inbox_dm_sources set enabled=false where user_id=$1", [owner]);
  assert.equal((await call()).ignored, true);
  console.log(
    "PASS: model routing, per-model dedupe, replay immutability, sender pinning, owner isolation, no paid jobs, no text storage, pause and access control",
  );
} finally {
  await db.close();
}
