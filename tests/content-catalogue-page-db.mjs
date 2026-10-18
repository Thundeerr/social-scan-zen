import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
const owner = crypto.randomUUID(), other = crypto.randomUUID();
const approved = crypto.randomUUID(), promoted = crypto.randomUUID();
const pending = crypto.randomUUID(), foreignReview = crypto.randomUUID();
const clip = crypto.randomUUID(), foreignClip = crypto.randomUUID(), offer = crypto.randomUUID();
const snapshot = async (user = owner, page = 0, reviewPage = 0) =>
  (await db.query("select catalogue_snapshot($1,$2,$3) as value", [user,page,reviewPage])).rows[0].value;
const assign = async (user, id, next, expected) =>
  (await db.query("select set_catalogue_clip_assignment($1,$2,$3,$4) as value",
    [user,id,next,expected])).rows[0].value;
const fails = (fn, message) => assert.rejects(fn, e => e.message === message);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.user_roles(user_id uuid,role text);
    grant select on public.user_roles to service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,
      public boolean,file_size_limit bigint,allowed_mime_types text[]);
  `);
  for (const name of [
    "20261006020101_reel_inbox.sql","20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql","20261011114403_model_pipeline_queue.sql",
    "20261018141733_content_catalogue.sql","20261018142834_promote_review_to_clip.sql",
    "20261018143846_catalogue_page_commands.sql",
  ]) await db.exec(await readFile(new URL("../supabase/migrations/" + name, import.meta.url),"utf8"));
  await db.query("insert into auth.users values($1),($2)",[owner,other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'owner')",[owner,other]);
  for (const [id,user,status] of [
    [approved,owner,"approved"],[promoted,owner,"approved"],
    [pending,owner,"pending"],[foreignReview,other,"approved"],
  ]) await db.query(`insert into content_review_items
    (id,user_id,model,title,media_path,status,sha256,bytes)
    values($1::uuid,$2,'kiikii','Test',$1::text,$3,repeat('a',64),100)`,[id,user,status]);
  await db.exec("set role service_role");
  await db.query(`insert into catalogue_clips(id,user_id,model,clip_code,review_item_id)
    values($1,$2,'kiikii','KII-V020',$3),($4,$5,'kiikii','KII-V020',$6)`,
    [clip,owner,promoted,foreignClip,other,foreignReview]);
  let data = await snapshot();
  assert.equal(data.clip_count,1);
  assert.deepEqual(data.reviews.map(r=>r.id),[approved]);
  assert.equal(data.review_count,1);
  assert.equal(data.clips[0].has_media,true);
  assert.equal(data.clips[0].review_revision,1);
  assert.equal(data.clips[0].in_offer,false);
  assert.equal((await snapshot(other)).clips[0].id,foreignClip);
  for (const [next,expected] of [["wall","unassigned"],["ppv","wall"],["unassigned","ppv"]])
    assert.equal((await assign(owner,clip,next,expected)).assignment,next);
  await fails(()=>assign(other,clip,"wall","unassigned"),"Clip not found");
  await fails(()=>assign(owner,clip,"wall","ppv"),"Assignment changed; refresh catalogue");
  await fails(()=>assign(owner,clip,"both","unassigned"),"Invalid assignment");
  await assign(owner,clip,"ppv","unassigned");
  await db.query("insert into catalogue_offers(id,user_id,model,title) values($1,$2,'kiikii','Test')",[offer,owner]);
  await db.query("insert into catalogue_offer_clips(offer_id,clip_id,user_id,model) values($1,$2,$3,'kiikii')",
    [offer,clip,owner]);
  assert.equal((await snapshot()).clips[0].in_offer,true);
  for (const value of ["wall","unassigned","ppv"])
    await fails(()=>assign(owner,clip,value,"ppv"),"Clip is inside an offer");
  // Missing media/source has a usable empty state; pagination covers every clip.
  await db.query(`insert into catalogue_clips(user_id,model,clip_code)
    select $1,'kiikii','KII-V' || (100+n)::text from generate_series(1,51) n`,[owner]);
  data = await snapshot();
  const second = await snapshot(owner,1);
  assert.equal(data.clip_count,52);
  assert.equal(data.clips.length,50);
  assert.equal(second.clips.length,2);
  assert.equal(new Set([...data.clips,...second.clips].map(c=>c.id)).size,52);
  assert(data.clips.some(c=>!c.has_media && c.review_revision===null));
  await fails(()=>snapshot(owner,-1),"Invalid catalogue page");
  assert.deepEqual((await snapshot(owner,0,1)).reviews,[]);
  await db.exec("reset role");
  await db.query("delete from user_roles where user_id=$1",[other]);
  await db.exec("set role service_role");
  await fails(()=>snapshot(other),"Catalogue owner required");
  await fails(()=>assign(other,foreignClip,"wall","unassigned"),"Catalogue owner required");
  for (const role of ["anon","authenticated"]) {
    await db.exec("set role " + role);
    await assert.rejects(()=>snapshot(),e=>e.code==="42501");
    await assert.rejects(()=>assign(owner,clip,"wall","ppv"),e=>e.code==="42501");
  }
  console.log("Catalogue page DB passed: owner isolation, approved/unpromoted filtering, media flags, pagination, assignment transitions, offer lock, stale updates and RPC grants.");
} finally { await db.close(); }
