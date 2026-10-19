# Simple generation submission

Local implementation; no production migration, deployment or provider request was made.

Route: /generate (“Video erstellen” in desktop and mobile navigation).
Choose an Instagram Reel/post link or upload an MP4 (40 MB maximum), choose Kiikii
or Tuuva, choose Prompt 1 or Prompt 2, and submit.
Only Instagram URLs are supported, using the existing canonicalReel allowlist.

## Pipeline

- Authenticated generationSubmitFn validates input and rechecks the current user.
- generation_submit RPC requires the owner role and an existing model profile.
- Link submission calls reel_inbox_command and inserts a model_pipeline_jobs row
  in one transaction. The existing unique key deduplicates model + inbox source.
- Upload preparation creates a private generation_uploads record and an expiring
  signed upload token. It does not queue work yet.
- Finalization verifies stored size/MP4 signature, hashes the bytes and creates
  the job with source_upload_id. Repeated finalization reuses the same job.
- The worker downloads private sources through /api/model-pipeline/source.
  The route verifies its existing worker token, job lease, owner, model and active
  working state. The downloader rejects redirects and verifies the SHA-256.
- Existing ffprobe/ffmpeg validation runs before generation. The MP4 signature
  alone is not treated as proof of a decodable video.
- Existing claims, budget reservations, provider submission and Telegram review
  remain in place. The only worker command change is a fallback review title for
  an upload without a Reel shortcode.
- No automatic worker activation. Paused jobs stay queued.
- Retries in the open form reuse the upload ID. Reselecting a file or changing
  character starts a separate upload. There is no cross-session file deduplication.
- Abandoned uploads remain private; retention/cleanup is not implemented here.

## Local checks (no remote calls)

    node tests/generation-submission-db.mjs
    node tests/generation-submission-db.mjs --production-revisions
    python tests/test_generation_upload.py
    node node_modules/typescript/bin/tsc --noEmit
    npm run build

The database test uses disposable PGlite and verifies exact job creation,
character selection, deduplication, authorization, pause behavior and the existing
worker claim → reserve → submitted → review transitions. These are simulated DB
transitions, not provider calls. Python tests mock the download transport.

## Local UI smoke test

Use a local/test Supabase project with the previous pipeline migrations and
20261018163645_generation_submission.sql and
20261018173534_generation_source_revisions.sql applied. Use a test owner account with
model_pipeline_settings and both model_pipeline_profiles configured.
Keep settings.enabled=false and do not run the paid worker.
Start npm run dev and visit /generate.

1. Submit a valid-format Reel URL for Kiikii. Verify a queued job with that model
   and inbox_id. Repeating it must return the same job ID.
2. Upload a small real MP4 for Tuuva. Verify source_upload_id, source_sha256,
   null inbox_id and state queued. Finalizing again must return the same job.
3. Confirm unsupported URLs and invalid files do not create jobs.
4. Confirm the UI says the pipeline is paused.

For an eventual deployment, apply the migration and deploy both the web app and
the worker image (Dockerfile now includes source_upload.py). An old worker cannot
process upload-backed jobs. Deploy with the worker paused until both versions
are ready. Do not deploy unrelated local worker edits without reviewing them.
Full live generation and Telegram delivery have not been tested by this change.

## Revision compatibility

Deploy the source-revisions migration after the generation-submission migration,
with the worker stopped. It incorporates the previously manual production
revision schema without replaying the historical job insert.

Both source types keep their source identity across attempts. Upload revisions
retain source_upload_id and source_sha256; link revisions retain inbox_id.
Uniqueness is per owner, model, source and attempt. The unique review ID prevents
repeated review callbacks from creating another job. Initial submission always
returns attempt 0, even when revisions exist. Source XOR, upload-owner binding,
RLS and service-only writes remain unchanged.

No additional worker changes are required: it already reuses a parent's local
source when present, otherwise downloads using the revision's source fields.
Tests cover two revisions for each source, repeated review transitions, duplicate
attempt rejection, initial re-submission and paused claims, on fresh and
production-revision schemas. These are local database tests, not paid generation
or live Telegram tests.

## Submission safeguards (local, not yet deployed)

