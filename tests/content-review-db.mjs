import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.user_roles(user_id uuid,role text); grant select on public.user_roles to service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261011100940_content_review.sql", import.meta.url),
      "utf8",
    ),
  );
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID(),
    colleague = crypto.randomUUID();
  await db.query("insert into auth.users values($1),($2),($3)", [owner, other, colleague]);
  await db.query("insert into public.user_roles values($1,'owner'),($2,'owner'),($3,'cofounder')", [
    owner,
    other,
    colleague,
  ]);
  const call = async (user, action, payload = {}) =>
    (
      await db.query("select public.content_review_command($1,$2,$3) as value", [
        user,
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].value;
  await db.exec("set role service_role");
  await assert.rejects(call(colleague, "list"));
  await assert.rejects(call(owner, "create", { model: "someone", title: "Invalid" }));
  let item = await call(owner, "create", {
    model: "tuuva",
    title: "Tuuva first Reel",
    caption: "",
  });
  const ref = { id: item.id, revision: item.revision };
  assert.equal((await call(other, "list")).length, 0);
  await assert.rejects(call(other, "get", ref));
  await assert.rejects(call(owner, "decide", { ...ref, decision: "approved" }));
  item = await call(owner, "finalize", { ...ref, sha256: "a".repeat(64), bytes: 2048 });
  await assert.rejects(call(owner, "finalize", { ...ref, sha256: "b".repeat(64), bytes: 4096 }));
  await assert.rejects(call(owner, "decide", { ...ref, decision: "approved" })); // no caption
  item = await call(owner, "edit", { ...ref, caption: "A prepared caption" });
  ref.revision = item.revision;
  await assert.rejects(call(owner, "decide", { ...ref, revision: 1, decision: "approved" }));
  await assert.rejects(call(owner, "decide", { ...ref, decision: "changes", note: " " }));
  await call(owner, "reserve_notification", ref);
  await assert.rejects(call(owner, "reserve_notification", ref));
  await assert.rejects(call(owner, "edit", { ...ref, caption: "Changed during send" }));
  await call(owner, "finish_notification", ref);
  await assert.rejects(call(owner, "reserve_notification", ref)); // ambiguous delivery cannot duplicate
  item = await call(owner, "decide", { ...ref, decision: "approved" });
  assert.equal(item.status, "approved");
  await assert.rejects(call(owner, "decide", { ...ref, decision: "rejected" })); // first reviewer wins
  item = await call(owner, "edit", { ...ref, caption: "Changed after approval" });
  assert.equal(item.status, "pending");
  assert.equal(item.reviewed_at, null);
  assert.equal(item.sha256, "a".repeat(64)); // immutable media
  await assert.rejects(call(owner, "publish", { id: item.id, revision: item.revision }));
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select * from public.content_review_items")).rows.length, 0);
  await assert.rejects(call(owner, "list"));
  await assert.rejects(db.exec("update public.content_review_items set status='approved'"));
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select * from public.content_review_items")).rows.length, 1);
  await db.exec("reset role; set role anon");
  await assert.rejects(db.exec("select * from public.content_review_items"));
  await assert.rejects(call(owner, "list"));
  await db.exec("reset role");
  assert.equal(
    (await db.query("select public from storage.buckets where id='content-review'")).rows[0].public,
    false,
  );
  console.log(
    "Content Review DB: ownership, RLS, revision conflicts, approval invalidation, immutable media, no publish, duplicate notification guards passed.",
  );
} finally {
  await db.close();
}
