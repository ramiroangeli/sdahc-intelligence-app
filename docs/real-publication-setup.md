# Real publication: exact settings

Do these in order. Each step says what it changes and how to confirm it.

## 1. Website repository (ramiroangeli/sdahc-website)
1. Merge the website pull request that adds `ci.yml` and the publish/update modes. It must be on `main` before anything below.
2. Settings > Actions > General > Workflow permissions: leave "Read repository contents and packages permissions". (The publish workflow declares its own narrow permissions, and the publication pull request is opened by the GitHub App, so "Allow GitHub Actions to create and approve pull requests" is not needed.)
3. Optional, Settings > Secrets and variables > Actions > Variables: `LISTINGS_SITE_URL` = `https://sdahomechoices.com.au` (this is already the default).
4. Apply the branch rules (after step 1): Settings > Rules > Rulesets > New ruleset > Import a ruleset > choose `docs/github-ruleset-main.json`, or from a terminal logged in as the owner:
   `gh api -X POST repos/ramiroangeli/sdahc-website/rulesets --input docs/github-ruleset-main.json`
   Result: `main` needs a pull request with the check `site-checks` passing, allows squash merges only, blocks force pushes and deletion, and has **no bypass list**. From then on even the owner changes `main` only through a pull request (open a pull request, wait for `site-checks`, merge).
   Pull requests opened with the workflow token never start `site-checks` by themselves (GitHub does not start workflows for that token). That is why publication uses the GitHub App below: its pull request starts the check normally. A manual run of the CI workflow never satisfies the rule.
5. Optional: Settings > General > Pull Requests > tick **Automatically delete head branches**, so a merged publication branch does not linger.