Apply 20261019142046_generation_submission_safeguards.sql after the revision
migration before deploying the updated app. No worker changes are needed.
Keep the existing worker stopped and pipeline enabled=false throughout.

The read-only preflight checks this owner's jobs across both characters in the
last 30 days, matching a canonical Instagram shortcode or SHA-256 file hash.
It returns at most ten recent matches. Final submission repeats the check under
the owner's settings-row lock, using the stored upload bytes' hash. A duplicate
returns a warning without inserting a job until the user explicitly confirms.
The underlying intake RPC is no longer directly executable by service_role;
only the guarded server RPC may call it. RLS and source/revision constraints stay.

Confirmed repeat links for the same character reopen the existing initial job;
they do not force a new paid attempt. A separately uploaded duplicate file may
create another job after confirmation. The same upload request ID remains
idempotent. Source/model changes clear confirmation; failed checks block submit.

Uploads preview locally using a revocable object URL; selecting a file does not
upload it. Link previews use the canonical Instagram embed. Private posts,
tracking protection or unavailable embeds may prevent playback; the UI provides
an original-link fallback and suggests uploading the file instead. There is no
server-side scraping or paid preview request. The optional short description is
for the submission preview only; it is not a persistent catalogue title.

Testing:

- node tests/generation-submission-db.mjs
- node tests/generation-submission-db.mjs --production-revisions
- node node_modules/vitest/vitest.mjs run src/lib/generation.server.test.ts
- node node_modules/typescript/bin/tsc --noEmit
- npm run build

Use a disposable database/storage project for write tests. With its worker
stopped and pipeline paused, queue a small MP4 once. Reload, select the same file
(also try another filename and another character): a warning appears, and the
submit button requires the confirmation checkbox. Changing source or character
clears that checkbox. Submit after confirming and verify a queued job only.
Repeat using an Instagram link with and without query parameters. Confirming a
same-character link returns the original job ID. Verify preview, title and model
selection before submission. Verify failed preflight cannot be submitted.

On paused production after an approved deployment, previewing/selecting an
existing source performs only a read-only check. Do not click Video erstellen
for a verification that must create no jobs. Do not enable generation, start
the worker or use production fixtures to test confirmed duplicate creation.

## Minimal prompt selection (local, not deployed)

The unapplied migration `20261019144846_generation_reference_prompt.sql` now stores
`prompt_id` (`prompt_1` or `prompt_2`) rather than free text. No prompt texts are
supplied by this change. UI: file drop zone or Instagram link, compact model choice,
two prompt buttons, one submit button. Preview and duplicate confirmation remain.

`reference_profile` references the model entry in the existing worker-owned
`/references/models.json`. Existing image hashes are checked. The worker resolves
`models[model].prompts[prompt_id]`; the operator must configure these entries before
processing new jobs. Missing/blank entries or invalid identifiers stop with `setup`
before media upload or paid provider submission. The identifier is NOT sent as
literal prompt text or as an unsupported WaveSpeed field. The configured text goes
in the existing `prompt` field. Legacy jobs with NULL prompt_id use the old default.
Duplicate submissions preserve the existing job and prompt identifier; revisions
inherit it and the reference profile. Owner isolation and RLS are unchanged.

The reference pointer is not a frozen snapshot: changing models.json changes what
later executions resolve. No reference files or mappings were changed.

### Offline verification

```sh
node tests/generation-submission-db.mjs
node tests/generation-submission-db.mjs --production-revisions
node node_modules/vitest/vitest.mjs run src/lib/generation.server.test.ts
python -m unittest discover -s cloud/model-worker -p test_worker.py
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

DB tests use disposable PGlite databases. Worker media uploads are mocked; there
are no provider calls. For a manual local-only check, keep the pipeline paused and
worker stopped, submit one source, then inspect:

```sql
select id, model, inbox_id, source_upload_id, reference_profile, prompt_id
from public.model_pipeline_jobs order by created_at desc limit 5;
```

Exactly one source column must be populated. reference_profile must equal model,
and prompt_id must match the chosen button. Verify both source types, both models,
both identifiers, retries and revisions. Do not create production test jobs.
Deploy migration, app and worker together only after a separate deployment decision.
