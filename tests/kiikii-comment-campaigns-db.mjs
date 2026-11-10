import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();
const owner = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
const post = "9c7203d1-3d4a-4d85-881b-613ac5fa042f";
const receiver = "17841416918437774";
const media = "18196729870394207";
let checks = 0;
const equal = (actual, expected, why) => { assert.equal(actual, expected, why); checks++; };

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table user_roles(user_id uuid,role text); grant select on user_roles to service_role;
    create table ig_oauth_states(state text);
    create table content_posts(id uuid primary key,user_id uuid,destination text,status text,published_at timestamptz);
    create table content_publications(content_post_id uuid,channel text,status text,platform_media_id text,published_ig_user_id text);
    alter table content_posts enable row level security; alter table content_publications enable row level security;
    grant all on content_posts,content_publications to service_role;`);
  for (const file of [
    "20261102180531_kiikii_dm_redirect.sql",
    "20261103150628_kiikii_comment_private_replies.sql",
    "20261103160246_kiikii_comment_test_reply.sql",
  ]) await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  await db.query("insert into auth.users values($1);", [owner]);
  await db.query("insert into user_roles values($1,'owner')", [owner]);
  await db.query("insert into ig_dm_redirect_settings(user_id,receiver_id,mode) values($1,$2,'off')", [owner,receiver]);
  await db.query("insert into content_posts values($1,$2,'kiikii','published',now()-interval '2 days')", [post,owner]);
  await db.query("insert into content_publications values($1,'reel','published',$2,$3)", [post,media,receiver]);
  await db.query(`insert into ig_dm_redirect_receipts(user_id,message_hash,sender_id,event_at,status,source,provider_message_id)
    values($1,encode(sha256(convert_to('comment:18473482705191162','UTF8')),'hex'),'1569413477836896',now()-interval '1 day','sent','comment','real-test-message')`, [owner]);
  const migration = await readFile(new URL("../supabase/migrations/20261110075233_kiikii_comment_webhook_campaign.sql", import.meta.url), "utf8");
  await db.exec("begin; delete from ig_dm_redirect_receipts");
  await assert.rejects(db.exec(migration), /successful Kiikii test receipt/); checks++;
  await db.exec("rollback");
  equal((await db.query("select to_regclass('public.ig_comment_campaigns') name")).rows[0].name, null, "failed seed guard leaves no partial schema when applied transactionally");
  await db.exec(migration);

  let sequence = 1000;
  const reserve = async ({ receiverId=receiver, mediaId=media, sender="20", comment=String(++sequence), at=new Date().toISOString(), username="visitor", text="<3" } = {}) => (
    await db.query("select ig_comment_campaign_reserve($1,$2,$3,$4,$5,$6,$7) result", [receiverId,mediaId,sender,comment,at,username,text])
  ).rows[0].result;
  equal((await db.query("select count(*)::int n from ig_comment_campaigns where enabled=false")).rows[0].n, 1, "migration prepares one disabled campaign");
  equal((await db.query("select campaign_media_id from ig_dm_redirect_receipts where sender_id='1569413477836896'")).rows[0].campaign_media_id, media, "successful prior test is seeded");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const sql of ["select * from ig_comment_campaigns", "update ig_comment_campaigns set enabled=true", "select * from ig_dm_redirect_receipts"]) {
      await assert.rejects(db.query(sql)); checks++;
    }
    await assert.rejects(reserve()); checks++;
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  equal((await reserve()).ignored, true, "disabled campaign cannot reserve");
  await db.exec("update ig_comment_campaigns set enabled=true");
  equal((await reserve({sender:"1569413477836896"})).duplicate, true, "test sender cannot receive another intro on a new comment");
  for (const args of [
    {receiverId:"99"}, {mediaId:"99"}, {sender:receiver}, {sender:"invalid"}, {comment:"invalid"},
    {username:"KIIKII.BAT"}, {text:"<33"}, {text:"❤"}, {text:"hi <3"}, {text:null},
    {at:new Date(Date.now()-8*86400000).toISOString()}, {at:new Date(Date.now()+600000).toISOString()},
  ]) equal((await reserve(args)).ignored, true, `reject out-of-scope event ${JSON.stringify(args)}`);
  equal((await reserve({comment:"2001"})).send, true, "valid campaign works while old DM mode remains off");
  equal((await reserve({comment:"2001"})).duplicate, true, "same comment replay cannot send");
  equal((await reserve({comment:"2002"})).duplicate, true, "second comment from same person cannot send");
  equal((await db.query("select status from ig_dm_redirect_receipts where comment_id='2001'")).rows[0].status,"reserved","intent persists before any network send");
  for (const status of ["sent","failed","uncertain"]) {
    await db.query("update ig_dm_redirect_receipts set status=$1 where comment_id='2001'", [status]);
    await db.exec("update ig_dm_redirect_contacts set last_attempt_at=now()-interval '2 days'");
    equal((await reserve()).duplicate,true,`${status} attempt remains suppressed after cooldown`);
  }
  await db.query("insert into ig_dm_redirect_contacts(user_id,sender_id,opted_out) values($1,'21',true)", [owner]);
  equal((await reserve({sender:"21",comment:"2101"})).send,false,"existing opt-out prevents sending");
  equal((await db.query("select status from ig_dm_redirect_receipts where comment_id='2101'")).rows[0].status,"opted_out","opt-out has durable receipt");
  await db.query("insert into ig_dm_redirect_contacts(user_id,sender_id,last_attempt_at) values($1,'22',now())", [owner]);
  equal((await reserve({sender:"22",comment:"2201"})).send,false,"shared 24h cooldown applies");
  equal((await db.query("select status from ig_dm_redirect_receipts where comment_id='2201'")).rows[0].status,"cooldown","cooldown has durable receipt");
  equal((await reserve({sender:"23"})).send,true,"different recipient can receive intro");
  await db.exec("update ig_dm_redirect_settings set mode='live'");
  equal((await reserve({sender:"24"})).ignored,true,"old responder live prevents campaign conflict");
  await db.exec("update ig_dm_redirect_settings set mode='off'; update content_publications set published_ig_user_id='99'");
  equal((await reserve({sender:"24"})).ignored,true,"wrong publication owner prevents sending");
  await db.query("update content_publications set published_ig_user_id=$1",[receiver]);
  await db.exec("update content_posts set status='draft'");
  equal((await reserve({sender:"24"})).ignored,true,"unpublished target cannot send");
  await db.exec("update content_posts set status='published'; update ig_comment_campaigns set enabled=false");
  equal((await reserve({sender:"24"})).ignored,true,"pause blocks new reservations");
  await db.exec("update ig_comment_campaigns set enabled=true; reset role; delete from user_roles; set role service_role");
  equal((await reserve({sender:"24"})).ignored,true,"revoked owner role prevents sending");
  console.log(`PASS: ${checks} campaign DB checks: disabled seed, permissions/RLS, exact target/trigger, prior test dedupe, durable intent, terminal attempt dedupe, shared cooldown/opt-out, publication identity and pause.`);
} finally {
  await db.close();
}
