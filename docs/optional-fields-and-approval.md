# Optional listing fields and commercial approval

Scope: the Listings Manager can hold optional property, SDA, commercial and marketing details for a listing. All are optional. A listing without them is saved, previewed and published exactly as before.

## Fields (the website's approved data contract)
- Property: bathrooms, car spaces, floor area, land area, parking, council area.
- SDA: bedrooms, participant places, OOA wording.
- Commercial ("Investment details"): lease status and occupancy status (separate), tenure, annual income and type, yield and type, basis (actual or projected), provider arrangement wording.
- Marketing agency, chosen from the website's approved agency list.

## What is private and what needs approval
- Property, SDA and agency details are descriptive facts: they publish with the listing.
- The commercial block is stored privately and is published only while a Publisher's approval matches its exact values. Nothing from the CRM is ever copied into these fields.
- Victoria: income and yield cannot be approved or published (the website's conservative restriction, not a legal determination). Lease and occupancy can be. The Victorian pricing compliance check is untouched.
- A Sold listing never carries the commercial block.

## How the approval cannot be forged
1. The approval record is stored server-side in the draft's existing `verification` column under `investment_disclosure`: `{ valuesHash, provider, by, at, note }`.
2. Only the Publisher-only verify route (`POST /api/listings/draft-verify`, capability `listings.publish`) writes it. The hash is computed on the server from the values stored in the database. The request carries no hash, record or identity; `by` is the signed-in session and `at` is the server clock.
3. The save route never reads `verification` or any approval from a request, and the content cleaner drops any `approval` or hash typed into the commercial values.
4. Any change to a commercial value removes the record in the same save (visible in the history) and, independently, an approval that no longer matches the values is never used: publishing recomputes the hash from the stored values.
5. The publication request is built from the stored draft (never the browser) and signed. The website verifies the same hash again and applies its own safety checks.
6. The approver's identity and note stay in the private draft record and history. The public request, snapshot and pull request name nobody.

No database schema, new function or new secret is involved: `verification` is an existing jsonb column and `verify` an existing history action. The app still has exactly 12 functions under `api/listings`.

## Workflow notes
- Saving, previewing, publishing, updating, status changes and withdrawal behave as before. "Changes since live" now also compares the optional groups.
- Adopting an already published listing carries its optional groups; if its published approval hash verifies, that approval is carried over (marked as imported) so the next update does not silently remove live figures.
- Requires website PR 78 (the publish engine accepts the optional groups from the signed request) to be merged and deployed first. Until then, do not publish a listing that has optional details.
