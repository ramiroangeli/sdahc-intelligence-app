# Operational closeout list

Launch blockers (decide or do before relying on the platform commercially)
1. Victorian real estate advertising compliance: the income and yield restriction is conservative, not a legal determination. Needs written advice on who is the agent in Victoria, what licence applies to SDA sales advice, and what may be said about price, income and yield. Pricing determinations in `compliance.json` stay as they are until then.
2. Unverified licensing claims: `public/llms.txt` (two lines) and the About page state "licensed operations in Queensland, Victoria and the Northern Territory". Remove or replace with confirmed licence holder, jurisdiction and number (proposed in `outputs/listing-review-pack-2026-11-11.md`). Needs owner approval.
3. Whipray Circuit content corrections (also in the review pack). Needs commercial approval; do not change published content without it.
4. Staff access: confirm `LISTINGS_STAFF_JSON` in Production. The documented example gives Steve `view` and `publish` only, so he can approve and publish but cannot edit descriptions or enter optional details; give `edit` if that is intended. Confirm Ali's capabilities and that Ramiro has the administrator capability.
5. Azure client secret expiry (Supabase Auth, Azure provider): when it expires, sign-in stops for everyone. Check the expiry date in Entra ID (App registration, Certificates and secrets) and calendar it with a renewal reminder.
6. Vercel plan: the project runs on a plan with a 12 function limit. Vercel's Hobby plan excludes commercial use; confirm the plan for both projects covers commercial use and expected traffic before launch.
7. Legacy GitHub token: delete `LISTINGS_GITHUB_DISPATCH_TOKEN` from the app's Vercel environment and revoke the personal token (steps below). The code does not read it.

Minor improvements (after launch)
- Victorian approval-panel wording: the form still says "You are approving exactly these values" and lists income and yield while the approve button is disabled. Hide or reword when figures are present.
- Re-vendor the website core after each website listing-core change (header shows source commit).
- Decide whether narrative text may carry approved figures (a second Publisher approval bound to the exact text); see `docs/description-editing.md`.
- Approver names are visible to all signed-in staff with view access; restrict if that is not wanted.

## Remove the legacy dispatch token (manual, no secret values needed)
1. Vercel, project `sdahc-intelligence-app`, Settings, Environment Variables: find `LISTINGS_GITHUB_DISPATCH_TOKEN` (all environments), Remove. No redeploy is required because the code never reads it. Confirm publishing still starts afterwards ("Test without publishing" is a safe check).
2. GitHub, your account, Settings, Developer settings, Personal access tokens (fine-grained and classic): open the token created for dispatching publication, Delete. Check Settings, Applications, Authorized OAuth Apps for nothing unexpected.
3. Publishing now depends only on the GitHub App "SDAHC Listings Publisher" (`LISTINGS_GITHUB_APP_*`), which does not expire. Keep its private key in Vercel and the website's Actions secrets only.
