import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
process.on("uncaughtException", (error) => {
  console.error(error.message, error.where || "", error.detail || "");
  process.exit(1);
});
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key); create table public.user_roles(user_id uuid,role text);
create table public.ig_connections(id uuid primary key,user_id uuid,ig_username text,status text);
grant select on public.user_roles,public.ig_connections to service_role;`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261102120000_smartlink_studio.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(await readFile(new URL('../supabase/migrations/20261102180616_smartlink_overview_alias.sql', import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/20261102190120_smartlink_providers.sql', import.meta.url),'utf8'));
const a = crypto.randomUUID(),
  b = crypto.randomUUID(),
  outsider = crypto.randomUUID(),
  account = crypto.randomUUID();
await db.query("insert into auth.users values($1),($2),($3)", [a, b, outsider]);
await db.query("insert into public.user_roles values($1,'owner'),($2,'cofounder')", [a, b]);
await db.query("insert into public.ig_connections values($1,$2,'creator','active')", [account, a]);
const call = async (user, action, p = {}) =>
  (await db.query("select public.sl_command($1,$2,$3) result", [user, action, JSON.stringify(p)]))
    .rows[0].result;
const analytics = async (user, p = { days: 7 }) =>
  (await db.query("select public.sl_analytics($1,$2) result", [user, JSON.stringify(p)])).rows[0]
    .result;
await db.exec("set role service_role");
await assert.rejects(call(outsider, "overview"));
const campaign = await call(a, "create_campaign", {
  name: "Launch",
  template: "Hallo {{name}}: {{link}}",
});
const other = await call(b, "create_campaign", { name: "Other", template: "" });
const overview = await call(a, 'overview');
assert.equal(overview.campaigns.length, 1);
assert.equal(overview.campaigns[0].name, 'Launch');
assert.equal(overview.accounts[0].name, 'creator');
assert.equal((await call(b, 'overview')).accounts.length, 0);
const payload = {
  request_id: crypto.randomUUID(),
  campaign: campaign.id,
  count: 1000,
  target: "https://example.com/offer",
  domain: "https://go.example.com",
  account,
};
assert.equal((await call(a, "generate", payload)).count, 1000);
assert.equal((await call(a, "generate", payload)).replayed, true);
assert.equal(
  (await db.query("select count(distinct slug)::int n from public.sl_links")).rows[0].n,
  1000,
);
await assert.rejects(call(a, "generate", { ...payload, count: 999 }));
await assert.rejects(call(b, "generate", payload));
await assert.rejects(
  call(a, "generate", { ...payload, request_id: crypto.randomUUID(), campaign: other.id }),
);
await assert.rejects(
  call(a, "generate", { ...payload, request_id: crypto.randomUUID(), count: 1001 }),
);
await assert.rejects(
  call(b, "generate", { ...payload, request_id: crypto.randomUUID(), campaign: other.id }),
); // other owner's account
assert.equal((await call(b, "links")).total, 0);
const page = await call(a, "links", { offset: 0, sort: "oldest" });
assert.equal(page.items.length, 100);
const second = await call(a, "links", { offset: 100, sort: "oldest" });
assert.equal(second.items.length, 100);
assert(!page.items.some((x) => second.items.some((y) => x.id === y.id)));
const link = page.items[0];
await assert.rejects(call(b, "update_links", { ids: [link.id], active: false }));
await call(a, "update_links", { ids: [link.id], active: false, target: "https://example.com/new" });
assert.equal(
  (await db.query("select active from public.sl_links where id=$1", [link.id])).rows[0].active,
  false,
);
await call(a, "update_links", { ids: [link.id], active: true });
await assert.rejects(
  call(a, "import_recipients", {
    campaign: campaign.id,
    recipients: [{ handle: "alex", name: "Alex", consent: "granted", evidence: "" }],
  }),
);
await call(a, "import_recipients", {
  campaign: campaign.id,
  recipients: [
    { handle: "@Alex", name: "Alex", consent: "granted", evidence: "Form opt-in" },
    { handle: "alex", name: "Duplicate", consent: "unknown", evidence: "" },
  ],
});
const recipients = await call(a, "recipients", { campaign: campaign.id });
assert.equal(recipients.total, 1);
await call(a, "update_links", { ids: [link.id], recipient: recipients.items[0].id });
await call(a, "drafts", { campaign: campaign.id });
await call(a, "drafts", { campaign: campaign.id });
assert.equal(
  (await call(a, "recipients", { campaign: campaign.id })).items[0].message_status,
  "draft",
);
await call(a, "suppress", { handle: "@alex" });
const blocked = (await call(a, "recipients", { campaign: campaign.id })).items[0];
assert.equal(blocked.message_status, "blocked");
assert.equal(blocked.consent, "revoked");
await assert.rejects(
  call(a, "update_links", { ids: [link.id], recipient: recipients.items[0].id }),
);
await call(a, "import_recipients", {
  campaign: campaign.id,
  recipients: [{ handle: "alex", name: "Alex", consent: "granted", evidence: "new import" }],
});
assert.equal((await call(a, "recipients", { campaign: campaign.id })).items[0].consent, "revoked");
await call(a, "import_recipients", {
  campaign: campaign.id,
  recipients: Array.from({ length: 1000 }, (_, i) => ({
    handle: `person${i}`,
    name: `Person ${i}`,
    consent: "granted",
    evidence: "Test opt-in",
  })),
});
await assert.rejects(call(b, "assign_recipients", { campaign: campaign.id }));
assert.equal((await call(a, "assign_recipients", { campaign: campaign.id })).assigned, 999);
assert.equal((await call(a, "assign_recipients", { campaign: campaign.id })).assigned, 0);
assert.equal(
  (
    await db.query(
      "select count(distinct recipient_id)::int n from public.sl_links where campaign_id=$1",
      [campaign.id],
    )
  ).rows[0].n,
  1000,
);
await call(a, "drafts", { campaign: campaign.id });
assert.equal(
  (
    await db.query(
      "select count(*)::int n from public.sl_messages where campaign_id=$1 and status='draft'",
      [campaign.id],
    )
  ).rows[0].n,
  999,
);
for (const kind of ["human", "human", "preview", "bot", "unknown"])
  await db.query(
    "insert into public.sl_events(id,link_id,kind,device,country,referrer,visitor_hash) values($1,$2,$3,$4,$5,$6,$7)",
    [
      crypto.randomUUID(),
      link.id,
      kind,
      "mobile",
      "DE",
      "instagram.com",
      kind === "human" ? "a".repeat(64) : null,
    ],
  );
const stats = await analytics(a);
assert.equal(stats.total, 5);
assert.equal(stats.human, 2);
assert.equal(stats.unique, 1);
assert.equal(stats.bots, 2);
assert.equal(stats.unknown, 1);
assert.equal(stats.top[0].total, 5);
assert.equal((await analytics(b)).total, 0);
assert.equal((await analytics(a, { days: 7, country: "US" })).total, 0);
assert.equal((await analytics(a, { days: 7, account })).total, 5);
assert.equal((await analytics(a, { days: 7, campaign: other.id })).total, 0);
assert.equal((await db.query("select public.sl_rate('test',2,60) ok")).rows[0].ok, true);
assert.equal((await db.query("select public.sl_rate('test',2,60) ok")).rows[0].ok, true);
assert.equal((await db.query("select public.sl_rate('test',2,60) ok")).rows[0].ok, false);
await db.query("update public.sl_events set created_at=now()-interval '31 days' where kind='bot'");
await db.exec("select public.sl_purge()");
assert.equal((await analytics(a)).total, 4);
for (let i = 0; i < 4; i++)
  await call(a, "generate", { ...payload, request_id: crypto.randomUUID() });
await assert.rejects(
  call(a, "generate", { ...payload, request_id: crypto.randomUUID(), count: 1 }),
);
for (const role of ["anon", "authenticated"]) {
  await db.exec(`reset role;set role ${role}`);
  await assert.rejects(call(a, "overview"));
  await assert.rejects(analytics(a));
  await assert.rejects(db.query("select * from public.sl_links"));
  await assert.rejects(db.query("select * from public.sl_recipients"));
  await assert.rejects(db.query("select public.sl_rate('test',2,60)"));
}

await db.exec("reset role; set role service_role");
await db.query("update public.sl_batches set created_at=now()-interval '2 hours'");
const providerBatch = { ...payload, request_id: crypto.randomUUID(), count: 101, providers: ["bitly", "tinyurl"] };
await call(a, "generate", providerBatch);
const split = (await db.query("select provider,count(*)::int n from public.sl_links where batch_id=$1 group by provider order by provider", [providerBatch.request_id])).rows;
assert.deepEqual(split, [{provider:"bitly",n:51},{provider:"tinyurl",n:50}]);
await assert.rejects(call(a,"generate",{...providerBatch,providers:["tinyurl","bitly"]}));
const claim = async(user,provider)=>(await db.query("select public.sl_provider_claim($1,$2) result",[user,provider])).rows[0].result;
assert.equal(await claim(b,"bitly"),null);
const firstJob = await claim(a,"bitly");
assert.equal(firstJob.provider,"bitly");
assert.equal(await claim(a,"bitly"),null);
await db.query("update public.sl_links set provider_state='failed',provider_error='http_429' where id=$1",[firstJob.id]);
assert.equal(await claim(a,"bitly"),null);
assert.equal((await claim(a,"tinyurl")).provider,"tinyurl");
const providerStats = (await db.query("select public.sl_provider_stats($1,'{}') result",[a])).rows[0].result;
assert.equal(providerStats.providers.find(p=>p.provider==='bitly').failed,1);
assert.equal((await db.query("select public.sl_provider_stats($1,'{}') result",[b])).rows[0].result.providers.length,0);
console.log("Provider split, idempotency, isolation, concurrency and circuit-stop tests passed");
await db.close();
console.log(
  "PASS: 1,000-link batch, idempotency, pagination, ownership, permissions, limits, consent, suppression, drafts, analytics and retention.",
);
