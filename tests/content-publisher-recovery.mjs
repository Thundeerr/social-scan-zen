import fs from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";

// Execute the actual Edge Function helpers without Deno or external network.
const file = new URL("../supabase/functions/content-publisher/index.ts", import.meta.url);
// Edge code is outside the app's tsconfig. Check it against the installed,
// pinned Supabase package; the only shim is Deno's env/serve runtime surface.
const shimPath = fileURLToPath(new URL("publisher-runtime-check.d.ts", import.meta.url)).replaceAll(
  "\\",
  "/",
);
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  strict: true,
  noEmit: true,
};
const compilerHost = ts.createCompilerHost(compilerOptions);
const readSource = compilerHost.getSourceFile;
compilerHost.getSourceFile = (name, version, ...rest) =>
  name.replaceAll("\\", "/") === shimPath
    ? ts.createSourceFile(
        name,
        "declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };",
        version,
      )
    : readSource(name, version, ...rest);
compilerHost.resolveModuleNames = (names, containing) =>
  names.map(
    (name) =>
      ts.resolveModuleName(
        name.startsWith("npm:") ? "@supabase/supabase-js" : name,
        containing,
        compilerOptions,
        compilerHost,
      ).resolvedModule,
  );
const diagnostics = ts.getPreEmitDiagnostics(
  ts.createProgram([fileURLToPath(file), shimPath], compilerOptions, compilerHost),
);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  }),
);
console.log("PASS publisher Edge TypeScript check with local Supabase types and Deno runtime shim");
let source = await fs.readFile(file, "utf8");
const sf = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
for (const statement of [...sf.statements].reverse()) {
  if (ts.isImportDeclaration(statement))
    source = source.slice(0, statement.getFullStart()) + source.slice(statement.end);
}
source +=
  "\nthis.testApi = {processVideoPublication,finishImagePublication,processFirstComment,graphRequest};";
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
let calls = [],
  responses = [],
  trace = [],
  eventRecords = [],
  postState = {},
  records = new Map(),
  failReceipt = false,
  leaseValid = true;
