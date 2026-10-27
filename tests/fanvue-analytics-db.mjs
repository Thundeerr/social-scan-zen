import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
// Vault crypto is supplied by production Supabase; this mock exercises permissions/transactions only.
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create schema vault;create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text unique);
create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text,n text) returns uuid language sql as $$insert into vault.secrets(secret,name) values(s,n) returning id$$;
create function vault.update_secret(i uuid,s text) returns void language sql as $$update vault.secrets set secret=s where id=i$$;`);
await db.exec(await readFile(new URL('../supabase/migrations/20261027192120_fanvue_analytics_connection.sql',import.meta.url),'utf8'));
const user=crypto.randomUUID(),lease=crypto.randomUUID();await db.query('insert into auth.users values($1)',[user]);
for(const role of ['anon','authenticated']) {
 await db.exec(`set role ${role}`);
 await assert.rejects(db.query('select * from fanvue_connections'));
 await assert.rejects(db.query('select fanvue_secret_get($1)',[user]));
 await assert.rejects(db.query('select fanvue_secret_put($1,$2)',[user,{}]));
 await assert.rejects(db.query('select * from fanvue_oauth_states'));
 await db.exec('reset role');
}
await db.exec('set role service_role');
await db.query('select fanvue_secret_put($1,$2)',[user,{clientSecret:'test'}]);
assert.equal((await db.query('select fanvue_secret_get($1) as s',[user])).rows[0].s.clientSecret,'test');
await assert.rejects(db.query('select fanvue_secret_put($1,$2)',[user,{clientSecret:'overwrite'}]));
await db.query("update fanvue_connections set lease_id=$2,lease_until=now()+interval '5 minutes' where user_id=$1",[user,lease]);
await assert.rejects(db.query('select fanvue_secret_put($1,$2,$3)',[user,{},crypto.randomUUID()]));
await db.query('select fanvue_secret_put($1,$2,$3)',[user,{clientSecret:'test',refreshToken:'rotated'},lease]);
assert.equal((await db.query('select fanvue_secret_get($1) as s',[user])).rows[0].s.refreshToken,'rotated');
await db.query("insert into fanvue_oauth_states values('hash',$1,'browser','verifier',now()+interval '10 minutes')",[user]);
assert.equal((await db.query("delete from fanvue_oauth_states where state_hash='hash' and browser_hash='wrong' returning *")).rows.length,0);
assert.equal((await db.query("delete from fanvue_oauth_states where state_hash='hash' and browser_hash='browser' and expires_at>now() returning *")).rows.length,1);
assert.equal((await db.query("delete from fanvue_oauth_states where state_hash='hash' returning *")).rows.length,0);
await db.close();console.log('PASS: browser roles denied, Vault RPC service-only, credential lease, browser-bound single-use state');
