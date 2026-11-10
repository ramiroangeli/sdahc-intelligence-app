# Phase 4, increment 1: dry-run publication. Setup and first run

**Nothing in this increment publishes anything.** A dry run proves that an approved draft would publish: it reads Notion (read only), runs the website's own engine on the approved content, runs the website test suite, builds the site with the new page and scans the output for private data. It writes nothing to Notion, creates no branch or pull request, copies no image to the public store and changes no deployment. The job runs on GitHub's servers and continues if the browser is closed.

## Order of work
1. **Merge the website PR first** (it adds `.github/workflows/publish-listing.yml`; a workflow can only be started once it is on `main`).
2. **Supabase**: run `supabase/migrations/listings_0004_publish_jobs.sql` in the SQL editor (one new table, reversible: `listings_0004_publish_jobs_rollback.sql`). Run its VERIFY queries.
3. **GitHub App** (starts the workflow, and later opens and merges the publication pull request): see "GitHub App" in `docs/real-publication-setup.md`. There is no personal access token: the old `LISTINGS_GITHUB_DISPATCH_TOKEN` is no longer read.
4. **Shared secret** (signs the job's reports; one value, set in two places). Do not paste it anywhere else:
   ```
   SECRET=$(openssl rand -hex 32)
   printf %s "$SECRET" | gh secret set LISTINGS_CALLBACK_SECRET --repo ramiroangeli/sdahc-website
   printf %s "$SECRET" | vercel env add LISTINGS_CALLBACK_SECRET production --sensitive
   printf %s "$SECRET" | vercel env add LISTINGS_CALLBACK_SECRET preview --sensitive
   unset SECRET
   ```
5. **Check the App connection** (read only, starts nothing, never shows a token): signed in as an administrator, the portal answers `GET /api/listings/github-app-check` with a verdict ("APP TOKEN OK ...").
6. **GitHub Actions secrets and variables for the website repository** (the repository has none today). The Notion token is the existing READ-ONLY website integration:
   ```
   gh secret set NOTION_TOKEN --repo ramiroangeli/sdahc-website            # paste the read-only token
   gh secret set NOTION_PROPERTIES_DATA_SOURCE_ID --repo ramiroangeli/sdahc-website
   gh variable set LISTINGS_MEDIA_BASE_URL --repo ramiroangeli/sdahc-website --body "<public Blob origin, as in .env.listings>"
   gh variable set LISTINGS_APP_URL --repo ramiroangeli/sdahc-website --body "https://app.sdahomechoices.com.au"
   ```
7. **Staff list** (`LISTINGS_STAFF_JSON`): nothing is required beyond what exists. Optionally add `"displayName": "Ali Example"` for a Publisher: it is the name shown publicly as the approver of a listing (never an email address; the default is "SDA Home Choices"). Approval is made in the Listings Manager, so a Notion user id and the website `approvers.json` are no longer needed for it.
8. Merge this PR and let it deploy.

## First dry run (the first new listing)
1. Open **Website > Listings**, the draft, tab **Review & publish**.
2. Check the final content and the photographs in order (there is no separate gallery review: publishing approves the photographs with the listing, and the automatic checks have already run). In **Commercial verification**, a Publisher records the accepted occupancy position, with the source link of the approved advertisement (the note and link go into the review history).
3. Click **Run dry run**. Watch the steps; you can close the page, the job continues. The GitHub run link is shown.
4. Expected today: **it stops at the publication engine for one reason, the advertising sign-off** (shown to staff in plain words). For a Victorian listing the website still requires a recorded position before it can go live: `compliance.json` in the website repository holds one for Rutherford Grove only. Instead of one record per listing, ONE standing record for a pricing mode (`"listingId": "*"`, with who, when, basis, reference and statement) now covers every listing for that mode. It is recorded by pull request by the code owner, and nothing is recorded yet. This is the real requirement being enforced, not a defect.

A rehearsal of the whole pipeline on a developer machine (real Notion read, real engine, real test suite, real production build, real privacy scan) passed once a scratch determination was added to a throwaway checkout: all seven checks OK. That entry was never committed.

## What is not in this increment
Writing the approved fields to Notion, copying images to the public store, the snapshot pull request, merging, deployment, the live check, updating Rutherford Grove, withdrawing. They come next and need the repository changes below.

## GitHub repository state for real publication (as built)
| | State |
|---|---|
| Rules on `main` (website) | ruleset `26822636`: pull request required, required check `site-checks`, squash only, no force-push, no deletion, **no bypass list** |
| Who opens and merges the publication pull request | the GitHub App (its token, scoped to the website repository), never a person. Its pull request starts `site-checks` by itself, which is what satisfies the rule |
| Actions default token | read only; the publication workflow asks for what it needs itself |
| Auto-merge | not used: the job merges after its own checks pass |


## Simplifications applied after the first dry run (approved)
1. **The Listings Manager is the authority for public content.** The approved text, price and photograph list come from the app; Notion only prefills a new draft and stays the CRM (read only). Edits to the Notion `Web *` fields are not tracked and cannot stop a publication. The website job accepts the approval because the request is signed and the approver is a Publisher in the app's staff list.
2. **No mandatory gallery review.** Publishing a listing approves its photographs. The automatic checks remain: location data removed from every image, type and size limits, minimum width, and the privacy checks on typed descriptions (house numbers, prices, contact details, links, file names). The `photo_review` column stays in the database, unused.
3. **Advertising requirements in plain words.** Staff see one line, "Advertising sign-off", never internal document names or technical terms. The requirement itself is unchanged and still enforced by the website engine.
