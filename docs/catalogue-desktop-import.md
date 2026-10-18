# Desktop catalogue import

Implementation only: this migration and UI have not been deployed or applied to production.

## Input and flow

On /catalogue, expand “Alte Desktop-Dateien importieren”. Select VIDEO REGISTER.json
and OFFER REGISTER.json, run the preview, review/download its report, then explicitly
choose “Jetzt übernehmen”. Changing either file invalidates the previous preview.
The authenticated endpoint derives the owner from the session, never from JSON.
The database RPC permits only service_role/postgres and requires the owner role.
Files are limited to 1 MB each in the UI and server; each register allows 1,000 rows.

Accepted format is the inspected desktop format, not an invented generic import:

    {"clips":[{"clipId":"KII-V020","channel":"PPV","currentTemplates":["KII-008"],
      "paidOwners":["@sample"],"freeRecipients":[],"mediaId":"historical-id","filename":"sample.mp4"}]}
    {"offers":[{"template":"KII-008 | Sample","status":"active","clipIds":["KII-V020"]}],"deleted":[]}

Channels: PPV → ppv, WALL ONLY → wall, UNASSIGNED / REVIEW → unassigned.
Clip prefixes determine the character. Unknown channels/codes are reported, not guessed.
Source rows are retained in desktop_source, including media IDs, filenames and
coverage caveats. No media URLs are fetched and no review/job links are invented.

Ownership is observed evidence, not a complete buyer history. Handles are stored
under historical-fanvue-handle:@handle (lowercase), NOT fanvue:<verified-id>.
Paid and free entries coexist. Unknown delivery dates remain null. panelFans and
aggregate counts do not establish purchases. confirmedWallBuyers display names
are retained only in source and flagged for manual identity reconciliation.
No automatic fan exclusions are implemented.

## Replay and conflicts

Clips match by owner + exact clip code; offers by owner + imported template code.
Existing unmatched or changed clips are not overwritten. Changed bundle titles,
source rows or current memberships are conflicts, not reset to old state.
Recipients and membership use their existing unique keys.
An owner-scoped transaction lock serializes concurrent imports.
Invalid items are isolated in savepoints. One invalid bundle member skips its
entire bundle, preventing a misleading partial bundle. Wall/mixed-model clips
cannot enter bundles; both registers must agree about membership.
Inactive/deleted offers are skipped. The source bundle is included in its error report.
Reports count database records (clips + offers + memberships + receipts), not videos.
Download the report to retain skipped-item diagnostics; there is no persistent import-job table.
Preview runs the same constraints inside a subtransaction and rolls back all writes.
Apply rechecks current state; a preview is not a reservation.

## Local testing, no production access

    node tests/catalogue-import-db.mjs

Optional real-file preview, also entirely in disposable in-memory PGlite:

    node tests/catalogue-import-db.mjs "PATH/VIDEO REGISTER.json" "PATH/OFFER REGISTER.json"

The test does not load .env, call Supabase remotely or alter either source file.
It covers rollback, IDs, paid/free receipts, repeat imports, conflicts, bundle edits,
owner isolation and execution grants. Real files are previewed before synthetic tests.

For UI testing, use a local/test Supabase environment with the existing migrations
and 20261018161059_catalogue_desktop_import.sql applied, then npm run dev.
Use the small fictional sample above. Preview must leave all tables unchanged.
Apply once, then repeat: the second run must add zero records.

Actual Kiikii registers tested locally: 124 new records would be added; KII-002
is skipped due to UNRESOLVED. Three wall-buyer display-name warnings are retained.
No production import has been performed.
