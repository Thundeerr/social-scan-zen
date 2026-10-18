import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
const owner = crypto.randomUUID(), other = crypto.randomUUID();
const review = crypto.randomUUID(), otherReview = crypto.randomUUID();
const tuuvaReview = crypto.randomUUID(), job = crypto.randomUUID();
const clip = crypto.randomUUID(), wall = crypto.randomUUID();
const offer = crypto.randomUUID(), otherOffer = crypto.randomUUID();
const tuuvaOffer = crypto.randomUUID();
const rejects = async (sql, params, code) =>
  assert.rejects(db.query(sql, params), (error) => error.code === code);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.user_roles(user_id uuid, role text);
    grant select on public.user_roles to service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,
      file_size_limit bigint,allowed_mime_types text[]);
  `);
  for (const file of [
    "20261006020101_reel_inbox.sql", "20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql", "20261011114403_model_pipeline_queue.sql",
    "20261018141733_content_catalogue.sql",
  ]) await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  await db.query("insert into auth.users values ($1),($2)", [owner, other]);
  for (const [id, user, model] of [
    [review,owner,"kiikii"], [otherReview,other,"kiikii"], [tuuvaReview,owner,"tuuva"],
  ]) await db.query(`insert into content_review_items(id,user_id,model,title,media_path)
    values($1::uuid,$2,$3,'test',$1::text)`, [id,user,model]);
  await db.query("insert into model_pipeline_settings(user_id) values($1)", [owner]);
  await db.query("insert into model_pipeline_profiles(user_id,model) values($1,'kiikii')", [owner]);
  const inbox = crypto.randomUUID();
  await db.query(`insert into reel_inbox_items(id,user_id,shortcode,canonical_url)
    values($1,$2,'Abc123','https://www.instagram.com/reel/Abc123/')`, [inbox,owner]);
  await db.query(`insert into model_pipeline_jobs(id,user_id,model,inbox_id,review_id)
    values($1,$2,'kiikii',$3,$4)`, [job,owner,inbox,review]);
  await db.exec("set role service_role");
  const insertClip = `insert into catalogue_clips
    (id,user_id,model,clip_code,assignment,review_item_id,pipeline_job_id)
    values($1,$2,'kiikii',$3,$4,$5,$6)`;
  await db.query(insertClip,[clip,owner,"KII-V020","ppv",review,job]);
  await db.query(insertClip,[wall,owner,"KII-V021","wall",null,null]);
  await rejects(insertClip,[crypto.randomUUID(),owner,"KII-V020","ppv",null,null],"23505");
  await rejects(insertClip,[crypto.randomUUID(),owner,"TUU-V022","ppv",null,null],"23514");
  await rejects(insertClip,[crypto.randomUUID(),owner,"KII-V022","ppv",otherReview,null],"23503");
  await rejects(insertClip,[crypto.randomUUID(),owner,"KII-V022","ppv",tuuvaReview,null],"23503");
  await rejects(insertClip,[crypto.randomUUID(),other,"KII-V022","ppv",null,job],"23503");
  await rejects("update catalogue_clips set clip_code='KII-V099' where id=$1",[clip],"P0001");
  for (const [id,user,model] of [[offer,owner,"kiikii"],[otherOffer,other,"kiikii"],[tuuvaOffer,owner,"tuuva"]])
    await db.query("insert into catalogue_offers(id,user_id,model,title) values($1,$2,$3,'Bundle')",[id,user,model]);
  const member = "insert into catalogue_offer_clips(offer_id,clip_id,user_id,model) values($1,$2,$3,$4)";
  await db.query(member,[offer,clip,owner,"kiikii"]);
  await rejects(member,[offer,wall,owner,"kiikii"],"23503");
  await rejects(member,[otherOffer,clip,owner,"kiikii"],"23503");
  await rejects(member,[tuuvaOffer,clip,owner,"tuuva"],"23503");
  await rejects("update catalogue_offer_clips set assignment='wall' where clip_id=$1",[clip],"23514");
  await rejects("update catalogue_clips set assignment='wall' where id=$1",[clip],"23503");
  await rejects("update catalogue_clips set assignment='unassigned' where id=$1",[clip],"23503");
  // A bundle can contain multiple PPV clips.
  await db.query("update catalogue_clips set assignment='ppv' where id=$1",[wall]);
  await db.query(member,[offer,wall,owner,"kiikii"]);
  const receipt = `insert into catalogue_clip_recipients
    (clip_id,user_id,model,recipient_key,receipt_kind)
    values($1,$2,'kiikii','fanvue:example',$3)`;
  await db.query(receipt,[clip,owner,"paid"]);
  await db.query(receipt,[clip,owner,"free"]);
  await rejects(receipt,[clip,owner,"paid"],"23505");
  await rejects(receipt,[wall,other,"paid"],"23503");
  await rejects("delete from catalogue_clips where id=$1",[clip],"23503");
  // Assignment changes require removing membership; recipient records survive.
  await db.query("delete from catalogue_offer_clips where clip_id=$1",[clip]);
  await db.query("update catalogue_clips set assignment='wall' where id=$1",[clip]);
  assert.equal((await db.query("select * from catalogue_clip_recipients")).rows.length,2);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  for (const table of ["catalogue_clips","catalogue_offers","catalogue_offer_clips","catalogue_clip_recipients"]) {
    const rows = (await db.query("select * from " + table)).rows;
    assert(rows.length > 0);
    assert(rows.every((row) => row.user_id === owner));
    await rejects("delete from " + table,[],"42501");
    await rejects("update " + table + " set user_id=$1",[other],"42501");
    await rejects("insert into " + table + " default values",[],"42501");
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  assert.equal((await db.query("select * from catalogue_clips")).rows.length,0);
  assert.equal((await db.query("select * from catalogue_offers")).rows.length,1);
  assert.equal((await db.query("select * from catalogue_offer_clips")).rows.length,0);
  assert.equal((await db.query("select * from catalogue_clip_recipients")).rows.length,0);
  await db.exec("set role anon");
  for (const table of ["catalogue_clips","catalogue_offers","catalogue_offer_clips","catalogue_clip_recipients"])
    await rejects("select * from " + table,[],"42501");
  console.log("Catalogue DB passed: real prerequisite migrations, source isolation, immutable IDs, bundles, bidirectional wall/PPV exclusion, recipient preservation, duplicates, RLS and grants.");
} finally { await db.close(); }
