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
