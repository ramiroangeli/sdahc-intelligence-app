# Phase 4, increment 1: dry-run publication. Setup and first run

**Nothing in this increment publishes anything.** A dry run proves that an approved draft would publish: it reads Notion (read only), runs the website's own engine on the approved content, runs the website test suite, builds the site with the new page and scans the output for private data. It writes nothing to Notion, creates no branch or pull request, copies no image to the public store and changes no deployment. The job runs on GitHub's servers and continues if the browser is closed.

## Order of work
1. **Merge the website PR first** (it adds `.github/workflows/publish-listing.yml`; a workflow can only be started once it is on `main`).
2. **Supabase**: run `supabase/migrations/listings_0004_publish_jobs.sql` in the SQL editor (one new table, reversible: `listings_0004_publish_jobs_rollback.sql`). Run its VERIFY queries.
3. **Create the GitHub access token** the app uses to start the workflow (the only new credential):
   GitHub > Settings > Developer settings > Fine-grained personal access tokens > Generate.
   Resource owner `ramiroangeli`; Repository access: **Only select repositories > `sdahc-website`**; Permissions: **Actions: Read and write**, Metadata: Read-only. Nothing else. Choose an expiry and put the renewal date in a calendar.
4. **Shared secret** (signs the job's reports; one value, set in two places). Do not paste it anywhere else:
   ```
   SECRET=$(openssl rand -hex 32)
   printf %s "$SECRET" | gh secret set LISTINGS_CALLBACK_SECRET --repo ramiroangeli/sdahc-website
   printf %s "$SECRET" | vercel env add LISTINGS_CALLBACK_SECRET production --sensitive
   printf %s "$SECRET" | vercel env add LISTINGS_CALLBACK_SECRET preview --sensitive
   unset SECRET
   ```
   **Common mistake: leaving Actions at "Read-only".** The token then reads the repository and the workflow but GitHub answers 403 `Resource not accessible by personal access token` when asked to start it. Fix: GitHub > Settings > Developer settings > Fine-grained personal access tokens > the token > Repository permissions > **Actions: Read and write** > Update. The token value does not change: nothing needs replacing in Vercel and nothing needs redeploying.
   **Check it before using it** (starts nothing, never prints the token):
   ```
   LISTINGS_GITHUB_DISPATCH_TOKEN=<token> node scripts/check-github-dispatch-token.mjs
   ```
   It must print `"ok": true` and "OK: the token may start the workflow".
5. **The access token in Vercel** (Sensitive): `vercel env add LISTINGS_GITHUB_DISPATCH_TOKEN production --sensitive` (and `preview`), paste the token when asked.
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

## GitHub repository state (checked 8 Nov 2026) and what the real publication will need
| | Today | For the real publication |
|---|---|---|
| Branch protection / rulesets on `main` | none | protect `main`: pull request required, required status check, no force-push. The bot must be able to merge ITS OWN publication pull requests without a human review, and nothing else |
| Actions default token | read only | the publication workflow requests `contents` and `pull-requests` write itself |
| "Allow GitHub Actions to create and approve pull requests" | off | must be on for the workflow to open the pull request |
| `docs/github-ruleset-main.json` (prepared earlier) | not applied | requires code-owner review on listing files, which blocks automatic merging. It needs a decision before the real publication |
| Auto-merge | disabled | not needed if the workflow merges after its own checks pass |
None of this is needed for a dry run.


## Simplifications applied after the first dry run (approved)
1. **The Listings Manager is the authority for public content.** The approved text, price and photograph list come from the app; Notion only prefills a new draft and stays the CRM (read only). Edits to the Notion `Web *` fields are not tracked and cannot stop a publication. The website job accepts the approval because the request is signed and the approver is a Publisher in the app's staff list.
2. **No mandatory gallery review.** Publishing a listing approves its photographs. The automatic checks remain: location data removed from every image, type and size limits, minimum width, and the privacy checks on typed descriptions (house numbers, prices, contact details, links, file names). The `photo_review` column stays in the database, unused.
3. **Advertising requirements in plain words.** Staff see one line, "Advertising sign-off", never internal document names or technical terms. The requirement itself is unchanged and still enforced by the website engine.
