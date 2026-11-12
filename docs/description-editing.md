# Description editing and publication

The Description is one plain-text field. Write it as long as you need.

- A blank line starts a new paragraph. Lines starting with `- ` make a bullet list. A line ending in a colon directly above a list is its label (`Investment summary:`). A short line on its own is a heading (`## Heading` also works).
- Saving and previewing accept any text, including dollar amounts, income, yield, lease, occupancy and provider wording. Nothing is removed. The preview shows the first paragraph with "Read full description" and "Show less", exactly as the listing page does.
- Limits are technical: 120 blocks, 6,000 characters in a block, 30,000 in all.

## What is still checked, and where
| Check | Where | Effect |
|---|---|---|
| Dollar amounts, income or yield wording in the text | App (specific warning naming the words and lines) and website engine (`checkPublicSafety`) | Does not affect saving or preview. The text cannot be published. |
| Text calling the property fully leased or occupied while the CRM shows fewer participants | App | Same: publication warning only. |
| House or unit number, email, phone, private document link | App and website engine | Editing error. |
| CRM price or yield appearing in the text | App and website engine | Editing error. |
| Victorian income and yield | Website engine and the structured Investment details | Never published for Victorian listings (conservative rule, pending legal review). |
| Markup | Display | Shown as typed. Never interpreted. |

Free text cannot publish figures. Structured lease, occupancy, income and yield belong in Investment details, where a Publisher's approval is required.

## Open question (needs a decision, not built)
Some listings may need figures in the narrative itself. The smallest safe way is a second Publisher approval bound to the exact description text (the same server-built hash mechanism as Investment details), refused for Victorian listings. It is not part of this change.
