# Simple generation submission

Local implementation; no production migration, deployment or provider request was made.

Route: /generate (“Video erstellen” in desktop and mobile navigation).
Choose an Instagram Reel/post link or upload an MP4 (40 MB maximum), choose Kiikii
or Tuuva, and submit. There are no additional modes or flags.
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
