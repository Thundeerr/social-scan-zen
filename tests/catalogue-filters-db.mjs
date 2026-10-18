import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(), owner = crypto.randomUUID(), other = crypto.randomUUID();
const snapshot = async (filters = {}, page = 0) =>
  (await db.query("select catalogue_snapshot($1,$2,0,$3) as value", [owner,page,filters])).rows[0].value;
const codes = async filters => (await snapshot(filters)).clips.map(c=>c.clip_code);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    grant usage on schema auth to authenticated;
    create table user_roles(user_id uuid,role text);
    grant select on user_roles to service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,
      public boolean,file_size_limit bigint,allowed_mime_types text[]);
  `);
  for (const name of [
    "20261006020101_reel_inbox.sql","20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql","20261011114403_model_pipeline_queue.sql",
    "20261018141733_content_catalogue.sql","20261018142834_promote_review_to_clip.sql",
    "20261018143846_catalogue_page_commands.sql","20261018145344_catalogue_offer_commands.sql",
    "20261018150907_catalogue_filters.sql",
  ]) await db.exec(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"));
  await db.query("insert into auth.users values($1),($2)",[owner,other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'owner')",[owner,other]);
  await db.exec("set role service_role");
  for (const [user,model,code,assignment,day] of [
    [owner,"kiikii","KII-V001","unassigned",1],
    [owner,"kiikii","KII-V002","wall",5],
    [owner,"kiikii","KII-V003","ppv",3],
    [owner,"tuuva","TUU-V001","ppv",2],
    [other,"kiikii","KII-V999","ppv",6],
  ]) await db.query(`insert into catalogue_clips(user_id,model,clip_code,assignment,created_at)
    values($1,$2,$3,$4,$5)`,[user,model,code,assignment,"2026-10-0"+day+"T00:00:00Z"]);
  const command = async(user,action,data) =>
    (await db.query("select catalogue_offer_command($1,$2,$3) as value",[user,action,data])).rows[0].value;
  for (const title of ["Beta","Alpha"]) {
    const offer = await command(owner,"create",{title,model:"kiikii"});
    await command(owner,"add",{offer_id:offer.id,clip_code:"KII-V003"});
  }
  const privateOffer = await command(other,"create",{title:"Private",model:"kiikii"});
  await command(other,"add",{offer_id:privateOffer.id,clip_code:"KII-V999"});
  assert.deepEqual(await codes({}),["KII-V002","KII-V003","TUU-V001","KII-V001"]);
  assert.deepEqual(await codes({sort:"clip_code"}),["KII-V001","KII-V002","KII-V003","TUU-V001"]);
  assert.deepEqual(await codes({sort:"assignment"}),["KII-V001","KII-V002","KII-V003","TUU-V001"]);
  assert.deepEqual(await codes({model:"tuuva"}),["TUU-V001"]);
  assert.deepEqual(await codes({assignment:"wall"}),["KII-V002"]);
  assert.deepEqual(await codes({assignment:"unassigned"}),["KII-V001"]);
  assert.deepEqual(await codes({membership:"in_offer"}),["KII-V003"]);
  assert.deepEqual(await codes({assignment:"ppv",membership:"no_offer"}),["TUU-V001"]);
  assert.deepEqual(await codes({model:"kiikii",assignment:"ppv",membership:"in_offer",search:"  kii-v003  "}),["KII-V003"]);
  assert.deepEqual(await codes({search:"%"}),[]);
  assert.deepEqual(await codes({search:"_"}),[]);
  assert.deepEqual((await snapshot({membership:"in_offer"})).clips[0].offers.map(o=>o.title),["Alpha","Beta"]);
  assert.deepEqual((await snapshot({assignment:"wall"})).clips[0].offers,[]);
  assert.equal((await db.query("select catalogue_snapshot($1,0,0) as value",[owner])).rows[0].value.clip_count,4);
  for (const filters of [{model:"bad"},{assignment:"bad"},{membership:"bad"},{sort:"bad"},{search:"a".repeat(201)},null,[]])
    await assert.rejects(()=>snapshot(filters),e=>e.message==="Invalid catalogue filters");
  await db.query(`insert into catalogue_clips(user_id,model,clip_code)
    select $1,'tuuva','TUU-V'||n from generate_series(100,154) n`,[owner]);
  const first = await snapshot({model:"tuuva",sort:"clip_code"});
  const second = await snapshot({model:"tuuva",sort:"clip_code"},1);
  assert.equal(first.clip_count,56); assert.equal(first.clips.length,50); assert.equal(second.clips.length,6);
  assert.equal(new Set([...first.clips,...second.clips].map(c=>c.id)).size,56);
  assert.equal((await snapshot({model:"kiikii"})).clip_count,3);
  for (const role of ["anon","authenticated"]) {
    await db.exec("set role "+role);
    await assert.rejects(()=>snapshot(),e=>e.code==="42501");
  }
  console.log("Catalogue filters passed: search, sorting, membership, multiple titles, isolation, pagination, validation and grants.");
} finally { await db.close(); }
