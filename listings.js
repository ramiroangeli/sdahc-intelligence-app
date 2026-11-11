/* ============================================================================
   WEBSITE > LISTINGS
   Dashboard, property picker, draft editor and private preview.
   Talks ONLY to this app's own /api/listings endpoints with the user's Supabase session token. It holds no Notion,
   GitHub, Blob or database credentials, and it renders every server value as plain text, never as markup.
   Drafts are private: nothing here can change the public website.
   Routes (hash): #/listings  #/listings/new  #/listings/draft/<id>  #/listings/draft/<id>/preview
   ============================================================================ */

const LS = { me: null, list: null, listError: null, listLoading: false, picker: null, pickerQ: '', pickerError: null, confirm: null,
  d: null, jobs: null, jobErr: null, jobBusy: false, jobFlash: null, historyOpen: false, dErr: null, dirty: false, saving: false, form: null, live: null, flash: null, notionConflict: null, verifyOpen: null };
let lsTimer = null;

function lsEl(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') node.value = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
}

async function lsApi(method, path, body) {
  const { data } = await getCurrentSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw Object.assign(new Error('unauthenticated'), { status: 401, body: null });
  const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store' });
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) throw Object.assign(new Error((json && json.error) || 'request_failed'), { status: res.status, body: json });
  return json;
}

const lsRoute = () => {
  const h = location.hash || '';
  let m = /^#\/listings\/draft\/(lst_[a-f0-9]{10})(\/preview|\/review)?$/.exec(h);
  if (m) return { name: 'draft', id: m[1], tab: m[2] === '/preview' ? 'preview' : m[2] === '/review' ? 'review' : 'edit' };
  if (h === '#/listings/new') return { name: 'new' };
  return { name: 'list' };
};
const lsGo = (hash) => { if (location.hash === hash) lsPaint(); else location.hash = hash; };
const lsRoot = () => document.getElementById('view-listings');
const lsActive = () => { const r = lsRoot(); return r && r.classList.contains('active'); };

window.addEventListener('hashchange', () => { if (lsActive()) lsRouteChanged(); });

function renderListingsPage() { lsRouteChanged(); }

async function lsRouteChanged() {
  lsStopPolling(); LS.jobFlash = null;
  LS.flash = null; LS.notionConflict = null; LS.verifyOpen = null; LS.confirm = null; LS.photoMsg = null; LS.removeAsk = null; LS.statusChoice = null; LS.soldConfirmed = false; LS.withdrawOpen = false; LS.withdrawReason = ''; LS.withdrawAddress = '';
  const r = lsRoute();
  if (r.name === 'list') return lsLoadList();
  if (r.name === 'new') return lsLoadPicker();
  return lsLoadDraft(r.id);
}

/* ------------------------------------------------------------------ shared pieces */
const DEPLOY_LABEL = { live: ['Live', 'ls-badge-live'], not_live: ['Not responding', 'ls-badge-warn'], unknown: ['Unconfirmed', 'ls-badge-muted'], not_published: ['Not on website', 'ls-badge-muted'], withdrawn: ['Withdrawn', 'ls-badge-bad'] };
const COMMERCIAL_LABEL = { available: 'Available', under_offer: 'Under offer', sold: 'Sold' };
/* TWO separate things, never merged into one status:
   PUBLICATION state: is the listing on the website, and does the website match the saved draft?
   COMMERCIAL status: what the public page says about the sale (only meaningful once published). A listing can be Live AND Under offer. */
const PUBLICATION_LABEL = { draft: 'Draft', ready: 'Ready to publish', publishing: 'Publishing', live: 'Live', live_changes: 'Live, changes not published', withdrawn: 'Withdrawn' };
const PUBLICATION_CLASS = { draft: 'ls-badge-draft', ready: 'ls-badge-notion', publishing: 'ls-badge-warn', live: 'ls-badge-live', live_changes: 'ls-badge-warn', withdrawn: 'ls-badge-bad' };
const COMMERCIAL_CLASS = { available: 'ls-badge-live', under_offer: 'ls-badge-warn', sold: 'ls-badge-draft' };
const publicationBadge = (state) => badge(PUBLICATION_LABEL[state] || 'Draft', PUBLICATION_CLASS[state] || 'ls-badge-muted');
const commercialBadge = (status) => (COMMERCIAL_LABEL[status] ? badge(COMMERCIAL_LABEL[status], COMMERCIAL_CLASS[status]) : null);
const badge = (text, cls) => lsEl('span', { class: 'ls-badge ' + cls, text });
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function errorPanel(status, retry) {
  const msg = status === 401 || status === 403 ? 'You do not have access to this. Ask an administrator to check your Listings permissions.'
    : status === 503 ? 'This part of the Listings service is not configured yet. An administrator needs to finish the setup.'
    : status === 404 ? 'That draft was not found. It may have been discarded.'
    : 'The Listings service could not be reached. Please try again.';
  return lsEl('div', { class: 'panel ls-state', role: 'alert' }, lsEl('h2', { text: 'Unavailable' }), lsEl('p', { text: msg }),
    lsEl('div', { class: 'ls-actions ls-center' }, retry ? lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: retry, text: 'Try again' }) : null,
      lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => lsGo('#/listings'), text: 'Back to Listings' })));
}
const back = (text, hash) => lsEl('a', { class: 'ls-back', href: hash, text });

/* ------------------------------------------------------------------ dashboard */
async function lsLoadList() {
  LS.listLoading = true; LS.listError = null; lsPaint();
  try {
    const [me, list] = await Promise.all([lsApi('GET', '/api/listings/me'), lsApi('GET', '/api/listings')]);
    LS.me = me; LS.list = list;
  } catch (e) { LS.listError = e.status || 0; }
  LS.listLoading = false; lsPaint();
}

function listingRow(l) {
  const [dLabel, dClass] = DEPLOY_LABEL[l.deployment.state] || DEPLOY_LABEL.unknown;
  const siteCell = lsEl('td', null, l.draft && !l.website ? badge('Draft, not published', 'ls-badge-draft') : badge(dLabel, dClass),
    l.deployment.checkedAt ? lsEl('div', { class: 'ls-sub', text: 'Checked ' + new Date(l.deployment.checkedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) }) : null);
  const draftCell = lsEl('td', null, l.draft
    ? lsEl('div', null, lsEl('a', { class: 'ls-link-strong', href: '#/listings/draft/' + l.id, text: 'Draft v' + l.draft.version }),
        lsEl('div', { class: 'ls-sub', text: l.draft.fieldsFilled + ' of ' + l.draft.fieldsTotal + ' fields, ' + (l.draft.photoCount || 0) + ' photos, saved by ' + l.draft.updatedBy.split('@')[0] + ' ' + when(l.draft.updatedAt) }),
        l.draft.openNotes ? lsEl('div', { class: 'ls-sub ls-warn-text', text: l.draft.openNotes + ' open verification note' + (l.draft.openNotes > 1 ? 's' : '') }) : null)
    : lsEl('span', { class: 'ls-sub', text: 'None' }));
  const tr = lsEl('tr', null,
    lsEl('td', null, lsEl('div', { class: 'ls-name', text: l.name }), lsEl('div', { class: 'ls-sub', text: [l.state, l.designCategories.join(', '), l.buildType].filter(Boolean).join(' · ') })),
    lsEl('td', null, l.notion ? badge(l.notion.status, 'ls-badge-notion') : badge('Not set', 'ls-badge-muted')),
    siteCell,
    lsEl('td', null, l.website && !l.deployment.state.startsWith('withdrawn') ? commercialBadge(l.website.commercialStatus) : null),
    lsEl('td', null, l.website && l.website.url ? lsEl('a', { class: 'ls-link', href: l.website.url, target: '_blank', rel: 'noopener noreferrer', text: '/opportunities/' + l.website.slug + '/' }) : null),
    draftCell);
  const rows = [tr];
  if (l.notes.length) rows.push(lsEl('tr', { class: 'ls-note-row' }, lsEl('td', { colspan: '6' }, lsEl('ul', { class: 'ls-notes' }, l.notes.map((n) => lsEl('li', { text: n }))))));
  return rows;
}

function paintList(root) {
  if (LS.listLoading && !LS.list) { root.append(lsEl('div', { class: 'panel ls-state', text: 'Loading website listings...' })); return; }
  if (LS.listError) { root.append(errorPanel(LS.listError, lsLoadList)); return; }
  const d = LS.list;
  const canEdit = LS.me && LS.me.canEdit;
  const warns = [];
  if (d.sources.notion.state === 'not_configured') warns.push('Notion is not connected to this service, so only what is already on the website is shown.');
  if (d.sources.notion.state === 'error') warns.push(d.sources.notion.message + '. Showing the website state only.');
  if (d.sources.website.state === 'error') warns.push(d.sources.website.message + '. Live status cannot be confirmed.');
  if (d.sources.website.state === 'warning') warns.push(d.sources.website.message);
  if (d.sources.drafts && d.sources.drafts.state === 'error') warns.push('Drafts could not be read right now.');
  if (d.sources.drafts && d.sources.drafts.state === 'not_configured') warns.push('Drafts are not enabled yet: the drafts database is not configured.');
  root.append(lsEl('div', { class: 'panel' },
    lsEl('div', { class: 'panel-head' },
      lsEl('div', null, lsEl('h2', { class: 'panel-title', text: 'Listings' }),
        lsEl('div', { class: 'panel-sub', text: 'What is on the website, and what is being prepared for it. Nothing changes on the website until you publish.' })),
      lsEl('div', { class: 'ls-actions' },
        lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: lsLoadList, text: LS.listLoading ? 'Checking...' : 'Refresh' }),
        lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-add-btn', disabled: !canEdit, title: canEdit ? '' : 'You need the Editor capability to add a listing', onclick: () => lsGo('#/listings/new'), text: 'Add listing' }))),
    warns.length ? lsEl('div', { class: 'ls-banner', role: 'status' }, warns.map((m) => lsEl('div', { text: m }))) : null,
    d.listings.length === 0
      ? lsEl('div', { class: 'ls-state', text: 'No properties are on the website or in draft yet.' })
      : lsEl('div', { class: 'table-wrap ls-table-wrap' }, lsEl('table', { class: 'deals-table ls-table' },
          lsEl('thead', null, lsEl('tr', null, ['Property', 'CRM status', 'Website', 'Selling status', 'Page', 'Draft'].map((h) => lsEl('th', { scope: 'col', text: h })))),
          lsEl('tbody', null, d.listings.map(listingRow)))),
    lsEl('div', { class: 'ls-foot', text: 'Generated ' + new Date(d.generatedAt).toLocaleString('en-AU') + '.' })));
}

/* ------------------------------------------------------------------ property picker */
async function lsLoadPicker() {
  LS.pickerError = null; LS.picker = LS.picker || null; lsPaint();
  try { if (!LS.me) LS.me = await lsApi('GET', '/api/listings/me'); LS.picker = (await lsApi('GET', '/api/listings/properties?q=' + encodeURIComponent(LS.pickerQ))).properties; } catch (e) { LS.pickerError = e.status || 0; }
  lsPaint();
}

