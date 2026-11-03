import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
let assertions = 0;
const check = (name, run) =>
  Promise.resolve()
    .then(run)
    .then(() => {
      assertions++;
      console.log(`PASS: ${name}`);
    });
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    grant usage on schema auth to authenticated;
    create table user_roles(user_id uuid,role text); grant select on user_roles to service_role;
    create schema storage; create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const name of [
    "20261006020101_reel_inbox.sql",
    "20261006025347_reel_inbox_dm.sql",
    "20261011100940_content_review.sql",
    "20261011114403_model_pipeline_queue.sql",
    "20261010122517_reel_card_diagnostics.sql",
    "20261027180000_dm_model_collection.sql",
  ])
    await db.exec(
      await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"),
    );
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID();
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("insert into user_roles values($1,'owner'),($2,'owner')", [owner, other]);
  await db.query("insert into model_pipeline_settings(user_id,enabled) values($1,true)", [owner]);
  await db.query(
    "insert into model_pipeline_profiles(user_id,model,sender_username) values($1,'kiikii','kiikii.bat'),($1,'tuuva','tuuva.test')",
    [owner],
  );
  await db.query(
    "insert into reel_inbox_dm_sources(user_id,receiver_id,enabled) values($1,'10',true),($2,'11',true)",
    [owner, other],
  );
  const link = (code) => ({ shortcode: code, url: `https://www.instagram.com/reel/${code}/` });
  const diag = (count) => ({
    outcome: count ? "link_found" : "no_attachment",
    attachment_count: count ? 1 : 0,
    share_count: count ? 1 : 0,
    url_count: count ? 1 : 0,
    unsupported: false,
    text: "DO NOT STORE",
  });
  let n = 0;
  const nextHash = () => (++n).toString(16).padStart(64, "0");
  const base = Date.now() - 3600000;
  const at = (seconds) => new Date(base + seconds * 1000).toISOString();
  const v3 = async (code, model = "kiikii") =>
    db.query("select reel_inbox_dm_ingest_v3($1,$2,$3,$4,$5,$6,$7)", [
      "10",
      "20",
      "thundeerr999",
      nextHash(),
      JSON.stringify([link(code)]),
      JSON.stringify(diag(1)),
      model,
    ]);
  await db.exec("set role service_role");
  await v3("Legacy01");
  await db.exec("reset role");
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261103172132_reel_dm_split_model_notes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec("set role service_role");
  const send = async ({
    code,
    links = code ? [link(code)] : [],
    model = null,
    time = null,
    sender = "20",
    username = "thundeerr999",
    receiver = "10",
    hash = nextHash(),
    diagnostics = diag(links.length),
  } = {}) => {
    const { rows } = await db.query(
      "select reel_inbox_dm_ingest_v4($1,$2,$3,$4,$5,$6,$7,$8) as value",
      [
        receiver,
        sender,
        username,
        hash,
        JSON.stringify(links),
        JSON.stringify(diagnostics),
        model,
        time,
      ],
    );
    return { hash, ...rows[0].value };
  };
  const models = async (code, user = owner) =>
    (
      await db.query(
        "select c.model from reel_inbox_dm_candidates c join reel_inbox_items i on i.id=c.inbox_id where c.user_id=$1 and i.shortcode=$2 order by c.model",
        [user, code],
      )
    ).rows.map((x) => x.model);
  const receipt = async (hash) =>
    (
      await db.query("select * from reel_inbox_dm_receipts where user_id=$1 and message_hash=$2", [
        owner,
        hash,
      ])
    ).rows[0];
  const id = async (code) =>
    (
      await db.query("select id from reel_inbox_items where user_id=$1 and shortcode=$2", [
        owner,
        code,
      ])
    ).rows[0].id;
  const move = async (code, from, to, user = owner) =>
    db.query("select reel_inbox_dm_reassign($1,$2,$3,$4) as value", [
      user,
      await id(code),
      from,
      to,
    ]);

  await check("default and inline explicit routing", async () => {
    await send({ code: "Plain01", time: at(0) });
    await send({ code: "Inline01", time: at(60), model: "tuuva" });
    assert.deepEqual(await models("Plain01"), ["kiikii"]);
    assert.deepEqual(await models("Inline01"), ["tuuva"]);
  });
  await check("split note arriving after the share moves only that collection", async () => {
    const share = await send({ code: "Split01", time: at(120) });
    const note = await send({ model: "tuuva", time: at(123) });
    assert.equal(note.routing_status, "note_applied");
    assert.deepEqual(await models("Split01"), ["tuuva"]);
    assert.equal((await receipt(share.hash)).routing_status, "paired");
    assert.equal((await receipt(share.hash)).paired_message_hash, note.hash);
  });
  await check("note-first webhook delivery is reconciled using event time", async () => {
    const note = await send({ model: "tuuva", time: at(183) });
    await send({ code: "Reverse01", time: at(180) });
    assert.deepEqual(await models("Reverse01"), ["tuuva"]);
    assert.equal((await receipt(note.hash)).routing_status, "note_applied");
  });
  await check("duplicate deliveries cannot consume a note or reapply a manual change", async () => {
    const share = await send({ code: "Replay01", time: at(240) });
    const note = await send({ model: "tuuva", time: at(243) });
    assert.equal((await send({ model: "tuuva", time: at(243), hash: note.hash })).duplicate, true);
    assert.deepEqual(await models("Replay01"), ["tuuva"]);
    await move("Replay01", "tuuva", "kiikii");
    assert.equal(
      (await send({ code: "Replay01", time: at(240), hash: share.hash })).duplicate,
      true,
    );
    await send({ model: "tuuva", time: at(244) });
    assert.deepEqual(await models("Replay01"), ["kiikii"]);
    assert.equal((await receipt(share.hash)).routing_locked, true);
    assert.equal((await receipt(note.hash)).routing_locked, true);
  });
  await check("two eligible shares are ambiguous, including a late competing share", async () => {
    const first = await send({ code: "Ambig01", time: at(300) });
    const note = await send({ model: "tuuva", time: at(303) });
    assert.deepEqual(await models("Ambig01"), ["tuuva"]);
    await send({ code: "Ambig02", time: at(301) });
    assert.deepEqual(await models("Ambig01"), ["kiikii"]);
    assert.deepEqual(await models("Ambig02"), ["kiikii"]);
    assert.equal((await receipt(note.hash)).routing_status, "note_ambiguous");
    assert.equal((await receipt(first.hash)).paired_message_hash, null);
  });
  await check("two notes cannot steal the same share", async () => {
    await send({ code: "Double01", time: at(360) });
    const first = await send({ model: "tuuva", time: at(362) });
    const second = await send({ model: "kiikii", time: at(363) });
    assert.deepEqual(await models("Double01"), ["kiikii"]);
    assert.equal((await receipt(first.hash)).routing_status, "note_ambiguous");
    assert.equal((await receipt(second.hash)).routing_status, "note_ambiguous");
  });
  await check("notes never cross sender or owner boundaries", async () => {
    await send({ code: "Scope01", time: at(420) });
    await send({ model: "tuuva", time: at(422), sender: "30", username: "kiikii.bat" });
    await send({ model: "tuuva", time: at(422), receiver: "11" });
    assert.deepEqual(await models("Scope01"), ["kiikii"]);
    assert.deepEqual(await models("Scope01", other), []);
    assert.equal((await send({ model: "tuuva", time: at(422), sender: "99" })).ignored, true);
    assert.equal(
      (await send({ model: "tuuva", time: at(422), sender: "99", username: "stranger" })).ignored,
      true,
    );
  });
  await check(
    "missing timestamps, notes before a share, expiry and unsupported cards do not relabel",
    async () => {
      await send({ code: "Missing01", time: at(480) });
      const noTime = await send({ model: "tuuva" });
      assert.equal(noTime.routing_status, "note_expired");
      await send({ code: "NoShareTime01" });
      const late = await send({ model: "tuuva", time: at(511) });
      assert.equal(late.routing_status, "note_expired");
      await send({ model: "tuuva", time: at(540) });
      await send({ code: "Future01", time: at(541) });
      await send({
        model: "tuuva",
        time: at(542),
        diagnostics: { ...diag(0), unsupported: true, outcome: "unsupported" },
      });
      await send({
        model: "tuuva",
        time: at(543),
        diagnostics: { ...diag(0), attachment_count: 1, outcome: "attachment_without_link" },
      });
      for (const code of ["Missing01", "NoShareTime01", "Future01"])
        assert.deepEqual(await models(code), ["kiikii"]);
    },
  );
  await check("an inline explicit assignment is not overridden by a later loose note", async () => {
    await send({ code: "Explicit01", time: at(600), model: "kiikii" });
    await send({ model: "tuuva", time: at(602) });
    assert.deepEqual(await models("Explicit01"), ["kiikii"]);
  });
  await check(
    "independent claims preserve intentionally collecting the same reel for both models",
    async () => {
      await send({ code: "Both01", time: at(660), model: "kiikii" });
      await send({ code: "Both01", time: at(720) });
      await send({ model: "tuuva", time: at(722) });
      assert.deepEqual(await models("Both01"), ["kiikii", "tuuva"]);
    },
  );
  await check(
    "baseline and rollout-window legacy candidates survive new paired collections",
    async () => {
      await send({ code: "Legacy01", time: at(780) });
      await send({ model: "tuuva", time: at(782) });
      assert.deepEqual(await models("Legacy01"), ["kiikii", "tuuva"]);
      await v3("Rollout01");
      await send({ code: "Rollout01", time: at(840) });
      await send({ model: "tuuva", time: at(842) });
      assert.deepEqual(await models("Rollout01"), ["kiikii", "tuuva"]);
    },
  );
  await check(
    "manual moves merge target rows and keep unrelated assets and receipts intact",
    async () => {
      const prior = await db.query("select * from reel_inbox_items order by id");
      await move("Both01", "kiikii", "tuuva");
      assert.deepEqual(await models("Both01"), ["tuuva"]);
      await move("Both01", "kiikii", "tuuva"); // idempotent retry
      assert.deepEqual(
        (await db.query("select * from reel_inbox_items order by id")).rows,
        prior.rows,
      );
      await assert.rejects(move("Both01", "tuuva", "kiikii", other));
      await assert.rejects(move("Both01", "tuuva", "other"));
    },
  );
  await check(
    "multi-link manual correction changes the selected row and freezes the event",
    async () => {
      const share = await send({ links: [link("Multi01"), link("Multi02")], time: at(900) });
      await move("Multi01", "kiikii", "tuuva");
      await send({ model: "tuuva", time: at(902) });
      assert.deepEqual(await models("Multi01"), ["tuuva"]);
      assert.deepEqual(await models("Multi02"), ["kiikii"]);
      assert.equal((await receipt(share.hash)).routing_locked, true);
      assert.equal((await receipt(share.hash)).model, null);
    },
  );
  await check("simultaneous requests converge on one pair and one model row", async () => {
    await Promise.all([
      send({ code: "Parallel01", time: at(960) }),
      send({ model: "tuuva", time: at(962) }),
    ]);
    assert.deepEqual(await models("Parallel01"), ["tuuva"]);
    // PGlite serializes its single connection; production uses the source-row FOR UPDATE lock.
  });
  await check("a fresh old-v3 claim survives after a legacy claim was manually moved", async () => {
    await move("Rollout01", "kiikii", "tuuva");
    await v3("Rollout01");
    await send({ code: "Rollout01", model: "tuuva", time: at(1020) });
    assert.deepEqual(await models("Rollout01"), ["kiikii", "tuuva"]);
  });
  await check(
    "manual ambiguity resolution freezes old notes and blocks late notes from jumping to another reel",
    async () => {
      await send({ code: "ManualAmbig01", time: at(1080) });
      await send({ code: "ManualAmbig02", time: at(1081) });
      const oldNote = await send({ model: "tuuva", time: at(1083) });
      assert.equal(oldNote.routing_status, "note_ambiguous");
      await move("ManualAmbig02", "kiikii", "tuuva");
      const lateNote = await send({ model: "tuuva", time: at(1084) });
      assert.equal(lateNote.routing_status, "note_ambiguous");
      assert.equal((await receipt(oldNote.hash)).routing_locked, true);
      assert.deepEqual(await models("ManualAmbig01"), ["kiikii"]);
      assert.deepEqual(await models("ManualAmbig02"), ["tuuva"]);
    },
  );
  await check(
    "an explicitly labelled nearby share also blocks a loose note from jumping to an unrelated reel",
    async () => {
      await send({ code: "Barrier01", time: at(1140) });
      await send({ code: "Barrier02", model: "kiikii", time: at(1141) });
      const note = await send({ model: "tuuva", time: at(1143) });
      assert.equal(note.routing_status, "note_ambiguous");
      assert.deepEqual(await models("Barrier01"), ["kiikii"]);
      assert.deepEqual(await models("Barrier02"), ["kiikii"]);
    },
  );
  await check("access controls, no text storage and no paid jobs remain intact", async () => {
    assert.equal((await db.query("select * from model_pipeline_jobs")).rows.length, 0);
    assert.ok(
      (await db.query("select diagnostics from reel_inbox_dm_receipts")).rows.every(
        (x) => !JSON.stringify(x).includes("DO NOT STORE"),
      ),
    );
    await db.exec("reset role; set role authenticated");
    await assert.rejects(send({ code: "Denied01", time: at(1020) }));
    await assert.rejects(db.query("select * from reel_inbox_dm_claims"));
    await assert.rejects(
      db.query("select reel_inbox_dm_reassign($1,$2,'kiikii','tuuva')", [
        owner,
        crypto.randomUUID(),
      ]),
    );
    await db.exec("reset role; set role service_role");
    await db.query("update reel_inbox_dm_sources set enabled=false where user_id=$1", [owner]);
    assert.equal((await send({ code: "Paused01", time: at(1080) })).ignored, true);
  });
  console.log(`${assertions} routing/database checks passed; local PGlite only.`);
} finally {
  await db.close();
}
