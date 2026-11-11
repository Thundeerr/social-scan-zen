import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Actual publishing migrations and RPCs, isolated in memory; no network or provider calls.
const db = new PGlite();
const owner = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
const other = "ea7c33be-46a8-47cd-8d2d-c73f1c12c9c0";
const guardMigration = "20261110175337_model_source_duplicate_guard.sql";
let checks = 0;
let sequence = 1;
const hash = () => (sequence++).toString(16).padStart(64, "0");
const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.v;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const rejects = async (operation, pattern, message) => {
  await assert.rejects(operation, pattern, message);
  checks++;
};
const command = (action, data, user = owner) =>
  value("select public.model_publish_command($1,$2,$3) v", [user, action, JSON.stringify(data)]);
const evidence = (name) => ({
  kind: "offline_fixture",
  path: `fixture://${name}`,
  sha256: "e".repeat(64),
});

async function review({
  user = owner,
  model = "kiikii",
  mode = "normal",
  output = hash(),
  title = "Fixture source",
} = {}) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.content_review_items
    (id,user_id,model,title,caption,status,media_path,sha256,bytes,reviewed_at)
    values($1,$2,$3,$4,'Approved fixture caption','approved',$5,$6,100,now())`,
    [id, user, model, title, `${user}/${id}/video.mp4`, output],
  );
  return { id, revision: 1, user, model, mode, output };
}
async function prepare(item) {
  const result = await command(
    "prepare",
    {
      id: item.id,
      revision: item.revision,
      sha256: item.output,
      publish_mode: item.mode,
      storage_path: `${item.user}/model-review/${item.id}/${item.output}.mp4`,
    },
    item.user,
  );
  item.post = result.post_id;
  return item;
}
const target = (item) =>
  item.user === other ? "22300" : item.model === "tuuva" ? "12400" : "12300";
const publish = (item) =>
  command(
    "publish",
    {
      id: item.id,
      revision: item.revision,
      confirmation: "PUBLISH",
      publish_mode: item.mode,
      ig_user_id: target(item),
    },
    item.user,
  );
const source = (key, aliases = [], user = owner) =>
  value("select public.register_verified_source($1,$2,$3,$4) v", [
    user,
    key,
    JSON.stringify(aliases),
    JSON.stringify(evidence(key)),
  ]);
const bind = (item, sourceId, expected = item.output) =>
  value("select public.bind_review_source($1,$2,$3,$4,$5) v", [
    item.user,
    item.id,
    sourceId,
    expected,
    JSON.stringify(evidence(item.id)),
  ]);
const status = (item) =>
  value("select status v from public.content_posts where id=$1", [item.post]);

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    create table public.user_roles(user_id uuid,role text);
    create function public.is_operator(p_user uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.user_roles where user_id=p_user and role in ('owner','cofounder')) $$;
    grant select on public.user_roles to authenticated,service_role;
    create function public.update_updated_at_column() returns trigger language plpgsql as $$
      begin new.updated_at:=now(); return new; end $$;
    create table public.profiles(id uuid primary key,publishing_paused boolean default true);
    create table public.ig_connections(id uuid primary key default gen_random_uuid(),user_id uuid unique,
      ig_user_id text,ig_username text,status text,token_expires_at timestamptz,
      page_id text,last_error text,created_at timestamptz,updated_at timestamptz);
    create table public.ig_oauth_states(state text);
    create schema storage;
    create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text);
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
    create schema vault; create table vault.decrypted_secrets(name text,decrypted_secret text);
    create schema cron; create table cron.job(jobid bigint,jobname text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create function cron.unschedule(bigint) returns boolean language sql as $$select true$$;`);
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("insert into public.user_roles values($1,'owner'),($2,'owner')", [owner, other]);
  await db.query("insert into public.profiles values($1,false),($2,false)", [owner, other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  for (const name of [
    "20260820154804_add_content_publisher_queue.sql",
    "20260820165801_add_content_batch_import.sql",
    "20260821080205_4710d50a-bd5a-4bc2-bf40-290acace36aa.sql",
    "20260821080333_9f3a4dee-aba7-4789-9efd-290226cbf5f9.sql",
    "20260822100000_add_image_carousel_publishing.sql",
    "20261011110112_model_publishing_accounts.sql",
    "20261011100940_content_review.sql",
    "20261011110559_review_publish_handoff.sql",
    "20261011102726_channel_alerts.sql",
    "20261011112049_model_trial_reels.sql",
    "20261011125819_model_posting_queue.sql",
  ])
    await db.exec(await migration(name));
  await db.exec(`create table public.model_pipeline_settings(user_id uuid primary key,enabled boolean,last_seen_at timestamptz);
    create table public.reel_inbox_items(id uuid primary key,user_id uuid,shortcode text,canonical_url text,sha256 text,receipt jsonb);
    create table public.model_pipeline_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,model text,
      state text,created_at timestamptz default now(),reserved_day date,reserved_cents integer,
      review_id uuid,inbox_id uuid,source_sha256 text,source_upload_id uuid,parent_job_id uuid,provider_id text);
    grant all on all tables in schema public to service_role;`);
  await db.exec(await migration("20261018141733_content_catalogue.sql"));
  await db.exec(await migration("20261106181755_content_publisher_fenced_recovery.sql"));
  await db.exec(await migration("20261106181827_model_worker_health_posting_policy.sql"));
  await db.query(
    `insert into public.ig_connections(user_id,ig_user_id,ig_username,status,token_expires_at,destination)
    values($1,'12300','fixture.kiikii','active',now()+interval '90 days','kiikii'),
      ($1,'12400','fixture.tuuva','active',now()+interval '90 days','tuuva'),
      ($1,'12500','fixture.generic','active',now()+interval '90 days','followerstar'),
      ($2,'22300','other.kiikii','active',now()+interval '90 days','kiikii')`,
    [owner, other],
  );

  // Historical duplicates exist BEFORE the new guard. They must not be deleted or silently retried.
  const historical = [];
  for (let i = 0; i < 2; i++) {
    const item = await prepare(await review({ title: `Historical duplicate ${i}` }));
    await db.query(
      "update public.content_posts set status='published',published_at=now()-interval '2 days' where id=$1",
      [item.post],
    );
    await db.query(
      `update public.content_publications set status='published',platform_media_id=$2,
      published_ig_user_id='12300',published_at=now()-interval '2 days' where content_post_id=$1`,
      [item.post, `historical-${i}`],
    );
    historical.push(item);
  }
  const uncertain = await prepare(await review({ title: "Lost receipt historical fixture" }));
  await db.query(
    `update public.content_publications set external_action_started_at=now(),recovery_required=true,status='failed'
    where content_post_id=$1`,
    [uncertain.post],
  );
  await db.query("update public.content_posts set status='failed' where id=$1", [uncertain.post]);

  await db.exec(await migration(guardMigration));
  equal(await status(historical[0]), "published", "migration preserves historical publication");
  equal(await status(historical[1]), "published", "migration preserves legacy duplicate record");
  equal(await status(uncertain), "failed", "migration must not retry uncertain post");

  const historicalSource = await source("instagram:LegacySame1", [
    { kind: "instagram_shortcode", value: "LegacySame1" },
    { kind: "sha256", value: "a".repeat(64) },
  ]);
  for (const item of historical) {
    equal(await bind(item, historicalSource), historicalSource, "historical explicit mapping");
    await value("select public.seed_existing_post($1) v", [item.post]);
    checks++;
  }
  const legacyNewVariant = await review({ title: "Different file, same historical footage" });
  await bind(legacyNewVariant, historicalSource);
  await prepare(legacyNewVariant);
  await rejects(
    () => publish(legacyNewVariant),
    /duplicate|already|source|published|reserved/i,
    "legacy variants must share a durable source claim",
  );
  equal(await status(legacyNewVariant), "approved", "failed authorization rolls back");

  const uncertainSource = await source("instagram:Uncertain01", [
    { kind: "instagram_shortcode", value: "Uncertain01" },
  ]);
  await bind(uncertain, uncertainSource);
  await value("select public.seed_existing_post($1) v", [uncertain.post]);
  const uncertainVariant = await prepare(await review());
  await bind(uncertainVariant, uncertainSource);
  await rejects(
    () => publish(uncertainVariant),
    /duplicate|already|source|reserved|uncertain/i,
    "ambiguous old external action blocks a new output/review",
  );
  await rejects(
    () =>
      db.query(
        "update public.content_posts set status='scheduled',scheduled_for=now() where id=$1",
        [uncertain.post],
      ),
    /reconcil|previous|duplicate|source|uncertain/i,
    "same uncertain post cannot be manually rescheduled",
  );

  const firstSource = await source("instagram:SourceOne01", [
    { kind: "instagram_shortcode", value: "SourceOne01" },
    { kind: "instagram_shortcode", value: "FaceEdit002" },
    { kind: "sha256", value: "b".repeat(64) },
  ]);
  equal(
    await source("instagram:SourceOne01", [{ kind: "instagram_shortcode", value: "SourceOne01" }]),
    firstSource,
    "registry repeat is idempotent",
  );
  const first = await review();
  equal(await bind(first, firstSource), firstSource, "binding registered source");
  equal(await bind(first, firstSource), firstSource, "binding retry is idempotent");
  await prepare(first);
  await publish(first);
  equal(await status(first), "scheduled", "normal first publication is permitted");
  equal((await publish(first)).post_id, first.post, "same-post repeat click is idempotent");
  equal(
    await value(
      "select count(*)::int v from public.content_events where content_post_id=$1 and event_type='model_publish_authorized'",
      [first.post],
    ),
    1,
    "same-post repeat creates no second authorization",
  );

  const reencode = await review({ title: "Same source after a re-encode" });
  await bind(reencode, firstSource);
  await prepare(reencode);
  await rejects(
    () => publish(reencode),
    /duplicate|already|source|reserved/i,
    "different output SHA cannot bypass source claim",
  );
  const trial = await review({ mode: "trial" });
  await bind(trial, firstSource);
  await prepare(trial);
  await rejects(
    () => publish(trial),
    /duplicate|already|source|reserved/i,
    "trial mode shares normal source lock",
  );
  const nextTime = new Date(Date.now() + 5 * 86400_000).toISOString();
  await rejects(
    () =>
      command("schedule", {
        id: reencode.id,
        revision: 1,
        confirmation: "SCHEDULE",
        publish_mode: "normal",
        ig_user_id: "12300",
        scheduled_for: nextTime,
      }),
    /duplicate|already|source|reserved/i,
    "scheduled model RPC enforces the source lock",
  );
  await rejects(
    () =>
      db.query("select public.schedule_content_post($1,now()+interval '6 days')", [reencode.post]),
    /duplicate|already|source|reserved/i,
    "generic scheduling RPC cannot bypass model guard",
  );
  await rejects(
    () =>
      db.query(
        "update public.content_posts set status='scheduled',scheduled_for=now() where id=$1",
        [reencode.post],
      ),
    /duplicate|already|source|reserved/i,
    "direct scheduled write cannot bypass model guard",
  );
  await rejects(
    () =>
      db.query("update public.content_posts set status='publishing' where id=$1", [reencode.post]),
    /duplicate|already|source|reserved/i,
    "direct publishing write cannot bypass model guard",
  );

  const unknown = await prepare(
    await review({ title: "Arbitrary title SourceOne01 is not evidence" }),
  );
  await rejects(
    () => publish(unknown),
    /source|identity|verified|provenance|registered/i,
    "unknown source fails closed despite a suggestive title",
  );
  await rejects(
    () =>
      db.query(
        `update public.content_publications set external_action_started_at=now()
    where content_post_id=$1 and channel='reel'`,
        [unknown.post],
      ),
    /source|identity|verified|provenance|registered/i,
    "final external action guard rejects an unknown source even without scheduling",
  );
  await rejects(
    () =>
      db.query(
        `insert into public.content_posts(user_id,post_key,title,caption,destination,target_ig_user_id,status,scheduled_for,media_sha256)
    values($1,$2,'Bypass','Caption','kiikii','12300','scheduled',now(),$3)`,
        [owner, crypto.randomUUID(), hash()],
      ),
    /source|review|identity|verified|provenance|registered/i,
    "direct insert into scheduled model queue fails closed",
  );

  const differentTarget = await review({ model: "tuuva" });
  await bind(differentTarget, firstSource);
  await prepare(differentTarget);
  await publish(differentTarget);
  equal(
    await status(differentTarget),
    "scheduled",
    "different actual target has independent source claim",
  );
  const otherSource = await source(
    "instagram:SourceOne01",
    [{ kind: "instagram_shortcode", value: "SourceOne01" }],
    other,
  );
  const differentOwner = await review({ user: other });
  await bind(differentOwner, otherSource);
  await prepare(differentOwner);
  await publish(differentOwner);
  equal(
    await status(differentOwner),
    "scheduled",
    "different owner has independent registry and claim",
  );
  const foreignBinding = await review({ user: other });
  await rejects(
    () => bind(foreignBinding, firstSource),
    /owner|source|match|belong|found/i,
    "source families cannot be bound across owners",
  );

  const batch = crypto.randomUUID();
  await db.query(
    `update public.content_posts set status='review',batch_key=$2,planned_for=now()+interval '7 days',
    cover_storage_path='fixture/cover.jpg',story_storage_path='fixture/story.mp4',story_publish_mode='automatic_no_link',
    media_manifest='{"reel":{"width":1080,"height":1920},"story":{"width":1080,"height":1920}}'::jsonb
    where id=$1`,
    [reencode.post, batch],
  );
  await rejects(
    () => db.query("select public.approve_content_batch($1)", [batch]),
    /duplicate|already|source|reserved/i,
    "batch approval cannot bypass source uniqueness",
  );
  equal(await status(reencode), "review", "batch failure rolls back intermediate approval");

  const freshSource = await source("instagram:CancelSafe1", [
    { kind: "instagram_shortcode", value: "CancelSafe1" },
  ]);
  const cancelled = await review();
  await bind(cancelled, freshSource);
  await prepare(cancelled);
  await publish(cancelled);
  await command("unschedule", { id: cancelled.id, revision: 1 });
  await command("cancel", { id: cancelled.id, revision: 1 });
  equal(
    await status(cancelled),
    undefined,
    "untouched scheduled post can be cancelled and removed",
  );
  const afterCancel = await review();
  await bind(afterCancel, freshSource);
  await prepare(afterCancel);
  await publish(afterCancel);
  equal(
    await status(afterCancel),
    "scheduled",
    "cancellation before provider action releases source reservation",
  );
  await db.query("update public.content_posts set status='failed' where id=$1", [afterCancel.post]);
  await db.query("select public.schedule_content_post($1,now())", [afterCancel.post]);
  equal(
    await status(afterCancel),
    "scheduled",
    "same-post retry before any external action remains possible",
  );

  const ambiguousLease = await value("select public.claim_due_content_post_v2($1,$2) v", [
    afterCancel.post,
    owner,
  ]);
  const ambiguousPublication = await value(
    "select id v from public.content_publications where content_post_id=$1 and channel='reel'",
    [afterCancel.post],
  );
  equal(
    await value("select public.write_content_publish_state($1,$2,$3,$4,'{}',null,'{}') v", [
      afterCancel.post,
      ambiguousLease.lease_token,
      ambiguousPublication,
      JSON.stringify({ external_action_started_at: new Date().toISOString() }),
    ]),
    true,
    "normal deployed worker intent creates durable source consumption",
  );
  equal(
    await value("select public.write_content_publish_state($1,$2,$3,$4,$5,null,'{}') v", [
      afterCancel.post,
      ambiguousLease.lease_token,
      ambiguousPublication,
      JSON.stringify({ status: "failed", recovery_required: true }),
      JSON.stringify({ status: "failed" }),
    ]),
    true,
    "lost receipt records failure without releasing source consumption",
  );
  await db.query("update public.content_review_items set publish_post_id=null where id=$1", [
    afterCancel.id,
  ]);
  try {
    await db.query("delete from public.content_posts where id=$1", [afterCancel.post]);
  } catch (error) {
    assert.match(
      error.message,
      /published|source|claim|reserved|external|delete|durable|uncertain/i,
    );
  }
  const afterAmbiguousDelete = await review();
  await bind(afterAmbiguousDelete, freshSource);
  await prepare(afterAmbiguousDelete);
  await rejects(
    () => publish(afterAmbiguousDelete),
    /duplicate|already|source|reserved|uncertain|consumed/i,
    "ambiguous send remains blocked after deletion of public queue record",
  );

  const claim = await value("select public.claim_due_content_post_v2($1,$2) v", [
    first.post,
    owner,
  ]);
  equal(claim.post_id, first.post, "existing worker claim reaches the registered scheduled post");
  const publicationId = await value(
    "select id v from public.content_publications where content_post_id=$1 and channel='reel'",
    [first.post],
  );
  const state = (publicationValues, postValues = {}) =>
    value("select public.write_content_publish_state($1,$2,$3,$4,$5,null,'{}') v", [
      first.post,
      claim.lease_token,
      publicationId,
      JSON.stringify(publicationValues),
      JSON.stringify(postValues),
    ]);
  equal(
    await state({ external_action_started_at: new Date().toISOString() }),
    true,
    "deployed worker can durably reserve a registered first send",
  );
  equal(
    await state(
      {
        status: "published",
        platform_media_id: "provider-receipt-1",
        published_ig_user_id: "12300",
        published_at: new Date().toISOString(),
      },
      { status: "published", published_at: new Date().toISOString() },
    ),
    true,
    "normal provider receipt persists after intent",
  );
  equal(
    (await publish(first)).post_id,
    first.post,
    "published model RPC returns existing job without another action",
  );
  await rejects(
    () =>
      db.query(
        "update public.content_posts set status='scheduled',scheduled_for=now() where id=$1",
        [first.post],
      ),
    /published|duplicate|source|consumed|attempt|reserved/i,
    "known published same-post retry cannot requeue",
  );

  // If deletion is intentionally forbidden, the existing row is itself durable evidence;
  // if permitted, the separate source tombstone must remain after ON DELETE CASCADE.
  await db.query("update public.content_review_items set publish_post_id=null where id=$1", [
    first.id,
  ]);
  let deleted = false;
  try {
    await db.query("delete from public.content_posts where id=$1", [first.post]);
    deleted = true;
  } catch (error) {
    assert.match(error.message, /published|source|claim|reserved|external|delete|durable/i);
  }
  checks++;
  equal(
    await status(first),
    deleted ? undefined : "published",
    "published deletion is either denied or complete",
  );
  const afterDelete = await review();
  await bind(afterDelete, firstSource);
  await prepare(afterDelete);
  await rejects(
    () => publish(afterDelete),
    /duplicate|already|source|reserved|published/i,
    "deletion cannot erase the consumed source claim",
  );

  const wrongHash = await review();
  await rejects(
    () => bind(wrongHash, freshSource, hash()),
    /hash|changed|match|output/i,
    "binding requires the exact current review output hash",
  );
  await rejects(
    () =>
      source("instagram:ConflictingAlias", [{ kind: "instagram_shortcode", value: "SourceOne01" }]),
    /alias|source|conflict|already|identity/i,
    "another canonical identity cannot steal a known alias",
  );
  await rejects(
    () =>
      source("instagram:InvalidAlias", [
        { kind: "instagram_shortcode", value: "https://evil.example/" },
      ]),
    /alias|invalid|shortcode/i,
    "URLs cannot masquerade as canonical shortcode aliases",
  );
  await rejects(
    () =>
      value("select public.register_verified_source($1,$2,$3,$4) v", [
        owner,
        "empty-evidence",
        "[]",
        "{}",
      ]),
    /evidence|invalid|alias/i,
    "unsubstantiated registry entries are refused",
  );

  const changedSource = await source("instagram:ChangedHash1", [
    { kind: "instagram_shortcode", value: "ChangedHash1" },
  ]);
  const changedReview = await review();
  await bind(changedReview, changedSource);
  const replacementHash = hash();
  let immutable = false;
  try {
    await db.query("update public.content_review_items set sha256=$2 where id=$1", [
      changedReview.id,
      replacementHash,
    ]);
  } catch (error) {
    assert.match(error.message, /hash|media|immutable|bound|source|changed/i);
    immutable = true;
  }
  if (!immutable) {
    changedReview.output = replacementHash;
    await prepare(changedReview);
    await rejects(
      () => publish(changedReview),
      /hash|media|bound|source|match|changed/i,
      "changing review media invalidates a prior source binding",
    );
  } else checks++;

  const jobSourceHash = "c".repeat(64);
  await source("instagram:Pipeline001", [
    { kind: "instagram_shortcode", value: "Pipeline001" },
    { kind: "sha256", value: jobSourceHash },
  ]);
  const viaJob = await review();
  const inboxId = crypto.randomUUID();
  await db.query(
    "insert into public.reel_inbox_items(id,user_id,shortcode,receipt) values($1,$2,'Pipeline001',$3)",
    [inboxId, owner, JSON.stringify({ sha256: jobSourceHash })],
  );
  await db.query(
    `insert into public.model_pipeline_jobs(user_id,model,state,review_id,inbox_id,provider_id)
    values($1,'kiikii','review',$2,$3,$4)`,
    [owner, viaJob.id, inboxId, "1".repeat(32)],
  );
  await prepare(viaJob);
  await publish(viaJob);
  equal(
    await status(viaJob),
    "scheduled",
    "real reviewed pipeline relation resolves registered provenance",
  );
  const aliasedJob = await review();
  const aliasInbox = crypto.randomUUID();
  await db.query(
    "insert into public.reel_inbox_items(id,user_id,shortcode,receipt) values($1,$2,'FaceEdit002',$3)",
    [aliasInbox, owner, JSON.stringify({ sha256: "b".repeat(64) })],
  );
  await db.query(
    `insert into public.model_pipeline_jobs(user_id,model,state,review_id,inbox_id,provider_id)
    values($1,'kiikii','review',$2,$3,$4)`,
    [owner, aliasedJob.id, aliasInbox, "2".repeat(32)],
  );
  await prepare(aliasedJob);
  await rejects(
    () => publish(aliasedJob),
    /duplicate|already|source|published|reserved/i,
    "different shortcode registered as same footage cannot bypass consumed source claim",
  );

  const derivedInput = await review();
  await db.query(
    `insert into public.model_pipeline_jobs(user_id,model,state,review_id,source_sha256,source_upload_id,provider_id)
    values($1,'kiikii','review',$2,$3,$4,$5)`,
    [owner, derivedInput.id, first.output, crypto.randomUUID(), "3".repeat(32)],
  );
  await prepare(derivedInput);
  await rejects(
    () => publish(derivedInput),
    /duplicate|already|source|published|reserved/i,
    "an existing generated output reused as a fresh input remains in the original source family",
  );
  const contradictory = await review();
  await db.query(
    `insert into public.model_pipeline_jobs(user_id,model,state,review_id,inbox_id,source_sha256,provider_id)
    values($1,'kiikii','review',$2,$3,$4,$5)`,
    [owner, contradictory.id, inboxId, first.output, "4".repeat(32)],
  );
  await prepare(contradictory);
  await rejects(
    () => publish(contradictory),
    /unknown|contradictory|evidence/i,
    "conflicting registered source evidence fails closed instead of selecting one identity",
  );

  const realPublication = await value(
    "select id v from public.content_publications where content_post_id=$1 and channel='reel'",
    [first.post],
  );
  if (realPublication) {
    await rejects(
      () =>
        db.query(
          "update public.content_publications set external_action_started_at=null where id=$1",
          [realPublication],
        ),
      /intent|reset|duplicate|source/i,
      "send intent cannot be cleared for a retry",
    );
    await rejects(
      () =>
        db.query(
          "update public.content_publications set platform_media_id=null,status='pending' where id=$1",
          [realPublication],
        ),
      /receipt|reset|duplicate|source/i,
      "provider receipt cannot be cleared for a retry",
    );
    await rejects(
      () =>
        db.query("update public.content_publications set channel='story' where id=$1", [
          realPublication,
        ]),
      /immutable|identity|source/i,
      "protected Reel receipt cannot move to an unguarded channel",
    );
    await rejects(
      () =>
        db.query("update public.content_publications set content_post_id=$2 where id=$1", [
          realPublication,
          unknown.post,
        ]),
      /immutable|identity|source/i,
      "protected Reel receipt cannot be moved to another post",
    );
    await rejects(
      () => db.query("delete from public.content_publications where id=$1", [realPublication]),
      /history|delete|duplicate|source/i,
      "published primary receipt cannot be deleted separately",
    );
  }

  const multiJob = await prepare(await review());
  for (const provider of ["5", "6"])
    await db.query(
      `insert into public.model_pipeline_jobs(user_id,model,state,review_id,inbox_id,provider_id)
      values($1,'kiikii','review',$2,$3,$4)`,
      [owner, multiJob.id, inboxId, provider.repeat(32)],
    );
  await rejects(
    () => publish(multiJob),
    /ambiguous|multiple|exactly|generation|source/i,
    "more than one matching generation job fails closed",
  );
  await rejects(
    () =>
      db.query(
        `insert into public.content_posts(user_id,post_key,title,caption,destination,target_ig_user_id,status,media_sha256)
    values($1,$2,'Bypass marked published','Caption','kiikii','12300','published',$3)`,
        [owner, crypto.randomUUID(), hash()],
      ),
    /source|review|prepare/i,
    "direct published INSERT cannot bypass source history",
  );

  const manualSource = await source("instagram:ManualDone1", [
    { kind: "instagram_shortcode", value: "ManualDone1" },
  ]);
  const manualPublished = await review();
  await bind(manualPublished, manualSource);
  await prepare(manualPublished);
  await db.query(
    "update public.content_posts set status='published',published_at=now() where id=$1",
    [manualPublished.post],
  );
  equal(
    await value("select state v from content_dedupe.claims where post_id=$1", [
      manualPublished.post,
    ]),
    "consumed",
    "manual reconciliation records consumed source even without a worker receipt",
  );
  const manualVariant = await review();
  await bind(manualVariant, manualSource);
  await prepare(manualVariant);
  await rejects(
    () => publish(manualVariant),
    /duplicate|already|source|reserved|consumed/i,
    "manual publication blocks a later newly encoded copy",
  );
  await db.query("update public.content_posts set title=title||' verified' where id=$1", [
    historical[1].post,
  ]);
  await db.query(
    "update public.content_publications set permalink='https://www.instagram.com/p/fixture/' where content_post_id=$1 and channel='reel'",
    [historical[1].post],
  );
  equal(
    await status(historical[1]),
    "published",
    "historical sibling metadata remains editable without re-consuming another post's source claim",
  );

  const containerSource = await source("instagram:Container01", [
    { kind: "instagram_shortcode", value: "Container01" },
  ]);
  const containerOnly = await review();
  await bind(containerOnly, containerSource);
  await prepare(containerOnly);
  await db.query(
    "update public.content_publications set platform_container_id='container-only' where content_post_id=$1",
    [containerOnly.post],
  );
  await rejects(
    () =>
      db.query("delete from public.content_publications where content_post_id=$1", [
        containerOnly.post,
      ]),
    /history|delete|duplicate|source/i,
    "an existing external container cannot be erased to manufacture a safe retry",
  );

  // A second application owner cannot erase account history by recreating an owner-scoped source family.
  await db.query(
    "update public.ig_connections set ig_user_id='12300' where user_id=$1 and destination='kiikii'",
    [other],
  );
  const sameAccountOtherOwner = await review({ user: other });
  await bind(sameAccountOtherOwner, otherSource);
  await prepare(sameAccountOtherOwner);
  await rejects(
    () =>
      command(
        "publish",
        {
          id: sameAccountOtherOwner.id,
          revision: 1,
          confirmation: "PUBLISH",
          publish_mode: "normal",
          ig_user_id: "12300",
        },
        other,
      ),
    /source|owner|account/i,
    "same actual Instagram account cannot be re-used through another application owner",
  );
  await db.query(
    "update public.ig_connections set ig_user_id='22300' where user_id=$1 and destination='kiikii'",
    [other],
  );

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await rejects(
      () => source("unauthorized", [{ kind: "instagram_shortcode", value: "NoAuth12345" }]),
      /permission|authorized|service|owner/i,
      `${role} cannot register source identities`,
    );
    await rejects(
      () => bind(unknown, freshSource),
      /permission|authorized|service|owner/i,
      `${role} cannot bind review identities`,
    );
    for (const table of [
      "sources",
      "source_aliases",
      "review_sources",
      "post_sources",
      "claims",
      "output_claims",
      "account_owners",
    ])
      await rejects(
        () => db.query(`select * from content_dedupe.${table}`),
        /permission|authorized/i,
        `${role} cannot read private ${table}`,
      );
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  await rejects(
    () => value("select public.seed_existing_post($1) v", [historical[0].post]),
    /permission|postgres|admin/i,
    "history seeding is not available to the application role",
  );
  const serviceSource = await source("instagram:ServicePath1", [
    { kind: "instagram_shortcode", value: "ServicePath1" },
  ]);
  const serviceItem = await review();
  equal(
    await bind(serviceItem, serviceSource),
    serviceSource,
    "application role can bind verified review source",
  );
  await prepare(serviceItem);
  await publish(serviceItem);
  equal(await status(serviceItem), "scheduled", "service-role model publishing path is usable");
  await db.exec("reset role");

  const dedupeChecks = checks;
  await db.exec(await migration("20261111173408_model_story_mentions.sql"));
  const storyInfo = (item) =>
    value(
      `select jsonb_build_object('mention',story_mention_username,
    'mode',story_publish_mode,'story_path',story_storage_path,'media_type',story_media_type,'reusable',story_media_reusable,
    'children',(select count(*) from content_publications where content_post_id=p.id and channel='story')) v
    from content_posts p where id=$1`,
      [item.post],
    );
  const configureStory = (item) =>
    value("select public.configure_model_post_story($1) v", [item.post]);
  equal(
    await configureStory(serviceItem),
    false,
    "migration defaults off and leaves existing queue untouched",
  );
  const disabledStory = await prepare(await review());
  equal(
    (await storyInfo(disabledStory)).children,
    0,
    "normal prepares stay Reel-only until explicitly enabled",
  );
  await rejects(
    () =>
      db.query(
        "update model_posting_policies set story_enabled=true where user_id=$1 and model='kiikii'",
        [owner],
      ),
    /check|constraint/i,
    "enabled policy requires exact source account and valid mention",
  );
  await db.query(
    `update model_posting_policies set story_enabled=true,story_source_ig_user_id='12300',
    story_mention_username='kiikiilink',story_template_storage_paths=array[$1||'/story-templates/a.jpg',$1||'/story-templates/b.jpg']
    where user_id=$1::uuid and model='kiikii'`,
    [owner],
  );
  const normalStory = await prepare(await review());
  const storyDelay = await value(
    "select story_link_delay_seconds v from content_posts where id=$1",
    [normalStory.post],
  );
  equal(
    Number.isInteger(storyDelay) && storyDelay >= 300 && storyDelay <= 1200,
    true,
    "prepared Story snapshots one random delay within 5-20 minutes",
  );
  await rejects(
    () =>
      db.query("update content_posts set story_link_delay_seconds=null where id=$1", [
        normalStory.post,
      ]),
    /immutable/,
    "prepared delay cannot be cleared",
  );
  await rejects(
    () =>
      db.query("update content_posts set story_link_delay_seconds=299 where id=$1", [
        disabledStory.post,
      ]),
    /constraint|check/i,
    "new delay cannot fall below five minutes",
  );
  await rejects(
    () =>
      db.query("update content_posts set story_link_delay_seconds=1201 where id=$1", [
        disabledStory.post,
      ]),
    /constraint|check/i,
    "new delay cannot exceed twenty minutes",
  );
  equal(
    await storyInfo(normalStory),
    {
      mention: "kiikiilink",
      mode: "automatic_no_link",
      story_path: owner + "/story-templates/a.jpg",
      media_type: "image",
      reusable: true,
      children: 1,
    },
    "normal approved Reel gets one real image Story with a reusable approved template snapshot",
  );
  await db.exec("set role service_role");
  const serviceStory = await prepare(await review());
  equal(
    (await storyInfo(serviceStory)).children,
    1,
    "production service role can prepare an opted-in Story",
  );
  equal(
    (await storyInfo(serviceStory)).story_path,
    owner + "/story-templates/b.jpg",
    "next service-role prepare rotates to the next approved image",
  );
  await db.exec("reset role");
  await prepare(normalStory);
  equal(await configureStory(normalStory), true, "configuration is idempotent");
  equal(
    await value("select story_link_delay_seconds v from content_posts where id=$1", [
      normalStory.post,
    ]),
    storyDelay,
    "idempotent prepare cannot resample the random delay",
  );
  equal(
    await value(
      "select story_template_next_index v from model_posting_policies where user_id=$1 and model='kiikii'",
      [owner],
    ),
    0,
    "idempotent prepare does not advance the template rotation",
  );
  equal(
    (await storyInfo(normalStory)).children,
    1,
    "repeated prepare cannot create duplicate Stories",
  );
  equal(
    await configureStory(serviceItem),
    true,
    "untouched scheduled post can be explicitly backfilled",
  );
  equal(await status(serviceItem), "scheduled", "Story backfill preserves schedule state");
  equal(
    (await storyInfo(serviceItem)).story_path,
    owner + "/story-templates/a.jpg",
    "rotation wraps around to the first approved image",
  );
  for (const invalid of [
    "array['other-owner/template.jpg']",
    "array[null]::text[]",
    `array['${owner}/a.jpg','${owner}/a.jpg']`,
    `'[0:0]={${owner}/a.jpg}'::text[]`,
  ])
    await rejects(
      () =>
        db.query(
          `update model_posting_policies set story_template_storage_paths=${invalid} where user_id=$1 and model='kiikii'`,
          [owner],
        ),
      /constraint|distinct|owned/i,
      "template pool rejects foreign, null, duplicate or shifted-index entries",
    );
  await rejects(
    () =>
      db.query("update content_posts set story_media_type=null where id=$1", [normalStory.post]),
    /constraint|check/i,
    "reusable template cannot have an unknown media type",
  );
  await db.query(
    "update model_posting_policies set story_template_storage_paths=array[$1||'/story-templates/c.jpg'] where user_id=$1::uuid and model='kiikii'",
    [owner],
  );
  equal(
    (await storyInfo(normalStory)).story_path,
    owner + "/story-templates/a.jpg",
    "changing the pool cannot silently replace a queued image",
  );
  equal(
    await configureStory(normalStory),
    true,
    "idempotent snapshot remains valid after its old template leaves the pool",
  );
  equal(
    await value("select story_link_delay_seconds v from content_posts where id=$1", [
      normalStory.post,
    ]),
    storyDelay,
    "policy edits cannot change a queued delay",
  );
  const trialStory = await prepare(await review({ mode: "trial" }));
  equal(
    (await storyInfo(trialStory)).children,
    0,
    "Trial Reels are never announced through a Story",
  );
  const tuuvaStory = await prepare(await review({ model: "tuuva" }));
  equal((await storyInfo(tuuvaStory)).children, 0, "unconfigured other model stays unchanged");
  const otherOwnerStory = await prepare(await review({ user: other }));
  equal((await storyInfo(otherOwnerStory)).children, 0, "another owner's Kiikii is not opted in");
  await db.query(
    "update model_posting_policies set story_source_ig_user_id='99999' where user_id=$1 and model='kiikii'",
    [owner],
  );
  const changedAccountStory = await prepare(await review());
  equal(
    (await storyInfo(changedAccountStory)).children,
    0,
    "a changed source Instagram account cannot inherit Story opt-in",
  );
  await db.query(
    "update model_posting_policies set story_source_ig_user_id='12300',story_mention_username='later.link' where user_id=$1 and model='kiikii'",
    [owner],
  );
  equal(
    (await storyInfo(normalStory)).mention,
    "kiikiilink",
    "policy changes do not retarget an approved Story",
  );
  await rejects(
    () => configureStory(normalStory),
    /Existing Story/,
    "explicit conflict requires review instead of silently retargeting",
  );
  await db.query(
    "update model_posting_policies set story_mention_username='kiikiilink' where user_id=$1 and model='kiikii'",
    [owner],
  );
  await rejects(
    () => configureStory(containerOnly),
    /untouched/,
    "a container already created cannot be retrofitted",
  );
  await rejects(
    () => configureStory(historical[1]),
    /untouched/,
    "published historical posts are excluded",
  );
  const storySource = await source("instagram:StoryFlow01", [
    { kind: "instagram_shortcode", value: "StoryFlow01" },
  ]);
  await bind(normalStory, storySource);
  await publish(normalStory);
  const storyLease = await value("select public.claim_due_content_post_v2($1,$2) v", [
    normalStory.post,
    owner,
  ]);
  equal(
    storyLease.post_id,
    normalStory.post,
    "the existing lease system claims the Reel and Story parent",
  );
  const ensureStoryTime = (token = storyLease.lease_token) =>
    value("select public.ensure_model_story_time($1,$2) v", [normalStory.post, token]);
  await rejects(
    () => ensureStoryTime(),
    /Confirmed primary/,
    "timing cannot start before a real primary receipt",
  );
  await rejects(
    () => ensureStoryTime(crypto.randomUUID()),
    /Live publisher lease/,
    "lost lease cannot anchor Story timing",
  );
  await db.query(
    "update content_publications set status='published',platform_media_id='story-flow-primary',external_action_started_at=now() where content_post_id=$1 and channel='reel'",
    [normalStory.post],
  );
  await rejects(
    () => ensureStoryTime(),
    /timestamp/,
    "receipt without actual publication time cannot anchor timing",
  );
  const primaryPublishedAt = "2026-11-11T02:05:12.000Z";
  await db.query(
    "update content_publications set published_at=$2 where content_post_id=$1 and channel='reel'",
    [normalStory.post, primaryPublishedAt],
  );
  await db.query(
    "update content_posts set publish_lease_until=now()-interval '1 minute' where id=$1",
    [normalStory.post],
  );
  await rejects(
    () => ensureStoryTime(),
    /Live publisher lease/,
    "expired lease cannot anchor Story timing",
  );
  await db.query(
    "update content_posts set publish_lease_until=now()+interval '10 minutes' where id=$1",
    [normalStory.post],
  );
  await db.query("update profiles set publishing_paused=true where id=$1", [owner]);
  await rejects(
    () => ensureStoryTime(),
    /Live publisher lease/,
    "owner pause fences the timing write",
  );
  await db.query("update profiles set publishing_paused=false where id=$1", [owner]);
  await db.query(
    "update content_publications set recovery_required=true where content_post_id=$1 and channel='reel'",
    [normalStory.post],
  );
  await rejects(
    () => ensureStoryTime(),
    /Confirmed primary/,
    "partial-success or ambiguous primary cannot anchor timing",
  );
  await db.query(
    "update content_publications set recovery_required=false where content_post_id=$1 and channel='reel'",
    [normalStory.post],
  );
  await db.exec("set role service_role");
  const anchoredDue = await ensureStoryTime();
  await db.exec("reset role");
  equal(
    new Date(anchoredDue).getTime(),
    Date.parse(primaryPublishedAt) + storyDelay * 1000,
    "crash recovery anchors delay to actual Reel publication instead of schedule or retry time",
  );
  equal(
    await value("select media_cleanup_after v from content_posts where id=$1", [normalStory.post]),
    null,
    "anchoring Story timing does not enable media cleanup",
  );
  await db.query(
    "update content_publications set published_at=published_at+interval '1 day' where content_post_id=$1 and channel='reel'",
    [normalStory.post],
  );
  equal(
    await ensureStoryTime(),
    anchoredDue,
    "later metadata edits and retries cannot move the saved due time",
  );
  equal(
    await value(
      "select count(*)::int v from content_events where content_post_id=$1 and event_type='model_story_delay_anchored'",
      [normalStory.post],
    ),
    1,
    "retries write the timing anchor event once",
  );
  await rejects(
    () =>
      db.query("update content_posts set story_link_not_before=null where id=$1", [
        normalStory.post,
      ]),
    /immutable/,
    "anchored due time cannot be cleared",
  );
  await rejects(
    () =>
      db.query(
        "update content_posts set story_link_not_before=story_link_not_before+interval '1 minute' where id=$1",
        [normalStory.post],
      ),
    /immutable/,
    "anchored due time cannot be moved",
  );
  await db.query(
    "update content_publications set status='publishing',platform_container_id='story-flow-container',attempts=1 where content_post_id=$1 and channel='story'",
    [normalStory.post],
  );
  await db.query(
    "update content_publications set external_action_started_at=now(),status='published',platform_media_id='story-flow-receipt' where content_post_id=$1 and channel='story'",
    [normalStory.post],
  );
  equal(
    await value(
      "select status v from content_publications where content_post_id=$1 and channel='story'",
      [normalStory.post],
    ),
    "published",
    "Story child follows successful primary receipt without conflicting with source duplicate claim",
  );
  for (const patch of [
    "story_mention_username='different.name'",
    "story_storage_path='another.mp4'",
    "story_mention_username=null,story_publish_mode='manual_link_sticker'",
    "story_media_type='video',story_media_reusable=false",
    "story_media_reusable=false",
  ])
    await rejects(
      () => db.query(`update content_posts set ${patch} where id=$1`, [normalStory.post]),
      /immutable/,
      "started Story identity cannot change",
    );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await rejects(
      () => configureStory(disabledStory),
      /permission|Service role/i,
      `${role} cannot enable Story publication`,
    );
    await rejects(
      () => ensureStoryTime(),
      /permission|Service role/i,
      `${role} cannot anchor Story timing`,
    );
    await db.exec("reset role");
  }
  console.log(
    `PASS source duplicate guard: ${dedupeChecks} assertions; Story policy: ${checks - dedupeChecks} assertions`,
  );
} catch (error) {
  console.error(`FAIL after ${checks} assertions: ${error.message}`);
  console.error(error.where ?? error.detail ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
