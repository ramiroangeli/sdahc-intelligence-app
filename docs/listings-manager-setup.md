# Listings Manager: setup and security notes (first slice, read only)

This slice adds `Website > Listings` to the app: a read-only list of website-managed properties with Notion status shown
separately from the confirmed live status of the website. It cannot write to Notion, GitHub or Blob, and has no database.

## What it reads
| Source | What | Credential |
|---|---|---|
| Notion Properties (read only) | Name (house number removed), State, Design Category, Build Type, Web Listing Status, Web Title, Web Pricing Mode, Web Featured | `NOTION_LISTINGS_TOKEN` |
| Website repo (public) | `approved/*.json` and `withdrawn/*.json` on `main` | none (optional read-only `LISTINGS_GITHUB_READ_TOKEN`) |
| Public website | one GET per listing page | none |

Address, Price, Yield, Description, Features, Listing Agent, Sharepoint Link and Deals are never requested.

## Vercel environment variables (project `sdahc-intelligence-app`, Production and Preview, mark secrets Sensitive)
| Variable | Value |
|---|---|
| `LISTINGS_SUPABASE_URL` | `https://yngfaykhvegavzueukmc.supabase.co` |
| `LISTINGS_SUPABASE_ANON_KEY` | the public anon key (already in `supabase-data.js`) |
| `AZURE_TENANT_ID` | `207ef305-ee7d-4c16-a5b3-c3bdf7b1b29b` |
| `LISTINGS_STAFF_JSON` | allowlist, see below. **Sensitive.** Emails stay out of this public repo |
| `NOTION_LISTINGS_TOKEN` | Notion integration with Read content only, shared with the Properties database only. Do not reuse the Deals integration |
| `NOTION_PROPERTIES_DATA_SOURCE_ID` | the Properties data source id (as in the website `.env.listings`) |
| `LISTINGS_DATABASE_URL` | the `listings_app` database role (see "Database" below). **Sensitive** |
| `LISTINGS_CALLBACK_SECRET` | at least 32 characters; signs the publication job's reports. The same value is the website repository's Actions secret of the same name. **Sensitive** |
| `LISTINGS_GITHUB_APP_ID`, `LISTINGS_GITHUB_APP_INSTALLATION_ID`, `LISTINGS_GITHUB_APP_PRIVATE_KEY` | the GitHub App "SDAHC Listings Publisher" (starts the publication workflow). The private key is a full PEM. **Sensitive.** See `docs/real-publication-setup.md` |
| `PUBLIC_BLOB_STORE_ID` | the public image store (Production only), added by connecting the store with the prefix `PUBLIC_BLOB` |

There is no personal GitHub token: `LISTINGS_GITHUB_DISPATCH_TOKEN` is not read by the code and can be deleted from Vercel.

Optional: `LISTINGS_SITE_BASE_URL`, `LISTINGS_GITHUB_REPO`, `LISTINGS_GITHUB_REF`, `LISTINGS_GITHUB_READ_TOKEN`, `NOTION_API_VERSION`.

If any of the first four is missing or invalid, every endpoint answers 503 and does nothing. Fail closed. If a publication variable is missing, publishing answers 503 and nothing is recorded.

```json
[
  {"email": "ramiro@...", "capabilities": ["listings.view","listings.edit","listings.publish","listings.admin"]},
  {"email": "ali@...",    "capabilities": ["listings.view","listings.edit","listings.publish"]},
  {"email": "steve@...",  "capabilities": ["listings.view","listings.publish"]}
]
```
Optional `"authUserId": "<Supabase user id>"` binds an entry to one account (the id appears in the audit log line after the
first sign-in). `"active": false` disables a person. Confirm each person's real Microsoft sign-in address first.

## Authorisation (adapted from the RFI system)
Server validates the Supabase session, requires the Microsoft provider, requires the SDAHC tenant, requires the email on the
allowlist (and the bound user id if set), then the capability. Client errors are generic; reasons go to the audit log.
Audit events are JSON lines in the Vercel function log for now. A reviewed migration adds the database table and the
`listings.users` allowlist with the first write action.

