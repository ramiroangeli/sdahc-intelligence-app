// Commercial verification items. SYSTEM items are derived from CRM facts on every read, so they cannot be forgotten;
// a Publisher can acknowledge one with a note, and the acknowledgement stops counting if the underlying fact changes.
// STAFF notes are free text (for example "advertised income differs from the CRM"). Open items block publication, never saving.
import { createHash } from 'node:crypto';

const FULL_CLAIM = /\b(fully\s+(?:leased|let|tenanted|occupied|tenanted)|100\s?%\s+(?:leased|occupied|tenanted)|all\s+(?:\w+\s+)?(?:places|rooms|tenancies)\s+(?:are\s+)?(?:leased|let|tenanted|occupied)|(?:three|3)\s+tenants?)\b/i;
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);

export function systemItems({ occupancy, content }) {
  const items = [];
  if (occupancy && occupancy.occupied < occupancy.places) {
    items.push({
      code: 'occupancy_not_full', severity: 'verify', basis: sha(occupancy),
      text: `The CRM records ${occupancy.occupied} of ${occupancy.places} places physically occupied. Confirm the current occupancy before public wording or any other channel calls the property fully leased or fully occupied.`,
    });
    const text = `${content?.title ?? ''}\n${content?.description ?? ''}`;
    if (FULL_CLAIM.test(text)) {
      items.push({
        code: 'public_text_claims_full', severity: 'error', basis: sha(['claim', occupancy]),
        text: `The draft says the property is fully leased or occupied, but the CRM records ${occupancy.occupied} of ${occupancy.places}. Change the wording or correct the CRM first.`,
      });
    }
  }
  return items;
}

/** Combine system items with acknowledgements and staff notes. */
export function verificationState({ occupancy, content, verification, notes }) {
  const system = systemItems({ occupancy, content }).map((i) => {
    const ack = verification?.[i.code];
    const acknowledged = i.severity === 'verify' && ack && ack.basis === i.basis;
    return { ...i, status: acknowledged ? 'verified' : 'open', verifiedBy: acknowledged ? ack.by : null, verifiedAt: acknowledged ? ack.at : null, note: acknowledged ? ack.note : null };
  });
  const staff = (notes ?? []).map((n) => ({ code: `note:${n.id}`, id: n.id, severity: 'verify', text: n.text, by: n.by, at: n.at, status: n.status, resolvedBy: n.resolvedBy ?? null, resolvedAt: n.resolvedAt ?? null }));
  const open = [...system, ...staff].filter((i) => i.status === 'open');
  return { system, staff, open, blocking: open.length };
}
