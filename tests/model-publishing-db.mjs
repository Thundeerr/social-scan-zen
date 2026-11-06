import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(),
  owner = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc",
  other = crypto.randomUUID();
const migration = async (name) =>
  readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8");
const call = async (action, data, user = owner) =>
  (
    await db.query("select model_publish_command($1,$2,$3) as v", [
      user,
      action,
      JSON.stringify(data),
    ])
  ).rows[0].v;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 grant usage on schema auth to authenticated;
 create table user_roles(user_id uuid,role text);
 create table profiles(id uuid primary key,publishing_paused boolean default true);
 create table ig_connections(id uuid primary key default gen_random_uuid(),user_id uuid unique,ig_user_id text,ig_username text,status text,token_expires_at timestamptz);
 create table ig_oauth_states(state text);
 create schema storage;create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await db.exec(
    (await migration("20260820154804_add_content_publisher_queue.sql")).split("REVOKE ALL ON")[0],
  );
  await db.exec(
    `alter table content_posts add column highlight_enabled boolean default false,add column share_to_feed boolean default true,add column story_publish_mode text default 'manual_link_sticker',add column published_at timestamptz;`,
  );
  await db.exec(await migration("20261011110112_model_publishing_accounts.sql"));
  await db.exec(await migration("20261011100940_content_review.sql"));
  await db.exec(await migration("20261011110559_review_publish_handoff.sql"));
  await db.exec(
    "grant all on all tables in schema public to service_role;grant all on content_posts to authenticated;",
  );
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.exec(
    "create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint'",
  );
  await db.query("insert into user_roles values($1,'owner')", [owner]);
  await db.query("insert into profiles values($1,true)", [owner]);
  const id = crypto.randomUUID(),
    sha = "a".repeat(64),
    ref = { id, revision: 1 },
    prepare = {
      ...ref,
      sha256: sha,
      publish_mode: "trial",
      storage_path: `${owner}/model-review/${id}/${sha}.mp4`,
    };
  await db.query(
    "insert into content_review_items(id,user_id,model,title,caption,status,media_path,sha256,bytes,reviewed_at) values($1,$2,'kiikii','Test','Approved caption','approved','private/video.mp4',$3,20,now())",
    [id, owner, sha],
  );
  await db.exec(await migration("20261011102726_channel_alerts.sql"));
  await db.exec(await migration("20261011112049_model_trial_reels.sql"));
  await db.exec(await migration("20261011125819_model_posting_queue.sql"));
  await db.exec(await migration("20261011131405_review_card_status_sync.sql"));
  await db.exec(`create table model_pipeline_settings(user_id uuid primary key,enabled boolean,last_seen_at timestamptz);
    create table model_pipeline_jobs(user_id uuid,model text,state text,created_at timestamptz,reserved_day date,reserved_cents integer);
    grant select on model_pipeline_settings,model_pipeline_jobs to service_role;`);
  await db.exec(await migration("20261106181827_model_worker_health_posting_policy.sql"));
  // Migration only stores policy; it never authorizes a post or starts generation.
  assert.equal(
    (await db.query("select count(*)::int n from content_posts where status='scheduled'")).rows[0]
      .n,
    0,
  );
  const policy = (await db.query("select * from model_posting_policy($1,'kiikii')", [owner]))
    .rows[0];
  assert.equal(policy.daily_limit, 1);
  assert.deepEqual(policy.slots, ["03:00:00"]);
  assert.equal(
    (await db.query("select daily_limit from model_posting_policy($1,'tuuva')", [owner])).rows[0]
      .daily_limit,
    2,
  );
  assert.equal(
    (await db.query("select daily_limit from model_posting_policy($1,'kiikii')", [other])).rows[0]
      .daily_limit,
    2,
  );
  for (const invalid of [
    "array[time '03:00',time '03:00']",
    "array[]::time[]",
    "array[null]::time[]",
  ]) {
    await assert.rejects(
      db.query(
        `update model_posting_policies set slots=${invalid},daily_limit=2 where user_id=$1`,
        [owner],
      ),
    );
  }
  await assert.rejects(
    db.query("update model_posting_policies set timezone='Mars/Olympus' where user_id=$1", [owner]),
  );
  const grants = (
    await db.query(
      "select has_table_privilege('authenticated','content_posts','TRUNCATE') as truncate,has_table_privilege('authenticated','content_posts','TRIGGER') as trigger,has_table_privilege('authenticated','content_posts','REFERENCES') as references,has_table_privilege('authenticated','content_posts','SELECT') as select_ok,has_table_privilege('authenticated','model_posting_policies','SELECT') as policy_read,has_function_privilege('authenticated','model_next_posting_slot(uuid,text,timestamptz)','EXECUTE') as helper_execute",
    )
  ).rows[0];
  assert.deepEqual(grants, {
    truncate: false,
    trigger: false,
    references: false,
    select_ok: true,
    policy_read: false,
    helper_execute: false,
  });
  await db.exec("set role service_role");
  await assert.rejects(call("status", ref, other));
  await assert.rejects(call("prepare", prepare));
  await db.query(
    "insert into ig_connections(user_id,ig_user_id,ig_username,status,token_expires_at,destination) values($1,'123','kiikii.bat','active',now()+interval '30 days','kiikii')",
    [owner],
  );
  await assert.rejects(call("prepare", { ...prepare, revision: 2 }));
  const first = await call("prepare", prepare);
  assert.equal((await call("prepare", prepare)).post_id, first.post_id);
  assert.equal((await call("status", ref)).status, "approved");
  assert.equal((await db.query("select count(*)::int n from content_publications")).rows[0].n, 1);
  await assert.rejects(
    db.query("update content_review_items set caption='changed' where id=$1", [id]),
  );
  await assert.rejects(
    db.query("update content_posts set target_ig_user_id='456' where id=$1", [first.post_id]),
  );
  await db.exec("reset role;set role authenticated");
  await assert.rejects(
    db.query("update content_posts set status='scheduled' where id=$1", [first.post_id]),
  );
  await db.exec("reset role;set role service_role");
  const publish = { ...ref, confirmation: "PUBLISH", publish_mode: "trial", ig_user_id: "123" };
  await assert.rejects(call("publish", publish)); // paused
  await call("cancel", ref);
  assert.equal((await call("status", ref)).post_id, null);
  const second = await call("prepare", prepare);
  assert.equal((await call("status", ref)).publish_mode, "trial");
  await assert.rejects(
    db.query("update content_posts set publish_mode='normal' where id=$1", [second.post_id]),
  );
  await db.query("update profiles set publishing_paused=false where id=$1", [owner]);
  await assert.rejects(call("publish", { ...publish, confirmation: "APPROVE" }));
  await assert.rejects(call("publish", { ...publish, publish_mode: "normal" }));
  await assert.rejects(call("publish", { ...publish, ig_user_id: "456" }));
  await db.query("update ig_connections set ig_user_id='456' where user_id=$1", [owner]);
  await assert.rejects(call("publish", publish));
  await db.query("update ig_connections set ig_user_id='123' where user_id=$1", [owner]);
  await call("publish", publish);
  assert.equal((await call("status", ref)).status, "scheduled");
  assert.equal((await call("publish", publish)).post_id, second.post_id);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from content_events where event_type='model_publish_authorized'",
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(call("cancel", ref));
  await db.query("update content_posts set status='published' where id=$1", [second.post_id]);
  await db.query(
    "update content_publications set status='published',platform_media_id='media',permalink='https://www.instagram.com/reel/TrialTest/',published_at=now(),published_ig_user_id='123' where content_post_id=$1",
    [second.post_id],
  );
  await db.query(
    "update model_alert_channels set ig_user_id='123',bot_ready=true,enabled_since=now()-interval '1 day' where model='kiikii'",
  );
  const alert = await db.query(
    "select model_alert_command('claim',null,'{\"allow_send\":true}') as v",
  );
  assert.equal(alert.rows[0].v, null);
  assert.equal((await db.query("select count(*)::int n from model_channel_alerts")).rows[0].n, 0);
  const make = async (n) => {
    const id = crypto.randomUUID(),
      hash = n.toString(16).padStart(64, "0");
    await db.query(
      "insert into content_review_items(id,user_id,model,title,caption,status,media_path,sha256,bytes,reviewed_at) values($1,$2,'kiikii','Queued test','Approved caption','approved','private/'||($1::uuid)::text||'.mp4',$3,20,now())",
      [id, owner, hash],
    );
    const ref = { id, revision: 1 };
    await call("prepare", {
      ...ref,
      publish_mode: "normal",
      sha256: hash,
      storage_path: `${owner}/model-review/${id}/${hash}.mp4`,
    });
    return ref;
  };
  const a = await make(1),
    b = await make(2);
  const slot = await call("schedule_preview", a);
  assert.equal((await call("status", a)).status, "approved");
  const schedule = {
    ...a,
    confirmation: "SCHEDULE",
    publish_mode: "normal",
    ig_user_id: "123",
    scheduled_for: slot.scheduled_for,
  };
  await assert.rejects(call("schedule", { ...schedule, confirmation: "PUBLISH" }));
  await assert.rejects(call("schedule", { ...schedule, revision: 2 }));
  await assert.rejects(call("schedule", { ...schedule, ig_user_id: "456" }));
  await assert.rejects(call("schedule", { ...schedule, scheduled_for: new Date(0).toISOString() }));
  await assert.rejects(call("queue", {}, other));
  await call("schedule", schedule);
  await call("schedule", schedule); // Lost-response retry does not allocate another slot.
  const sameDayLater = new Date(new Date(slot.scheduled_for).valueOf() + 3600_000).toISOString();
  await assert.rejects(
    call("schedule", { ...schedule, ...b, scheduled_for: sameDayLater }),
    /Daily posting limit/,
  );
  assert.equal((await call("queue", {})).queue.length, 1);
  assert.equal(
    new Date((await call("status", a)).scheduled_for).valueOf(),
    new Date(slot.scheduled_for).valueOf(),
  );
  await assert.rejects(call("schedule", { ...schedule, ...b }));
  const next = await call("schedule_preview", b);
  assert.ok(new Date(next.scheduled_for) > new Date(slot.scheduled_for));
  for (let n = 2; n <= 14; n++) {
    const ref = n === 2 ? b : await make(n),
      preview = await call("schedule_preview", ref);
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(preview.scheduled_for));
    assert.equal(local, "03:00");
    await call("schedule", { ...schedule, ...ref, scheduled_for: preview.scheduled_for });
  }
  assert.equal((await call("queue", {})).queue.length, 14);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from content_posts where status='scheduled' and scheduled_for<=now()",
      )
    ).rows[0].n,
    0,
  );
  await call("unschedule", a);
  assert.equal((await call("status", a)).status, "approved");
  assert.equal((await call("status", a)).scheduled_for, null);
  assert.equal((await call("queue", {})).queue.length, 13);
  assert.equal(
    new Date((await call("schedule_preview", a)).scheduled_for).valueOf(),
    new Date(slot.scheduled_for).valueOf(),
  );
  await call("schedule", schedule);
  await db.query(
    "update content_posts set status='publishing' where id=(select publish_post_id from content_review_items where id=$1)",
    [a.id],
  );
  await assert.rejects(call("unschedule", a));
  const expiryRef = await make(15);
  await db.query(
    "update ig_connections set token_expires_at=now()+interval '1 hour' where user_id=$1",
    [owner],
  );
  await assert.rejects(call("schedule_preview", expiryRef));
  // PostgreSQL timezone conversion follows daylight saving rather than fixed UTC offsets.
  const dst = (
    await db.query(
      "select extract(epoch from (timestamp '2026-10-26 00:00' at time zone 'Europe/Berlin')-(timestamp '2026-10-25 00:00' at time zone 'Europe/Berlin'))/3600 as hours",
    )
  ).rows[0];
  assert.equal(Number(dst.hours), 25);
  // Policy-based slot selection follows local dates across both DST changes.
  const spring = (
    await db.query("select model_next_posting_slot($1,'kiikii','2027-03-27T03:00:00Z') v", [owner])
  ).rows[0].v;
  assert.equal(new Date(spring).toISOString(), "2027-03-28T01:00:00.000Z");
  const autumn = (
    await db.query("select model_next_posting_slot($1,'kiikii','2027-10-30T02:00:00Z') v", [owner])
  ).rows[0].v;
  assert.equal(new Date(autumn).toISOString(), "2027-10-31T02:00:00.000Z");
  await db.exec("reset role");
  await db.query(
    "insert into model_pipeline_settings values($1,true,now()-interval '11 days'),($2,true,now())",
    [owner, other],
  );
  await db.query(
    "insert into model_pipeline_jobs values($1,'kiikii','queued',now()-interval '13 days',current_date,0),($1,'tuuva','queued',now()-interval '20 days',current_date,0),($2,'kiikii','queued',now()-interval '30 days',current_date,0)",
    [owner, other],
  );
  await db.exec("set role service_role");
  const health = (await db.query("select business_live_status($1) v", [owner])).rows[0].v
    .generation_worker;
  assert.equal(health.enabled, true);
  assert.equal(health.queued, 1);
  assert.equal(health.in_progress, 0);
  assert.ok(Date.now() - Date.parse(health.last_seen_at) > 10 * 86400_000);
  assert.ok(Date.now() - Date.parse(health.oldest_queued_at) < 14 * 86400_000);
  const missing = (await db.query("select business_live_status($1) v", [crypto.randomUUID()]))
    .rows[0].v.generation_worker;
  assert.equal(missing.configured, false);
  assert.equal(missing.enabled, null);
  assert.equal(missing.last_seen_at, null);
  assert.equal(missing.queued, 0);
  await db.query("update content_review_items set telegram_message_id=10 where id=$1", [b.id]);
  const sync = async (action, data) =>
    (
      await db.query("select review_card_sync_command($1,$2,$3) v", [
        owner,
        action,
        JSON.stringify(data),
      ])
    ).rows[0].v;
  const claimed = await sync("claim", { id: b.id });
  assert.equal(claimed.item.telegram_message_id, 10);
  assert.equal(claimed.post.status, "scheduled");
  assert.equal(await sync("claim", { id: b.id }), null);
  await call("unschedule", b); // A newer change during an edit cannot be lost.
  await sync("done", { id: b.id, lease: claimed.lease });
  const newer = await sync("claim", { id: b.id });
  assert.equal(newer.post.status, "approved");
  await assert.rejects(sync("done", { id: b.id, lease: claimed.lease }));
  await sync("retry", { id: b.id, lease: newer.lease });
  assert.equal(await sync("claim", { id: b.id }), null);
  await db.query(
    "update review_card_sync set retry_at=now()-interval '1 second' where item_id=$1",
    [b.id],
  );
  const retried = await sync("claim", { id: b.id });
  await sync("done", { id: b.id, lease: retried.lease });
  assert.equal(await sync("claim", { id: b.id }), null);
  await call("cancel", b);
  await db.query("select content_review_command($1,'edit',$2)", [
    owner,
    JSON.stringify({ ...b, caption: "New caption" }),
  ]);
  const edited = (
    await db.query(
      "select revision,status,telegram_message_id from content_review_items where id=$1",
      [b.id],
    )
  ).rows[0];
  assert.equal(edited.telegram_message_id, 10);
  assert.equal(edited.status, "pending");
  assert.equal(edited.revision, 2);
  console.log(
    "Telegram card queue passed: lease isolation, new changes preserved, stale receipts rejected, delayed retry and successful completion.",
  );
  console.log(
    "Posting queue passed: stored model policy, 14 daily slots, manual daily cap, confirmation, isolation, collision, idempotency, cancellation, expiry, DST, worker evidence and least privilege.",
  );
  console.log(
    "Model publishing DB passed: owner, revision, separate account, immutable review/target/media, pause, exact confirmation, prepare/cancel, idempotent publish.",
  );
} finally {
  await db.close();
}