function paintPicker(root) {
  if (LS.pickerError) { root.append(errorPanel(LS.pickerError, lsLoadPicker)); return; }
  const search = lsEl('input', { type: 'search', class: 'ls-input', id: 'ls-search', placeholder: 'Search the CRM by address', value: LS.pickerQ, 'aria-label': 'Search properties',
    oninput: (e) => { LS.pickerQ = e.target.value; clearTimeout(lsTimer); lsTimer = setTimeout(async () => { try { LS.picker = (await lsApi('GET', '/api/listings/properties?q=' + encodeURIComponent(LS.pickerQ))).properties; } catch (x) { LS.pickerError = x.status || 0; } lsPaintKeepFocus(); }, 350); } });
  const rows = (LS.picker || []).map((p) => {
    const asking = LS.confirm === p.id;
    const canAdopt = p.onWebsite && !p.hasDraft && LS.me && LS.me.canEdit && LS.me.canPublish;
    const action = canAdopt ? lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.confirm = p.id; lsPaint(); }, text: 'Import published listing' })
      : p.onWebsite && p.hasDraft ? lsEl('a', { class: 'btn btn-secondary btn-sm', href: '#/listings/draft/' + p.id, text: 'Open draft' })
      : p.onWebsite ? badge('Already on website', 'ls-badge-live')
      : p.hasDraft ? lsEl('a', { class: 'btn btn-secondary btn-sm', href: '#/listings/draft/' + p.id, text: 'Open draft' })
      : lsEl('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { LS.confirm = p.id; lsPaint(); }, text: 'Create draft' });
    const tr = lsEl('tr', null,
      lsEl('td', null, lsEl('div', { class: 'ls-name', text: p.name }), lsEl('div', { class: 'ls-sub', text: [p.state, p.designCategories.join(', '), p.buildType].filter(Boolean).join(' · ') })),
      lsEl('td', null, badge(p.notionStatus, 'ls-badge-notion')), lsEl('td', null, action));
    if (!asking) return [tr];
    return [tr, lsEl('tr', { class: 'ls-confirm-row' }, lsEl('td', { colspan: '3' }, lsEl('div', { class: 'ls-confirm' },
      lsEl('strong', { text: (p.onWebsite ? 'Import the published listing for ' : 'Create a website draft for ') + p.name + '?' }),
      lsEl('span', { text: p.onWebsite ? ' This copies the listing exactly as it is on the website, with its photographs, into a draft you can then edit and publish as an update. The website and the Notion record are not changed.' : ' Check the house or unit number: a neighbouring property may look the same. The Notion record is not changed.' }),
      lsEl('div', { class: 'ls-actions' },
        lsEl('button', { class: 'btn btn-primary btn-sm', type: 'button', id: 'ls-confirm-create', onclick: () => lsCreate(p.id, p.onWebsite), text: p.onWebsite ? 'Yes, import it' : 'Yes, create draft' }),
        lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.confirm = null; lsPaint(); }, text: 'Cancel' })))))];
  });
  root.append(lsEl('div', { class: 'panel' },
    lsEl('div', { class: 'panel-head' }, lsEl('div', null, back('Back to Listings', '#/listings'), lsEl('h2', { class: 'panel-title', text: 'Add listing' }),
      lsEl('div', { class: 'panel-sub', text: 'Choose a property from the CRM. The CRM is never changed, and nothing goes on the website until you publish.' }))),
    lsEl('div', { class: 'ls-pad' }, search),
    LS.flash ? lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert', text: LS.flash }) : null,
    LS.picker == null ? lsEl('div', { class: 'ls-state', text: 'Loading properties...' })
      : LS.picker.length === 0 ? lsEl('div', { class: 'ls-state', text: 'No properties match.' })
      : lsEl('div', { class: 'table-wrap' }, lsEl('table', { class: 'deals-table ls-table' },
          lsEl('thead', null, lsEl('tr', null, ['Property (CRM address)', 'CRM status', ''].map((h) => lsEl('th', { scope: 'col', text: h })))),
          lsEl('tbody', null, rows)))));
}

async function lsCreate(propertyId, adopt) {
  try { const d = await lsApi('POST', '/api/listings/draft', adopt ? { propertyId, importPublished: true } : { propertyId }); LS.d = d; lsGo('#/listings/draft/' + d.draft.id); }
  catch (e) {
    LS.flash = adopt && e.status === 409 ? 'The published listing could not be imported (' + e.message.replace(/_/g, ' ') + '). Nothing was changed.' : adopt && e.status === 403 ? 'Importing a published listing needs the Editor and Publisher capabilities.' : adopt ? 'The published listing could not be imported. Nothing was changed; try again.'
      : e.status === 409 && e.message === 'already_published' ? 'That property is already on the website.' : e.status === 409 ? 'A draft already exists for that property.' : e.status === 403 ? 'You need the Editor capability.' : 'The draft could not be created (' + e.message + ').';
    LS.confirm = null; lsPaint();
  }
}

/* ------------------------------------------------------------------ draft editor */
async function lsLoadDraft(id) {
  LS.dErr = null; if (!LS.d || LS.d.draft.id !== id) LS.historyOpen = false; LS.d = LS.d && LS.d.draft.id === id ? LS.d : null; LS.dirty = false; lsPaint();
  try { if (!LS.me) LS.me = await lsApi('GET', '/api/listings/me'); LS.d = await lsApi('GET', '/api/listings/draft?id=' + id); LS.form = { ...LS.d.draft.content }; LS.live = LS.d; if (lsRoute().tab === 'review') await lsLoadJobs(); }
  catch (e) { LS.dErr = e.status || 0; }
  lsPaint();
}

const FIELD_HELP = {
  title: 'Optional. Leave blank to use "SDA property, <suburb>". 5 to 90 characters.',
  description: 'The only text published. Separate paragraphs with a blank line. Do not include house numbers, prices, income or contact details.',
  publicAddress: 'Street name, suburb, state, postcode. Never a house or unit number.',
};

function fieldErrs(name) { const e = LS.live && LS.live.validation.fieldErrors[name]; return e ? lsEl('ul', { class: 'ls-ferr', 'data-for': name }, e.map((m) => lsEl('li', { text: m }))) : lsEl('ul', { class: 'ls-ferr', 'data-for': name }); }
const readOnly = () => !(LS.d && LS.d.permissions.canEdit);

function field(label, name, input, help) {
  return lsEl('div', { class: 'ls-field' }, lsEl('label', { for: 'ls-f-' + name, class: 'ls-label', text: label }), input, help ? lsEl('div', { class: 'ls-help', text: help }) : null, fieldErrs(name));
}

function onEdit(name, get) {
  return (e) => { LS.form[name] = get(e); LS.dirty = true; lsMarkDirty(); clearTimeout(lsTimer); lsTimer = setTimeout(lsLive, 700); };
}

async function lsLive() {
  if (!LS.d) return;
  try { LS.live = await lsApi('PUT', '/api/listings/draft', { id: LS.d.draft.id, content: LS.form, dryRun: true }); } catch (e) { return; }
  lsRefreshLive();
}

function lsMarkDirty() { const el = document.getElementById('ls-save-state'); if (el) el.textContent = 'Unsaved changes'; const b = document.getElementById('ls-save-btn'); if (b) b.disabled = readOnly() || LS.saving; }

function lsRefreshLive() {
  for (const ul of document.querySelectorAll('ul.ls-ferr')) {
    const e = LS.live.validation.fieldErrors[ul.getAttribute('data-for')] || [];
    ul.replaceChildren(...e.map((m) => lsEl('li', { text: m })));
  }
  const side = document.getElementById('ls-side');
  if (side) side.replaceChildren(...sideContent(lsRoute().tab));
  const pv = document.getElementById('ls-preview-host');
  if (pv) pv.replaceChildren(previewContent());
}

async function lsSave(acknowledge) {
  if (LS.saving) return;
  LS.saving = true; LS.flash = null; lsMarkDirty();
  try {
    const d = await lsApi('PUT', '/api/listings/draft', { id: LS.d.draft.id, expectedVersion: LS.d.draft.version, content: LS.form, ...(acknowledge ? { acknowledgeNotionChange: true } : {}) });
    LS.d = d; LS.live = d; LS.form = { ...d.draft.content }; LS.dirty = false; LS.notionConflict = null; LS.flash = { ok: 'Draft saved (version ' + d.draft.version + ').' };
  } catch (e) {
    if (e.status === 409 && e.message === 'notion_changed') LS.notionConflict = (e.body && e.body.changed) || [];
    else if (e.status === 409) LS.flash = { bad: 'Someone else saved this draft first. Reload to see their version. Your text is still on screen so you can copy it.', reload: true };
    else LS.flash = { bad: 'Could not save (' + e.message + ').' };
  }
  LS.saving = false; lsPaint();
}

async function lsAddNote() {
  const ta = document.getElementById('ls-note-text'); const text = ta && ta.value.trim();
  if (!text) return;
  try { const d = await lsApi('PUT', '/api/listings/draft', { id: LS.d.draft.id, expectedVersion: LS.d.draft.version, content: LS.d.draft.content, addNote: text }); LS.d = d; LS.live = d; LS.flash = { ok: 'Verification note added.' }; }
  catch (e) { LS.flash = e.status === 409 && e.message === 'notion_changed' ? { bad: 'The Notion record changed. Save the draft first to review it.' } : { bad: 'Could not add the note (' + e.message + ').' }; }
  lsPaint();
}

async function lsVerify(item) {
  const ta = document.getElementById('ls-verify-text'); const note = ta && ta.value.trim();
  if (!note || note.length < 5) { LS.flash = { bad: 'Write what was checked (at least 5 characters).' }; lsPaint(); return; }
  try { const srcEl = document.getElementById('ls-verify-source'); const source = srcEl && srcEl.value.trim(); const body = { id: LS.d.draft.id, expectedVersion: LS.d.draft.version, note, ...(source && !item.id ? { source } : {}), ...(item.id ? { noteId: item.id } : { code: item.code }) }; LS.d = await lsApi('POST', '/api/listings/draft-verify', body); LS.live = LS.d; LS.verifyOpen = null; LS.flash = { ok: 'Recorded.' }; }
  catch (e) { LS.flash = { bad: 'Could not record it (' + e.message + ').' }; }
  lsPaint();
}

