import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const db=new PGlite(),owner=crypto.randomUUID();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create schema vault; create table vault.test_secrets(id uuid primary key default gen_random_uuid(),decrypted_secret text,name text);
 create view vault.decrypted_secrets as select * from vault.test_secrets;
 create function vault.create_secret(s text,n text) returns uuid language sql as $$insert into vault.test_secrets(decrypted_secret,name) values(s,n) returning id$$;
 create function vault.update_secret(i uuid,s text) returns void language sql as $$update vault.test_secrets set decrypted_secret=s where id=i$$;`);
 // Vault is stubbed locally: tests ACL and wiring, not provider encryption.
 await db.exec(await readFile(new URL("../supabase/migrations/20261028170827_closer_analytics_connection.sql",import.meta.url),"utf8"));
 await db.query("insert into auth.users values ($1)",[owner]);
 for(const role of ["anon","authenticated"]) {
  await db.exec(`set role ${role}`);
  for(const sql of ["select * from closer_analytics_connections",`select closer_analytics_secret_get('${owner}')`,`select closer_analytics_secret_put('${owner}','abcdefghijklmnop')`])
   await assert.rejects(db.exec(sql),e=>e.code==="42501");
  await db.exec("reset role");
 }
 await db.exec("set role service_role");
 await db.query("select closer_analytics_secret_put($1,'abcdefghijklmnop')",[owner]);
 assert.equal((await db.query("select closer_analytics_secret_get($1) as token",[owner])).rows[0].token,"abcdefghijklmnop");
 await db.query("update closer_analytics_connections set last_attempt_at=now() where user_id=$1",[owner]);
 await assert.rejects(db.query("select closer_analytics_secret_put($1,'replacementtoken')",[owner]),e=>e.code==="P0001");
 console.log("Closer credential ACL and in-flight replacement protection passed");
} finally {await db.close();}
