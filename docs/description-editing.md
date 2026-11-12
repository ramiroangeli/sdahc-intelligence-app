# Description editing and publication

The Description is one plain-text field. Write it as long as you need.

- A blank line starts a new paragraph. Lines starting with `- ` make a bullet list. A line ending in a colon directly above a list is its label (`Investment summary:`). A short line on its own is a heading (`## Heading` also works).
- Saving and previewing accept any text, including dollar amounts, income, yield, lease, occupancy and provider wording. Nothing is removed. The preview shows the first paragraph with "Read full description" and "Show less", exactly as the listing page does.
- Limits are technical: 120 blocks, 6,000 characters in a block, 30,000 in all.

## Approving a commercial description (Publisher)
SDAHC may publish commercial marketing it has already approved elsewhere (for example an existing public listing). When the text mentions income, yield, dollar amounts or similar, the Description shows a panel. A Publisher saves the draft, then "Review and approve this exact text": confirm that SDAHC has approved the text for public advertising, record the source (a web address or a short description, kept private), add a note, approve.

- The record is built on the server from the stored text and the session. It is bound to the exact text (every block, as written) and to the approved structured commercial values. Any change to either removes it, visibly in the history; putting the old text back does not revive it.
- Approve Investment details first if the listing has them, then the description (the description approval is bound to the values the request will carry).
- The publication request carries only `descriptionApproval.textHash`. The approver, source and note stay private.
- Only the financial wording scan is relaxed, and only for the description. Addresses, emails, phone numbers, private links, the CRM price and the title are still refused.
- A Sold listing carries no commercial figures: edit the text before marking a listing Sold.

### Victorian listings
Income and yield (structured or in the text) are published only with a recorded business authorisation: for structured figures, the Publisher ticks that SDAHC has already authorised these exact figures and records the source; for the description, the Publisher also acknowledges that this is a business authorisation and not a legal classification. The flag is bound into the hash and the website engine requires it. It does not settle the Victorian advertising obligations; Victorian pricing compliance is a separate check and unchanged.

## What is still checked, and where
| Check | Where | Effect |
|---|---|---|
| Dollar amounts, income or yield wording in the text without an approval | App (specific warning) and website engine | Saving and preview are unaffected. The text cannot be published. |
| Text calling the property fully leased or occupied while the CRM shows fewer participants | App | Publication warning only. |
| House or unit number, email, phone, private document link | App and website engine | Editing error. Not relaxed by any approval. |
| CRM price or yield appearing in the text | App and website engine | Editing error. |
| Markup | Display | Shown as typed. Never interpreted. |