function sideContent(tab) {
  const v = LS.live.validation; const ver = LS.live.verification; const p = LS.d.property; const nodes = [];
  // readiness
  const items = [
    ['Required fields complete', v.complete],
    ['Photographs added', !v.blockers.some((b) => b.code === 'photos_required')],
    ['Photographs added, descriptions pass the checks', LS.live.photos ? LS.live.photos.items.length > 0 && LS.live.photos.items.every((x) => x.issues.length === 0) : false],
    ['Commercial verification clear', ver.open === 0],
    ['Advertising sign-off', !v.blockers.some((b) => b.code === 'victoria_compliance' || b.code === 'basic_classification')],
  ];
  nodes.push(lsEl('div', { class: 'ls-card' }, lsEl('h3', { text: 'Before you publish' }),
    lsEl('div', { class: 'ls-ready ' + (v.publishable ? 'ok' : 'no'), text: v.publishable ? 'Ready for publication review' : 'Not ready to publish' }),
    lsEl('ul', { class: 'ls-check' }, items.map(([t, ok]) => lsEl('li', { class: ok ? 'ok' : 'no' }, lsEl('span', { 'aria-hidden': 'true', text: ok ? '✓' : '○' }), ' ', t))),
    v.errors.length ? lsEl('div', { class: 'ls-errs' }, lsEl('strong', { text: 'To fix' }), lsEl('ul', null, v.errors.map((e) => lsEl('li', { text: e.message })))) : null,
    v.blockers.length ? lsEl('div', { class: 'ls-blocks', id: 'ls-signoff' }, lsEl('strong', { text: 'Before publication' }), lsEl('ul', null, v.blockers.map((b) => lsEl('li', { text: b.message })))) : null,
    v.warnings.length ? lsEl('div', { class: 'ls-sub', text: v.warnings.map((w) => w.message).join(' ') }) : null,
    v.slug ? lsEl('div', { class: 'ls-sub', text: 'Website path: /opportunities/' + v.slug + '/' }) : null));
  // verification
  const all = [...ver.system, ...ver.notes];
  nodes.push(lsEl('div', { class: 'ls-card' }, lsEl('h3', { text: 'Notes for review' }),
    all.length === 0 ? lsEl('div', { class: 'ls-sub', text: 'Nothing flagged.' }) : lsEl('ul', { class: 'ls-ver' }, all.map((i) => verifyItem(i))),
    !readOnly() ? lsEl('div', { class: 'ls-note-add' }, lsEl('textarea', { id: 'ls-note-text', class: 'ls-input', rows: '2', maxlength: '500', placeholder: 'Add a note for something to verify, for example an advertised figure that differs from the CRM' }),
      lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', id: 'ls-note-btn', onclick: lsAddNote, text: 'Add verification note' })) : null));
  // facts
  nodes.push(lsEl('div', { class: 'ls-card' }, lsEl('h3', { text: 'From the CRM' }),
    lsEl('dl', { class: 'ls-facts' }, [
      ['Property', p.fullName], ['State', p.state || 'Not set'], ['Design category', p.designCategories.join(', ') || 'Not set'], ['Build type', p.buildType || 'Not set'],
      ['Features', p.features.join(', ') || 'None'], ['CRM occupancy', p.occupancy ? p.occupancy.occupied + ' of ' + p.occupancy.places + ' places' : 'Not stated'], ['CRM status', p.notionStatus],
    ].map(([k, val]) => [lsEl('dt', { text: k }), lsEl('dd', { text: val })])),
    lsEl('div', { class: 'ls-sub', text: 'Reference only: this is never published. Prices, income and other financial fields are not shown or editable here.' })));
  // history
  // History: collapsed by default, one click to open or close. The heading (a real button) stays visible. Content is unchanged.
  const hOpen = !!LS.historyOpen;
  nodes.push(lsEl('section', { class: 'ls-card ls-card-history' + (hOpen ? ' open' : ''), id: 'ls-history' },
    lsEl('h3', { class: 'ls-hist-h' }, lsEl('button', { type: 'button', class: 'ls-hist-toggle', id: 'ls-hist-toggle', 'aria-expanded': hOpen ? 'true' : 'false', 'aria-controls': 'ls-hist-panel', onclick: lsToggleHistory },
      lsEl('span', { text: 'History' }), lsEl('span', { class: 'ls-hist-count', text: String(LS.d.history.length) }), lsEl('span', { class: 'ls-hist-chev', 'aria-hidden': 'true' }))),
    lsEl('div', { id: 'ls-hist-panel', class: 'ls-hist-panel', role: 'region', 'aria-labelledby': 'ls-hist-toggle', hidden: !hOpen },
      lsEl('ul', { class: 'ls-hist' }, LS.d.history.map((h) => lsEl('li', null, lsEl('strong', { text: 'v' + h.version + ' ' + h.action }), ' ', h.by.split('@')[0], ' ', when(h.at), h.fields.length ? lsEl('div', { class: 'ls-sub', text: h.fields.join(', ') }) : null))))));
  // Prepare: what is missing, and the CRM reference. Preview and check: what is missing, the notes for review, and the history. Never the same card twice.
  const pick = tab === 'preview' ? [0, 1, 3] : [0, 2];
  return pick.map((i) => nodes[i]);
}

function lsToggleHistory() {
  LS.historyOpen = !LS.historyOpen;
  const card = document.getElementById('ls-history'); const btn = document.getElementById('ls-hist-toggle'); const panel = document.getElementById('ls-hist-panel');
  if (card) card.classList.toggle('open', LS.historyOpen);
  if (btn) btn.setAttribute('aria-expanded', LS.historyOpen ? 'true' : 'false');
  if (panel) panel.hidden = !LS.historyOpen;
}

function verifyItem(i) {
  const open = i.status === 'open';
  const canVerify = LS.d.permissions.canPublish && open && (i.severity === 'verify');
  const asking = LS.verifyOpen === i.code;
  return lsEl('li', { class: 'ls-ver-item ' + (open ? (i.severity === 'error' ? 'bad' : 'open') : 'done') },
    lsEl('div', null, badge(open ? (i.severity === 'error' ? 'Fix' : 'Open') : (i.status === 'resolved' ? 'Resolved' : 'Verified'), open ? (i.severity === 'error' ? 'ls-badge-bad' : 'ls-badge-warn') : 'ls-badge-live'), ' ', i.text),
    !open && (i.verifiedBy || i.resolvedBy) ? lsEl('div', { class: 'ls-sub' }, (i.verifiedBy || i.resolvedBy).split('@')[0] + ' ' + when(i.verifiedAt || i.resolvedAt) + (i.note ? ': ' + i.note : ''), i.source && /^https:\/\//.test(i.source) ? [' Source: ', lsEl('a', { href: i.source, target: '_blank', rel: 'noopener noreferrer', class: 'ls-link', text: 'link' })] : null) : null,
    canVerify && !asking ? lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.verifyOpen = i.code; lsPaint(); }, text: i.id ? 'Mark resolved' : 'Mark verified' }) : null,
    canVerify && asking ? lsEl('div', { class: 'ls-note-add' }, lsEl('textarea', { id: 'ls-verify-text', class: 'ls-input', rows: '2', maxlength: '500', placeholder: 'What was accepted, and on what basis?' }),
      i.id ? null : lsEl('input', { id: 'ls-verify-source', class: 'ls-input', type: 'url', maxlength: '300', placeholder: 'Source link (optional), e.g. the approved advertisement' }),
      lsEl('div', { class: 'ls-actions' }, lsEl('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => lsVerify(i), text: 'Record' }), lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.verifyOpen = null; lsPaint(); }, text: 'Cancel' }))) : null);
}

function editForm() {
  const ro = readOnly(); const f = LS.form;
  const mode = f.pricingMode; const needsPrice = mode === 'asking_price' || mode === 'price_guide';
  const priceField = lsEl('div', { id: 'ls-price-wrap', class: needsPrice ? '' : 'ls-hidden' },
    field('Price shown (AUD)', 'displayPrice', lsEl('input', { id: 'ls-f-displayPrice', class: 'ls-input', type: 'text', inputmode: 'numeric', value: f.displayPrice, disabled: ro, placeholder: 'e.g. 695000', oninput: onEdit('displayPrice', (e) => e.target.value) }), 'A single approved public amount. Price ranges are not supported yet. The CRM price is never used.'));
  const sel = lsEl('select', { id: 'ls-f-pricingMode', class: 'ls-input', disabled: ro, onchange: (e) => { LS.form.pricingMode = e.target.value; LS.dirty = true; document.getElementById('ls-price-wrap').classList.toggle('ls-hidden', !(e.target.value === 'asking_price' || e.target.value === 'price_guide')); lsMarkDirty(); clearTimeout(lsTimer); lsTimer = setTimeout(lsLive, 300); } },
    lsEl('option', { value: '', text: 'Choose...' }), ...[['asking_price', 'Asking Price'], ['price_guide', 'Price Guide'], ['eoi', 'Expressions of Interest'], ['contact_agent', 'Contact Agent']].map(([k, t]) => lsEl('option', { value: k, text: t, selected: mode === k })));
  const sugg = LS.d.property.suggestedPublicAddress;
  return lsEl('div', { class: 'ls-form' },
    field('Title', 'title', lsEl('input', { id: 'ls-f-title', class: 'ls-input', type: 'text', maxlength: '200', value: f.title, disabled: ro, oninput: onEdit('title', (e) => e.target.value) }), FIELD_HELP.title),
    field('Description', 'description', lsEl('textarea', { id: 'ls-f-description', class: 'ls-input', rows: '11', disabled: ro, oninput: onEdit('description', (e) => e.target.value), text: f.description }), FIELD_HELP.description),
    field('Address shown on the website', 'publicAddress', lsEl('input', { id: 'ls-f-publicAddress', class: 'ls-input', type: 'text', value: f.publicAddress, disabled: ro, placeholder: 'Street Name, Suburb VIC 3000', oninput: onEdit('publicAddress', (e) => e.target.value) }), FIELD_HELP.publicAddress),
    !ro && sugg && sugg !== f.publicAddress ? lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.form.publicAddress = sugg; LS.dirty = true; lsPaint(); lsLive(); }, text: 'Use suggested: ' + sugg }) : null,
    lsEl('div', { class: 'ls-row' }, field('Price shown as', 'pricingMode', sel), priceField),
    lsEl('label', { class: 'ls-check-row' }, lsEl('input', { type: 'checkbox', id: 'ls-f-featured', checked: f.featured, disabled: ro, onchange: (e) => { LS.form.featured = e.target.checked; LS.dirty = true; lsMarkDirty(); } }), ' Show this listing first on the website (featured)'),
    photosSection());
}

function previewContent() {
  const pv = LS.live.preview;
  const ph = LS.live.photos || LS.d.photos; const order = ph.items; /* the stored array order IS the public order */
  const lead = order.length && order[0].kind !== 'floorplan' ? order[0] : null;
  const card = lsEl('div', { class: 'ls-pv-card' }, lead ? lsEl('div', { class: 'ls-pv-photo ls-pv-img' }, lsPhotoImg(lead.id, 960, lead.altText)) : lsEl('div', { class: 'ls-pv-photo', text: 'No photograph yet' }),
    lsEl('div', { class: 'ls-pv-body' }, lsEl('div', { class: 'ls-pv-chips' }, badge(pv.status, 'ls-badge-live'), ...pv.design.map((d) => badge(d, 'ls-badge-notion')), pv.featured ? badge('Featured', 'ls-badge-draft') : null),
      lsEl('h4', { text: pv.title || '(no title yet)' }), lsEl('div', { class: 'ls-pv-addr', text: pv.addressLine || '(no address yet)' }), lsEl('div', { class: 'ls-pv-price', text: pv.pricing || '(no pricing mode yet)' }),
      lsEl('p', { text: pv.summary || '(no description yet)' })));
  const detail = lsEl('div', { class: 'ls-pv-detail' }, order.length ? lsEl('div', { class: 'ls-pv-gallery' }, lsEl('div', { class: 'ls-pv-photo ls-pv-photo-lg ls-pv-img' }, lsPhotoImg(order[0].id, 1600, order[0].altText)),
      order.length > 1 ? lsEl('div', { class: 'ls-pv-thumbs' }, order.slice(1).map((x) => lsEl('div', { class: 'ls-pv-thumb' + (x.kind === 'floorplan' ? ' ls-pv-plan' : '') }, lsPhotoImg(x.id, 480, x.altText), x.kind === 'floorplan' ? lsEl('span', { class: 'ls-ph-flag ls-ph-flag-plan', text: 'Floorplan' }) : null))) : null) : lsEl('div', { class: 'ls-pv-photo ls-pv-photo-lg', text: 'No photographs yet' }),
    lsEl('h3', { text: pv.title || '(no title yet)' }), lsEl('div', { class: 'ls-pv-addr', text: pv.addressLine || '(no address yet)' }),
    lsEl('div', { class: 'ls-pv-price', text: pv.pricing || '(no pricing mode yet)' }),
    lsEl('div', { class: 'ls-pv-facts' }, pv.design.length ? lsEl('span', { text: 'Design category: ' + pv.design.join(', ') }) : null, pv.buildType ? lsEl('span', { text: 'Building: ' + pv.buildType }) : null),
    ...(pv.description.length ? pv.description.map((t) => lsEl('p', { text: t })) : [lsEl('p', { class: 'ls-sub', text: '(no description yet)' })]));
  return lsEl('div', null,
    lsEl('div', { class: 'ls-banner' }, 'Private preview. This is how the card and detail page will read, built from your current text. It is not on the website. Photographs shown here are private staged copies.'),
    lsEl('div', { class: 'ls-pv-grid' }, lsEl('div', null, lsEl('h4', { class: 'ls-pv-h', text: 'Listing card' }), card), lsEl('div', null, lsEl('h4', { class: 'ls-pv-h', text: 'Detail page' }), detail)));
}

/** The listing's name is the address visitors see (the CRM address, with its house number, is only a reference line). */
function lsListingName() {
  const c = LS.d && LS.d.draft && LS.d.draft.content;
  return (c && c.publicAddress && c.publicAddress.trim()) || (LS.d && LS.d.property && LS.d.property.suggestedPublicAddress) || (LS.d && LS.d.draft && LS.d.draft.label) || 'Listing';
}

/** The three steps of a listing (Add listing comes before them, Manage after). Each step says where you are and what is done. */
function lsStepper(tab, id) {
  const v = LS.live && LS.live.validation; const jobs = LS.jobs;
  const prepared = !!(v && v.complete && LS.live.photos && LS.live.photos.items.length > 0);
  const checked = !!(v && v.publishable);
  const done = [prepared, checked, !!(jobs && jobs.noChanges) || !!(jobs && jobs.live && !(jobs.changes && jobs.changes.count))];
  const steps = [['edit', 'Prepare', '#/listings/draft/' + id], ['preview', 'Preview and check', '#/listings/draft/' + id + '/preview'], ['review', 'Publish', '#/listings/draft/' + id + '/review']];
  return lsEl('nav', { class: 'ls-steps', 'aria-label': 'Steps' }, steps.map(([key, label, href], i) => lsEl('a', { class: 'ls-step' + (tab === key ? ' active' : '') + (done[i] && tab !== key ? ' done' : ''), href, 'aria-current': tab === key ? 'step' : false },
    lsEl('span', { class: 'ls-step-n', 'aria-hidden': 'true', text: done[i] && tab !== key ? '✓' : String(i + 1) }), ' ', label)));
}
/** Continue: save first when there are unsaved changes (the draft is the only thing that moves forward), then go to the next step. */
async function lsContinue(hash) {
  if (LS.dirty && !readOnly()) await lsSave(false);
  if (!LS.dirty) lsGo(hash);
}
function lsStepFooter(tab, id) {
  const back = (hash) => lsEl('a', { class: 'btn btn-secondary', href: hash, text: 'Back' });
  if (tab === 'edit') return lsEl('div', { class: 'ls-step-footer' }, lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-continue', onclick: () => lsContinue('#/listings/draft/' + id + '/preview'), text: 'Continue to Preview and check' }));
  if (tab === 'preview') return lsEl('div', { class: 'ls-step-footer' }, back('#/listings/draft/' + id), ' ', lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-continue', onclick: () => lsGo('#/listings/draft/' + id + '/review'), text: 'Continue to Publish' }));
  return lsEl('div', { class: 'ls-step-footer' }, back('#/listings/draft/' + id + '/preview'));
}

function paintDraft(root) {
  if (LS.dErr) { root.append(errorPanel(LS.dErr, () => lsLoadDraft(lsRoute().id))); return; }
  if (!LS.d) { root.append(lsEl('div', { class: 'panel ls-state', text: 'Loading draft...' })); return; }
  const r = lsRoute(); const d = LS.d.draft; const ro = readOnly();
  const flash = LS.flash && (LS.flash.ok || LS.flash.bad) ? lsEl('div', { class: 'ls-banner ' + (LS.flash.bad ? 'ls-banner-bad' : 'ls-banner-ok'), role: LS.flash.bad ? 'alert' : 'status' }, LS.flash.ok || LS.flash.bad, LS.flash.reload ? lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => lsLoadDraft(d.id), text: 'Reload' }) : null) : null;
  const conflict = LS.notionConflict ? lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert' },
    lsEl('div', { text: 'The Notion record for this property changed since this draft was based on it (' + LS.notionConflict.join(', ') + '). Review the property facts and wording, then continue.' }),
    lsEl('button', { class: 'btn btn-primary btn-sm', type: 'button', id: 'ls-ack-btn', onclick: () => lsSave(true), text: 'I have reviewed the change: save anyway' })) : null;
  const pendingChange = LS.d.notion.changed.length && !LS.notionConflict ? lsEl('div', { class: 'ls-banner' }, 'The Notion record has changed since this draft started (' + LS.d.notion.changed.join(', ') + '). You will be asked to confirm when you save.') : null;
  root.append(lsEl('div', { class: 'panel' },
    lsEl('div', { class: 'panel-head' },
      lsEl('div', null, back('Back to Listings', '#/listings'), lsEl('h2', { class: 'panel-title', text: lsListingName() }),
        lsEl('div', { class: 'ls-sub', id: 'ls-crm-ref', text: 'From the CRM: ' + LS.d.property.fullName + ' (reference only, never published)' }),
        lsEl('div', { class: 'panel-sub', id: 'ls-ver-label', text: 'Saved by ' + d.updatedBy.split('@')[0] + ' ' + when(d.updatedAt) + '. Changes you save here are not public until you publish.' })),
      r.tab === 'edit' ? lsEl('div', { class: 'ls-actions' }, lsEl('span', { id: 'ls-save-state', class: 'ls-sub', text: ro ? 'Read only' : LS.dirty ? 'Unsaved changes' : 'All changes saved' }),
        ro ? null : lsEl('button', { class: 'btn btn-secondary', type: 'button', id: 'ls-save-btn', disabled: LS.saving, onclick: () => lsSave(false), text: LS.saving ? 'Saving...' : 'Save' })) : null),
    lsStepper(r.tab, d.id),
    flash, conflict, pendingChange,
    ro ? lsEl('div', { class: 'ls-banner', text: 'You have read-only access. Editors can change this draft.' }) : null,
    lsEl('div', { class: 'ls-editor' + (r.tab === 'review' ? ' ls-editor-single' : '') },
      lsEl('div', { class: 'ls-main' }, r.tab === 'edit' ? editForm() : r.tab === 'review' ? reviewContent() : lsEl('div', { id: 'ls-preview-host' }, previewContent()), lsStepFooter(r.tab, d.id)),
      r.tab === 'review' ? null : lsEl('aside', { class: 'ls-side', id: 'ls-side' }, sideContent(r.tab)))));
}


/* ------------------------------------------------------------------ photographs (private staging) */
/* Images are fetched with the user's session and shown from short-lived object URLs: there is no public image URL, and no
   storage credential in this file. Uploaded bytes go to this app's own /api, which checks the file and strips metadata.
   ONE rule orders the gallery, on the server and here: index 0 is the Cover (always a photograph), floorplans are last. */
const PHOTO_MAX_BYTES = 3600000;   /* the server accepts up to 4 MB: larger photos are shrunk in the browser first */
const PHOTO_MAX_SIDE = 2800;
const PHOTO_PARALLEL = 3;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const photoCache = new Map();
LS.photoBusy = null; LS.photoMsg = null; LS.dragId = null; LS.removeAsk = null; LS.queue = []; LS.running = 0; LS.refreshTimer = null;
window.__lsPhotoTimings = window.__lsPhotoTimings || [];

async function lsToken() {
  const { data } = await getCurrentSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  return token;
}
async function lsFetchPhoto(photoId, w) {
  const key = LS.d.draft.id + ':' + photoId + ':' + w;
  if (photoCache.has(key)) return photoCache.get(key);
  const res = await fetch('/api/listings/draft-photo?id=' + LS.d.draft.id + '&photo=' + photoId + '&w=' + w, { headers: { Authorization: 'Bearer ' + await lsToken() }, cache: 'no-store' });
  if (!res.ok) throw new Error('photo_' + res.status);
  const url = URL.createObjectURL(await res.blob());
  photoCache.set(key, url);
  return url;
}
/* An <img> that fills in once the authorised fetch completes. */
function lsPhotoImg(photoId, w, alt, cls) {
  const img = lsEl('img', { class: cls || '', alt: alt || '', loading: 'lazy', draggable: 'false' });
  lsFetchPhoto(photoId, w).then((u) => { img.src = u; }, () => { img.alt = 'Image unavailable'; img.classList.add('ls-img-fail'); img.dispatchEvent(new Event('lsfail')); });
  return img;
}

/* Shrinks a large photograph in the browser (re-encoding also drops its EXIF) so it fits the 4 MB upload limit. Decoding and
   encoding use OffscreenCanvas where the browser has it, which keeps the page responsive. The server still validates and
   strips every file again; this is only a convenience for large camera photos. */
async function lsShrink(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw Object.assign(new Error('read'), { friendly: 'This image could not be read.' });
  const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * k); const H = Math.round(bmp.height * k);
  const enc = async (q) => {
    if (typeof OffscreenCanvas !== 'undefined') { const c = new OffscreenCanvas(W, H); c.getContext('2d').drawImage(bmp, 0, 0, W, H); return c.convertToBlob({ type: 'image/jpeg', quality: q }); }
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(bmp, 0, 0, W, H);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', q));
  };
  let blob = await enc(0.88);
  if (blob && blob.size > PHOTO_MAX_BYTES) blob = await enc(0.74);
  if (bmp.close) bmp.close();
  if (!blob || blob.size > PHOTO_MAX_BYTES + 400000) throw Object.assign(new Error('big'), { friendly: 'Still too large after shrinking. Use a smaller export.' });
  return blob;
}
async function lsPrepareFile(file) {
  if (!PHOTO_TYPES.includes(file.type)) throw Object.assign(new Error('type'), { friendly: 'Only JPG, PNG and WebP images can be added.' });
  if (file.size <= PHOTO_MAX_BYTES) return { blob: file, type: file.type, shrunk: false };
  return { blob: await lsShrink(file), type: 'image/jpeg', shrunk: true };
}

