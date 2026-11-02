import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table user_roles(user_id uuid,role text); grant select on user_roles to service_role;
    create table ig_oauth_states(state text);`);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261102180531_kiikii_dm_redirect.sql", import.meta.url),
      "utf8",
    ),
  );
  const owner = crypto.randomUUID();
  await db.query("insert into auth.users values($1)", [owner]);
  await db.query("insert into user_roles values($1,'owner')", [owner]);
  await db.query(
    "insert into ig_dm_redirect_settings(user_id,receiver_id,mode,activated_at) values($1,'17841416918437774','test',now()-interval '1 minute')",
    [owner],
  );
  let seq = 0;
  async function reserve({
    sender = "20",
    hash = (++seq).toString(16).padStart(64, "0"),
    at = new Date().toISOString(),
    stop = false,
    username = "user_diary01",
    receiver = "17841416918437774",
  } = {}) {
    return (
      await db.query("select ig_dm_redirect_reserve($1,$2,$3,$4,$5,$6) as result", [
        receiver,
        sender,
        hash,
        at,
        stop,
        username,
      ])
    ).rows[0].result;
  }
  await db.exec("set role authenticated");
  await assert.rejects(reserve());
  for (const table of [
    "ig_dm_redirect_settings",
    "ig_dm_redirect_contacts",
    "ig_dm_redirect_receipts",
  ])
    await assert.rejects(db.query(`select * from ${table}`));
  await db.exec("reset role; set role anon");
  await assert.rejects(reserve());
  await db.exec("reset role; set role service_role");
  assert.equal((await reserve({ username: "stranger" })).ignored, true);
  assert.equal((await reserve({ receiver: "17841473861037386" })).ignored, true);
  assert.equal(
    (await reserve({ at: new Date(Date.now() - 86400000).toISOString() })).ignored,
    true,
  );
  const first = await reserve({ hash: "a".repeat(64) });
  assert.equal(first.send, true);
  assert.equal((await reserve({ hash: "a".repeat(64) })).duplicate, true);
  assert.equal((await reserve()).send, false);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer as n from ig_dm_redirect_receipts where status='reserved'",
      )
    ).rows[0].n,
    1,
  );
  // No repeat on a subsequent eligible day, including all possible prior indexes.
  for (let prior = 0; prior < 30; prior++) {
    await db.query(
      "update ig_dm_redirect_contacts set last_attempt_at=now()-interval '25 hours',previous_variant=$1 where sender_id='20'",
      [prior],
    );
    const next = await reserve();
    assert.equal(next.send, true);
    assert.notEqual(next.variant, prior);
    assert.ok(next.variant >= 0 && next.variant < 30);
  }
  await reserve({ stop: true });
  await db.exec("update ig_dm_redirect_contacts set last_attempt_at=now()-interval '25 hours'");
  assert.equal((await reserve()).send, false, "opt-out persists beyond the cooldown");
  const simultaneous = await Promise.all(
    Array.from({ length: 8 }, () => reserve({ sender: "30" })),
  );
  assert.equal(
    simultaneous.filter((r) => r.send).length,
    1,
    "only one reservation across competing requests",
  );
  await db.exec("update ig_dm_redirect_settings set mode='off'");
  assert.equal((await reserve({ sender: "40" })).ignored, true);
  await db.exec("update ig_dm_redirect_settings set mode='live'");
  assert.equal((await reserve({ sender: "40", username: null })).send, true);
  await db.exec("reset role; delete from user_roles; set role service_role");
  assert.equal((await reserve({ sender: "50" })).ignored, true, "removed operator cannot send");
  console.log(
    "PASS: private tables/RPC, receiver binding, test identity, freshness, dedupe, concurrency, cooldown, variation, opt-out, pause and roles",
  );
} finally {
  await db.close();
}
