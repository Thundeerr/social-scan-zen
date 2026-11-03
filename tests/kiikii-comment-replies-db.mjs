import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(),
  owner = crypto.randomUUID();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);create table user_roles(user_id uuid,role text);
    grant select on user_roles to service_role;create table ig_oauth_states(state text);`);
  for (const file of [
    "20261102180531_kiikii_dm_redirect.sql",
    "20261103150628_kiikii_comment_private_replies.sql",
    "20261103160246_kiikii_comment_test_reply.sql",
  ])
    await db.exec(
      await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"),
    );
  await db.query("insert into auth.users values($1)", [owner]);
  await db.query("insert into user_roles values($1,'owner')", [owner]);
  await db.query(
    "insert into ig_dm_redirect_settings(user_id,receiver_id,mode,activated_at) values($1,'17841416918437774','live',now()-interval '1 minute')",
    [owner],
  );
  await db.query(
    "insert into ig_comment_redirect_settings(user_id,mode,activated_at) values($1,'test',now()-interval '1 minute')",
    [owner],
  );
  let seq = 0;
  const reserve = async ({
    sender = "20",
    hash = (++seq).toString(16).padStart(64, "0"),
    at = new Date().toISOString(),
    username = "user_diary01",
    trigger = true,
  } = {}) =>
    (
      await db.query(
        "select ig_comment_redirect_reserve('17841416918437774',$1,$2,$3,$4,$5) as result",
        [sender, hash, at, username, trigger],
      )
    ).rows[0].result;
  const dm = async (sender, stop = false) =>
    (
      await db.query(
        "select ig_dm_redirect_reserve('17841416918437774',$1,$2,now(),$3,null) as result",
        [sender, (++seq).toString(16).padStart(64, "0"), stop],
      )
    ).rows[0].result;
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(reserve());
    await assert.rejects(db.query("select * from ig_comment_redirect_settings"));
    await assert.rejects(db.query("update ig_comment_redirect_settings set mode='live'"));
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  assert.equal((await reserve({ username: "other" })).ignored, true);
  assert.equal((await reserve({ trigger: false })).ignored, true);
  assert.equal(
    (await reserve({ at: new Date(Date.now() - 600000).toISOString() })).ignored,
    true,
    "old comment with new webhook ignored",
  );
  assert.equal((await reserve({ hash: "a".repeat(64) })).send, true);
  assert.equal((await reserve({ hash: "a".repeat(64) })).duplicate, true);
  assert.equal((await dm("20")).send, false, "comment reservation suppresses DM");
  await db.exec(
    "update ig_comment_redirect_settings set test_reply_once_until=now()+interval '15 minutes'",
  );
  assert.equal(
    (await reserve({ hash: "a".repeat(64) })).duplicate,
    true,
    "extra test never retries a previous comment",
  );
  assert.equal(
    (await reserve({ username: "other" })).ignored,
    true,
    "extra test remains bound to the test account",
  );
  assert.equal(
    (await reserve({ sender: "20" })).send,
    true,
    "authorized extra test works during cooldown",
  );
  assert.equal(
    (await reserve({ sender: "20" })).send,
    false,
    "extra test is consumed exactly once",
  );
  assert.equal((await dm("20")).send, false, "extra comment test does not open extra DMs");
  await db.exec(
    "update ig_comment_redirect_settings set test_reply_once_until=now()-interval '1 second'",
  );
  assert.equal(
    (await reserve({ sender: "20" })).send,
    false,
    "expired extra test cannot bypass the limit",
  );
  await db.exec(
    "update ig_comment_redirect_settings set test_reply_once_until=now()+interval '15 minutes',mode='live'",
  );
  assert.equal(
    (await reserve({ sender: "20" })).send,
    false,
    "test allowance cannot bypass live mode limits",
  );
  await db.exec("update ig_comment_redirect_settings set test_reply_once_until=null,mode='test'");
  assert.equal((await dm("21")).send, true);
  assert.equal((await reserve({ sender: "21" })).send, false, "DM reservation suppresses comment");
  const mixed = await Promise.all([reserve({ sender: "22" }), dm("22"), reserve({ sender: "22" })]);
  assert.equal(mixed.filter((r) => r.send).length, 1);
  await dm("23", true);
  await db.exec("update ig_dm_redirect_contacts set last_attempt_at=now()-interval '25 hours'");
  assert.equal(
    (await reserve({ sender: "23" })).send,
    false,
    "DM opt-out also suppresses comments",
  );
  assert.equal(
    (await reserve({ sender: "20" })).send,
    true,
    "new comment on next eligible day works",
  );
  await db.exec("update ig_dm_redirect_settings set mode='off'");
  assert.equal((await reserve({ sender: "24" })).ignored, true);
  await db.exec(
    "update ig_dm_redirect_settings set mode='test';update ig_comment_redirect_settings set mode='live'",
  );
  assert.equal(
    (await reserve({ sender: "24", username: "other" })).ignored,
    true,
    "main test mode remains restrictive",
  );
  await db.exec(
    "update ig_dm_redirect_settings set mode='live';update ig_comment_redirect_settings set mode='off'",
  );
  assert.equal((await reserve({ sender: "24" })).ignored, true);
  assert.equal((await dm("24")).send, true, "pausing comments does not pause DMs");
  await db.exec("update ig_comment_redirect_settings set mode='live'");
  assert.equal((await reserve({ sender: "25", username: "other" })).send, true);
  const count = (
    await db.query("select count(*)::int n from ig_dm_redirect_receipts where source='comment'")
  ).rows[0].n;
  assert.ok(count > 0);
  await db.exec("reset role;delete from user_roles;set role service_role");
  assert.equal((await reserve({ sender: "26" })).ignored, true);
  console.log(
    "PASS: service-only grants/RLS, explicit trigger, activation time, test identities, dedupe, shared cooldown/opt-out, competing reservations and pause",
  );
} finally {
  await db.close();
}