const PHOTO_ERR = {
  unsupported_image_type: 'Only JPG, PNG and WebP images can be added.', image_type_mismatch: 'The file is not the type it claims to be.', image_too_small: 'The image is too small. Use one at least 960 pixels wide.',
  unreadable_image: 'This image could not be read. It may be damaged.', animated_image: 'Animated images are not supported.', duplicate_image: 'That image is already in the gallery.',
  too_many_photos: 'The gallery is full (24 images).', image_too_large: 'The image is too large.', draft_changed: 'Someone else saved this draft first. Reload to see their version.',
  photos_not_configured: 'Photo storage is not set up yet. An administrator needs to finish the setup.', not_configured: 'Photo storage is not set up yet.',
  cover_must_stay_first: 'The cover stays first. Use "Make cover" on another photo to change it.', cover_is_floorplan: 'A floorplan cannot be the cover.',
  no_photographs: 'Add a photograph first.',
};
const photoErrText = (e) => (e.friendly || PHOTO_ERR[e.message] || (e.status === 403 ? 'You do not have permission for that.' : 'The photo change could not be saved (' + e.message + ').'));

/* Take photo data from a server response without disturbing text the person is typing. */
function lsAdoptPhotos(resp) {
  if (!resp || !resp.photos || !LS.d) return;
  if (resp.draft.version < LS.d.draft.version) return; /* an older response that arrived late */
  LS.d.draft.version = resp.draft.version; LS.d.draft.updatedBy = resp.draft.updatedBy; LS.d.draft.updatedAt = resp.draft.updatedAt;
  LS.d.photos = resp.photos;
  if (LS.live) { LS.live.photos = resp.photos; LS.live.draft = LS.d.draft; }
  const sub = document.getElementById('ls-ver-label');
  if (sub) sub.textContent = 'Saved by ' + LS.d.draft.updatedBy.split('@')[0] + ' ' + when(LS.d.draft.updatedAt) + '. Changes you save here are not public until you publish.';
}
/* Validation, history and the preview come from the full draft: fetched in the background, never blocking the gallery. */
function lsScheduleRefresh() {
  clearTimeout(LS.refreshTimer);
  LS.refreshTimer = setTimeout(async () => {
    if (!LS.d || LS.running || LS.photoBusy) return lsScheduleRefresh();
    try {
      const d = await lsApi('GET', '/api/listings/draft?id=' + LS.d.draft.id);
      if (d.draft.version < LS.d.draft.version) return;
      LS.d = d; LS.live = d; if (LS.dirty) lsLive(); else lsRefreshLive();
    } catch (e) { /* the gallery already shows the saved state */ }
  }, 700);
}

/* A file input's `files` is a LIVE list: setting value = '' (needed to allow choosing the same file again) empties it. Copy first,
   then reset. Cancelling the dialog fires no change event, or an empty one: both are no-ops. */
function lsPicked(input) { const files = input && input.files ? Array.from(input.files) : []; if (input) input.value = ''; return files; }
function lsOnPick(e, opts) { const files = lsPicked(e && e.target); if (files.length) lsEnqueue(files, opts); }
/* One persistent, off-screen file input, created once and not rebuilt on repaint, so a repaint while the dialog is open cannot orphan it. */
function lsFileInput() {
  let el = document.getElementById('ls-file-input');
  if (!el) { el = document.createElement('input'); el.type = 'file'; el.id = 'ls-file-input'; el.className = 'ls-offscreen'; el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); el.accept = PHOTO_TYPES.join(','); document.body.append(el); }
  return el;
}
function lsChoose(opts) { const el = lsFileInput(); el.multiple = !(opts && opts.replace); el.onchange = (e) => lsOnPick(e, opts); el.value = ''; el.click(); }

/* ---- upload queue: local thumbnail at once, visible stages, up to three at a time ---- */
function lsEnqueue(files, opts) {
  opts = opts || {};
  for (const file of [...files]) {
    const item = { key: 'q' + Math.random().toString(36).slice(2, 9), file, localUrl: PHOTO_TYPES.includes(file.type) ? URL.createObjectURL(file) : null, state: 'queued', pct: 0, msg: '', replace: opts.replace || null, floorplan: !!opts.floorplan };
    LS.queue.push(item);
  }
  LS.photoMsg = null; lsRefreshPhotos(); lsPump();
}
function lsPump() {
  while (LS.running < PHOTO_PARALLEL) {
    const next = LS.queue.find((q) => q.state === 'queued');
    if (!next) break;
    LS.running += 1; next.state = 'preparing';
    lsRunItem(next).finally(() => { LS.running -= 1; lsPump(); if (!LS.running) { lsRefreshPhotos(); lsScheduleRefresh(); } });
  }
  lsRefreshPhotos();
}
function lsXhr(url, blob, headers, onProgress, onSent) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    x.upload.onload = onSent;
    x.onload = () => { let json = null; try { json = JSON.parse(x.responseText); } catch (e) { /* not JSON */ } resolve({ status: x.status, json }); };
    x.onerror = () => reject(Object.assign(new Error('network'), { friendly: 'The network connection failed. Try again.' }));
    x.ontimeout = x.onerror; x.timeout = 120000;
    x.send(blob);
  });
}
async function lsRunItem(item) {
  const T = { start: performance.now() };
  try {
    item.state = 'preparing'; lsQueueRefresh(item);
    const prep = await lsPrepareFile(item.file); T.prepared = performance.now();
    item.state = 'uploading'; item.pct = 0; lsQueueRefresh(item);
    const url = '/api/listings/draft-photos?id=' + LS.d.draft.id + (item.replace ? '&replace=' + item.replace : '') + (item.floorplan ? '&kind=floorplan' : '');
    const res = await lsXhr(url, prep.blob, { Authorization: 'Bearer ' + await lsToken(), 'Content-Type': 'application/octet-stream', 'X-Image-Type': prep.type },
      (pct) => { item.pct = pct; lsQueueRefresh(item); }, () => { T.sent = performance.now(); item.state = 'processing'; lsQueueRefresh(item); });
    T.done = performance.now();
    if (res.status < 200 || res.status >= 300) throw Object.assign(new Error((res.json && res.json.error) || 'upload_failed'), { status: res.status });
    const rec = { bytes: prep.blob.size, shrunk: prep.shrunk, prepareMs: Math.round(T.prepared - T.start), uploadMs: Math.round((T.sent || T.done) - T.prepared), serverWaitMs: Math.round(T.done - (T.sent || T.done)), totalMs: Math.round(T.done - T.start), server: res.json.timings };
    window.__lsPhotoTimings.push(rec); console.info('photo upload timings', rec);
    lsAdoptPhotos(res.json);
    LS.queue = LS.queue.filter((q) => q !== item);
    if (item.localUrl) setTimeout(() => URL.revokeObjectURL(item.localUrl), 4000);
    LS.photoMsg = { ok: item.replace ? 'Image replaced.' : 'Added. A short description is optional.' };
  } catch (e) {
    item.state = 'failed'; item.msg = e.friendly || PHOTO_ERR[e.message] || 'Could not be added (' + e.message + ').'; lsQueueRefresh(item);
  }
}
function qCard(item) {
  const label = { queued: 'Waiting...', preparing: 'Preparing image...', uploading: 'Uploading ' + item.pct + '%', processing: 'Processing on the server...', failed: item.msg }[item.state] || '';
  return lsEl('li', { class: 'ls-ph ls-ph-queue' + (item.state === 'failed' ? ' ls-ph-failed' : ''), 'data-key': item.key },
    lsEl('div', { class: 'ls-ph-img' }, item.localUrl ? lsEl('img', { src: item.localUrl, alt: 'Selected image (uploading)', draggable: 'false' }) : lsEl('span', { class: 'ls-sub', text: 'Not an image' })),
    lsEl('div', { class: 'ls-ph-body' },
      lsEl('div', { class: 'ls-ph-qstate', role: item.state === 'failed' ? 'alert' : 'status', text: label }),
      item.state === 'failed' ? null : lsEl('div', { class: 'ls-bar' + (item.state === 'processing' || item.state === 'preparing' ? ' ls-bar-ind' : ''), 'aria-hidden': 'true' }, lsEl('span', { style: 'width:' + (item.state === 'uploading' ? item.pct : item.state === 'queued' ? 0 : 100) + '%' })),
      item.state === 'failed' ? lsEl('div', { class: 'ls-ph-actions' },
        lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { item.state = 'queued'; item.msg = ''; lsRefreshPhotos(); lsPump(); }, text: 'Try again' }),
        lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.queue = LS.queue.filter((q) => q !== item); if (item.localUrl) URL.revokeObjectURL(item.localUrl); lsRefreshPhotos(); }, text: 'Dismiss' })) : null));
}
function lsQueueRefresh(item) {
  const el = document.querySelector('[data-key="' + item.key + '"]');
  if (el) el.replaceWith(qCard(item));
}