## Local preview
`npm run dev:local` (see `scripts/dev-server.mjs`) serves the app with a fake session and a fake `authorise`. Local only.
Put Notion variables in your shell first to see real data. It refuses to run on Vercel.

## Security finding
See the separate security pull request (analytics.deals access for non-Microsoft accounts). It is not part of this change.

---

# Phase 2: draft editor (drafts are private, nothing is published)

## What was added
Add listing (property picker from the CRM), a draft editor (Title, Description, Address shown on the website, Price shown,
display price, featured), live validation, private preview of the card and detail page, saved drafts with history and the
saving person's identity, Notion-change detection, and commercial verification items. No Notion writes. No photos. No publishing.

- Drafts live in a NEW database schema `listings` (migration `supabase/migrations/listings_0001_drafts.sql`, **not applied yet**).
- Validation uses the website's own rules, vendored from the website repo: `api/_lib/vendor/listings-core.mjs`
  (rebuild with `node scripts/vendor-listings-core.mjs --from <clean website checkout>` when the website rules change).
- Capabilities: Viewer reads. Editor (`listings.edit`) creates and saves drafts, adds verification notes.
  Publisher (`listings.publish`) acknowledges commercial verification items. Editor and Publisher are independent.

## One-time setup to enable drafts
1. **Run the migration** in the Supabase SQL editor (`listings_0001_drafts.sql`). Reversible; see the file.
2. **Set the role password** (a separate statement; never put it in a file): `alter role listings_app with password '<long random>';`
3. **Check the schema is not exposed** (verification queries are at the bottom of the migration file).
4. **Add to Vercel** (project `sdahc-intelligence-app`, Production and Preview, Sensitive):
   `LISTINGS_DATABASE_URL` = `postgres://listings_app.<project-ref>:<password>@<pooler-host>:6543/postgres`
   (same pooler host as the RFI system's `RFI_DATABASE_URL`).
5. Redeploy.

Until step 4, the dashboard works and shows "Drafts are not enabled yet"; the draft endpoints answer 503.

## Notion change detection
Each draft stores hashes of four groups of Notion facts (identity, classification, web fields, commercial fields). If a group
changes, the editor says which group changed (never the values) and asks for confirmation on save. A refresh is recorded in the history.

## Commercial verification
System items come from the CRM (for example "CRM records 2 of 3 places occupied"). A Publisher can acknowledge one with a note;
the acknowledgement stops counting if the CRM fact changes. Editors can add free-text notes (for example an advertised figure that
differs from the CRM), and a Publisher resolves them. Open items block publication, never saving. Public wording that claims
"fully leased" while the CRM says otherwise is an error.

---

# Phase 3: photographs (private staging; nothing is published)

## What was added
A Photographs section in the draft editor: upload JPG, PNG or WebP, thumbnails, drag-and-drop (or arrow) reordering, cover image,
floorplan flag (floorplans always show last), alt text, a per-image privacy review, replace and remove. The private preview shows the
real gallery. Every change is a versioned draft save with a history row. Nothing is published, nothing is written to Notion, GitHub or
the public Blob store.

## How images are handled
- The browser sends image bytes only (never the file name) to `POST /api/listings/draft-photos`. Photos over about 3.6 MB are shrunk in the
  browser first because Vercel rejects request bodies over 4.5 MB; the server limit is 4 MB.
- The server checks the file signature, declared type, size (4 MB), width (at least 960 px), dimensions and pixel count; refuses animated or corrupt files.
- It applies EXIF orientation, drops ALL metadata (EXIF, GPS, XMP, ICC) and writes WebP at 480, 960 and 1600 px named
  `<content hash>-<width>.webp`, the same scheme as the website's `prepare-listing-photos.mjs`. Originals are not kept.
- Files are stored in a PRIVATE Vercel Blob store under `listings-staging/<public id>/`. They are read only through
  `GET /api/listings/draft-photo`, which authorises the user, looks the file up from the draft row (the client never supplies a path)
  and returns it with `Cache-Control: private, no-store`. The browser fetches each image with its session token and shows it from an object URL.
- Photo UX release: there is no per-photo privacy checkbox. Owner authorisation is obtained before upload; the automated alt-text privacy checks and the website publication guards are unchanged. A single gallery review (a Publisher confirms they inspected every image) is recorded with who and when, and is cleared when an image is added, replaced or removed. The first photograph is always the cover and floorplans are always last (one ordered array, no separate cover flag).
- Alt text is also checked for a house number next to the street name, prices and contact details.
- Capabilities: Viewer can look at images; Editor uploads and edits. The privacy review records who confirmed it and when.

## One-time setup (in this order)
1. **Supabase**: run `supabase/migrations/listings_0002_photos.sql` in the SQL editor BEFORE the release is deployed (the app now reads a `photos` column).
   Verify with the queries at the bottom of the file. Rollback: `listings_0002_photos_rollback.sql` (separate file).
2. **Vercel > Storage > Create Database > Blob**: create a NEW store named e.g. `sdahc-listings-staging` with access set to **Private**. Do not reuse the public
   website store. Connect it to project `sdahc-intelligence-app` (Production and Preview). This adds `BLOB_STORE_ID`. The app authenticates with
   Vercel OIDC (`VERCEL_OIDC_TOKEN`, issued per deployment and refreshed by the SDK), so no storage secret is needed in the code or in Vercel env vars.
   Check Project Settings > Security that OIDC federation is enabled. If the connection also adds `BLOB_READ_WRITE_TOKEN`, the app does not need it.
3. **Redeploy** production. Until `BLOB_STORE_ID` exists the photo endpoints answer 503 and the editor shows "Photo storage is not set up yet".


## Photo UX release (listings_0003_photo_review.sql): run BEFORE deploying
1. **Supabase**: run `supabase/migrations/listings_0003_photo_review.sql` in the SQL editor first. It adds one nullable column (`photo_review`) to `listings.drafts`; nothing else
   changes and no grant is added. The new code reads that column, so deploying without it makes draft reads fail. Rollback: `listings_0003_photo_review_rollback.sql`.
   Old code ignores the column, so running the migration early is safe.
2. Merge and deploy. Existing photos keep working: the old per-photo flags are dropped on the next save and a legacy cover flag is honoured once.
3. Optional, separate decision: run the functions in Tokyo (see `docs/photo-ux-performance.md`).

Timings after deployment: browser console `photo upload timings`, and the function log line `{"type":"timing",...}`.

## Polish release: file picker, optional photo descriptions, collapsed History
- **File picker**: "Add photographs" and "Replace" use one persistent off-screen file input. The old handler read the input's live file list after resetting it (needed to allow choosing the same file again), which emptied it, so button selection started nothing while drag and drop worked. The list is now copied first.
- **Photo descriptions are optional** (empty, "Kitchen", "Bedroom"... all accepted; at most 200 characters). The automatic checks still run on anything typed: a house or unit number beside the street name, prices or income, contact details or links, and a file name used as a description. An empty description is shown (and later published) as a neutral fallback that states only what is certain: `Photograph 2 of 5 of the property`, `Floorplan of the property`. The main listing description is still required.
  The website needs the matching change (its schema, manifest reader and photo gate required 8 characters): website PR **#54**. Merge it before publishing anything with short or empty descriptions. `api/_lib/vendor/listings-core.mjs` was rebuilt from that change; rebuild it again from the website's `main` after the merge (`node scripts/vendor-listings-core.mjs --from <clean website checkout>`).
- **History** is collapsed when a listing opens, on a navy card (text contrast 14.3:1 and 6.5:1), with the heading as a button (`aria-expanded`). Content is unchanged.
- No new tables, columns, infrastructure or permissions.


## Update: gallery review removed (Phase 4)
The single gallery review described in the Photo UX release no longer exists: publishing approves the photographs with the listing, and the automatic checks remain. The review endpoint, dialog and state were removed; the `photo_review` column is left in place, unused. See `docs/phase4-dry-run-setup.md`.
