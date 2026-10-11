import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(),
  owner = crypto.randomUUID();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table ig_connections(id uuid primary key default gen_random_uuid(),user_id uuid unique,ig_user_id text,status text,token_expires_at timestamptz);
 create table ig_oauth_states(state text);
 create table content_posts(id uuid primary key default gen_random_uuid(),user_id uuid,status text,scheduled_for timestamptz);
 grant all on all tables in schema public to service_role;
 grant select,insert,update on content_posts to authenticated;
 grant select on ig_connections to authenticated;`);
  await db.query(
    "insert into ig_connections(user_id,ig_user_id,status,token_expires_at) values($1,'followerstar','active',now()+interval '10 days')",
    [owner],
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261011110112_model_publishing_accounts.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    (await db.query("select destination from ig_connections")).rows[0].destination,
    "followerstar",
  );
  await db.exec("set role service_role");
  const post = (
    await db.query(
      "insert into content_posts(user_id,status,destination) values($1,'approved','kiikii') returning id",
      [owner],
    )
  ).rows[0].id;
  await assert.rejects(db.query("update content_posts set status='scheduled' where id=$1", [post]));
  await db.query(
    "insert into ig_connections(user_id,ig_user_id,status,token_expires_at,destination) values($1,'kiikii','active',now()+interval '10 days','kiikii')",
    [owner],
  );
  assert.equal((await db.query("select * from ig_connections")).rows.length, 2);
  await assert.rejects(
    db.query(
      "insert into ig_connections(user_id,ig_user_id,destination) values($1,'followerstar','tuuva')",
      [owner],
    ),
  );
  await db.query("update content_posts set status='scheduled' where id=$1", [post]);
  await assert.rejects(
    db.query("update content_posts set destination='followerstar' where id=$1", [post]),
  );
  await db.exec("reset role;set role authenticated");
  await assert.rejects(
    db.query("insert into content_posts(user_id,status,destination) values($1,'draft','kiikii')", [
      owner,
    ]),
  );
  await db.query("insert into content_posts(user_id,status) values($1,'draft')", [owner]);
  console.log(
    "Model account DB passed: legacy defaults, separate accounts, no cross-destination scheduling, immutable destinations, service-only model inserts, duplicate IG prevention.",
  );
} finally {
  await db.close();
}
