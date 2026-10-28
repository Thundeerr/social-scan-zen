import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const db=new PGlite(),owner=crypto.randomUUID();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);`);
 await db.exec(await readFile(new URL("../supabase/migrations/20261028173134_wavespeed_business_analytics.sql",import.meta.url),"utf8"));
 await db.query("insert into auth.users values($1)",[owner]);
 for(const role of ["anon","authenticated"]){
  await db.exec(`set role ${role}`);
  for(const table of ["wavespeed_analytics_state","wavespeed_monthly_reports"])
   await assert.rejects(db.exec(`select * from ${table}`),e=>e.code==="42501");
  await assert.rejects(db.query("insert into wavespeed_analytics_state(user_id) values($1)",[owner]),e=>e.code==="42501");
  await db.exec("reset role");
 }
 await db.exec("set role service_role");
 await db.query("insert into wavespeed_analytics_state(user_id,report) values($1,'{\"balance\":3}')",[owner]);
 await db.query("insert into wavespeed_analytics_state(user_id,requested_at) values($1,now()) on conflict(user_id) do update set requested_at=excluded.requested_at",[owner]);
 assert.equal((await db.query("select report from wavespeed_analytics_state")).rows[0].report.balance,3);
 console.log("WaveSpeed ACL and refresh preservation passed");
}finally{await db.close();}
