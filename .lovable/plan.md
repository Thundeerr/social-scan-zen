## Problem

All 27 tracked locations scan cleanly (no error) but every run returns 0 posts, so no assets ever land in the inbox. There are no tracked accounts, so 100% of scanning depends on the location endpoint working.

Root cause hypothesis: the location endpoint of your RapidAPI Instagram host isn't actually being hit correctly. The code falls back to `/location-feeds?id=<numeric_id>` when `RAPIDAPI_LOCATION_PATH` / `RAPIDAPI_LOCATION_ID_PARAM` secrets are not set — and they aren't. Either the endpoint doesn't exist on your host, or it responds with a payload shape our normaliser doesn't recognise (so `posts = []`).

## Plan

1. **Add a raw provider probe** — a small operator-only server function `probeLocationFetchFn` that:
   - Calls `provider.fetchLocation(locationId)` for one tracked location.
   - Also runs the raw HTTP request and returns `{ url, status, bodyPreview (first 2 KB), parsedPostCount, sampleKeys }`.
   - Requires operator role.
   Wire a tiny "Probe provider" button on the Scanner page (operator-only) that runs it against the first active location and dumps the JSON into a `<pre>` block so we can see exactly what RapidAPI returns.

2. **Log outcome on the run itself** — in `executeLocationScan`, when `result.posts.length === 0`, set `phase_detail` to include the raw payload shape summary (top-level keys + array length) instead of just "Normalising 0 items". That way future zero-post runs are self-diagnosing without a rebuild.

3. **Fix the integration based on the probe result** — one of:
   - Set `RAPIDAPI_LOCATION_PATH` / `RAPIDAPI_LOCATION_ID_PARAM` / `RAPIDAPI_LOCATION_EXTRA_PARAMS` secrets to match your host's real endpoint (e.g. `/v1/location_media`, `location_id`, `count=30`).
   - Or extend `normaliseResponse` / `collectPostLike` to unwrap whatever nesting the host uses (some hosts return `{ data: { recent: { sections: [...] } } }`, others `{ graphql: { location: { edge_location_to_media: { edges } } } }`).

4. **Verify** by triggering "Scan now" from the dashboard and confirming at least one location returns >0 assets, then checking the Asset Inbox.

## Technical notes

- Scanner service: `src/lib/scanner-service.server.ts` (executeLocationScan around line 590).
- Provider: `src/lib/instagram-provider.server.ts` — `fetchLocation` at 328, `normaliseResponse` at 167, `collectPostLike` at 130.
- Existing secrets present: `RAPIDAPI_KEY`, `RAPIDAPI_HOST`, `RAPIDAPI_PATH`, `RAPIDAPI_PROFILE_PATH`, `RAPIDAPI_USERNAME_PARAM`, `RAPIDAPI_EXTRA_PARAMS`, `RAPIDAPI_LOCATION_SEARCH_PATH`, `RAPIDAPI_LOCATION_SEARCH_QUERY_PARAM`, `RAPIDAPI_LOCATION_SEARCH_EXTRA_PARAMS`, `RAPIDAPI_LOCATION_EXTRA_PARAMS`.
- Not set: `RAPIDAPI_LOCATION_PATH`, `RAPIDAPI_LOCATION_ID_PARAM` — so the code silently uses `/location-feeds?id=`. This is almost certainly the miss.
- The probe function must never return raw API keys and must be operator-gated via `requireSupabaseAuth` + `is_operator` check.

## What you'll see when this is done

Scanner page gets a small "Probe provider" diagnostic panel showing the exact URL, HTTP status, and first 2 KB of the RapidAPI response for one location. Once we can see the shape, we either flip the two missing secrets or teach the parser about the shape — and the next "Scan now" starts filling the Asset Inbox.