const admin = {
  rpc: async (name, args) => {
    trace.push(name);
    if (name === "renew_content_publish_lease") return { data: leaseValid, error: null };
    assert.equal(name, "write_content_publish_state");
    if (!leaseValid) return { data: false, error: null };
    if (args._publication_values) {
      if (failReceipt && args._publication_values.platform_media_id)
        return { data: null, error: new Error("Receipt write interrupted") };
      trace.push(args._publication_values.platform_media_id ? "receipt" : "state");
      const row = records.get(args._publication_id);
      Object.assign(row, args._publication_values);
    }
    if (args._post_values) Object.assign(postState, args._post_values);
    if (args._event_type) eventRecords.push({ type: args._event_type, detail: args._event_detail });
    return { data: true, error: null };
  },
};
const context = vm.createContext({
  console,
  Response,
  Request,
  URL,
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  Deno: { env: { get: () => undefined }, serve: () => {} },
  fetch: async (url, options) => {
    const method = options?.method || "GET";
    calls.push({ url, method });
    trace.push(method === "POST" ? "post" : "get");
    const result = responses.shift();
    if (result instanceof Error) throw result;
    if (!result) throw new Error("Unexpected request: external network is disabled");
    return Response.json(result);
  },
});
vm.runInContext(js, context);
const api = context.testApi;
const reset = (overrides = {}) => {
  calls = [];
  responses = [];
  trace = [];
  eventRecords = [];
  postState = {};
  failReceipt = false;
  leaseValid = true;
  const row = {
    id: "publication",
    status: "publishing",
    channel: "reel",
    attempts: 1,
    platform_container_id: "container",
    platform_child_container_ids: [],
    platform_media_id: null,
    external_action_started_at: null,
    recovery_required: false,
    processing_started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  records = new Map([[row.id, row]]);
  return {
    admin,
    lease: { postId: "post", token: "token" },
    postId: "post",
    publication: { ...row },
    channel: "reel",
    storagePath: "unused",
    caption: "caption",
    shareToFeed: true,
    igUserId: "account",
    apiBaseUrl: "https://example.invalid/v25.0",
    token: "mock",
  };
};
let count = 1;
const pass = (label) => {
  count += 1;
  console.log(`PASS ${label}`);
};

let input = reset();
responses = [{ status_code: "PUBLISHED" }];
await assert.rejects(api.processVideoPublication(input), /reconciliation/);
assert.equal(records.get("publication").recovery_required, true);
assert.equal(calls.filter((c) => c.method === "POST").length, 0);
pass(
  "already-published container is held for reconciliation without repeat POST or endless polling",
);

input = reset();
responses = [{ status_code: "FINISHED" }, { id: "media" }, new Error("Permalink unavailable")];
assert.equal(await api.processVideoPublication(input), "done");
assert.equal(records.get("publication").platform_media_id, "media");
assert.ok(trace.indexOf("receipt") < trace.lastIndexOf("get"));
pass("durable receipt precedes optional metadata and survives metadata failure");

for (const configIssue of ["USER_TAGGING_FAILURE", "CAPTION_NOT_ATTACHED"]) {
  input = reset({ channel: configIssue === "USER_TAGGING_FAILURE" ? "story" : "reel" });
  input.channel = input.publication.channel;
  responses = [
    { status_code: "FINISHED" },
    { id: "partial-media", config_issue: configIssue },
    new Error("Permalink unavailable"),
  ];
  await assert.rejects(api.processVideoPublication(input), new RegExp(configIssue));
  assert.equal(records.get("publication").platform_media_id, "partial-media");
  assert.equal(records.get("publication").status, "published");
  assert.equal(records.get("publication").recovery_required, true);
  assert.equal(postState.status, "failed");
  assert.equal(postState.publish_next_attempt_at, null);
  assert.equal(eventRecords.at(-1).detail.config_issue, configIssue);
  assert.equal(eventRecords.at(-1).detail.media_id, "partial-media");
  assert.ok(trace.indexOf("receipt") < trace.lastIndexOf("get"));
  const previousCalls = calls.length;
  await assert.rejects(
    api.processVideoPublication({ ...input, publication: { ...records.get("publication") } }),
    new RegExp(configIssue),
  );
  assert.equal(calls.length, previousCalls);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(records.get("publication").recovery_required, true);
  pass(
    `${configIssue} preserves published receipt and issue, holds parent, and never republishes on replay`,
  );
}

input = reset();
responses = [{ status_code: "FINISHED" }, { id: "media" }];
failReceipt = true;
await assert.rejects(api.processVideoPublication(input), /Receipt write/);
assert.ok(records.get("publication").external_action_started_at);
failReceipt = false;
await assert.rejects(
  api.processVideoPublication({ ...input, publication: { ...records.get("publication") } }),
  /reconciliation/,
);
assert.equal(calls.filter((c) => c.method === "POST").length, 1);
pass("lost publish receipt cannot resend on replay");

input = reset();
responses = [{ status_code: "FINISHED" }, new Error("Response lost after acceptance")];
await assert.rejects(api.processVideoPublication(input), /reconciliation/);
assert.equal(records.get("publication").recovery_required, true);
pass("uncertain provider response becomes a durable recovery hold");

input = reset();
leaseValid = false;
responses = [{ status_code: "FINISHED" }];
await assert.rejects(api.processVideoPublication(input), /lease/);
assert.equal(calls.filter((c) => c.method === "POST").length, 0);
pass("lost lease prevents external publication");

input = reset({ processing_started_at: new Date(Date.now() - 31 * 60_000).toISOString() });
responses = [{ status_code: "IN_PROGRESS" }];
await assert.rejects(api.processVideoPublication(input), /timed out/);
pass("container processing has a bounded wait");

input = reset();
responses = [{}];
assert.equal(await api.finishImagePublication({ ...input, label: "image" }), "waiting");
assert.equal(calls.filter((c) => c.method === "POST").length, 0);
pass("missing image container status is never treated as FINISHED");

input = reset({ status: "pending", channel: "first_comment", platform_container_id: null });
const comment = {
  ...input,
  reel: { status: "published", platform_media_id: "media" },
  message: "test",
};
responses = [{ id: "comment-one" }];
failReceipt = true;
await assert.rejects(api.processFirstComment(comment), /Receipt write/);
assert.equal(records.get("publication").status, "publishing");
failReceipt = false;
await assert.rejects(
  api.processFirstComment({ ...comment, publication: { ...records.get("publication") } }),
  /reconciliation/,
);
assert.equal(calls.filter((c) => c.method === "POST").length, 1);
pass("comment reservation prevents duplicate after lost receipt");

input = reset({ status: "pending", platform_media_id: "already-known" });
assert.equal(await api.processVideoPublication(input), "done");
assert.equal(calls.length, 0);
pass("known durable media receipt resumes without contacting publish endpoint");

input = reset({
  status: "publishing",
  channel: "first_comment",
  platform_media_id: "known-comment",
  external_action_started_at: new Date().toISOString(),
});
assert.equal(
  await api.processFirstComment({
    ...input,
    reel: { status: "published", platform_media_id: "media" },
    message: "test",
  }),
  "done",
);
assert.equal(calls.length, 0);
pass("known durable comment receipt resumes without another comment or false hold");

const db = new PGlite();
const owner = "33333333-3333-3333-3333-333333333333";
const first = "11111111-1111-1111-1111-111111111111",
  second = "22222222-2222-2222-2222-222222222222";
const firstPub = "44444444-4444-4444-4444-444444444444",
  secondPub = "55555555-5555-5555-5555-555555555555";
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);
    create table profiles(id uuid primary key,publishing_paused boolean);`);
  const base = await fs.readFile(
    new URL(
      "../supabase/migrations/20260820154804_add_content_publisher_queue.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(base.split("REVOKE ALL ON")[0]);
  await db.exec(`alter table content_posts add publish_started_at timestamptz,add publish_attempts int default 0,
    add publish_lease_until timestamptz,add published_at timestamptz,add last_publish_error text,add media_cleanup_after timestamptz;
    alter table content_publications add platform_child_container_ids text[] default '{}',add published_ig_user_id text;`);
  const legacyUser = crypto.randomUUID(),
    legacyPost = crypto.randomUUID(),
    legacyCommentPost = crypto.randomUUID();
  await db.query("insert into auth.users values($1)", [legacyUser]);
  await db.query(
    "insert into content_posts(id,user_id,post_key,title,status) values($1,$3,'legacy-media','legacy-media','failed'),($2,$3,'legacy-comment','legacy-comment','publishing')",
    [legacyPost, legacyCommentPost, legacyUser],
  );
  await db.query(
    "insert into content_publications(content_post_id,channel,status,platform_container_id,platform_media_id) values($1,'reel','publishing','legacy-container',null),($2,'reel','published',null,'legacy-known-media'),($2,'first_comment','pending',null,null)",
    [legacyPost, legacyCommentPost],
  );
  const migration = await fs.readFile(
    new URL(
      "../supabase/migrations/20261106181755_content_publisher_fenced_recovery.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  const legacy = (
    await db.query(
      "select content_post_id,channel,status,recovery_required from content_publications where content_post_id in ($1,$2) order by channel",
      [legacyPost, legacyCommentPost],
    )
  ).rows;
  assert.equal(legacy.filter((row) => row.recovery_required).length, 2);
  assert.ok(legacy.filter((row) => row.recovery_required).every((row) => row.status === "failed"));
  await assert.rejects(
    db.query("update content_posts set status='scheduled' where id=$1", [legacyPost]),
    /Reconcile/,
  );
  await assert.rejects(
    db.query("update content_posts set status='scheduled' where id=$1", [legacyCommentPost]),
    /Reconcile/,
  );
  pass("upgrade quarantines legacy lost-receipt media and potentially interrupted first comments");
  await db.query("insert into auth.users values($1);", [owner]);
  await db.query("insert into profiles values($1,false)", [owner]);
  await db.query(
    "insert into content_posts(id,user_id,post_key,title,status,scheduled_for) values($1,$3,'first','first','publishing',now()-interval '2 days'),($2,$3,'second','second','scheduled',now()-interval '1 hour')",
    [first, second, owner],
  );
  await db.query(
    "insert into content_publications(id,content_post_id,channel) values($1,$2,'reel'),($3,$4,'reel')",
    [firstPub, first, secondPub, second],
  );
  const rpc = async (name, args = [], casts = []) =>
    (
      await db.query(
        `select ${name}(${args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ""}`).join(",")}) as result`,
        args,
      )
    ).rows[0].result;
  const claim1 = await rpc("claim_due_content_post_v2");
  assert.equal(claim1.post_id, first);
  await db.query(
    "update content_posts set publish_lease_until=clock_timestamp()-interval '1 second' where id=$1",
    [first],
  );
  assert.equal(await rpc("renew_content_publish_lease", [first, claim1.lease_token]), false);
  assert.equal(
    await rpc("write_content_publish_state", [
      first,
      claim1.lease_token,
      firstPub,
      JSON.stringify({ status: "failed" }),
    ]),
    false,
  );
  pass("expired lease cannot renew or write even before a successor claims");
  const claim2 = await rpc("claim_due_content_post_v2", [first]);
  assert.notEqual(claim1.lease_token, claim2.lease_token);
  assert.equal(await rpc("release_content_publish_lease_v2", [first, claim1.lease_token]), false);
  assert.equal(await rpc("renew_content_publish_lease", [first, claim1.lease_token]), false);
  assert.equal(
    await rpc("write_content_publish_state", [
      first,
      claim1.lease_token,
      firstPub,
      JSON.stringify({ status: "failed" }),
    ]),
    false,
  );
  assert.equal(
    (await db.query("select status from content_publications where id=$1", [firstPub])).rows[0]
      .status,
    "pending",
  );
  pass("stale worker cannot release, renew, or overwrite successor state");
  assert.equal(await rpc("renew_content_publish_lease", [first, claim2.lease_token]), true);
  await db.query("update profiles set publishing_paused=true where id=$1", [owner]);
  assert.equal(await rpc("renew_content_publish_lease", [first, claim2.lease_token]), false);
  await db.query("update profiles set publishing_paused=false where id=$1", [owner]);
  pass("pause switch stops an existing worker at its next pre-send renewal");
  await assert.rejects(
    rpc("write_content_publish_state", [
      first,
      claim2.lease_token,
      secondPub,
      JSON.stringify({ status: "failed" }),
    ]),
    /does not belong/,
  );
  await assert.rejects(
    rpc("write_content_publish_state", [
      first,
      claim2.lease_token,
      firstPub,
      JSON.stringify({ content_post_id: second }),
    ]),
    /Invalid publisher/,
  );
  pass("valid owner renews; child ownership and patch fields are checked");

  await rpc("write_content_publish_state", [
    first,
    claim2.lease_token,
    null,
    "{}",
    JSON.stringify({ publish_next_attempt_at: new Date(Date.now() + 60_000).toISOString() }),
  ]);
  await rpc("release_content_publish_lease_v2", [first, claim2.lease_token]);
  const otherClaim = await rpc("claim_due_content_post_v2");
  assert.equal(otherClaim.post_id, second);
  pass("polling backoff leaves another due post claimable");
  await rpc("release_content_publish_lease_v2", [second, otherClaim.lease_token]);
  await db.query("update content_posts set publish_next_attempt_at=null where id=$1", [first]);
  const claim3 = await rpc("claim_due_content_post_v2", [first]);
  await rpc("write_content_publish_state", [
    first,
    claim3.lease_token,
    firstPub,
    JSON.stringify({ status: "failed", recovery_required: true }),
    JSON.stringify({ status: "failed" }),
  ]);
  await rpc("release_content_publish_lease_v2", [first, claim3.lease_token]);
  await assert.rejects(
    db.query("update content_posts set status='scheduled' where id=$1", [first]),
    /Reconcile/,
  );
  assert.equal(await rpc("claim_due_content_post_v2", [first]), null);
  pass("uncertain publications cannot be blindly rescheduled or automatically claimed");
  await db.query("update profiles set publishing_paused=true where id=$1", [owner]);
  assert.equal(await rpc("claim_due_content_post_v2"), null);
  await assert.rejects(rpc("claim_due_content_post"), /upgrade required/);
  await assert.rejects(rpc("release_content_publish_lease", [second]), /upgrade required/);
  pass("paused publishing and unfenced legacy clients fail closed");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(rpc("claim_due_content_post_v2"), /permission denied/);
    await assert.rejects(
      rpc("write_content_publish_state", [first, claim3.lease_token]),
      /permission denied/,
    );
    await db.exec("reset role");
  }
  pass("browser roles cannot claim leases or mutate privileged publisher state");
} finally {
  await db.close();
}
console.log(`${count} publisher recovery checks passed.`);