/* ---- gallery edits: saved at once, with the draft's version check ---- */
async function lsGallerySave(mutate, okText) {
  if (LS.photoBusy || LS.running) return;
  const items = LS.d.photos.items.map((p) => ({ id: p.id, alt: p.alt, kind: p.kind }));
  const next = mutate(items.map((x) => ({ ...x })));
  LS.photoBusy = 'Saving...'; lsRefreshPhotos();
  try {
    const out = await lsApi('PUT', '/api/listings/draft-photos', { id: LS.d.draft.id, expectedVersion: LS.d.draft.version, photos: next.items, ...(next.coverId ? { coverId: next.coverId } : {}) });
    lsAdoptPhotos(out); LS.photoMsg = okText ? { ok: okText } : null;
  } catch (e) { LS.photoMsg = { bad: photoErrText(e) }; }
  LS.photoBusy = null; LS.removeAsk = null; lsRefreshPhotos(); lsScheduleRefresh();
}
/* Movement rules (mirrored by the server): the cover (index 0) never moves down; nothing goes above it; floorplans only move among floorplans. */
const lsGroup = (p) => (p.kind === 'floorplan' ? 'plan' : 'photo');
function lsMoveAllowed(items, id, delta) {
  const i = items.findIndex((x) => x.id === id); const j = i + delta; if (i < 0 || j < 0 || j >= items.length) return false;
  if (i === 0 && lsGroup(items[0]) === 'photo') return false;           /* the cover stays first */
  if (lsGroup(items[i]) !== lsGroup(items[j])) return false;           /* never across photographs and floorplans */
  if (j === 0 && lsGroup(items[0]) === 'photo') return false;          /* nothing above the cover */
  return true;
}
const lsDropAllowed = (items, fromId, toId) => { const f = items.find((x) => x.id === fromId); const t = items.find((x) => x.id === toId); return !!(f && t && fromId !== toId && lsGroup(f) === lsGroup(t) && !(lsGroup(items[0]) === 'photo' && (items[0].id === fromId || items[0].id === toId))); };
const lsSetCover = (id) => lsGallerySave((items) => ({ items, coverId: id }), 'Cover set. It is now first.');
/* Pure reorder helpers: the UI and the tests use the same code. They only run after lsMoveAllowed / lsDropAllowed said yes. */
const lsApplyMove = (items, id, delta) => { const i = items.findIndex((x) => x.id === id); const [it] = items.splice(i, 1); items.splice(i + delta, 0, it); return items; };
const lsApplyDrop = (items, from, targetId) => { const i = items.findIndex((x) => x.id === from); const tOrig = items.findIndex((x) => x.id === targetId); const [it] = items.splice(i, 1); const t = items.findIndex((x) => x.id === targetId); items.splice(i < tOrig ? t + 1 : t, 0, it); return items; };
const lsMove = (id, delta) => lsGallerySave((items) => ({ items: lsApplyMove(items, id, delta) }), 'Order saved.');
const lsDropOn = (targetId) => { const from = LS.dragId; LS.dragId = null; if (!from || !lsDropAllowed(LS.d.photos.items, from, targetId)) return; lsGallerySave((items) => ({ items: lsApplyDrop(items, from, targetId) }), 'Order saved.'); };
const lsSetKind = (id, floor) => lsGallerySave((items) => ({ items: items.map((x) => (x.id === id ? { ...x, kind: floor ? 'floorplan' : 'photo' } : x)) }), floor ? 'Marked as a floorplan: it shows last.' : 'Marked as a photograph.');
const lsSetAlt = (id, alt) => lsGallerySave((items) => ({ items: items.map((x) => (x.id === id ? { ...x, alt } : x)) }), 'Description saved.');
const lsRemovePhoto = (id) => lsGallerySave((items) => ({ items: items.filter((x) => x.id !== id) }), 'Image removed.');

function photoCard(p, idx, items, ro) {
  const asking = LS.removeAsk === p.id; const busy = !!LS.photoBusy || LS.running > 0;
  const cover = p.cover; const plan = p.kind === 'floorplan';
  const canDrag = !ro && !cover && !busy;
  const card = lsEl('li', { class: 'ls-ph' + (cover ? ' ls-ph-cover' : '') + (plan ? ' ls-ph-plan' : ''), 'data-photo': p.id, draggable: canDrag ? 'true' : false,
    ondragstart: (e) => { LS.dragId = p.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', p.id); } catch (x) { /* ignore */ } card.classList.add('ls-ph-drag'); },
    ondragend: () => { card.classList.remove('ls-ph-drag'); LS.dragId = null; document.querySelectorAll('.ls-ph-over').forEach((n) => n.classList.remove('ls-ph-over')); },
    ondragover: (e) => { if (LS.dragId && lsDropAllowed(LS.d.photos.items, LS.dragId, p.id)) { e.preventDefault(); card.classList.add('ls-ph-over'); } },
    ondragleave: () => card.classList.remove('ls-ph-over'),
    ondrop: (e) => { e.preventDefault(); card.classList.remove('ls-ph-over'); lsDropOn(p.id); } },
    lsEl('div', { class: 'ls-ph-img' }, lsPhotoImg(p.id, 480, p.altText || 'Staged image'),
      lsEl('span', { class: 'ls-ph-pos', text: String(idx + 1) }),
      cover ? lsEl('span', { class: 'ls-ph-flag', text: 'Cover' }) : plan ? lsEl('span', { class: 'ls-ph-flag ls-ph-flag-plan', text: 'Floorplan' }) : null),
    lsEl('div', { class: 'ls-ph-body' },
      lsEl('label', { class: 'ls-label', for: 'ls-alt-' + p.id, text: 'Description (optional)' }),
      lsEl('input', { id: 'ls-alt-' + p.id, class: 'ls-input', type: 'text', maxlength: '200', value: p.alt, disabled: ro || busy, placeholder: 'Optional, e.g. Kitchen',
        onchange: (e) => { if (e.target.value.trim() !== (p.alt || '').trim()) lsSetAlt(p.id, e.target.value); } }),
      lsEl('label', { class: 'ls-check-row ls-ph-row', title: cover ? 'The cover must be a photograph. Make another photo the cover first.' : '' },
        lsEl('input', { type: 'checkbox', checked: plan, disabled: ro || busy || cover, onchange: (e) => lsSetKind(p.id, e.target.checked) }), cover ? ' Floorplan (not available for the cover)' : ' This is a floorplan (always last)'),
      p.issues.length ? lsEl('ul', { class: 'ls-ferr ls-ph-issues' }, p.issues.map((i) => lsEl('li', { text: i.message }))) : (p.alt ? lsEl('div', { class: 'ls-ph-ok', text: 'Description OK' }) : lsEl('div', { class: 'ls-sub ls-ph-fallback', text: 'No description. The website will say: "' + p.altText + '"' })),
      ro ? null : lsEl('div', { class: 'ls-ph-actions' },
        cover || plan ? null : lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: busy, onclick: () => lsSetCover(p.id), text: 'Make cover' }),
        cover ? null : lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: busy || !lsMoveAllowed(items, p.id, -1), title: 'Move earlier', 'aria-label': 'Move earlier', onclick: () => lsMove(p.id, -1), text: '←' }),
        cover ? null : lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: busy || !lsMoveAllowed(items, p.id, 1), title: 'Move later', 'aria-label': 'Move later', onclick: () => lsMove(p.id, 1), text: '→' }),
        lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: busy, onclick: () => lsChoose({ replace: p.id }), text: 'Replace' }),
        asking ? lsEl('span', { class: 'ls-ph-confirm' }, 'Remove this image? ',
          lsEl('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => lsRemovePhoto(p.id), text: 'Yes, remove' }),
          lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.removeAsk = null; lsRefreshPhotos(); }, text: 'Keep' }))
          : lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: busy, onclick: () => { LS.removeAsk = p.id; lsRefreshPhotos(); }, text: 'Remove' }))));
  return card;
}

function photosSection() {
  const ro = readOnly(); const ph = LS.d.photos; const items = ph.items;
  const zone = ro ? null : lsEl('div', { class: 'ls-drop', id: 'ls-photo-drop', tabindex: '0', role: 'button', 'aria-label': 'Add photographs',
    onclick: () => lsChoose(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lsChoose(); } },
    ondragover: (e) => { if (!LS.dragId) { e.preventDefault(); zone.classList.add('over'); } }, ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => { if (LS.dragId) return; e.preventDefault(); zone.classList.remove('over'); lsEnqueue(e.dataTransfer.files); } },
    lsEl('strong', { text: LS.queue.some((q) => q.state !== 'failed') ? 'Uploading... you can keep working' : 'Add photographs' }), lsEl('span', { text: 'Drag images here or click to choose. JPG, PNG or WebP, at least 960 pixels wide.' }));
  return lsEl('div', { class: 'ls-photos', id: 'ls-photos' },
    lsEl('h3', { class: 'ls-ph-h', text: 'Photographs' }),
    lsEl('div', { class: 'ls-help', text: 'Private: only signed-in staff can see these. Nothing here is published. Location data is removed from every image. Originals are not kept. The first photograph is the cover; floorplans are always last.' }),
    LS.photoMsg ? lsEl('div', { class: 'ls-banner ' + (LS.photoMsg.bad ? 'ls-banner-bad' : 'ls-banner-ok'), role: LS.photoMsg.bad ? 'alert' : 'status', text: LS.photoMsg.bad || LS.photoMsg.ok }) : null,
    ph.readiness.gallery.length ? lsEl('ul', { class: 'ls-ferr ls-ph-gal' }, ph.readiness.gallery.map((g) => lsEl('li', { text: g.message }))) : null,
    zone,
    LS.queue.length ? lsEl('ul', { class: 'ls-ph-grid ls-ph-queue-list', 'aria-label': 'Uploads in progress' }, LS.queue.map(qCard)) : null,
    items.length ? lsEl('ul', { class: 'ls-ph-grid' }, items.map((p, i) => photoCard(p, i, items, ro))) : (LS.queue.length ? null : lsEl('div', { class: 'ls-sub', text: 'No images yet.' })),
    items.length ? lsEl('div', { class: 'ls-help', text: 'Drag a card or use the arrows to reorder. "Make cover" moves a photo to the front. The cover and floorplans have no arrows: their place is fixed by the rules above.' }) : null,
    null);
}
function lsRefreshPhotos() { const el = document.getElementById('ls-photos'); if (el && LS.d) el.replaceWith(photosSection()); }

