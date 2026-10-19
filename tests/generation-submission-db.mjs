import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db=new PGlite(), owner=crypto.randomUUID(), other=crypto.randomUUID(), hash="a".repeat(64);
const migration=name=>readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8");
const submit=async(action,data,user=owner)=>(await db.query("select generation_submit($1,$2,$3) r",[user,action,{duplicate_confirmed:true,...data}])).rows[0].r;
try {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;grant usage on schema auth to authenticated;create table user_roles(user_id uuid,role text);grant select on user_roles to service_role;create schema storage;create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of [
    "20261006020101_reel_inbox.sql",
    "20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql",
    "20261011114403_model_pipeline_queue.sql",
    "20261018163645_generation_submission.sql",
    "20261018173534_generation_source_revisions.sql",
    "20261019142046_generation_submission_safeguards.sql",
  ]) {
    if(file === "20261018163645_generation_submission.sql" && process.argv.includes("--production-revisions")) {
      // Reproduce production's pre-existing revision columns, indexes and triggers.
      await db.exec(await readFile(new URL("../docs/model-revisions-20261012.sql",import.meta.url),"utf8"));
    }
    await db.exec(await migration(file));
  }
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'cofounder')", [owner, other]);
  await db.query("insert into model_pipeline_settings(user_id) values($1)", [owner]);
  await db.query(
    "insert into model_pipeline_profiles(user_id,model,sender_username) values($1,'kiikii','kiikii.bat'),($1,'tuuva','tuuva.test')",
    [owner],
  );
  await db.query(
    "insert into reel_inbox_dm_sources(user_id,receiver_id,enabled) values($1,'10',true)",
    [owner],
  );

  await db.exec("set role service_role");
  const link={model:"kiikii",shortcode:"Sample123",url:"https://www.instagram.com/reel/Sample123/"};
  const first=await submit("link",link);
  assert.equal(first.state,"queued");assert.equal(first.enabled,false);
  assert.equal((await submit("link",link)).id,first.id);
  const second=await submit("link",{...link,model:"tuuva"});assert.notEqual(first.id,second.id);
  await assert.rejects(()=>submit("link",link,other),/Owner required/);
  await assert.rejects(()=>submit("link",{...link,url:"https://localhost/private"}),/Invalid Reel/);
  await assert.rejects(()=>submit("link",{...link,model:"invalid"}),/not configured/);
  const id=crypto.randomUUID();
  const prepared=await submit("prepare",{id,model:"tuuva"});
  assert.equal(prepared.path,owner+"/"+id+".mp4");
  assert.equal((await submit("prepare",{id,model:"tuuva"})).id,id);
  await assert.rejects(()=>submit("prepare",{id,model:"kiikii"}),/Upload conflict/);
  await assert.rejects(()=>submit("upload",{id:crypto.randomUUID(),model:"tuuva",sha256:hash}),/not found/);
  const uploaded=await submit("upload",{id,model:"tuuva",sha256:hash});
  assert.equal((await submit("upload",{id,model:"tuuva",sha256:hash})).id,uploaded.id);
  await assert.rejects(()=>submit("upload",{id,model:"tuuva",sha256:"b".repeat(64)}),/Upload changed/);
  assert.equal((await db.query("select count(*)::int n from model_pipeline_jobs")).rows[0].n,3);
  // Read-only preflight and atomic final guard catch duplicate sources across models.
  const check=async(data,user=owner)=>(await db.query("select generation_source_check($1,$2) r",[user,data])).rows[0].r;
  const countJobs=async()=>(await db.query("select count(*)::int n from model_pipeline_jobs")).rows[0].n;
  const before=await countJobs();
  const linkCheck=await check({kind:"link",shortcode:link.shortcode});
  assert.equal(linkCheck.duplicates.length,2);
  assert.equal(linkCheck.enabled,false);
  assert.equal((await check({kind:"file",sha256:hash})).duplicates[0].id,uploaded.id);
  assert.equal(await countJobs(),before);
  await assert.rejects(()=>check({kind:"file",sha256:"invalid"}),/Invalid hash/);
  await assert.rejects(()=>check({kind:"file",sha256:hash},other),/Owner required/);
  const warnedLink=await submit("link",{...link,duplicate_confirmed:false});
  assert.equal(warnedLink.duplicate_warning,true);assert.equal(warnedLink.id,"");
  const nextId=crypto.randomUUID();
  await submit("prepare",{id:nextId,model:"kiikii"});
  const warnedFile=await submit("upload",{id:nextId,model:"kiikii",sha256:hash,duplicate_confirmed:false});
  assert.equal(warnedFile.duplicate_warning,true);assert.equal(await countJobs(),before);
  const allowed=await submit("upload",{id:nextId,model:"kiikii",sha256:hash,duplicate_confirmed:true});
  assert(allowed.id);assert.notEqual(allowed.id,uploaded.id);
  assert.equal((await submit("upload",{id:nextId,model:"kiikii",sha256:hash,duplicate_confirmed:true})).id,allowed.id);
  await db.query("delete from model_pipeline_jobs where id=$1",[allowed.id]);
  // Old submissions are outside the warning window; other owners' history is private.
  await db.query("update model_pipeline_jobs set created_at=now()-interval '31 days' where id=$1",[uploaded.id]);
  assert.equal((await check({kind:"file",sha256:hash})).duplicates.length,0);
  await db.query("update model_pipeline_jobs set created_at=now() where id=$1",[uploaded.id]);
  await db.exec("reset role");
  await db.query("update user_roles set role='owner' where user_id=$1",[other]);
  await db.query("insert into model_pipeline_settings(user_id) values($1)",[other]);
  await db.exec("set role service_role");
  assert.equal((await check({kind:"file",sha256:hash},other)).duplicates.length,0);
  await db.exec("reset role");
  await db.query("update user_roles set role='cofounder' where user_id=$1",[other]);
  await db.exec("set role service_role");
  await assert.rejects(()=>db.query("select generation_submit_core($1,'link',$2)",[owner,link]),e=>e.code==='42501');
  // Only the pre-existing worker command can claim and reserve. Pause still works.
  const call=async(action,data={})=>(await db.query("select model_pipeline_command($1,null,$2,$3) r",[action,data,hash])).rows[0].r;
  await db.query("update model_pipeline_settings set worker_hash=$2 where user_id=$1",[owner,hash]);
  assert.equal(await call("claim"),null);
  await db.query("delete from model_pipeline_jobs where inbox_id is not null");
  await db.query("update model_pipeline_settings set enabled=true where user_id=$1",[owner]);
  const job=await call("claim");assert.equal(job.id,uploaded.id);assert.equal(job.source_upload_id,id);
  assert.equal(job.model,"tuuva");assert.equal(job.source_sha256,hash);
  const ref={id:job.id,lease:job.lease};
  await call("reserve",{...ref,seconds:4});
  await call("submitted",{...ref,provider_id:"a".repeat(32)});
  const reviewed=await call("review",{...ref,caption:"Sample review caption"});
  assert(reviewed.review_id);
  assert.equal((await db.query("select title from content_review_items where id=$1",[reviewed.review_id])).rows[0].title,"Tuuva \u00b7 Upload");
  // Both sources must survive multiple review/revision cycles while paused.
  await db.query("update model_pipeline_settings set enabled=false where user_id=$1",[owner]);
  const linkOriginal=await submit("link",link);
  const row=async(id)=>(await db.query("select * from model_pipeline_jobs where id=$1",[id])).rows[0];
  const reviewFor=async(job)=>{
    if(job.review_id) return job.review_id;
    const reviewId=crypto.randomUUID();
    await db.query("insert into content_review_items(id,user_id,model,title,caption,media_path) values($1,$2,$3,'Test','Updated caption',$4)",[reviewId,owner,job.model,reviewId+"/video.mp4"]);
    await db.query("update model_pipeline_jobs set review_id=$2 where id=$1",[job.id,reviewId]);
    return reviewId;
  };
  for(const originalId of [uploaded.id,linkOriginal.id]) {
    const original=await row(originalId);
    let parent=original;
    for(let attempt=1;attempt<=2;attempt++) {
      const reviewId=await reviewFor(parent);
      await db.query("update content_review_items set status='pending',sha256=$2,bytes=12,note=$3,caption='Updated caption' where id=$1",[reviewId,hash,"Correction "+attempt]);
      await db.query("update content_review_items set status='changes' where id=$1",[reviewId]);
      const children=await db.query("select * from model_pipeline_jobs where revision_of_review_id=$1",[reviewId]);
      assert.equal(children.rows.length,1);
      const child=children.rows[0];
      assert.equal(child.parent_job_id,parent.id);
      assert.equal(child.attempt,attempt);
      assert.equal(child.user_id,owner);assert.equal(child.model,original.model);
      assert.equal(child.inbox_id,original.inbox_id);
      assert.equal(child.source_upload_id,original.source_upload_id);
      assert.equal(child.source_sha256,original.source_sha256);
      assert.equal(child.state,"queued");assert.equal(child.provider_id,null);
      assert.equal(child.revision_caption,"Updated caption");
      assert(child.revision_notes.includes("Correction 1"));
      assert(child.revision_notes.includes("Correction "+attempt));
      // Repeated callbacks, including a transition back to changes, are idempotent.
      await db.query("update content_review_items set status='changes' where id=$1",[reviewId]);
      await db.query("update content_review_items set status='pending' where id=$1",[reviewId]);
      await db.query("update content_review_items set status='changes' where id=$1",[reviewId]);
      assert.equal((await db.query("select count(*)::int n from model_pipeline_jobs where revision_of_review_id=$1",[reviewId])).rows[0].n,1);
      await assert.rejects(()=>db.query("insert into model_pipeline_jobs(user_id,model,inbox_id,source_upload_id,source_sha256,attempt) values($1,$2,$3,$4,$5,$6)",[owner,original.model,original.inbox_id,original.source_upload_id,original.source_sha256,attempt]),e=>e.code==='23505');
      parent=child;
    }
  }
  assert.equal((await submit("link",link)).id,linkOriginal.id);
  assert.equal((await submit("upload",{id,model:"tuuva",sha256:hash})).id,uploaded.id);
  assert.equal(await call("claim"),null);
  // Existing source XOR and upload-owner binding still hold.
  await assert.rejects(()=>db.query("insert into model_pipeline_jobs(user_id,model) values($1,'tuuva')",[owner]),e=>e.code==='23514');
  const linked=await row(linkOriginal.id);
  await assert.rejects(()=>db.query("insert into model_pipeline_jobs(user_id,model,inbox_id,source_upload_id,source_sha256,attempt) values($1,'tuuva',$2,$3,$4,9)",[owner,linked.inbox_id,id,hash]),e=>e.code==='23514');
  for(const role of ["anon","authenticated"]){await db.exec("set role "+role);await assert.rejects(()=>submit("link",link),e=>e.code==="42501");await assert.rejects(()=>check({kind:"file",sha256:hash}),e=>e.code==="42501");}
  console.log(`Generation submission passed: owner, model, deduplication, upload binding, pause, worker claim/reserve/review, two revisions per source, repeated callbacks and initial re-submission (${process.argv.includes("--production-revisions") ? "production upgrade" : "fresh database"}).`);
} finally {await db.close();}
