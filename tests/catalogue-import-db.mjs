import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(), owner = crypto.randomUUID(), other = crypto.randomUUID();
const videos = {clips: [
 {clipId:"KII-V001",channel:"PPV",currentTemplates:["KII-001"],paidOwners:["@sample"],freeRecipients:["@sample"],mediaId:"sample-media"},
 {clipId:"KII-V002",channel:"WALL ONLY",currentTemplates:[],paidOwners:[],freeRecipients:[],confirmedWallBuyers:["Display name"]},
 {clipId:"KII-V003",channel:"UNASSIGNED / REVIEW",currentTemplates:[],paidOwners:[],freeRecipients:["@other"]},
]};
const offers = {offers:[
 {template:"KII-001 | Sample",status:"active",clipIds:["KII-V001"]},
 {template:"KII-002 | Unknown",status:"active",clipIds:["UNRESOLVED"]},
 {template:"KII-003 | Wall conflict",status:"active",clipIds:["KII-V002"]},
],deleted:["KII-005"]};
const run = async (preview=true, v=videos, o=offers, u=owner) => (await db.query(
 "select import_catalogue_desktop($1,$2,$3,$4) as r",[u,v,o,preview])).rows[0].r;
const count = async table => (await db.query("select count(*)::int n from "+table)).rows[0].n;
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
    "20261018150907_catalogue_filters.sql","20261018161059_catalogue_desktop_import.sql",
  ]) await db.exec(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"));
  await db.query("insert into auth.users values($1),($2)",[owner,other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'owner')",[owner,other]);
  await db.exec("set role service_role");

  if (process.argv[2] && process.argv[3]) {
    const v=JSON.parse((await readFile(process.argv[2],"utf8")).replace(/^\uFEFF/,""));
    const o=JSON.parse((await readFile(process.argv[3],"utf8")).replace(/^\uFEFF/,""));
    const preview=await run(true,v,o);
    console.log("Actual-register LOCAL preview:",JSON.stringify({added:preview.added,existing:preview.existing,skipped:preview.skipped,issues:preview.issues.map(i=>({item:i.item,reason:i.reason}))}));
    assert.equal(await count("catalogue_clips"),0);
  }
  let r=await run();
  assert.equal(r.preview,true); assert.equal(r.added,8); assert.equal(r.skipped,2);
  assert.equal(await count("catalogue_clips"),0);
  assert.equal(await count("catalogue_offers"),0);
  assert.equal(await count("catalogue_clip_recipients"),0);
  r=await run(false); assert.equal(r.added,8); assert.equal(r.skipped,2);
  assert.equal(await count("catalogue_clips"),3);
  assert.equal(await count("catalogue_offers"),1);
  assert.equal(await count("catalogue_clip_recipients"),3);
  r=await run(false); assert.equal(r.added,0); assert.equal(r.existing,8);
  assert.equal(await count("catalogue_offer_clips"),1);
  const receipts=(await db.query("select recipient_key,received_at from catalogue_clip_recipients")).rows;
  assert(receipts.every(x=>x.recipient_key.startsWith("historical-fanvue-handle:") && x.received_at===null));
  const conflicting=structuredClone(videos);conflicting.clips[0].channel="WALL ONLY";
  r=await run(false,conflicting); assert(r.issues.some(x=>x.reason.includes("no overwrite")));
  assert.equal((await db.query("select assignment from catalogue_clips where clip_code='KII-V001'")).rows[0].assignment,"ppv");
  const malformed={clips:[{clipId:"BAD"},...videos.clips]};
  r=await run(false,malformed);assert(r.issues.some(x=>x.reason==="Invalid clip code"));
  const mixed={offers:[{template:"TUU-001 | Mixed",status:"active",clipIds:["KII-V001"]}]};
  r=await run(false,videos,mixed);assert.equal(r.skipped,1);
  // A user edit to an imported bundle must not be undone by reimport.
  await db.query("delete from catalogue_offer_clips where user_id=$1",[owner]);
  r=await run(false);assert(r.issues.some(x=>x.reason==="Existing bundle differs; no overwrite"));
  assert.equal(await count("catalogue_offer_clips"),0);
  r=await run(false,videos,offers,other);assert.equal(r.added,8);
  assert.equal(await count("catalogue_clips"),6);
  await db.exec("reset role");
  await db.query("delete from user_roles where user_id=$1",[other]);
  await db.exec("set role service_role");
  await assert.rejects(()=>run(true,videos,offers,other),/Catalogue owner required/);
  for(const role of ["anon","authenticated"]){await db.exec("set role "+role);await assert.rejects(()=>run(),e=>e.code==="42501");}
  console.log("Desktop import passed: preview rollback, exact IDs, idempotency, paid/free, conflicts, owner isolation and grants.");
} finally {await db.close();}
