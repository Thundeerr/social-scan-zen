import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(), owner = crypto.randomUUID(), other = crypto.randomUUID();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;`);
  await db.exec(await readFile(new URL("../supabase/migrations/20261028170053_instagram_business_analytics.sql", import.meta.url),"utf8"));
  await db.query("insert into auth.users values ($1),($2)",[owner,other]);
  await db.query("insert into instagram_analytics_state(user_id) values ($1),($2)",[owner,other]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  assert.deepEqual((await db.query("select user_id from instagram_analytics_state")).rows,[{user_id:owner}]);
  for (const sql of ["update instagram_analytics_state set last_error='x'", "delete from instagram_analytics_state", `insert into instagram_analytics_state(user_id) values ('${crypto.randomUUID()}')`])
    await assert.rejects(db.exec(sql),e=>e.code==="42501");
  await db.exec("reset role; set role anon");
  await assert.rejects(db.exec("select * from instagram_analytics_state"),e=>e.code==="42501");
  await db.exec("reset role; set role service_role");
  const claim = "update instagram_analytics_state set last_attempt_at=now() where user_id=$1 and last_attempt_at < now()-interval '10 minutes' returning user_id";
  assert.equal((await db.query(claim,[owner])).rows.length,1);
  assert.equal((await db.query(claim,[owner])).rows.length,0);
  console.log("Instagram analytics RLS and atomic throttle passed");
} finally { await db.close(); }
