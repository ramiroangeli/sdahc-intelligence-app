// Validation of a draft. The rules are the website's own (vendor/listings-core.mjs is built from the website repo), so a
// draft that passes here passes the same address, price, safety, Victorian-compliance and Basic checks the publication
// pipeline applies. Saving is never blocked by these results: an unfinished draft is allowed. They tell staff what is missing.
import * as core from './vendor/listings-core.mjs';
import { HttpError } from './http.js';

import { plainBlocker } from './publication.js';
import { cleanOptional, optionalIssues, approvalState, descriptionApprovalState, stateOf } from './optional-fields.js';

export const CONTENT_LIMITS = { title: 200, description: 30000, publicAddress: 200, displayPrice: 40 };
const PRICING_KEYS = { asking_price: 'asking_price', price_guide: 'price_guide', eoi: 'eoi', contact_agent: 'contact_agent' };
export const PRICING_CHOICES = core.PRICING_MODES.map((k) => ({ key: k, label: core.PRICING_MODE_LABEL[k] }));

/** Notion select label -> mode key, same mapping as the website adapter. */
export const modeKeyFromLabel = (label) => ({ askingprice: 'asking_price', priceguide: 'price_guide', expressionsofinterest: 'eoi', eoi: 'eoi', contactagent: 'contact_agent' })[String(label).toLowerCase().replace(/[^a-z]/g, '')] ?? '';

/** Normalises user input to the stored shape. Unknown keys are dropped. Throws for wrong types or oversize values. */
export function cleanContent(input) {
  const c = input && typeof input === 'object' ? input : {};
  const str = (k) => {
    const v = c[k] == null ? '' : c[k];
    if (typeof v !== 'string') throw new HttpError(400, 'invalid_content', { reasons: [`${k} must be text`] });
    if (v.length > CONTENT_LIMITS[k]) throw new HttpError(400, 'invalid_content', { reasons: [`${k} is too long`] });
    return v.replace(/\r\n/g, '\n').trim();
  };
  const mode = c.pricingMode == null ? '' : String(c.pricingMode);
  if (mode && !PRICING_KEYS[mode]) throw new HttpError(400, 'invalid_content', { reasons: ['unknown pricing mode'] });
  return { title: str('title'), description: str('description'), publicAddress: str('publicAddress'), pricingMode: mode, displayPrice: str('displayPrice'), featured: c.featured === true, ...cleanOptional(c) };
}

/** Same reading of the text as the website and the publish job (blocks keep their line breaks so bullet lists survive). */
const paragraphs = (raw) => core.descriptionBlocks(raw);

/** Splits a validation message from the website rules into a code and a field for the UI. */
function classify(msg) {
  if (/photograph/i.test(msg)) return { kind: 'blocker', code: 'photos_required' };
  if (/Victorian pricing compliance/i.test(msg)) return { kind: 'blocker', code: 'victoria_compliance' };
  if (/Design Category Basic/i.test(msg)) return { kind: 'blocker', code: 'basic_classification' };
  if (/house or unit number|internal street number|full internal address|unit\/number/i.test(msg)) return { kind: 'error', code: 'private_address', field: 'description' };
  if (/dollar amount|financial term/i.test(msg)) return { kind: 'blocker', code: 'description_financial' };
  if (/CRM price|internal yield/i.test(msg)) return { kind: 'error', code: 'private_financial', field: 'description' };
  if (/email|phone/i.test(msg)) return { kind: 'error', code: 'personal_data', field: 'description' };
  if (/private document system/i.test(msg)) return { kind: 'error', code: 'private_link', field: 'description' };
  if (/new build|Basic classification/i.test(msg)) return { kind: 'error', code: 'basic_wording', field: 'description' };
  return { kind: 'error', code: 'content', field: null };
}

/**
 * The publication warning for financial wording in the text. Saving and previewing are never affected; this says exactly what was found and what to do.
 * The lines are the person's own (the draft is private to staff), so quoting them is safe.
 */
