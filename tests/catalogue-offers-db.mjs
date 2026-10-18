import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(), owner = crypto.randomUUID(), other = crypto.randomUUID();
const unassigned = crypto.randomUUID(), ppv = crypto.randomUUID();
const wall = crypto.randomUUID(), tuuva = crypto.randomUUID(), foreignClip = crypto.randomUUID();
const command = async (user, action, data = {}) =>
  (await db.query("select catalogue_offer_command($1,$2,$3) as value",[user,action,data])).rows[0].value;
const fails = (fn, message) => assert.rejects(fn,e=>e.message===message);
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
  ]) await db.exec(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"));
  await db.query("insert into auth.users values($1),($2)",[owner,other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'owner')",[owner,other]);
  await db.exec("set role service_role");
  for (const [id,user,model,code,assignment] of [
    [unassigned,owner,"kiikii","KII-V001","unassigned"],[ppv,owner,"kiikii","KII-V002","ppv"],
    [wall,owner,"kiikii","KII-V003","wall"],[tuuva,owner,"tuuva","TUU-V001","unassigned"],
    [foreignClip,other,"kiikii","KII-V004","ppv"],
  ]) await db.query(`insert into catalogue_clips(id,user_id,model,clip_code,assignment)
    values($1,$2,$3,$4,$5)`,[id,user,model,code,assignment]);
  const offer = await command(owner,"create",{title:"  First bundle  ",model:"kiikii"});
  const foreignOffer = await command(other,"create",{title:"Private",model:"kiikii"});
  const tuuvaOffer = await command(owner,"create",{title:"Tuuva",model:"tuuva"});
  assert.equal(offer.title,"First bundle");
  assert.equal(offer.user_id,owner);
  for (const data of [{title:" ",model:"kiikii"},{title:"Test",model:"other"},{model:"kiikii"}])
    await fails(()=>command(owner,"create",data),"Invalid offer title or character");
  await fails(()=>command(owner,"add",{offer_id:foreignOffer.id,clip_code:"KII-V001"}),"Offer not found");
  assert.equal((await db.query("select assignment from catalogue_clips where id=$1",[unassigned])).rows[0].assignment,"unassigned");
  await fails(()=>command(owner,"add",{offer_id:offer.id,clip_code:"KII-V004"}),"Clip not found");
  await fails(()=>command(owner,"add",{offer_id:offer.id,clip_code:"TUU-V001"}),"Clip and offer characters differ");
  await fails(()=>command(owner,"add",{offer_id:offer.id,clip_code:"KII-V003"}),"Wall clips cannot enter offers");
  for (const code of ["KII-V001","KII-V002","KII-V001"])
    await command(owner,"add",{offer_id:offer.id,clip_code:code});
  await command(owner,"add",{offer_id:tuuvaOffer.id,clip_code:"TUU-V001"});
  let list = await command(owner,"list");
  assert.equal(list.total,2);
  assert(list.offers.every(o=>o.user_id===owner));
  assert.equal(list.offers.find(o=>o.id===offer.id).clips.length,2);
  assert.equal((await db.query("select assignment from catalogue_clips where id=$1",[unassigned])).rows[0].assignment,"ppv");
  assert.equal((await command(other,"list")).offers[0].id,foreignOffer.id);
  await assert.rejects(()=>db.query(`insert into catalogue_offer_clips(offer_id,clip_id,user_id,model)
    values($1,$2,$3,'kiikii')`,[offer.id,wall,owner]),e=>e.code==="23503");
  await fails(()=>db.query("select set_catalogue_clip_assignment($1,$2,'wall','ppv')",[owner,unassigned]),"Clip is inside an offer");
  await fails(()=>command(other,"remove",{offer_id:offer.id,clip_id:unassigned}),"Clip not found");
  await db.query(`insert into catalogue_clip_recipients(clip_id,user_id,model,recipient_key,receipt_kind)
    values($1,$2,'kiikii','fanvue:test','paid')`,[unassigned,owner]);
  for (let i=0;i<2;i++) await command(owner,"remove",{offer_id:offer.id,clip_id:unassigned});
  assert.equal((await command(owner,"list")).offers.find(o=>o.id===offer.id).clips.length,1);
  assert.equal((await db.query("select assignment from catalogue_clips where id=$1",[unassigned])).rows[0].assignment,"ppv");
  assert.equal((await db.query("select count(*)::int n from catalogue_clip_recipients")).rows[0].n,1);
  await db.query("select set_catalogue_clip_assignment($1,$2,'wall','ppv')",[owner,unassigned]);
  await db.query(`insert into catalogue_offers(user_id,model,title)
    select $1,'kiikii','Extra '||n from generate_series(1,50) n`,[owner]);
  list = await command(owner,"list",{page:0});
  const next = await command(owner,"list",{page:1});
  assert.equal(list.total,52);
  assert.equal(list.offers.length,50);
  assert.equal(next.offers.length,2);
  assert.equal(new Set([...list.offers,...next.offers].map(o=>o.id)).size,52);
  await fails(()=>command(owner,"list",{page:-1}),"Invalid page");
  await db.exec("reset role");
  await db.query("delete from user_roles where user_id=$1",[other]);
  await db.exec("set role service_role");
  await fails(()=>command(other,"list"),"Catalogue owner required");
  for (const role of ["anon","authenticated"]) {
    await db.exec("set role "+role);
    await assert.rejects(()=>command(owner,"create",{title:"No",model:"kiikii"}),e=>e.code==="42501");
  }
  console.log("Offer DB passed: create/list, pagination, owner/model isolation, atomic PPV assignment, idempotent add/remove, wall exclusion, recipient preservation and grants.");
} finally { await db.close(); }