/* ------------------------------------------------------------------ paint */
function lsPaint() {
  const root = lsRoot(); if (!root) return;
  setTimeout(lsSchedulePoll, 0);
  root.replaceChildren();
  const r = lsRoute();
  if (r.name === 'list') paintList(root); else if (r.name === 'new') paintPicker(root); else paintDraft(root);
}
function lsPaintKeepFocus() { lsPaint(); const s = document.getElementById('ls-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }


/* ------------------------------------------------------------------ Review & publish */
const JOB_STEPS = [
  ['requested', 'Requested'], ['dispatched', 'Handed to GitHub'], ['started', 'Job started'], ['payload', 'Approved content received'],
  ['engine', 'Publication engine accepts the content'], ['tests', 'Website test suite'], ['build', 'Production build and privacy scan'], ['finished', 'Finished'],
];
/* A real publication: the app copies the approved images first, then the job opens one pull request, waits for the required checks, merges,
   waits for the deployment and proves the live page. Only the last step makes the listing Live. */
const REAL_STEPS = [
  ['requested', 'Requested'], ['media_copy', 'Approved images copied to the public store'], ['dispatched', 'Handed to GitHub'], ['started', 'Job started'],
  ['payload', 'Approved content received'], ['engine', 'Publication engine accepts the content'], ['tests', 'Website test suite'], ['build', 'Production build and privacy scan'],
  ['media', 'Images checked on the public store'], ['pull_request', 'Publication pull request opened (one file)'], ['checks', 'Required checks passed'],
  ['merge', 'Merged under the branch rules'], ['deploy', 'Production deployment finished'], ['verify', 'Live page, images and catalogue checked'], ['finished', 'Finished'],
];
const WITHDRAW_STEPS = [
  ['requested', 'Requested'], ['dispatched', 'Handed to GitHub'], ['started', 'Job started'], ['payload', 'Request received'],
  ['engine', 'Listing found, not already withdrawn'], ['build', 'Website built without the listing and checked'], ['pull_request', 'Withdrawal pull request opened (one file)'],
  ['checks', 'Required checks passed'], ['merge', 'Merged under the branch rules'], ['deploy', 'Production deployment finished'],
  ['verify', 'Page is gone, and the catalogue and sitemap no longer list it'], ['finished', 'Finished'],
];
const isReal = (j) => j.kind === 'publish' || j.kind === 'update';
let lsPollTimer = null;
function lsStopPolling() { if (lsPollTimer) { clearTimeout(lsPollTimer); lsPollTimer = null; } }
async function lsLoadJobs() {
  try { LS.jobs = await lsApi('GET', '/api/listings/draft-publish?id=' + LS.d.draft.id); LS.jobErr = null; } catch (e) { LS.jobErr = e.status || 0; }
}
/* Polling only READS progress. The job itself runs on GitHub's servers and continues if this page is closed. */
function lsSchedulePoll() {
  lsStopPolling();
  if (lsRoute().tab !== 'review' || !LS.jobs || !LS.jobs.active) return;
  lsPollTimer = setTimeout(async () => { await lsLoadJobs(); if (lsRoute().tab === 'review') { lsRefreshReview(); lsSchedulePoll(); } }, 5000);
}
function lsRefreshReview() { const h = document.getElementById('ls-review-host'); if (h) h.replaceWith(reviewContent()); }

/* Commercial status. Available, Under offer and Sold all stay public; a Sold page stops offering the property. Publishers choose it on the publish card. */
const STATUS_LABEL = { available: 'Available', under_offer: 'Under offer', sold: 'Sold' };
const lsWebsiteStatus = () => (LS.jobs && STATUS_LABEL[LS.jobs.websiteStatus] ? LS.jobs.websiteStatus : null);
/** The status the Publisher is changing to, or null when nothing is being changed (the choice equals what the website shows). */
const lsStatusChange = () => { const cur = lsWebsiteStatus(); const c = LS.statusChoice; return cur && STATUS_LABEL[c] && c !== cur ? c : null; };
/** What is sent with a dry run or a publication: the new status and the status the person saw, only when it is being changed. */
const lsStatusFields = () => { const c = lsStatusChange(); return c ? { commercialStatus: c, expectedStatus: lsWebsiteStatus() } : {}; };

/** The public status line on the publish card: what the website shows now and, for a Publisher, a choice. */
function statusRow(ro, current, change) {
  const label = lsEl('div', { class: 'ls-sub', id: 'ls-status-now', text: 'Public status on the website now: ' + STATUS_LABEL[current] + '.' });
  if (ro) return label;
  const sel = lsEl('select', { id: 'ls-status-select', class: 'ls-input', 'aria-label': 'Public status', onchange: (e) => { LS.statusChoice = e.target.value === current ? null : e.target.value; LS.soldConfirmed = false; lsRefreshReview(); } },
    Object.keys(STATUS_LABEL).map((k) => lsEl('option', { value: k, selected: k === (change || current), text: STATUS_LABEL[k] })));
  return lsEl('div', { class: 'ls-statusrow' }, label, lsEl('label', { class: 'ls-sub', for: 'ls-status-select', text: 'Change the public status: ' }), sel,
    change ? lsEl('div', { class: 'ls-banner', id: 'ls-status-pending', role: 'status' }, 'The status will change to ' + STATUS_LABEL[change] + ' when you publish below.' + (change === 'sold' ? ' A Sold page stays public but no longer offers the property for enquiry.' : '')) : null);
}
/* Withdrawal. A Publisher takes a published listing out of public marketing: the page, catalogue entry and sitemap entry go (the address answers "not found").
   The reason is private (never published); the typed address is the confirmation. The website, not this page, decides when it is Withdrawn. */
const lsNorm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toLowerCase();
const lsWithdrawn = () => !!(LS.jobs && LS.jobs.withdrawn === true);
/** Merged into the website but the page being gone was not confirmed: a re-check is offered instead of a new withdrawal. */
const lsWithdrawUnconfirmed = () => lsWithdrawn() && !!(LS.jobs.withdrawal && LS.jobs.withdrawal.status === 'failed' && LS.jobs.withdrawal.merged);
const lsWithdrawReady = () => !!(LS.jobs && LS.jobs.websiteAddress && LS.withdrawReason && LS.withdrawReason.trim() && LS.withdrawReason.trim().length <= 300 && lsNorm(LS.withdrawAddress) === lsNorm(LS.jobs.websiteAddress));
async function lsStartWithdraw(recheck) {
  if (LS.jobBusy) return;
  LS.jobBusy = true; LS.jobFlash = null; lsRefreshReview();
  try {
    const body = recheck ? { id: LS.d.draft.id, mode: 'withdraw', recheck: true } : { id: LS.d.draft.id, mode: 'withdraw', confirmAddress: LS.withdrawAddress, reason: LS.withdrawReason };
    const out = await lsApi('POST', '/api/listings/draft-publish', body);
    LS.jobFlash = { ok: out.existing ? 'A withdrawal is already running for this listing.' : 'Withdrawal started. It runs on the server: you can close this page. The listing shows as Withdrawn only after the website has been checked.' };
    LS.withdrawOpen = false; LS.withdrawReason = ''; LS.withdrawAddress = '';
    await lsLoadJobs();
  } catch (e) {
    const b = e.body || {};
    LS.jobFlash = { bad: e.status === 409 && b.error === 'address_mismatch' ? 'The address you typed does not match the listing. Nothing was changed.'
      : e.status === 400 && b.error === 'reason_required' ? 'Write the reason for the withdrawal. It stays private and is never published.'
      : e.status === 400 && b.error === 'invalid_reason' ? 'The reason is too long (300 characters at most).'
      : e.status === 409 && b.error === 'already_withdrawn' ? 'This listing is already withdrawn. Reload the page.'
      : e.status === 409 && b.error === 'job_active' ? 'A publication is already running for this listing.'
      : e.status === 409 && b.error === 'draft_required' ? 'This listing has no draft in the Listings Manager. Import the published listing first.'
      : e.status === 409 && b.error === 'not_published' ? 'This listing is not published, so there is nothing to withdraw.'
      : e.status === 500 && b.error === 'audit_failed' ? 'The private record of this withdrawal could not be saved, so nothing was started. Tell an administrator.'
      : e.status === 503 ? 'Publishing is not set up correctly. An administrator needs to check the publishing settings.'
      : e.status === 502 ? 'The withdrawal could not be started. Nothing was changed. Try again shortly, and if it keeps happening ask an administrator.' : e.status === 403 ? 'Only a Publisher can withdraw a listing.' : 'The withdrawal could not be started. Try again, and if it keeps happening ask an administrator.' };
    await lsLoadJobs().catch(() => {});
  }
  LS.jobBusy = false; lsRefreshReview(); lsSchedulePoll();
}
/** The "Withdraw this listing" area: Publishers only, kept apart and visually distinct from publishing. */
function withdrawCard(ro, active) {
  if (ro || !LS.jobs || !LS.jobs.configured) return null;
  const busy = !!active || LS.jobBusy;
  return lsEl('div', { class: 'ls-rv-box ls-danger-box', id: 'ls-withdraw' },
    lsEl('h3', { text: 'Withdraw this listing' }),
    !LS.withdrawOpen
      ? lsEl('div', null, lsEl('p', { class: 'ls-sub', text: 'Permanently takes the listing out of public marketing. Use it when the property should no longer be advertised at all. Selling status (Available, Under offer, Sold) is changed above, not here.' }),
        lsEl('button', { class: 'btn btn-secondary', type: 'button', id: 'ls-withdraw-open', disabled: busy, onclick: () => { LS.withdrawOpen = true; lsRefreshReview(); }, text: 'Withdraw this listing...' }))
      : lsEl('div', { class: 'ls-confirm', role: 'group', 'aria-label': 'Confirm withdrawal' },
        lsEl('p', null, lsEl('strong', { text: 'This permanently removes the listing from public marketing.' })),
        lsEl('ul', { class: 'ls-sub' }, [
          'The page is removed: its address will answer "not found".', 'It disappears from the catalogue and from the sitemap.',
          'The photograph files are kept and may remain reachable through their direct web addresses. Search engines may keep a copy for a while.', 'The draft, its history and the private record stay here. Withdrawal is permanent in the Listings Manager: there is no undo.'].map((t) => lsEl('li', { text: t }))),
        lsEl('label', { class: 'ls-sub', for: 'ls-withdraw-reason', text: 'Reason (private: it is recorded in the audit trail and is never published)' }),
        lsEl('textarea', { id: 'ls-withdraw-reason', class: 'ls-input', rows: '3', maxlength: '300', value: LS.withdrawReason || '', oninput: (e) => { LS.withdrawReason = e.target.value; lsWithdrawBtn(); } }),
        lsEl('label', { class: 'ls-sub', for: 'ls-withdraw-address' }, 'To confirm, type the public address of the listing: ', lsEl('strong', { text: LS.jobs.websiteAddress || '(not available)' })),
        lsEl('input', { id: 'ls-withdraw-address', class: 'ls-input', type: 'text', autocomplete: 'off', value: LS.withdrawAddress || '', oninput: (e) => { LS.withdrawAddress = e.target.value; lsWithdrawBtn(); } }),
        lsEl('div', { class: 'ls-confirm-actions' },
          lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-withdraw-confirm', disabled: !lsWithdrawReady() || busy, onclick: () => lsStartWithdraw(false), text: 'Yes, withdraw this listing' }), ' ',
          lsEl('button', { class: 'btn btn-secondary', type: 'button', id: 'ls-withdraw-cancel', onclick: () => { LS.withdrawOpen = false; LS.withdrawReason = ''; LS.withdrawAddress = ''; lsRefreshReview(); }, text: 'Cancel' }))));
}
/** Typing must not rebuild the form (it would lose focus): only the confirm button is updated. */
function lsWithdrawBtn() { const b = document.getElementById('ls-withdraw-confirm'); if (b) b.disabled = !lsWithdrawReady() || !!(LS.jobs && LS.jobs.active) || LS.jobBusy; }
/** What a withdrawn listing shows: no publish or status controls, the proof, and (for Publishers) the private history. */
function withdrawnView(ro, latest) {
  const jobs = LS.jobs; const unconf = lsWithdrawUnconfirmed();
  const trail = (jobs.audit || []).filter((r) => r.action === 'withdraw');
  return lsEl('div', { id: 'ls-review-host', class: 'ls-review-host' },
    lsEl('div', { class: 'ls-rv-box', id: 'ls-withdrawn' },
      lsEl('h3', { text: unconf ? 'Withdrawal not yet confirmed' : 'Withdrawn from public marketing' }),
      unconf ? lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert', id: 'ls-withdraw-unconfirmed' }, 'The withdrawal was merged into the website, but the page being gone has not been confirmed yet. It is not shown as Withdrawn until it is.')
        : lsEl('div', { class: 'ls-banner', role: 'status', id: 'ls-withdrawn-note' }, badge('Withdrawn', 'ls-badge-muted'), ' The page, the catalogue entry and the sitemap entry are removed. Its address answers "not found".'),
      LS.jobFlash ? lsEl('div', { class: 'ls-banner ' + (LS.jobFlash.bad ? 'ls-banner-bad' : 'ls-banner-ok'), role: LS.jobFlash.bad ? 'alert' : 'status', text: LS.jobFlash.bad || LS.jobFlash.ok }) : null,
      lsEl('p', { class: 'ls-sub', text: 'Publishing and status changes are switched off while a listing is withdrawn. The draft, its history and the private record are kept. Withdrawal is permanent in the Listings Manager. Marketing this property again is a separate administrative process: ask an administrator.' }),
      unconf && !ro ? lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-withdraw-recheck', disabled: LS.jobBusy, onclick: () => lsStartWithdraw(true), text: LS.jobBusy ? 'Checking...' : 'Re-check withdrawal' }) : null,
      !ro && trail.length ? lsEl('div', { id: 'ls-withdraw-trail' }, lsEl('h4', { class: 'ls-rv-title', text: 'Private record (Publishers and administrators only)' }),
        lsEl('ul', { class: 'ls-sub' }, trail.map((r) => lsEl('li', { text: when(r.at) + ', ' + String(r.by).split('@')[0] + ': ' + r.reason })))) : null,
      latest && latest.kind === 'withdraw' ? jobTimeline(latest) : null));
}

/** A dry run that found the content identical to what is already published is not a failure: there is simply nothing to publish. */
function jobNoChange(j) {
  const s = (j.steps || []).find((x) => x.status === 'failed');
  return j.status === 'failed' && !!j.error && j.error.code === 'engine_refused' && !!s && s.step === 'engine' && !!s.detail && s.detail.kind === 'unchanged' && !(s.detail.issues && s.detail.issues.length);
}
/** Nothing public changed since the version on the website, and Notion has not moved: no action is offered. */
const lsNoChanges = () => !!(LS.jobs && LS.jobs.noChanges && LS.d && LS.d.notion && LS.d.notion.changed.length === 0 && !(LS.jobs.active) && !lsStatusChange());

async function lsStartDryRun() {
  if (LS.jobBusy) return;
  LS.jobBusy = true; LS.jobFlash = null; lsRefreshReview();
  try {
    const out = await lsApi('POST', '/api/listings/draft-publish', { id: LS.d.draft.id, expectedVersion: LS.d.draft.version, mode: 'dry_run', ...lsStatusFields() });
    LS.jobFlash = { ok: out.existing ? 'A dry run for this version already exists.' : 'Dry run started. It runs on the server: you can close this page.' };
    await lsLoadJobs();
  } catch (e) {
    const b = e.body || {};
    LS.jobFlash = e.status === 409 && b.error === 'no_changes' ? { ok: 'No changes to publish. This listing already matches what is on the website.' } : { bad: e.status === 409 && b.error === 'not_ready' ? 'Not ready yet: ' + (b.reasons || []).join(' ')
      : e.status === 409 && b.error === 'draft_changed' ? 'The draft changed. Reload and review the latest version.'
      : e.status === 409 && b.error === 'job_active' ? 'A publication is already running for this listing.'
      : e.status === 409 && b.error === 'status_changed' ? 'The status on the website has changed since you opened this page. Reload the page and check it.'
      : e.status === 503 ? 'Publishing is not set up correctly. An administrator needs to check the publishing settings.'
      : e.status === 502 ? 'The check could not be started. Nothing was published. Try again shortly, and if it keeps happening ask an administrator.' : e.status === 403 ? 'Only a Publisher can run this.' : 'The check could not be started. Try again, and if it keeps happening ask an administrator.' };
    await lsLoadJobs().catch(() => {});
  }
  LS.jobBusy = false; lsRefreshReview(); lsSchedulePoll();
}

/** Already public: verified Live by a portal job, or on the website without one (a listing imported from the website). Either way, changes go out as an update. */
const lsIsPublished = () => !!(LS.jobs && (LS.jobs.live || LS.jobs.publishedOnWebsite));

async function lsStartPublish() {
  if (LS.jobBusy) return;
  const kind = lsIsPublished() ? 'update' : 'publish';
  LS.jobBusy = true; LS.jobFlash = null; lsRefreshReview();
  try {
    const out = await lsApi('POST', '/api/listings/draft-publish', { id: LS.d.draft.id, expectedVersion: LS.d.draft.version, mode: kind, ...lsStatusFields() });
    LS.jobFlash = { ok: out.existing ? 'This version has already been published.' : 'Publishing started. It runs on the server: you can close this page. The listing shows as Live only after the website has been checked.' };
    await lsLoadJobs();
  } catch (e) {
    const b = e.body || {};
    LS.jobFlash = { bad: e.status === 409 && b.error === 'not_ready' ? 'Not ready yet: ' + (b.reasons || []).join(' ')
      : e.status === 409 && b.error === 'draft_changed' ? 'The draft changed. Reload and review the latest version.'
      : e.status === 409 && b.error === 'job_active' ? 'A publication is already running for this listing.'
      : e.status === 409 && b.error === 'status_changed' ? 'The status on the website has changed since you opened this page. Reload the page and check it.'
      : e.status === 409 && b.error === 'status_not_allowed' ? 'A first publication is always Available. Change the status after the listing is live.'
      : e.status === 409 && b.error === 'already_published' ? 'This listing is already published on the website. Reload: the button now publishes your changes as an update.'
      : e.status === 409 && b.error === 'already_live' ? 'This listing is already live. Reload the page: the button will publish your changes as an update.'
      : (b.error === 'media_failed') ? 'The photographs could not be prepared for the website. Nothing has been published. Try again, and if it keeps happening ask an administrator.'
      : e.status === 503 && b.error === 'public_media_not_configured' ? 'Publishing is not set up correctly: the public image store is not connected. An administrator needs to check the publishing settings.'
      : e.status === 503 ? 'Publishing is not set up correctly. An administrator needs to check the publishing settings.'
      : e.status === 502 ? 'The publication could not be started. Nothing was published. Try again shortly, and if it keeps happening ask an administrator.' : e.status === 403 ? 'Only a Publisher can publish.' : 'The publication could not be started. Try again, and if it keeps happening ask an administrator.' };
    await lsLoadJobs().catch(() => {});
  }
  LS.jobBusy = false; lsRefreshReview(); lsSchedulePoll();
}

/* ---- the Publish step -------------------------------------------------------------------------------------------------------------------
   One primary action. The summary on this screen IS the confirmation (Sold keeps its extra tick). Staff see four friendly stages and, when something
   goes wrong, one sentence and what to do. Administrators can open the technical details and the optional test run. */
const lsIsAdmin = () => !!(LS.me && Array.isArray(LS.me.capabilities) && LS.me.capabilities.includes('listings.admin'));

const STEP_ORDER = ['requested', 'media_copy', 'dispatched', 'started', 'payload', 'notion_read', 'engine', 'tests', 'build', 'media', 'pull_request', 'checks', 'merge', 'deploy', 'verify', 'finished'];
/** Friendly stages for a job, in plain words. Each stage closes on one technical step; no technical word is shown. Pure. */
function friendlyProgress(j) {
  const stages = j.kind === 'withdraw'
    ? [['Checking the listing', 'build'], ['Removing it from the website', 'merge'], ['Confirming it is gone', 'verify']]
    : [['Checking your listing', 'build'], ['Preparing the photos', 'media'], ['Publishing to the website', 'merge'], ['Confirming it is live', 'verify']];
  const steps = j.steps || [];
  const ok = new Set(steps.filter((x) => x.status === 'ok').map((x) => x.step));
  const failed = steps.find((x) => x.status === 'failed');
  const failedAt = failed ? STEP_ORDER.indexOf(failed.step) : -1;
  let activeGiven = false; let prevClose = -1;
  return stages.map(([label, closing]) => {
    const done = j.status === 'succeeded' || ok.has(closing);
    const closeAt = STEP_ORDER.indexOf(closing);
    // a failure belongs to the first stage that has not closed and that its step falls in
    const failedHere = !done && failedAt > prevClose && failedAt <= closeAt;
    prevClose = closeAt;
    let state = done ? 'done' : failedHere ? 'failed' : 'pending';
    if (state === 'pending' && j.active && !activeGiven) { state = 'active'; activeGiven = true; }
    if (state === 'failed') activeGiven = true;
    return { label, state };
  });
}
function progressView(j) {
  return lsEl('ol', { class: 'ls-prog', 'aria-label': 'Progress' }, friendlyProgress(j).map((st) => lsEl('li', { class: 'ls-prog-' + st.state },
    lsEl('span', { class: 'ls-prog-dot', 'aria-hidden': 'true', text: st.state === 'done' ? '✓' : st.state === 'failed' ? '✗' : '' }), ' ', st.label)));
}
/** One sentence about what happened, and what to do. No codes (administrators have those under Technical details). */
function friendlyFailure(j) {
  const merged = !!(j.result && j.result.merged);
  const what = j.error ? errText(j.error, j.kind) : (j.kind === 'withdraw' ? 'The withdrawal did not complete.' : 'The publication did not complete.');
  const todo = merged ? (j.kind === 'withdraw' ? 'Use "Re-check withdrawal": nothing is redone.' : 'Press the button again to check it: nothing is redone.')
    : 'Nothing was changed: the live page is exactly as it was. Try again, and if it fails again tell an administrator.';
  return { what, todo };
}

function reviewContent() {
  const d = LS.d; const v = d.validation; const c = d.draft.content; const ph = d.photos; const ro = !d.permissions.canPublish;
  const pf = [];
  if (!v.complete) pf.push('Complete the required details.');
  if (!ph.items.some((p) => p.kind !== 'floorplan')) pf.push('Add at least one photograph.');
  if (!ph.readiness.ready) pf.push('Fix the flagged photo descriptions.');
  if (v.blockers.some((b) => !['photos_required', 'photo_alt'].includes(b.code))) pf.push('Finish the items in "Preview and check".');
  if (d.notion.changed.length) pf.push('The CRM record changed: review it and save the draft.');
  if (LS.dirty) pf.push('Save your changes first: this step shows the saved draft.');
  const startable = pf.length === 0;
  const jobs = LS.jobs; const active = jobs && jobs.active; const latest = jobs && jobs.jobs && jobs.jobs[0];
  if (lsWithdrawn() && !active) return withdrawnView(ro, latest);

  const live = jobs && jobs.live; const stuck = jobs && jobs.mergedUnverified;
  const onSite = !live && !!(jobs && jobs.publishedOnWebsite);
  const published = !!(live || onSite);
  const sc = lsStatusChange(); const curStatus = lsWebsiteStatus();
  const nochg = lsNoChanges();
  const changes = jobs && jobs.changes;
  const realActive = !!(active && isReal(active));
  const failedLatest = latest && latest.status === 'failed' && !active && latest.kind !== 'dry_run' && !jobNoChange(latest) ? latest : null;
  const button = stuck ? 'Re-check and finish' : sc && jobs && jobs.noChanges ? 'Publish status change' : published ? 'Publish changes' : 'Publish to website';
  const heading = nochg ? 'Nothing to publish' : stuck ? 'Almost there' : published ? 'Publish changes' : startable ? 'Ready to publish' : 'Not ready to publish yet';

  const summary = [];
  if (published && changes && changes.count) {
    summary.push(lsEl('p', { class: 'ls-sub', text: 'These changes will go on the website once it has checked them:' }));
    summary.push(lsEl('ul', { class: 'ls-changes', id: 'ls-changes' }, changes.items.map((i) => lsEl('li', null, lsEl('strong', { text: i.label }), i.detail ? ' (' + i.detail + ')' : ''))));
  } else if (!published) {
    summary.push(lsEl('p', { class: 'ls-sub', text: 'Publishing makes this listing public at /opportunities/' + (v.slug || '...') + '/ once the website has checked it. It is shown as Live here only after that.' }));
  }

  const body = [];
  if (stuck && !realActive) body.push(lsEl('div', { class: 'ls-banner ls-banner-bad', id: 'ls-merged-unverified', role: 'alert' }, 'The last publication reached the website but could not be confirmed yet. It is not shown as Live. Press the button to check it again.'));
  if (live) body.push(lsEl('div', { class: 'ls-banner ls-banner-ok', role: 'status' }, badge('Live', 'ls-badge-live'), ' Checked on the website ', when(live.since),
    live.url && /^https:\/\/(www\.)?sdahomechoices\.com\.au\//.test(live.url) ? [' ', lsEl('a', { class: 'ls-link', href: live.url, target: '_blank', rel: 'noopener noreferrer', text: 'View the live page' })] : null));
  if (LS.jobFlash) body.push(lsEl('div', { class: 'ls-banner ' + (LS.jobFlash.bad ? 'ls-banner-bad' : 'ls-banner-ok'), role: LS.jobFlash.bad ? 'alert' : 'status', text: LS.jobFlash.bad || LS.jobFlash.ok }));
  if (LS.jobErr) body.push(lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert', text: 'The progress could not be read right now. Reload the page in a moment.' }));
  if (jobs && !jobs.configured) body.push(lsEl('div', { class: 'ls-banner', text: 'Publishing is not set up correctly: an administrator needs to check the publishing settings.' }));
  if (realActive) body.push(lsEl('div', { id: 'ls-progress' }, lsEl('h4', { class: 'ls-rv-title', text: active.kind === 'withdraw' ? 'Withdrawing...' : 'Publishing...' }), progressView(active), lsEl('div', { class: 'ls-sub', text: 'This takes about two minutes. You can close this page: it keeps going.' })));
  else if (failedLatest) { const f = friendlyFailure(failedLatest); body.push(lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert', id: 'ls-failure' }, lsEl('strong', { text: f.what }), ' ', f.todo)); }

  const action = nochg ? lsEl('div', { class: 'ls-banner ls-banner-ok', id: 'ls-no-changes', role: 'status' }, 'No changes to publish. This listing already matches what is on the website. Go back to "Prepare" when something needs to change.')
    : ro ? lsEl('div', { class: 'ls-sub', text: 'Only a Publisher can publish.' })
    : lsEl('div', { class: 'ls-publish-action' },
      sc === 'sold' ? lsEl('label', { class: 'ls-sold-confirm' }, lsEl('input', { type: 'checkbox', id: 'ls-sold-confirm', checked: !!LS.soldConfirmed, onchange: (e) => { LS.soldConfirmed = e.target.checked; lsRefreshReview(); } }), ' I confirm the property has sold. The listing page will say so and stop offering the property for enquiry.') : null,
      lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-publish-btn', disabled: !startable || !!active || LS.jobBusy || (jobs && !jobs.configured) || (sc === 'sold' && !LS.soldConfirmed), onclick: lsStartPublish,
        text: LS.jobBusy ? 'Starting...' : realActive ? 'Publishing...' : active ? 'Please wait...' : button }),
      !startable ? lsEl('ul', { class: 'ls-ferr', id: 'ls-publish-reasons' }, pf.map((m) => lsEl('li', { text: m }))) : null);

  // the dry run and the technical history: administrators only, inside the same screen
  const tech = lsIsAdmin() ? lsEl('details', { class: 'ls-admin ls-tech-box', id: 'ls-admin' }, lsEl('summary', { text: 'Technical details (administrators)' }),
    lsEl('div', { id: 'ls-dry' }, lsEl('h4', { class: 'ls-rv-title', text: 'Test without publishing' }),
      lsEl('p', { class: 'ls-sub', text: 'An optional rehearsal: publishing does not need it. It runs the website\'s own checks on this exact content and changes nothing: nothing is published and no photograph becomes public.' }),
      ro ? null : lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', id: 'ls-dry-btn', disabled: !startable || !!active || LS.jobBusy || nochg || (jobs && !jobs.configured), onclick: lsStartDryRun, text: LS.jobBusy ? 'Starting...' : 'Run test' })),
    latest ? jobTimeline(latest) : lsEl('div', { class: 'ls-sub', text: 'No jobs yet.' }),
    jobs && jobs.jobs.length > 1 ? lsEl('div', { class: 'ls-jobs-older' }, lsEl('h4', { class: 'ls-rv-title', text: 'Earlier jobs (' + (jobs.jobs.length - 1) + ')' }), lsEl('ul', null, jobs.jobs.slice(1).map((j) => lsEl('li', { text: (j.kind === 'dry_run' ? 'test' : j.kind) + ', version ' + j.draftVersion + ': ' + (jobNoChange(j) ? 'no changes' : j.status === 'failed' ? 'did not complete' : j.status) + ' (' + j.requestedBy.split('@')[0] + ', ' + when(j.createdAt) + ')' })))) : null) : null;

  const card = lsEl('div', { class: 'ls-rv-box', id: 'ls-publish' }, lsEl('h3', { text: heading }), summary, published && curStatus ? statusRow(ro, curStatus, sc) : null, body, action, tech);
  return lsEl('div', { id: 'ls-review-host', class: 'ls-review-host' }, card, published && !stuck ? withdrawCard(ro, active) : null);
}

/* The website engine's own wording for advertising rules is technical; staff read it in plain words. The rules are unchanged. */
const plainIssue = (m) => (/Victorian pricing compliance/i.test(m) ? 'Advertising sign-off needed: SDA Home Choices management has not yet confirmed the advertising position for this listing.'
  : /Design Category Basic/i.test(m) ? 'Needs confirmation that this existing (legacy) SDA property is classified as Basic.' : m);
function jobTimeline(j) {
  const done = new Map(j.steps.map((s) => [s.step, s]));
  const failedStep = j.steps.find((s) => s.status === 'failed');
  const real = isReal(j); const wd = j.kind === 'withdraw';
  const rows = (wd ? WITHDRAW_STEPS : real ? REAL_STEPS : JOB_STEPS).map(([key, label]) => {
    const s = done.get(key);
    const state = s ? (s.status === 'failed' ? 'bad' : (key === 'finished' && j.status !== 'succeeded' ? 'bad' : 'ok')) : (j.active ? 'wait' : 'skip');
    return lsEl('li', { class: 'ls-tl ' + state }, lsEl('span', { class: 'ls-tl-dot', 'aria-hidden': 'true', text: state === 'ok' ? '✓' : state === 'bad' ? '✗' : state === 'wait' ? '…' : '–' }), ' ', label, s ? lsEl('span', { class: 'ls-sub', text: ' ' + when(s.at) }) : null);
  });
  const res = j.result; const issues = (failedStep && failedStep.detail && failedStep.detail.issues) || [];
  const checks = (res && res.checks) || (failedStep && failedStep.detail && failedStep.detail.checks) || [];
  if (jobNoChange(j)) return lsEl('div', { class: 'ls-job', id: 'ls-job', 'data-status': 'no_changes' },
    lsEl('div', null, badge('No changes', 'ls-badge-muted'), ' ', lsEl('span', { class: 'ls-sub', text: 'Version ' + j.draftVersion + ', checked by ' + j.requestedBy.split('@')[0] + ' ' + when(j.createdAt) })),
    lsEl('div', { class: 'ls-banner', role: 'status' }, 'No changes to publish. This version is identical to what is on the website, so there was nothing to check.'));
  return lsEl('div', { class: 'ls-job', id: 'ls-job', 'data-status': j.status },
    lsEl('div', null, badge(wd ? (j.status === 'succeeded' ? 'Withdrawn' : j.status === 'failed' ? 'Failed' : 'Withdrawing') : j.status === 'succeeded' ? (real ? (j.result && j.result.live ? 'Live' : 'Finished') : 'Dry run passed') : j.status === 'failed' ? 'Failed' : j.status === 'cancelled' ? 'Cancelled' : (real ? 'Publishing' : 'Running'), j.status === 'succeeded' ? 'ls-badge-live' : j.status === 'failed' ? 'ls-badge-bad' : 'ls-badge-warn'),
      ' ', lsEl('span', { class: 'ls-sub', text: 'Version ' + j.draftVersion + ', started by ' + j.requestedBy.split('@')[0] + ' ' + when(j.createdAt) }),
      j.runUrl && /^https:\/\/github\.com\//.test(j.runUrl) ? [' ', lsEl('a', { class: 'ls-link', href: j.runUrl, target: '_blank', rel: 'noopener noreferrer', text: 'GitHub run' })] : null),
    lsEl('ol', { class: 'ls-tl-list' }, rows),
    j.status === 'succeeded' && wd ? lsEl('div', { class: 'ls-banner ls-banner-ok' }, 'Withdrawn and checked: the page no longer exists and the listing is gone from the catalogue and the sitemap.') : null,
    j.status === 'failed' && wd && res && res.merged ? lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert' }, 'The withdrawal was merged into the website, but the page being gone has not been confirmed yet. Use "Re-check withdrawal": nothing is redone.') : null,
    j.status === 'failed' && wd && !(res && res.merged) ? lsEl('div', { class: 'ls-banner' }, 'Nothing was changed: the listing is still public. You can try again; repeating is safe.') : null,
    j.status === 'succeeded' && !real && !wd ? lsEl('div', { class: 'ls-banner ls-banner-ok' }, 'The approved content would publish. Nothing was published or changed.') : null,
    j.status === 'succeeded' && real && res && res.live ? lsEl('div', { class: 'ls-banner ls-banner-ok' }, 'Published and checked on the live website.') : null,
    j.status === 'failed' && real && res && res.merged ? lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert' }, 'The change was merged into the website, but the live page has not been confirmed. The listing is not shown as Live. Press publish again to re-check: nothing is redone.') : null,
    j.status === 'failed' && real && !(res && res.merged) ? lsEl('div', { class: 'ls-banner' }, 'Nothing was merged: the website that visitors see is unchanged. You can try again; repeating is safe.') : null,
    j.error ? lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert' }, errText(j.error, j.kind)) : null,
    j.error ? lsEl('details', { class: 'ls-tech' }, lsEl('summary', { text: 'Technical details (for an administrator)' }), lsEl('div', { class: 'ls-sub', text: 'Code: ' + j.error.code + (j.attempt > 1 ? ', attempt ' + j.attempt : '') + (j.error.message ? '. ' + j.error.message : '') })) : null,
    issues.length ? lsEl('ul', { class: 'ls-ferr ls-job-issues' }, issues.map((m) => lsEl('li', { text: plainIssue(m) }))) : null,
    checks.length ? lsEl('ul', { class: 'ls-checks' }, checks.map((c) => lsEl('li', { class: c.ok ? 'ok' : 'no' }, lsEl('strong', { text: (c.ok ? 'OK ' : (real || wd ? 'Problem: ' : 'Would stop: ')) + c.name.replace(/_/g, ' ') }), c.note ? lsEl('div', { class: 'ls-sub', text: c.note }) : null))) : null,
    !real && res && res.wouldBlock && res.wouldBlock.length ? lsEl('div', { class: 'ls-banner' }, 'A real publication would currently stop on: ' + res.wouldBlock.map((x) => x.replace(/_/g, ' ')).join(', ') + '.') : null);
}
/* Plain words for staff. The technical code and GitHub's message stay on the job (and in the audit log) and are shown under "Technical details". */
const ERR_TEXT = {
  dispatch_failed: 'The publication could not be started. Nothing was published. Try again shortly.',
  workflow_ended: 'The publication stopped before it reported back. Try again: repeating is safe.',
  no_report: 'The publication finished, but its result did not reach this page. Press the publish button again to check it: nothing is repeated.',
  timed_out: 'The publication took too long and was stopped. Try again: repeating is safe.',
  engine_refused: 'The website did not accept this content for publication. See the points below.',
  parity_failed: 'The page the website prepared did not match what you approved, so nothing was published.',
  tests_failed: 'The website\'s own safety checks failed, so nothing was published. An administrator needs to look at this.',
  build_failed: 'The website could not be built with this listing, or the privacy check found a problem. Nothing was published.',
  media_failed: 'The photographs could not be prepared for the website. Nothing was published. Try again.',
  media_missing: 'An approved photograph was not found on the website\'s image store. Nothing was published. Try again.',
  checks_failed: 'The website\'s required checks did not pass, so nothing was published.',
  merge_refused: 'The website\'s protection rules blocked the change, so nothing was published. An administrator needs to look at this.',
  deploy_failed: 'The website did not finish updating. Press the publish button again to check it.',
  verify_failed: 'The change reached the website, but the live page does not show it correctly yet. Press the publish button again in a few minutes to check it.',
  wrong_mode: 'The portal asked for the wrong kind of publication for this listing. Reload the page and try again.',
  unexpected_files: 'The publication would have changed more than this listing, so it was stopped. Nothing was published. An administrator needs to look at this.',
  not_published: 'This listing is not published, so there is nothing to publish or withdraw.',
  not_configured: 'Publishing is not set up correctly. An administrator needs to check the publishing settings.',
  manifest_invalid: 'The photograph list could not be read. Check the photographs in the draft and try again.',
  property_not_found: 'The property record could not be found. An administrator needs to look at this.',
  mode_not_enabled: 'This action is not available.',
  payload_mismatch: 'The request did not match what was approved, so nothing was published. Reload the page and try again.',
};
const WITHDRAW_ERR_TEXT = {
  build_failed: 'The website could not be built without this listing, so nothing was changed. An administrator needs to look at this.',
  verify_failed: 'The website was updated, but the page or its catalogue entry is still showing. Use "Re-check withdrawal" in a few minutes.',
  deploy_failed: 'The website did not finish updating. Use "Re-check withdrawal" in a few minutes.',
  checks_failed: 'The website\'s required checks did not pass, so nothing was changed.',
  merge_refused: 'The website\'s protection rules blocked the change, so nothing was changed. An administrator needs to look at this.',
  not_published: 'This listing is not published, so there is nothing to withdraw.',
  audit_failed: 'The private record of this withdrawal could not be saved, so nothing was started. An administrator needs to look at this.',
};
const errText = (e, kind) => (kind === 'withdraw' && WITHDRAW_ERR_TEXT[e.code]) || ERR_TEXT[e.code] || (kind === 'withdraw' ? 'The withdrawal did not complete. Nothing is hidden unless this page says otherwise. Try again, and if it keeps happening ask an administrator.' : 'The publication did not complete. Try again, and if it keeps happening ask an administrator.');
