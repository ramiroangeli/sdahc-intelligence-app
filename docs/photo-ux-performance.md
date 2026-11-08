# Photo upload performance: what was measured and what changed (8 Nov 2026)

## Where the time went (before)
Real production request logs (Vercel, last 30 minutes of team testing, request start taken from the request id):

| Request | Observed server time |
|---|---|
| Photo upload (`POST draft-photos`), until the audit line | 7.3 s (of which 1.7 s was authorising while the body arrived) |
| Gallery save: cover, order, description (`PUT draft-photos`) | 2.25 to 2.34 s, six requests in a row |
| Authorising a request (Supabase session check) | 0.69 to 0.85 s, on every request |
| Thumbnail request until authorised | 0.7 to 1.6 s |

Production runs in **gru1 (Sao Paulo)**. The database is in Tokyo and the private Blob store in Seoul (icn1).

Stage constants measured from throwaway Vercel functions in each region (a temporary deployment per region, removed afterwards):

| | gru1 (production) | iad1 | syd1 | hnd1 (Tokyo) |
|---|---|---|---|---|
| Database round trip | 257 ms | 151 ms | 106 ms | **3 ms** |
| Database cold connect | 2.9 s | 1.4 s | 1.0 s | 0.1 s |
| Transaction of 4 queries (6 round trips) | 1.55 s | 0.91 s | 0.64 s | **0.02 s** |
| One private Blob write (150 kB) | 1.2 to 1.8 s | 1.3 to 1.6 s | n/m | 1.8 to 2.2 s |
| Three Blob writes in parallel | 1.4 to 1.9 s | 1.3 to 1.7 s | n/m | 2.2 s |
| Image pipeline, 2800 px photo, 2 vCPU: before then after | 1.57 s then 0.97 s | 1.26 s then 0.72 s | 1.29 s then 0.74 s | 1.28 s then 0.74 s |

Findings:
1. The old code wrote the three WebP variants **one after another** (3 x 1.5 s of Blob latency), made **about 12 database round trips** per upload (5 of them to save), and then rebuilt the **whole draft view** (Notion and GitHub calls) before answering. Uploads were also serialised by the draft version, so selecting several photos took the sum of all of them.
2. Resizing in the browser and the network transfer are small: the browser shrinks to under 4 MB in about 0.3 s and the upload itself is a second or less on a normal connection. The image work (sharp) was 1.6 s on the real runtime.
3. The Blob write is slow per call (about 1.5 s) from every region and does not depend on distance, so it is best hidden by running writes in parallel, not removed.

## What changed (this PR)
- Three variants are written **in parallel**; the image is decoded once per size straight from the upload with the three sizes made in parallel (1.6 s then 0.98 s on the real runtime).
- The content hash is taken from the uploaded bytes, so a **duplicate is rejected before any image work**.
- Photo changes answer with a **small response** (no Notion, GitHub or validation round trip); the editor refreshes validation in the background.
- A save is **one database statement** (update plus its history row, guarded by the version) instead of five round trips. It falls back to the transactional path to say exactly why it failed (404 or 409).
- Uploads no longer depend on one another: **up to three run at once**, each added with a compare-and-set that retries on a version change.
- The browser shows the **local thumbnail at once** and visible stages: Preparing, Uploading n%, Processing on the server.

## Measured result (real server code, real Postgres, latencies above injected)
`scripts/bench-upload-e2e.mjs` runs the actual `photos.js` and `drafts-repo.js` of a checkout against PGlite with the measured database and Blob latencies. The model was checked against production first: the old code under gru1 constants gives 6.4 s for an upload plus about 0.7 s authorisation (observed 7.3 s) and 1.56 s for a gallery save plus 0.75 s authorisation (observed 2.25 to 2.34 s).

| Operation (2800 px photo) | Before, gru1 | After, gru1 | Before, hnd1 | After, hnd1 |
|---|---|---|---|---|
| Add one photo (server time, local image work) | 6.4 s | **2.2 s** | 6.1 s | 2.1 s |
| Add three photos together | 12.8 s (one after another) | **3.6 s** (parallel) | 12.2 s | 2.2 s |
| Make a photo the cover / reorder / edit a description | 1.56 s | **0.52 s** | 0.03 s | 0.01 s |

Add about 0.8 s to both columns for the image work on the real runtime (1.6 s then 0.98 s against 0.19 s on a fast laptop), and 0.7 s authorisation per request. The "before" column also leaves out the full draft view the old route rebuilt after every change (Notion and GitHub calls), so it understates the old wait. After deployment the real numbers appear in two places: the browser console (`photo upload timings`, also `window.__lsPhotoTimings`) and the function log line `{"type":"timing",...}` with `inspect`, `process`, `store`, `persist` and `total`.

## Direct browser-to-Blob uploads: assessed, not adopted
- The body is not the bottleneck (the browser already shrinks to under 4 MB; transfer was about 0.1 s locally and about a second on a normal connection).
- The files we store are the **processed WebP variants**, produced on the server after EXIF removal. A browser upload could only carry the original, which would then have to be read back (another ~1.5 s Blob call) and processed, and the original (with its metadata) would sit in the store. It would also bypass the server-side validation unless repeated after the upload.
- Blob writes cost about 1.5 s per call from every region, so a direct upload would not avoid that cost.
Revisit only if originals larger than 4 MB must be kept.

## Recommended, not applied: run the functions in Tokyo
Moving the function region to `hnd1` cuts every database round trip from 257 ms to 3 ms, the cold connect from 2.9 s to 0.1 s, and every request's session check. It is a project setting (Settings, Functions, region) or a one-line `vercel.json`: `{"regions":["hnd1"]}`. It is infrastructure, so it is in a separate pull request for you to decide. Blob writes stay about 1.5 to 2 s either way.
