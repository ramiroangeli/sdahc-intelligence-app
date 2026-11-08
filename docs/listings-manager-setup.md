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

Optional: `LISTINGS_SITE_BASE_URL`, `LISTINGS_GITHUB_REPO`, `LISTINGS_GITHUB_REF`, `LISTINGS_GITHUB_READ_TOKEN`, `NOTION_API_VERSION`.

If any of the first four is missing or invalid, every endpoint answers 503 and does nothing. Fail closed.

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
Add next listing (property picker from Notion Properties), a draft editor (Web title, description, public address, pricing mode,
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
