# Real publication: exact settings

Do these in order. Each step says what it changes and how to confirm it.

## 1. Website repository (ramiroangeli/sdahc-website)
1. Merge the website pull request that adds `ci.yml` and the publish/update modes. It must be on `main` before anything below.
2. Settings > Actions > General > Workflow permissions: leave "Read repository contents and packages permissions". Tick **Allow GitHub Actions to create and approve pull requests**, then Save. (The publish workflow declares its own narrow permissions; this tick only lets its token open the pull request.)
3. Optional, Settings > Secrets and variables > Actions > Variables: `LISTINGS_SITE_URL` = `https://sdahomechoices.com.au` (this is already the default).
4. Apply the branch rules (after step 1): Settings > Rules > Rulesets > New ruleset > Import a ruleset > choose `docs/github-ruleset-main.json`, or from a terminal logged in as the owner:
   `gh api -X POST repos/ramiroangeli/sdahc-website/rulesets --input docs/github-ruleset-main.json`
   Result: `main` needs a pull request with the check `site-checks` passing, allows squash merges only, blocks force pushes and deletion, and has **no bypass list**. From then on even the owner changes `main` only through a pull request (open a pull request, wait for `site-checks`, merge).
   Pull requests opened by the existing `listings-sync` workflow do not start `site-checks` by themselves (GitHub does not start workflows for the workflow token): run Actions > CI > Run workflow on that branch, then merge.

## 2. Public image store connection (Vercel, project sdahc-intelligence-app)
The public store `sdahc-website-blob` is connected only to the website. Connect it to the app as a SECOND store, next to the private one, without touching the private store's `BLOB_STORE_ID`:
1. Vercel > Storage > `sdahc-website-blob` > Projects > Connect Project > `sdahc-intelligence-app`.
2. Environments: **Production** only (Preview must not write to the public store).
3. **Custom prefix: `PUBLIC_BLOB`**. (Do not leave it as `BLOB`: that would replace the private store's configuration.)
4. Open the project's Environment Variables. You should see `PUBLIC_BLOB_STORE_ID` and NO `PUBLIC_BLOB_READ_WRITE_TOKEN`. If a read-write token is listed instead, the store is token-only: stop and tell me; do not paste the token anywhere.
5. Redeploy production (Deployments > latest > Redeploy) so the variable reaches the functions.
6. Confirm: `vercel env pull .env.check --environment=production && node --env-file=.env.check scripts/check-public-blob.mjs --write` (from the app folder) should print `READ OK` and `WRITE OK`. Delete `.env.check` afterwards.

## 3. App
Merge the app pull request. It deploys to production on merge. `LISTINGS_GITHUB_DISPATCH_TOKEN` and `LISTINGS_CALLBACK_SECRET` stay as they are.

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
