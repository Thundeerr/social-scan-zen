import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
const owner = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc",
  other = crypto.randomUUID();
const call = async (action, data = {}, user = null) =>
  (
    await db.query("select public.model_alert_command($1,$2,$3) as value", [
      action,
      user,
      JSON.stringify(data),
    ])
  ).rows[0].value;
const admin = async (sql) => {
  await db.exec("reset role");
  await db.exec(sql);
  await db.exec("set role service_role");
};
const publish = async (ig, extra = {}) => {
  const id = crypto.randomUUID();
  await db.query("insert into content_posts values($1,$2,$3,$4)", [
    id,
    owner,
    extra.postStatus ?? "published",
    extra.unapproved ? null : new Date(),
  ]);
  await db.query(
    "insert into content_publications(id,content_post_id,status,channel,platform_media_id,permalink,published_at,published_ig_user_id) values($1,$1,$2,$3,'media',$4,now()+($5||' minutes')::interval,$6)",
    [
      id,
      extra.status ?? "published",
      extra.channel ?? "reel",
      extra.url ?? "https://www.instagram.com/reel/example/",
      String(extra.minutes ?? 0),
      ig,
    ],
  );
  return id;
};
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table user_roles(user_id uuid,role text);
 create table content_posts(id uuid primary key,user_id uuid,status text,approved_at timestamptz);
 create table content_publications(id uuid primary key,content_post_id uuid,status text,channel text,platform_media_id text,permalink text,published_at timestamptz);
 create table ig_connections(id uuid primary key,user_id uuid,status text,ig_user_id text,ig_username text);
 grant all on all tables in schema public to service_role;
 create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;`);
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("insert into user_roles values($1,'owner')", [owner]);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261011102726_channel_alerts.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec("set role service_role");
  assert.equal((await call("status", {}, owner)).channels.length, 2);
  await assert.rejects(call("status", {}, other));
  await assert.rejects(
    call("configure", { model: "kiikii", connection_id: crypto.randomUUID() }, owner),
  );
  await publish("followerstar");
  assert.equal(await call("claim", { allow_send: true }), null);
  await admin("update model_alert_channels set ig_user_id=model,ig_username=model,bot_ready=true");
  await publish("kiikii", { unapproved: true });
  await publish("kiikii", { status: "failed" });
  await publish("kiikii", { channel: "story" });
  await publish("kiikii", { minutes: -180 });
  await publish("kiikii", { url: "https://evil.example/reel/example/" });
  assert.equal(await call("claim", { allow_send: true }), null);
  const first = await publish("kiikii");
  await publish("kiikii");
  const tuuva = await publish("tuuva");
  const a = await call("claim", { allow_send: true }),
    b = await call("claim", { allow_send: true });
  assert.equal(a.model, "kiikii");
  assert.equal(b.model, "tuuva");
  assert.equal(b.publication_id, tuuva);
  assert.equal(a.chat_id, "-1003904760564");
  assert.equal(b.chat_id, "-1003979039770");
  assert.equal(await call("claim", { allow_send: true }), null);
  await call("uncertain", { id: a.id, lease: a.lease });
  await publish("kiikii");
  assert.equal(await call("claim", { allow_send: true }), null); // uncertain delivery still uses daily slot
  const date = Math.floor(Date.now() / 1000);
  await call("sent", { id: b.id, lease: b.lease, message_id: 42, date });
  const row = (await db.query("select * from model_channel_alerts where id=$1", [b.id])).rows[0];
  assert.equal(new Date(row.delete_after) - new Date(row.sent_at), 12 * 60 * 60 * 1000);
  assert.equal(await call("claim", { allow_send: false }), null); // not due yet
  await call("configure", { model: "tuuva", enabled: false, connection_id: null }, owner);
  await admin(
    `update model_channel_alerts set delete_after=now()-interval '1 minute' where id='${b.id}'`,
  );
  const deletion = await call("claim", { allow_send: false });
  assert.equal(deletion.state, "deleting");
  assert.equal(deletion.message_id, 42);
  assert.equal(await call("claim", { allow_send: false }), null); // lease prevents duplicate claim
  await call("delete_retry", { id: b.id, lease: deletion.lease });
  assert.equal(await call("claim", { allow_send: false }), null); // retry backoff
  await admin(
    `update model_channel_alerts set retry_at=now()-interval '1 minute' where id='${b.id}'`,
  );
  const retry = await call("claim", { allow_send: false });
  await assert.rejects(call("deleted", { id: b.id, lease: deletion.lease }));
  await call("deleted", { id: b.id, lease: retry.lease });
  assert.equal(await call("claim", { allow_send: false }), null);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select * from model_channel_alerts")).rows.length, 0);
  await assert.rejects(call("status", {}, owner));
  await assert.rejects(db.exec("update model_alert_channels set enabled=true"));
  await db.exec("reset role; set role anon");
  await assert.rejects(db.exec("select * from model_alert_channels"));
  console.log(
    "Channel alerts DB passed: routing, eligibility, daily cap, uncertain delivery, 12h deletion, pause/unmap deletion, retry leases, owner authorization and RLS.",
  );
} finally {
  await db.close();
}
