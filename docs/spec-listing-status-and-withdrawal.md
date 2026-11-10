# Listing status and withdrawal: functional specification

Status: **for review. Nothing in this document is built.** Prepared 10 Nov 2026 from the code of both repositories at their `main`.

## 1. Summary

Staff can create, import, edit and publish listings in the Listings Manager, but they cannot yet say a listing is **Under offer** or **Sold**, set an **end date**, **withdraw** it, or **reinstate** it. Today each of those needs a developer: a command-line tool, a pull request and a deployment (website runbook, sections 5 and 6). This specification describes how to bring them into the Listings Manager through the publication flow that is already proven (App-opened pull request, required check, merge, Vercel deployment, live verification), with no new infrastructure.

Two ideas drive the design:

1. **Commercial status and public visibility are different things.** Available, Under offer and Sold describe the sale and keep the page public. Withdrawn removes the page. They have different risks and different safeguards.
2. **The Listings Manager becomes the source of truth for public status.** It never writes to Notion (the CRM). Notion's own "Web Listing Status" stops being an input for listings the portal manages.

## 2. What exists today (verified in code)

| Fact | Where |
|---|---|
| A snapshot carries `commercialStatus` (available, under_offer, sold), optional `featured` and `listingEndDate` | website `schema.ts`, `approved/*.json` |
| The website job takes the status from the **Notion** "Web Listing Status" field, not from the portal. The portal payload carries no status | `propose.ts`, app `buildPayload` |
| A status-only change makes the engine answer kind `status`. The job accepts `update` only for kind `version`, so a status-only update is refused (`wrong_mode`, with a misleading message) | website `listings-publish-job.mjs` |
| Withdrawal is a file `withdrawn/<id>.json` (reason, who, when). It overrides everything, including Notion. Reinstating is removing that file. Both are command-line plus pull request | `listings-sync.mjs --withdraw / --reinstate`, runbook 6 |
| A passed `listingEndDate` hides the listing, but only when the site is next built (the site is static) | `versioning.ts` `resolveListing` |
| The database already allows the job kind `withdraw` (check constraint), but not `reinstate`. The app has no code for either | migration 0004, `ENABLED_KINDS` |
| The app never deletes from the public image store. After a withdrawal the image files stay reachable by URL | `public-media.js` |
| The withdrawal reason is committed to a **public** repository (max 120 characters, no personal data) | runbook 6 |

## 3. Definitions and states

```
                     publish / update
   (none) ───────────────────────────────▶  PUBLIC
                                              ├─ Available
                                              ├─ Under offer        (change freely between these three,
                                              └─ Sold                each is a normal update)
                                               │  ▲
                                      withdraw │  │ reinstate
                                               ▼  │
                                            WITHDRAWN   (page, catalogue entry and sitemap entry removed)
```

- **Commercial status** (Available, Under offer, Sold): what the public page says about the sale. The page stays.
- **End date** (optional): the date after which the listing should no longer be shown.
- **Withdrawn**: the page is removed from the website. The draft, its history and its photographs stay in the Listings Manager. It is a tombstone, not a deletion.
- **Reinstated**: a withdrawn listing is made public again. It is a fresh, fully re-checked publication, not an undo.
- **Notion "Web Listing Status"** is CRM information. It is shown read only for comparison and never changed.

## 4. Source of truth and the Notion boundary

- The portal stores the intended commercial status and end date with the listing and **freezes them into the approved payload** exactly as it already does for text, price and photographs. The website job applies the payload's status instead of reading Notion's.
- Withdrawn is derived from the website itself (the `withdrawn/` folder, which the portal already reads), and Live from verified jobs, as today.
- **Notion is not written.** If the CRM disagrees with the website (for example Notion says Under offer, the website says Available) the portal shows a neutral, read-only line: "The CRM says Under offer; the website says Available." It is information, never an error and never a block.
- Existing listings (Sheppard Street, Rutherford Grove) are already portal-managed: their current website status is the starting value.

## 5. The four actions

| Action | Who | What the website does | Reversible? | Safeguard |
|---|---|---|---|---|
| Change status: Available, Under offer | Publisher | Page stays, badge and catalogue order change | Yes, immediately | One confirmation that states the new public wording |
| Change status: **Sold** | Publisher | Page stays, badge says Sold, enquiries may be disabled or reworded | Yes, but it is a public market claim | One confirmation that states what visitors will see; shown as "Sold" in the history |
| Set or clear an **end date** | Publisher | Stored in the snapshot. Takes effect at the first deployment after the date (see decision 4) | Yes | The screen says exactly when it takes effect |
| **Withdraw** | Publisher | Page, catalogue entry, links and sitemap entry removed | The page can come back (reinstate), but search engines and caches may keep it for a while, and the public image files stay (decision 3) | Typed confirmation (see section 6) |
| **Reinstate** | Publisher | Page returns, as a full re-checked publication | n/a | Typed confirmation, and every current rule is checked again |

## 6. Approval and confirmation process

Principle: the more public and the less reversible, the more deliberate the step. The proven publication lifecycle does the heavy lifting (nothing is public until the website has verified it), so the confirmation is about intent, not about technology.

**Tier 1, status between Available and Under offer; end date.** Publisher only. A summary screen: "Rutherford Grove will show **Under offer**. Visitors will see: ...". One button. Result shown as Live only after verification, like an update.

**Tier 2, Sold.** Same as Tier 1, plus the screen states "This tells the public the property is sold" and, if the website changes enquiry behaviour for sold listings, what happens to the enquiry button. One extra tick, "I confirm the property has sold".

