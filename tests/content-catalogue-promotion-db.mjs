import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();
const owner = crypto.randomUUID(), other = crypto.randomUUID();
const review = crypto.randomUUID(), tuuva = crypto.randomUUID();
const pending = crypto.randomUUID(), extra = crypto.randomUUID();
const job = crypto.randomUUID(), wrongJob = crypto.randomUUID();
const promote = async (user, id, code, source = null) =>
  (await db.query(
    "select public.promote_review_item_to_clip($1,$2,$3,$4) as clip",
    [user, id, code, source],
  )).rows[0].clip;
const fails = (fn, message) =>
  assert.rejects(fn, (error) => error.message === message);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.user_roles(user_id uuid, role text);
    grant select on public.user_roles to service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,
      file_size_limit bigint,allowed_mime_types text[]);
  `);
  for (const name of [
    "20261006020101_reel_inbox.sql",
    "20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql",
    "20261011114403_model_pipeline_queue.sql",
    "20261018141733_content_catalogue.sql",
    "20261018142834_promote_review_to_clip.sql",
  ]) await db.exec(await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"));
  await db.query("insert into auth.users values($1),($2)", [owner,other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'owner')", [owner,other]);
  for (const [id, model, status] of [
    [review,"kiikii","approved"], [tuuva,"tuuva","approved"],
    [pending,"kiikii","pending"], [extra,"kiikii","approved"],
  ]) await db.query(`insert into content_review_items
    (id,user_id,model,title,media_path,status,sha256,bytes)
    values($1::uuid,$2,$3,'Test',$1::text,$4,repeat('a',64),100)`,
    [id,owner,model,status]);
  await db.query("insert into model_pipeline_settings(user_id) values($1)", [owner]);
  await db.query("insert into model_pipeline_profiles(user_id,model) values($1,'kiikii')", [owner]);
  for (const [id, source, shortcode] of [[job,review,"Clip001"],[wrongJob,extra,"Clip002"]]) {
    const inbox = crypto.randomUUID();
    await db.query(`insert into reel_inbox_items(id,user_id,shortcode,canonical_url)
      values($1,$2,$3,'https://www.instagram.com/reel/' || $3 || '/')`,[inbox,owner,shortcode]);
    await db.query(`insert into model_pipeline_jobs(id,user_id,model,inbox_id,review_id)
      values($1,$2,'kiikii',$3,$4)`,[id,owner,inbox,source]);
  }
  await db.exec("set role service_role");
  await fails(() => promote(other,review,"KII-V020"), "Review not found");
  await fails(() => promote(owner,pending,"KII-V020"), "Review must be approved");
  for (const code of [null,"bad","KII-V20","TUU-V020"," KII-V020"])
    await fails(() => promote(owner,review,code), "Invalid clip code for character");
  await fails(() => promote(owner,review,"KII-V020",wrongJob), "Pipeline job does not match review");
  const clip = await promote(owner,review,"KII-V020");
  assert.equal(clip.assignment,"unassigned");
  assert.equal(clip.review_item_id,review);
  assert.equal(clip.pipeline_job_id,job);
  assert.equal(clip.user_id,owner);
  assert.equal(clip.model,"kiikii");
  assert.equal((await promote(owner,review,"KII-V020",job)).id,clip.id);
  await db.query("update catalogue_clips set assignment='wall' where id=$1",[clip.id]);
  assert.equal((await promote(owner,review,"KII-V020")).assignment,"wall");
  await fails(() => promote(owner,review,"KII-V021"), "Review already promoted with different details");
  await assert.rejects(() => promote(owner,extra,"KII-V020"), e => e.code === "23505");
  // Unique index also protects writes that do not go through the promotion RPC.
  await assert.rejects(() => db.query(`insert into catalogue_clips
    (user_id,model,clip_code,review_item_id) values($1,'kiikii','KII-V099',$2)`,
    [owner,review]), e => e.code === "23505");
  const tuuvaClip = await promote(owner,tuuva,"TUU-V001");
  assert.equal(tuuvaClip.pipeline_job_id,null);
  assert.equal(tuuvaClip.model,"tuuva");
  assert.equal((await db.query("select count(*)::int as n from catalogue_clips")).rows[0].n,2);
  // Losing approval blocks promotion even on retries.
  await db.query("update content_review_items set status='changes' where id=$1",[review]);
  await fails(() => promote(owner,review,"KII-V020"), "Review must be approved");
  await db.exec("reset role");
  await db.query("delete from user_roles where user_id=$1",[owner]);
  await db.exec("set role service_role");
  await fails(() => promote(owner,extra,"KII-V022"), "Catalogue owner required");
  for (const role of ["anon","authenticated"]) {
    await db.exec("set role " + role);
    await assert.rejects(() => promote(owner,extra,"KII-V022"), e => e.code === "42501");
  }
  console.log("Promotion DB passed: approval/owner checks, code validation, job matching, idempotency, assignment preservation, unique reviews, duplicate codes, role restrictions.");
} finally { await db.close(); }