function financialWarning(content, address, ctxDraftState) {
  const lines = `${content.title}\n${content.description}`.split('\n').filter((l) => core.findFinancialMentions(l).length);
  const seen = [...new Set(core.findFinancialMentions(`${content.title}\n${content.description}`))].slice(0, 6);
  const quoted = lines.slice(0, 3).map((l) => { const t = l.trim().replace(/^[-*\u2022]\s+/, ''); return `"${t.slice(0, 70)}${t.length > 70 ? '...' : ''}"`; }).join(', ');
  const vic = address && address.state === 'VIC';
  const d = ctxDraftState;
  const route = d === 'stale' ? ' It was approved before, but the text or the commercial values changed since, so it needs approving again.' : '';
  return `The text mentions ${seen.map((x) => `"${x}"`).join(', ')}${quoted ? ` (for example ${quoted})` : ''}. You can keep it in the draft and preview it. To publish it, a Publisher must approve this exact text when SDAHC has already authorised it for public advertising (for example an existing public listing), and record the source.${route}`
    + (vic ? ' This is a Victorian listing, so the approval also records a business authorisation. It does not classify the property under Victorian law.' : ' Otherwise remove those lines, or enter lease, occupancy, income and yield in Investment details.');
}

/**
 * @param content    cleaned draft content
 * @param ctx        { publicId, internal:{address,priceAud,yieldPct}, crmState, designCategories, buildType, takenSlugs:Set, compliance }
 */