**Tier 3, Withdraw.** Publisher only, and always:
1. The screen lists what will disappear (page address, catalogue entry, sitemap entry) and what will not (photographs stay reachable by URL; search engines may cache).
2. A **reason is required**, short, with no names, phone numbers, emails or amounts, because it is written to a public repository. The portal checks these rules with the same privacy checks used for descriptions.
3. The person **types the property's public address** to confirm (the pattern used for destructive actions elsewhere).
4. It runs through the normal lifecycle (pull request, required check, merge, deployment) and shows as Withdrawn only after the website returns 404 for the page and the sitemap and catalogue no longer list it.
5. Two-person rule: **recommended off by default**, because it blocks an urgent takedown when only one Publisher is available. If you want it, the second Publisher approves in the portal before the job starts (decision 1).

**Tier 3, Reinstate.** Publisher only. Typed address. Because content, compliance or photographs may have changed since, it runs the full publication checks. It returns at the status chosen on the screen (default: Available).

Everything is recorded: who, when, the version and the reason, in the job record and the audit log; the withdrawal file itself carries the public-safe reason. There is no "delete" for listings.

## 7. Technical design (smallest change)

Reuses the proven path: portal freezes a payload, copies nothing new for status changes, dispatches `publish-listing.yml` through the GitHub App, the website job opens a one-file pull request, waits for `site-checks`, merges, waits for Vercel, verifies live, reports by signed callback.

**Status and end date (no new job kind, no migration).**
- App: add `commercialStatus` and `listingEndDate` to the draft content (it is jsonb, so no schema change) and to the payload. A status change is saved and published like any other change. When only the status changed, the draft's "no changes" logic must treat it as a public change.
- Website job: apply the payload's status and end date; accept the engine's `status` kind as a valid `update` (today it answers `wrong_mode`). Parity check gains the two fields.

**Withdraw and reinstate.**
- Job kind `withdraw` already exists in the database. The payload carries `action: "withdraw" | "reinstate"` and the reason. Using one kind for both avoids a migration. The alternative is a small migration widening the check to add `reinstate`, which needs your approval (decision 5).
- Website job (new branch of the same script): withdraw writes `withdrawn/<id>.json` (the same file the CLI writes) in a one-file pull request; reinstate removes it. The job verifies the page returns 404, the sitemap and catalogue do not list it (and the opposite for reinstate), using the existing live-verification helpers. The CLI stays as the emergency path.
- Reinstate runs the existing publication engine and checks.

**Portal state and screens.** The review screen gains a "Listing status" card (segmented choice, optional end date) and, separately and visually distinct, "Withdraw this listing". Withdrawn listings show "Withdrawn" with a "Reinstate" action. Editing a withdrawn draft is allowed; publishing is blocked until it is reinstated. No redesign: these are new cards in the existing layout.

**Not changed.** Notion (never written), the ruleset, the GitHub App permissions (already contents and pull requests write), the 12-function limit (new actions use the existing publish endpoint).

## 8. Failure and recovery

Identical to publication: a failure before the merge changes nothing and can be retried; a merge that is not yet verified shows "Merged, not yet confirmed" and offers a re-check; the portal shows Withdrawn or the new status only after the website is verified. For an urgent takedown the CLI and the documented Vercel instant rollback remain as a developer-side emergency, but the portal path is expected to complete in about two minutes, like an update.

## 9. Testing plan

- Unit and flow tests against the fake GitHub, Notion and database for: each state transition and the transitions that must be refused (publish while withdrawn, reinstate while public, withdraw twice); Publisher only; Editors and Viewers refused; the reason's privacy checks; typed-address confirmation; idempotency (two clicks, two tabs); stale tab (version check); failure injection at each job step; Live and Withdrawn only after verification.
- Website tests: the job's new branches (status kind accepted for update, withdraw and reinstate pull requests touching exactly one file, parity on the new fields), and the existing `check:withdrawal` run on the built output.
- No real listing is withdrawn or changed in testing. The first real use is on a listing you choose, with you watching.

## 10. Effort and risk

| Slice | Content | Effort | Regression risk |
|---|---|---|---|
| 1 | Status and end date through the update path (app payload, website job, parity, UI card) | medium | medium: touches the website job |
| 2 | Withdraw and reinstate (job branches, verification, typed confirmation, UI) | medium to large | medium: new website job branch, but the CLI path stays |
| 3 | Notion-vs-website information line, reminders for end dates | small | low |

Recommended order: 1, then 2, then 3. Each is its own pull request in each repository, none merged automatically.

## 11. Decisions needed from you

1. **Withdrawal approval:** a single Publisher with typed confirmation (recommended), or a second Publisher's approval as well?
2. **Reinstate returns to:** the status before withdrawal, or Available (recommended) with the status chosen on the screen?
3. **Public photographs on withdrawal:** leave them reachable by URL (current rule: the app never deletes), or add an explicit Administrator "remove public photographs" step after a withdrawal?
4. **End dates:** (a) store the date and take effect at the next deployment only (simplest), (b) also show a portal reminder "ended but still live" (recommended), or (c) add a scheduled daily rebuild (new infrastructure, not recommended now).
5. **Reinstate job kind:** reuse `withdraw` with an `action` field (no migration, recommended) or widen the database check with a migration?
6. **Who may change status:** Publishers only (recommended), or may an Editor also move Available and Under offer?
7. **Sold wording:** confirm what the public page and the enquiry form should do for a Sold listing (this is a website decision; the portal only sets the status).
8. **Reason text:** is a free-text reason acceptable (checked for personal data), or should it be a short list (vendor request, sold elsewhere, error, compliance)?
