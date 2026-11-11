import fs from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";

// Exercise real Edge code with provider I/O replaced; never publish test media.
let source = "";
for (const name of [
  "_shared/instagram-reel.ts",
  "_shared/instagram-feed.ts",
  "_shared/instagram-story.ts",
  "content-publisher/index.ts",
]) {
  let text = await fs.readFile(new URL("../supabase/functions/" + name, import.meta.url), "utf8");
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  for (const statement of [...sf.statements].reverse())
    if (ts.isImportDeclaration(statement))
      text = text.slice(0, statement.getFullStart()) + text.slice(statement.end);
  source += text.replace(/^export /gm, "") + "\n";
}
source +=
  "this.testApi={buildStoryMentionFields,processPost,processVideoPublication,processImagePublication,cleanupExpiredMedia};";
let posts,
  publications,
  calls,
  events,
  removedPaths,
  storyDue,
  timingError,
  timingCalls,
  released,
  handler;
const clockNow = Date.parse("2026-11-11T20:00:00Z");
class ClockDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [clockNow]));
  }
  static now() {
    return clockNow;
  }
}
const lease = { postId: "post", token: "test-lease" };
const admin = {
  rpc: async (name, args) => {
    if (name === "renew_content_publish_lease") return { data: true, error: null };
    if (name === "ensure_model_story_time") {
      timingCalls++;
      assert.equal(args.p_lease_token, lease.token);
      return { data: storyDue, error: timingError };
    }
    if (name === "verify_publisher_cron_secret") return { data: true, error: null };
    if (name === "claim_due_content_post_v2")
      return { data: { post_id: "post", lease_token: lease.token }, error: null };
    if (name === "release_content_publish_lease_v2") {
      released++;
      return { data: true, error: null };
    }
    assert.equal(name, "write_content_publish_state");
    if (args._publication_values)
      Object.assign(
        publications.find((p) => p.id === args._publication_id),
        args._publication_values,
      );
    if (args._post_values) Object.assign(posts, args._post_values);
    if (args._event_type) events.push({ type: args._event_type, detail: args._event_detail });
    return { data: true, error: null };
  },
  storage: {
    from: () => ({
      createSignedUrl: async (path) => ({
        data: { signedUrl: "https://media.invalid/" + path },
        error: null,
      }),
      remove: async (paths) => {
        removedPaths.push(...paths);
        return { error: null };
      },
    }),
  },
  from(table) {
    const filters = [];
    const upperBounds = [];
    let patch = null;
    const resolve = () => {
      const rows =
        table === "content_posts"
          ? [posts]
          : table === "content_publications"
            ? publications
            : [
                {
                  user_id: "owner",
                  destination: "kiikii",
                  ig_user_id: "source",
                  status: "active",
                  ig_username: "kiikii.bat",
                  token_expires_at: "2099-01-01T00:00:00Z",
                  api_base_url: "https://graph.invalid",
                  page_access_token: "test-only",
                },
              ];
      return rows.filter(
        (r) =>
          filters.every(([k, v]) => r[k] === v) &&
          upperBounds.every(([k, v]) => r[k] != null && r[k] <= v),
      );
    };
    const q = {
      select() {
        return q;
      },
      eq(k, v) {
        filters.push([k, v]);
        return q;
      },
      is(k, v) {
        return q.eq(k, v);
      },
      lte(k, v) {
        upperBounds.push([k, v]);
        return q;
      },
      limit() {
        return q;
      },
      update(values) {
        patch = values;
        return q;
      },
      insert: async (values) => {
        events.push(values);
        return { error: null };
      },
      single: async () => ({ data: resolve()[0], error: null }),
      maybeSingle: async () => ({ data: resolve()[0], error: null }),
      then(done, fail) {
        const rows = resolve();
        if (patch) for (const row of rows) Object.assign(row, patch);
        return Promise.resolve({ data: rows, error: null }).then(done, fail);
      },
    };
    return q;
  },
};
const context = vm.createContext({
  console,
  Request,
  Response,
  URL,
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  Date: ClockDate,
  createClient: () => admin,
  Deno: {
    env: {
      get: (name) =>
        ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].includes(name) ? "test-only" : undefined,
    },
    serve: (callback) => {
      handler = callback;
    },
  },
  fetch: async (url, opts) => {
    calls.push({
      url,
      method: opts?.method || "GET",
      body: opts?.body ? Object.fromEntries(opts.body) : null,
    });
    if (url.startsWith("https://media.invalid/"))
      return new Response("video", {
        headers: { "content-type": url.endsWith(".jpg") ? "image/jpeg" : "video/mp4" },
      });
    if (opts?.method === "POST") return Response.json({ id: "created-container" });
    throw new Error("Unexpected provider call");
  },
});
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText,
  context,
);
const api = context.testApi;
const reset = (primaryStatus = "pending") => {
  calls = [];
  events = [];
  removedPaths = [];
  storyDue = new Date(clockNow - 1000).toISOString();
  timingError = null;
  timingCalls = 0;
  released = 0;
  posts = {
    id: "post",
    user_id: "owner",
    destination: "kiikii",
    target_ig_user_id: "source",
    content_type: "reel",
    status: "publishing",
    publish_mode: "normal",
    reel_storage_path: "approved.mp4",
    story_storage_path: "approved-template.jpg",
    story_media_type: "image",
    story_media_reusable: true,
    story_link_delay_seconds: 600,
    media_cleanup_after: null,
    media_cleaned_at: null,
    story_publish_mode: "automatic_no_link",
    story_mention_username: "kiikiilink",
    caption: "Approved caption",
    share_to_feed: true,
    first_comment: "",
  };
  publications = ["reel", "story"].map((channel) => ({
    id: channel,
    content_post_id: "post",
    channel,
    status: channel === "reel" ? primaryStatus : "pending",
    attempts: 0,
    platform_container_id: null,
    platform_media_id:
      channel === "reel" && primaryStatus === "published" ? "primary-receipt" : null,
    platform_child_container_ids: [],
    external_action_started_at: null,
    recovery_required: false,
    processing_started_at: null,
    updated_at: new Date().toISOString(),
  }));
};
const createCalls = () => calls.filter((c) => c.method === "POST");
let count = 0;
const pass = (name) => {
  count++;
  console.log("PASS " + name);
};
reset();
assert.equal((await api.processPost(admin, "post", lease)).channel, "reel");
assert.equal(createCalls().length, 1);
assert.equal(createCalls()[0].body.media_type, "REELS");
assert.equal(createCalls()[0].body.user_tags, undefined);
assert.equal(publications[1].status, "pending");
pass("Story does not start before the primary Reel finishes; Reel is not tagged");
reset("skipped");
await assert.rejects(api.processPost(admin, "post", lease), /confirmed primary Reel publication/);
assert.equal(createCalls().length, 0);
pass("a skipped primary Reel cannot trigger a mention Story");
reset("published");
storyDue = new Date(clockNow + 600000).toISOString();
for (let retry = 0; retry < 2; retry++) {
  const result = await api.processPost(admin, "post", lease);
  assert.equal(result.state, "waiting");
  assert.equal(result.nextAttemptAt, storyDue);
}
assert.equal(calls.length, 0);
assert.equal(posts.status, "publishing");
assert.equal(posts.media_cleanup_after, null);
pass(
  "before-due retries preserve the same absolute delay without downloading, creating or cleaning media",
);
const response = await handler(
  new Request("https://publisher.invalid", {
    method: "POST",
    headers: { "x-cron-secret": "test-only" },
    body: "{}",
  }),
);
assert.equal(response.status, 200);
assert.equal((await response.json()).state, "waiting");
assert.equal(posts.publish_next_attempt_at, storyDue);
assert.equal(released, 1);
assert.equal(posts.status, "publishing");
assert.equal(calls.length, 0);
pass(
  "cron persists the absolute Story due time, preserves publishing state and releases its lease",
);
reset("published");
storyDue = new Date(clockNow).toISOString();
await api.processPost(admin, "post", lease);
assert.equal(createCalls().length, 1);
pass("the exact due-time boundary permits one static Story container");
reset("published");
storyDue = new Date(clockNow - 3600000).toISOString();
await api.processPost(admin, "post", lease);
assert.equal(createCalls().length, 1);
Object.assign(publications[1], { status: "published", platform_media_id: "late-story-receipt" });
await api.processPost(admin, "post", lease);
assert.equal(createCalls().length, 1);
assert.ok(posts.media_cleanup_after);
pass("late resume sends once and only completed Story receipt enables cleanup");
for (const failure of ["lost lease", "missing primary timestamp"]) {
  reset("published");
  timingError = new Error(failure);
  await assert.rejects(api.processPost(admin, "post", lease), new RegExp(failure));
  assert.equal(calls.length, 0);
}
pass("timing validation failures stop before any media or provider request");
reset("published");
storyDue = "invalid date";
await assert.rejects(api.processPost(admin, "post", lease), /due time was not confirmed/);
assert.equal(calls.length, 0);
pass("an invalid due timestamp fails closed");
reset("published");
assert.equal((await api.processPost(admin, "post", lease)).channel, "story");
assert.equal(createCalls().length, 1);
assert.equal(createCalls()[0].body.media_type, "STORIES");
assert.equal(createCalls()[0].body.image_url, "https://media.invalid/approved-template.jpg");
assert.equal(createCalls()[0].body.video_url, undefined);
assert.deepEqual(JSON.parse(createCalls()[0].body.user_tags), [
  { username: "kiikiilink", x: 0.5, y: 0.8 },
]);
assert.equal(createCalls()[0].body.caption, undefined);
assert.equal(createCalls()[0].body.trial_params, undefined);
assert.equal(events.at(-1).detail.mention_username, "kiikiilink");
pass(
  "successful Reel starts static image Story with real positioned user_tags and its approved template",
);
reset("published");
Object.assign(publications[1], { status: "published", platform_media_id: "story-receipt" });
assert.equal((await api.processPost(admin, "post", lease)).state, "published");
assert.equal(createCalls().length, 0);
pass("stored Story receipt makes repeated processing send nothing");
reset("published");
storyDue = new Date(clockNow + 600000).toISOString();
Object.assign(publications[1], {
  status: "published",
  platform_media_id: "story-receipt",
  recovery_required: true,
  last_error: "INSTAGRAM_CONFIG_ISSUE: USER_TAGGING_FAILURE. Story already exists.",
});
await assert.rejects(api.processPost(admin, "post", lease), /USER_TAGGING_FAILURE/);
assert.equal(createCalls().length, 0);
assert.equal(publications[1].recovery_required, true);
assert.equal(timingCalls, 0);
pass(
  "published static Story with dropped mention stays in reconciliation instead of silently completing or reposting",
);
reset("published");
storyDue = new Date(clockNow + 600000).toISOString();
Object.assign(publications[1], { external_action_started_at: new Date().toISOString() });
await assert.rejects(api.processPost(admin, "post", lease), /reconciliation/);
assert.equal(createCalls().length, 0);
assert.equal(timingCalls, 0);
pass("ambiguous Story send is fenced for recovery instead of reposted");
reset("published");
posts.story_mention_username = "@bad";
await assert.rejects(api.processPost(admin, "post", lease), /username without @/);
assert.equal(createCalls().length, 0);
pass("invalid mention fails before any Instagram POST");
reset("published");
posts.target_ig_user_id = "different-source";
await assert.rejects(api.processPost(admin, "post", lease), /destination changed after approval/);
assert.equal(createCalls().length, 0);
pass("a changed source Instagram account cannot receive the approved Story");
reset("published");
await api.processImagePublication({
  admin,
  lease,
  postId: "post",
  publication: publications[1],
  storagePath: "approved.jpg",
  altText: "not supported on Stories",
  caption: "",
  asStory: true,
  storyMentionUsername: "kiikiilink",
  igUserId: "source",
  apiBaseUrl: "https://graph.invalid",
  token: "test-only",
});
assert.deepEqual(JSON.parse(createCalls()[0].body.user_tags), [
  { username: "kiikiilink", x: 0.5, y: 0.8 },
]);
assert.equal(createCalls()[0].body.alt_text, undefined);
pass("image Stories use supported mention fields without unsupported alt_text");
reset("published");
posts.story_mention_username = null;
posts.story_media_type = null;
posts.story_media_reusable = false;
posts.story_link_delay_seconds = null;
posts.story_storage_path = "approved.mp4";
await api.processPost(admin, "post", lease);
assert.equal(createCalls()[0].body.user_tags, undefined);
assert.equal(createCalls()[0].body.video_url, "https://media.invalid/approved.mp4");
assert.equal(timingCalls, 0);
pass("existing automatic Stories without mentions remain compatible");
reset("published");
posts.story_media_type = "video";
posts.story_media_reusable = false;
posts.story_link_delay_seconds = null;
posts.story_storage_path = "approved.mp4";
await api.processPost(admin, "post", lease);
assert.deepEqual(JSON.parse(createCalls()[0].body.user_tags), [
  { username: "kiikiilink", x: 0.5, y: 0.8 },
]);
assert.equal(createCalls()[0].body.video_url, "https://media.invalid/approved.mp4");
assert.equal(timingCalls, 0);
pass("explicit video Stories retain real mentions independently of the static-template policy");
reset("published");
posts.media_cleanup_after = new Date(clockNow - 1000).toISOString();
assert.equal(await api.cleanupExpiredMedia(admin), 1);
assert.deepEqual(removedPaths, ["approved.mp4"]);
assert.ok(posts.media_cleaned_at);
pass("48-hour cleanup preserves the shared image for later queued Stories and future rotation");
reset("published");
posts.media_cleanup_after = new Date(clockNow - 1000).toISOString();
posts.story_media_reusable = false;
assert.equal(await api.cleanupExpiredMedia(admin), 1);
assert.deepEqual(removedPaths, ["approved.mp4", "approved-template.jpg"]);
pass("one-off nonreusable Story assets retain existing temporary-media cleanup behavior");
console.log(`${count} Story publisher checks passed.`);