export function validateDraft(content, ctx, now = new Date()) {
  const fieldErrors = {};
  const errors = [];
  const blockers = [];
  const warnings = [];
  const addField = (f, m) => { (fieldErrors[f] ??= []).push(m); };

  // address
  let address = null;
  if (!content.publicAddress) addField('publicAddress', 'Enter the public address as "Street Name, Suburb STATE 1234", with no house or unit number.');
  else {
    try { address = core.parsePublicAddress(content.publicAddress); } catch (e) { addField('publicAddress', e.message.replace(/^Web Public Address/, 'The public address')); }
    if (address && ctx.crmState && address.state !== ctx.crmState) addField('publicAddress', `The state ${address.state} differs from the CRM state ${ctx.crmState}.`);
  }
  // description
  const paras = paragraphs(content.description);
  if (!paras.length) addField('description', 'Write the public description. It is the only text published; the CRM description is never used.');
  // technical limits only (the same as the website schema): long commercial descriptions are normal
  if (paras.length > 120) addField('description', 'The description has more than 120 blocks. Join some of them (a block is what sits between blank lines).');
  if (paras.some((p) => p.length > 6000)) addField('description', 'One block (text between blank lines) is longer than 6,000 characters. Add a blank line to split it.');
  if (paras.join('').length > 30000) addField('description', 'The description is longer than 30,000 characters.');
  // title
  if (content.title && (content.title.length < 5 || content.title.length > 90)) addField('title', 'The title must be between 5 and 90 characters, or left blank to use the default.');
  if (!content.title) warnings.push({ code: 'default_title', field: 'title', message: 'No title: the website will use "SDA property, <suburb>".' });
  // pricing (single numeric amount only, see decision D5)
  let display;
  if (!content.pricingMode) addField('pricingMode', 'Choose a pricing mode.');
  const needsPrice = content.pricingMode === 'asking_price' || content.pricingMode === 'price_guide';
  if (needsPrice) {
    if (!content.displayPrice) addField('displayPrice', 'Enter the approved public price (a single amount in AUD).');
    else if ((content.displayPrice.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).length > 1 || /\bto\b|-|–/.test(content.displayPrice)) addField('displayPrice', 'Price ranges are not supported yet. Enter a single amount.');
    else { try { display = core.normalisePriceDisplay(content.displayPrice); } catch (e) { addField('displayPrice', e.message.replace(/^Web Display Price/, 'The price')); } }
  } else if (content.pricingMode && content.displayPrice) addField('displayPrice', `A price is not shown in "${core.PRICING_MODE_LABEL[content.pricingMode]}" mode. Clear it or change the mode.`);

  // optional groups: invalid descriptive facts block publication (the website would refuse them); invalid commercial values only block their approval
  for (const i of optionalIssues(content, { state: address?.state, allowVictorianFigures: !!ctx.draft && approvalState(ctx.draft).victorian === true })) {
    if (i.field === 'investment') warnings.push({ code: 'investment_values', field: 'investment', message: i.message });
    else addField(i.field, i.message);
  }

  const complete = () => Object.keys(fieldErrors).length === 0;
  let slug = null;
  let publicContent = null;
  if (address && paras.length && complete()) {
    slug = core.makeSlug(address, ctx.takenSlugs ?? new Set(), ctx.publicId);
    publicContent = {
      slug, type: 'property',
      title: content.title || `SDA property, ${address.suburb}`,
      description: paras, address,
      pricing: { mode: content.pricingMode, ...(display ? { display } : {}) },
      sda: { ...(ctx.designCategories?.length ? { designCategories: ctx.designCategories } : {}), ...(ctx.buildType ? { buildingType: ctx.buildType } : {}) },
      photos: ctx.photos ?? [],
    };
    // Run the website's own publication rules. Approval fields are placeholders: this is a readiness check, not an approval.
    const rec = {
      id: ctx.publicId, webStatus: 'draft', featured: content.featured, draft: publicContent,
      approval: { by: 'readiness check', byUserId: 'readiness-check', at: new Date(now.getTime() - 1000).toISOString() },
      isFixture: false, internal: { address: ctx.internal?.address, priceAud: ctx.internal?.priceAud, yieldPct: ctx.internal?.yieldPct },
    };
    const res = core.validateForPublication(rec, {
      internalAddress: ctx.internal?.address, internalPriceAud: ctx.internal?.priceAud, internalYieldPct: ctx.internal?.yieldPct,
      allowDemo: false, authorisedApproverIds: ['readiness-check'], compliance: ctx.compliance,
    }, now, { preflight: true });
    for (const m of res.issues) {
      const c = classify(m);
      // never echo CRM values that a rule might have quoted
      const message = c.code === 'description_financial' ? financialWarning(content, address, ctx.draft ? descriptionApprovalState(ctx.draft).state : 'unapproved') : c.code === 'victoria_compliance' || c.code === 'basic_classification' ? plainBlocker({ code: c.code, message: m }) : m.replace(/\$\s?\d[\d,]*/g, '[amount]');
      if (c.code === 'description_financial' && ctx.draft) {
        const d = descriptionApprovalState(ctx.draft);
        const titleOnly = core.findFinancialMentions(content.title).length > 0;
        if (d.state === 'approved' && (address.state !== 'VIC' || d.victorian === true) && !titleOnly) continue; // an approved exact description: the website engine applies the same rule
      }
      if (c.kind === 'blocker') blockers.push({ code: c.code, message });
      else { errors.push({ code: c.code, field: c.field, message }); if (c.field) addField(c.field, message); }
    }
    if (ctx.complianceUnavailable && address.state === 'VIC' && !blockers.some((b) => b.code === 'victoria_compliance')) blockers.push({ code: 'victoria_compliance', message: 'The advertising sign-off could not be checked just now. Try again shortly.' });
  }
  return {
    fieldErrors, errors, blockers, warnings, slug,
    complete: complete() && errors.length === 0,
    preview: { ...buildPreview(content, address, display, ctx), investment: ctx.draft ? approvalState(ctx.draft).state : (content.investment ? 'unapproved' : 'none') },
  };
}

function buildPreview(content, address, display, ctx) {
  const paras = paragraphs(content.description);
  const suburb = address?.suburb ?? '';
  const mode = content.pricingMode;
  const pricing = mode ? (display && (mode === 'asking_price' || mode === 'price_guide') ? core.pricingLine({ mode, display }) : core.PRICING_MODE_LABEL[mode]) : null;
  const design = (ctx.designCategories ?? []).map((d) => core.DESIGN_LABEL[d] ?? d);
  return {
    title: content.title || (suburb ? `SDA property, ${suburb}` : ''),
    titleIsDefault: !content.title,
    summary: (() => { const first = core.firstParagraph(paras); return first ? (first.length <= 200 ? first : `${first.slice(0, 200).replace(/\s+\S*$/, '')}...`) : ''; })(),
    description: paras,
    // the description as the listing page shows it (paragraphs, headings, lists), so the private preview matches the public one
    blocks: core.parseDescription(paras),
    addressLine: address ? core.formatPublicAddress(address) : content.publicAddress || '',
    pricing, design, buildType: ctx.buildType ?? null, status: 'Available', featured: content.featured, photos: 0,
  };
}