## 2. Public image store connection (Vercel, project sdahc-intelligence-app)
The public store `sdahc-website-blob` is connected only to the website. Connect it to the app as a SECOND store, next to the private one, without touching the private store's `BLOB_STORE_ID`:
1. Vercel > Storage > `sdahc-website-blob` > Projects > Connect Project > `sdahc-intelligence-app`.
2. Environments: **Production** only (Preview must not write to the public store).
3. **Custom prefix: `PUBLIC_BLOB`**. (Do not leave it as `BLOB`: that would replace the private store's configuration.)
4. Open the project's Environment Variables. You should see `PUBLIC_BLOB_STORE_ID` and NO `PUBLIC_BLOB_READ_WRITE_TOKEN`. If a read-write token is listed instead, the store is token-only: stop and tell me; do not paste the token anywhere.
5. Redeploy production (Deployments > latest > Redeploy) so the variable reaches the functions.
6. Confirm: `vercel env pull .env.check --environment=production && node --env-file=.env.check scripts/check-public-blob.mjs --write` (from the app folder) should print `READ OK` and `WRITE OK`. Delete `.env.check` afterwards.

## 3. GitHub App ("SDAHC Listings Publisher")
One App does everything the workflow and the portal need on GitHub. It replaces the former personal access token, which no longer exists in the code.
1. Create it under the owner account (Settings > Developer settings > GitHub Apps). Webhook: off. Repository permissions, nothing else: **Actions: Read and write**, **Contents: Read and write**, **Pull requests: Read and write**, **Checks: Read-only**, **Deployments: Read-only**, Metadata: Read-only.
2. Install it on **only** `ramiroangeli/sdahc-website` (Only select repositories).
3. Website repository, Actions secrets: `LISTINGS_APP_ID` (the App id) and `LISTINGS_APP_PRIVATE_KEY` (the full PEM including the BEGIN and END lines). The workflow uses them to open and merge the publication pull request.
4. Vercel project, Production, Sensitive: `LISTINGS_GITHUB_APP_ID`, `LISTINGS_GITHUB_APP_INSTALLATION_ID` and `LISTINGS_GITHUB_APP_PRIVATE_KEY` (full PEM; escaped `\n` and base64 are also accepted). The portal uses them to start the workflow with a short-lived token limited to the website repository.
5. Check it: signed in as an administrator, open `/api/listings/github-app-check` from the portal. It starts nothing and never shows a token.
6. `LISTINGS_GITHUB_AUTH` is no longer a switch. It may stay set to `app`; any other value stops publishing with a clear configuration error. `LISTINGS_GITHUB_DISPATCH_TOKEN` is ignored and can be deleted.

## 4. App
Merge the app pull request. It deploys to production on merge.

## 5. Protect `main` in this app repository (proposed, apply deliberately)
Pushing to `main` of this repository deploys to production, where the publication credentials live, so `main` should only change through a reviewed pull request whose `test` check passed. `docs/github-ruleset-main.json` is the exact ruleset (the same shape as the website's):
- pull request required (no approval count, so a single owner can still merge), required check `test` (the job in `.github/workflows/test.yml`), force-push and deletion blocked, merge or squash allowed, **no bypass list**;
- normal work is unchanged: open a pull request, wait about two minutes for `test`, merge, and Vercel deploys as it does today. Vercel's own preview check is not required;
- apply: `gh api -X POST repos/ramiroangeli/sdahc-intelligence-app/rulesets --input docs/github-ruleset-main.json`; remove: Settings > Rules > Rulesets > delete;
- it also stops a direct push from editing `.github/workflows/sync.yml`, which runs with the Supabase service key.

## Maintenance obligations
| Item | Where | Expires | Action |
|---|---|---|---|
| GitHub App private key | App settings, Actions secret, Vercel | does not expire | rotate if it may have been exposed: generate a new key, replace both secrets, delete the old key |
| `LISTINGS_CALLBACK_SECRET` | Vercel and website Actions | does not expire | rotate by setting both places to the same new value |
| Microsoft sign-in (Azure client secret) | Supabase Auth > Azure provider | has an expiry date set in Azure | note the date in a calendar; sign-in stops for everyone when it lapses |
| Staff access | `LISTINGS_STAFF_JSON` in Vercel | n/a | edit the list and redeploy to add or remove someone |


## What each part can and cannot do
- The app copies only `lst_xxxxxxxxxx/<hash>-<width>.webp` and `lst_xxxxxxxxxx/manifest.json` to the public store (enforced in `api/_lib/public-media.js`); it never deletes there.
- The GitHub job can write only a branch and the single `approved/<slug>.json` file, and merge only a pull request whose `site-checks` passed on the exact commit.
- Nothing writes to Notion. The listing is Live in the app only after the live page, every image and the catalogue were fetched from the production site.

## Adopting a listing that was published before the Listings Manager

A listing that is already on the website (for example Rutherford Grove) has no draft, and a normal "Create draft" is refused (`already_published`).
**Listings > Add next listing > Import published listing** (needs the Editor and Publisher capabilities) creates its draft from the approved snapshot:

- The draft keeps the published content, public address, slug, photograph ids, alt text, order and floorplan flag. The existing public WebP files are copied byte for byte into PRIVATE staging, so public image URLs do not change.
- Before anything is written the import checks the snapshot's content hash and schema, that every image is a WebP of the stated width at `<public id>/<photo id>-<width>.webp` on the public Blob host, and that the draft reproduces the published listing exactly (the website job's own comparison).
- It writes only the draft (with its gallery, in one transaction; history action `create`, changed fields include `importedFromPublished`) and the private staging files. It never writes to Notion, GitHub, the public store or the website, and never starts a job. The live page is untouched.
- Repeating it returns the existing draft and writes nothing. Failures leave nothing behind and are recorded in the audit log (`listings.draft.import`).
- The portal shows the listing as Live only after its first successful real update (the portal derives Live from publication jobs). Make a small real edit, run a dry run, then publish an update.

## Commercial status (Available, Under offer, Sold)

A Publisher changes the public status on the **Publish update** card of a published listing (choose the status, confirm; Sold needs an extra tick). It is sent as an `update` job whose payload carries `commercialStatus` only when it differs from the status the website shows now, together with the status the person saw (`expectedStatus`): if the website has changed in the meantime the request is refused (409 `status_changed`) rather than undoing someone else's change. Publishing content without choosing a status never changes the status. A status change at a draft version that is already live is a new job (idempotency compares the frozen payload, not just the version). Editors cannot change it. The change appears as Live only after the website has been verified (the badge, and for Sold that the page no longer offers the property).

**Privacy.** Nobody is named on the public website: the approver in every snapshot is the constant `listings-manager` / "SDA Home Choices" and the payload carries no email or Notion user id. Who acted is recorded only in the private job record and the audit log. Snapshots published before this change carry a per-person identifier (`approvedById`, a truncated hash of the approving person's email); they are not rewritten, and a new version published from now on carries the constant.
