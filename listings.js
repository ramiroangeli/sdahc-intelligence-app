/* ============================================================================
   WEBSITE > LISTINGS
   Dashboard, property picker, draft editor and private preview.
   Talks ONLY to this app's own /api/listings endpoints with the user's Supabase session token. It holds no Notion,
   GitHub, Blob or database credentials, and it renders every server value as plain text, never as markup.
   Drafts are private: nothing here can change the public website.
   Routes (hash): #/listings  #/listings/new  #/listings/draft/<id>  #/listings/draft/<id>/preview
   ============================================================================ */

const LS = { me: null, list: null, listError: null, listLoading: false, picker: null, pickerQ: '', pickerError: null, confirm: null,
  d: null, dErr: null, dirty: false, saving: false, form: null, live: null, flash: null, notionConflict: null, verifyOpen: null };
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
  let m = /^#\/listings\/draft\/(lst_[a-f0-9]{10})(\/preview)?$/.exec(h);
  if (m) return { name: 'draft', id: m[1], tab: m[2] ? 'preview' : 'edit' };
  if (h === '#/listings/new') return { name: 'new' };
  return { name: 'list' };
};
const lsGo = (hash) => { if (location.hash === hash) lsPaint(); else location.hash = hash; };
const lsRoot = () => document.getElementById('view-listings');
const lsActive = () => { const r = lsRoot(); return r && r.classList.contains('active'); };

window.addEventListener('hashchange', () => { if (lsActive()) lsRouteChanged(); });

function renderListingsPage() { lsRouteChanged(); }

async function lsRouteChanged() {
  LS.flash = null; LS.notionConflict = null; LS.verifyOpen = null; LS.confirm = null;
  const r = lsRoute();
  if (r.name === 'list') return lsLoadList();
  if (r.name === 'new') return lsLoadPicker();
  return lsLoadDraft(r.id);
}

/* ------------------------------------------------------------------ shared pieces */
const DEPLOY_LABEL = { live: ['Live', 'ls-badge-live'], not_live: ['Not responding', 'ls-badge-warn'], unknown: ['Unconfirmed', 'ls-badge-muted'], not_published: ['Not on website', 'ls-badge-muted'], withdrawn: ['Withdrawn', 'ls-badge-bad'] };
const COMMERCIAL_LABEL = { available: 'Available', under_offer: 'Under offer', sold: 'Sold' };
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
        lsEl('div', { class: 'ls-sub', text: l.draft.fieldsFilled + ' of ' + l.draft.fieldsTotal + ' fields, saved by ' + l.draft.updatedBy.split('@')[0] + ' ' + when(l.draft.updatedAt) }),
        l.draft.openNotes ? lsEl('div', { class: 'ls-sub ls-warn-text', text: l.draft.openNotes + ' open verification note' + (l.draft.openNotes > 1 ? 's' : '') }) : null)
    : lsEl('span', { class: 'ls-sub', text: 'None' }));
  const tr = lsEl('tr', null,
    lsEl('td', null, lsEl('div', { class: 'ls-name', text: l.name }), lsEl('div', { class: 'ls-sub', text: [l.state, l.designCategories.join(', '), l.buildType].filter(Boolean).join(' · ') })),
    lsEl('td', null, l.notion ? badge(l.notion.status, 'ls-badge-notion') : badge('Not set', 'ls-badge-muted')),
    siteCell,
    lsEl('td', { text: l.website ? COMMERCIAL_LABEL[l.website.commercialStatus] + ' · v' + l.website.version : '' }),
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
      lsEl('div', null, lsEl('h2', { class: 'panel-title', text: 'Website listings' }),
        lsEl('div', { class: 'panel-sub', text: 'Notion holds the commercial decision. Website is confirmed against the live site. A draft never changes the website.' })),
      lsEl('div', { class: 'ls-actions' },
        lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: lsLoadList, text: LS.listLoading ? 'Checking...' : 'Refresh' }),
        lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-add-btn', disabled: !canEdit, title: canEdit ? '' : 'You need the Editor capability to add a listing', onclick: () => lsGo('#/listings/new'), text: 'Add next listing' }))),
    warns.length ? lsEl('div', { class: 'ls-banner', role: 'status' }, warns.map((m) => lsEl('div', { text: m }))) : null,
    d.listings.length === 0
      ? lsEl('div', { class: 'ls-state', text: 'No properties are on the website or in draft yet.' })
      : lsEl('div', { class: 'table-wrap ls-table-wrap' }, lsEl('table', { class: 'deals-table ls-table' },
          lsEl('thead', null, lsEl('tr', null, ['Property', 'Notion status', 'Website', 'Commercial', 'Page', 'Draft'].map((h) => lsEl('th', { scope: 'col', text: h })))),
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
  const search = lsEl('input', { type: 'search', class: 'ls-input', id: 'ls-search', placeholder: 'Search Notion properties by address', value: LS.pickerQ, 'aria-label': 'Search properties',
    oninput: (e) => { LS.pickerQ = e.target.value; clearTimeout(lsTimer); lsTimer = setTimeout(async () => { try { LS.picker = (await lsApi('GET', '/api/listings/properties?q=' + encodeURIComponent(LS.pickerQ))).properties; } catch (x) { LS.pickerError = x.status || 0; } lsPaintKeepFocus(); }, 350); } });
  const rows = (LS.picker || []).map((p) => {
    const asking = LS.confirm === p.id;
    const action = p.onWebsite ? badge('Already on website', 'ls-badge-live')
      : p.hasDraft ? lsEl('a', { class: 'btn btn-secondary btn-sm', href: '#/listings/draft/' + p.id, text: 'Open draft' })
      : lsEl('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { LS.confirm = p.id; lsPaint(); }, text: 'Create draft' });
    const tr = lsEl('tr', null,
      lsEl('td', null, lsEl('div', { class: 'ls-name', text: p.name }), lsEl('div', { class: 'ls-sub', text: [p.state, p.designCategories.join(', '), p.buildType].filter(Boolean).join(' · ') })),
      lsEl('td', null, badge(p.notionStatus, 'ls-badge-notion')), lsEl('td', null, action));
    if (!asking) return [tr];
    return [tr, lsEl('tr', { class: 'ls-confirm-row' }, lsEl('td', { colspan: '3' }, lsEl('div', { class: 'ls-confirm' },
      lsEl('strong', { text: 'Create a website draft for ' + p.name + '?' }),
      lsEl('span', { text: ' Check the house or unit number: a neighbouring property may look the same. The Notion record is not changed.' }),
      lsEl('div', { class: 'ls-actions' },
        lsEl('button', { class: 'btn btn-primary btn-sm', type: 'button', id: 'ls-confirm-create', onclick: () => lsCreate(p.id), text: 'Yes, create draft' }),
        lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.confirm = null; lsPaint(); }, text: 'Cancel' })))))];
  });
  root.append(lsEl('div', { class: 'panel' },
    lsEl('div', { class: 'panel-head' }, lsEl('div', null, back('Back to Listings', '#/listings'), lsEl('h2', { class: 'panel-title', text: 'Add next listing' }),
      lsEl('div', { class: 'panel-sub', text: 'Choose an existing property from Notion Properties. No new CRM record is created.' }))),
    lsEl('div', { class: 'ls-pad' }, search),
    LS.flash ? lsEl('div', { class: 'ls-banner ls-banner-bad', role: 'alert', text: LS.flash }) : null,
    LS.picker == null ? lsEl('div', { class: 'ls-state', text: 'Loading properties...' })
      : LS.picker.length === 0 ? lsEl('div', { class: 'ls-state', text: 'No properties match.' })
      : lsEl('div', { class: 'table-wrap' }, lsEl('table', { class: 'deals-table ls-table' },
          lsEl('thead', null, lsEl('tr', null, ['Property (internal address)', 'Notion status', ''].map((h) => lsEl('th', { scope: 'col', text: h })))),
          lsEl('tbody', null, rows)))));
}

async function lsCreate(propertyId) {
  try { const d = await lsApi('POST', '/api/listings/draft', { propertyId }); LS.d = d; lsGo('#/listings/draft/' + d.draft.id); }
  catch (e) {
    LS.flash = e.status === 409 && e.message === 'already_published' ? 'That property is already on the website.' : e.status === 409 ? 'A draft already exists for that property.' : e.status === 403 ? 'You need the Editor capability.' : 'The draft could not be created (' + e.message + ').';
    LS.confirm = null; lsPaint();
  }
}

/* ------------------------------------------------------------------ draft editor */
async function lsLoadDraft(id) {
  LS.dErr = null; LS.d = LS.d && LS.d.draft.id === id ? LS.d : null; LS.dirty = false; lsPaint();
  try { if (!LS.me) LS.me = await lsApi('GET', '/api/listings/me'); LS.d = await lsApi('GET', '/api/listings/draft?id=' + id); LS.form = { ...LS.d.draft.content }; LS.live = LS.d; }
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
  if (side) side.replaceChildren(...sideContent());
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
  try { const body = { id: LS.d.draft.id, expectedVersion: LS.d.draft.version, note, ...(item.id ? { noteId: item.id } : { code: item.code }) }; LS.d = await lsApi('POST', '/api/listings/draft-verify', body); LS.live = LS.d; LS.verifyOpen = null; LS.flash = { ok: 'Recorded.' }; }
  catch (e) { LS.flash = { bad: 'Could not record it (' + e.message + ').' }; }
  lsPaint();
}

function sideContent() {
  const v = LS.live.validation; const ver = LS.live.verification; const p = LS.d.property; const nodes = [];
  // readiness
  const items = [
    ['Required fields complete', v.complete],
    ['Photographs added', !v.blockers.some((b) => b.code === 'photos_required')],
    ['Commercial verification clear', ver.open === 0],
    ['Compliance cleared', !v.blockers.some((b) => b.code === 'victoria_compliance' || b.code === 'basic_classification')],
  ];
  nodes.push(lsEl('div', { class: 'ls-card' }, lsEl('h3', { text: 'Readiness' }),
    lsEl('div', { class: 'ls-ready ' + (v.publishable ? 'ok' : 'no'), text: v.publishable ? 'Ready for publication review' : 'Not ready to publish' }),
    lsEl('ul', { class: 'ls-check' }, items.map(([t, ok]) => lsEl('li', { class: ok ? 'ok' : 'no' }, lsEl('span', { 'aria-hidden': 'true', text: ok ? '✓' : '○' }), ' ', t))),
    v.errors.length ? lsEl('div', { class: 'ls-errs' }, lsEl('strong', { text: 'To fix' }), lsEl('ul', null, v.errors.map((e) => lsEl('li', { text: e.message })))) : null,
    v.blockers.length ? lsEl('div', { class: 'ls-blocks' }, lsEl('strong', { text: 'Before publication' }), lsEl('ul', null, v.blockers.map((b) => lsEl('li', { text: b.message })))) : null,
    v.warnings.length ? lsEl('div', { class: 'ls-sub', text: v.warnings.map((w) => w.message).join(' ') }) : null,
    v.slug ? lsEl('div', { class: 'ls-sub', text: 'Website path: /opportunities/' + v.slug + '/' }) : null));
  // verification
  const all = [...ver.system, ...ver.notes];
  nodes.push(lsEl('div', { class: 'ls-card' }, lsEl('h3', { text: 'Commercial verification' }),
    all.length === 0 ? lsEl('div', { class: 'ls-sub', text: 'Nothing flagged.' }) : lsEl('ul', { class: 'ls-ver' }, all.map((i) => verifyItem(i))),
    !readOnly() ? lsEl('div', { class: 'ls-note-add' }, lsEl('textarea', { id: 'ls-note-text', class: 'ls-input', rows: '2', maxlength: '500', placeholder: 'Add a note for something to verify, for example an advertised figure that differs from the CRM' }),
      lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', id: 'ls-note-btn', onclick: lsAddNote, text: 'Add verification note' })) : null));
  // facts
  nodes.push(lsEl('div', { class: 'ls-card' }, lsEl('h3', { text: 'Property facts (read only, from Notion)' }),
    lsEl('dl', { class: 'ls-facts' }, [
      ['Property', p.fullName], ['State', p.state || 'Not set'], ['Design category', p.designCategories.join(', ') || 'Not set'], ['Build type', p.buildType || 'Not set'],
      ['Features', p.features.join(', ') || 'None'], ['CRM occupancy', p.occupancy ? p.occupancy.occupied + ' of ' + p.occupancy.places + ' places' : 'Not stated'], ['Notion web status', p.notionStatus],
    ].map(([k, val]) => [lsEl('dt', { text: k }), lsEl('dd', { text: val })])),
    lsEl('div', { class: 'ls-sub', text: 'Prices, income and other financial fields are not shown or editable here.' })));
  // history
  nodes.push(lsEl('div', { class: 'ls-card' }, lsEl('h3', { text: 'History' }),
    lsEl('ul', { class: 'ls-hist' }, LS.d.history.map((h) => lsEl('li', null, lsEl('strong', { text: 'v' + h.version + ' ' + h.action }), ' ', h.by.split('@')[0], ' ', when(h.at), h.fields.length ? lsEl('div', { class: 'ls-sub', text: h.fields.join(', ') }) : null)))));
  return nodes;
}

function verifyItem(i) {
  const open = i.status === 'open';
  const canVerify = LS.d.permissions.canPublish && open && (i.severity === 'verify');
  const asking = LS.verifyOpen === i.code;
  return lsEl('li', { class: 'ls-ver-item ' + (open ? (i.severity === 'error' ? 'bad' : 'open') : 'done') },
    lsEl('div', null, badge(open ? (i.severity === 'error' ? 'Fix' : 'Open') : (i.status === 'resolved' ? 'Resolved' : 'Verified'), open ? (i.severity === 'error' ? 'ls-badge-bad' : 'ls-badge-warn') : 'ls-badge-live'), ' ', i.text),
    !open && (i.verifiedBy || i.resolvedBy) ? lsEl('div', { class: 'ls-sub', text: (i.verifiedBy || i.resolvedBy).split('@')[0] + ' ' + when(i.verifiedAt || i.resolvedAt) + (i.note ? ': ' + i.note : '') }) : null,
    canVerify && !asking ? lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.verifyOpen = i.code; lsPaint(); }, text: i.id ? 'Mark resolved' : 'Mark verified' }) : null,
    canVerify && asking ? lsEl('div', { class: 'ls-note-add' }, lsEl('textarea', { id: 'ls-verify-text', class: 'ls-input', rows: '2', maxlength: '500', placeholder: 'What was checked, and with whom?' }),
      lsEl('div', { class: 'ls-actions' }, lsEl('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => lsVerify(i), text: 'Record' }), lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.verifyOpen = null; lsPaint(); }, text: 'Cancel' }))) : null);
}

function editForm() {
  const ro = readOnly(); const f = LS.form;
  const mode = f.pricingMode; const needsPrice = mode === 'asking_price' || mode === 'price_guide';
  const priceField = lsEl('div', { id: 'ls-price-wrap', class: needsPrice ? '' : 'ls-hidden' },
    field('Display price (AUD)', 'displayPrice', lsEl('input', { id: 'ls-f-displayPrice', class: 'ls-input', type: 'text', inputmode: 'numeric', value: f.displayPrice, disabled: ro, placeholder: 'e.g. 695000', oninput: onEdit('displayPrice', (e) => e.target.value) }), 'A single approved public amount. Price ranges are not supported yet. The CRM price is never used.'));
  const sel = lsEl('select', { id: 'ls-f-pricingMode', class: 'ls-input', disabled: ro, onchange: (e) => { LS.form.pricingMode = e.target.value; LS.dirty = true; document.getElementById('ls-price-wrap').classList.toggle('ls-hidden', !(e.target.value === 'asking_price' || e.target.value === 'price_guide')); lsMarkDirty(); clearTimeout(lsTimer); lsTimer = setTimeout(lsLive, 300); } },
    lsEl('option', { value: '', text: 'Choose...' }), ...[['asking_price', 'Asking Price'], ['price_guide', 'Price Guide'], ['eoi', 'Expressions of Interest'], ['contact_agent', 'Contact Agent']].map(([k, t]) => lsEl('option', { value: k, text: t, selected: mode === k })));
  const sugg = LS.d.property.suggestedPublicAddress;
  return lsEl('div', { class: 'ls-form' },
    field('Web title', 'title', lsEl('input', { id: 'ls-f-title', class: 'ls-input', type: 'text', maxlength: '200', value: f.title, disabled: ro, oninput: onEdit('title', (e) => e.target.value) }), FIELD_HELP.title),
    field('Web description', 'description', lsEl('textarea', { id: 'ls-f-description', class: 'ls-input', rows: '11', disabled: ro, oninput: onEdit('description', (e) => e.target.value), text: f.description }), FIELD_HELP.description),
    field('Web public address', 'publicAddress', lsEl('input', { id: 'ls-f-publicAddress', class: 'ls-input', type: 'text', value: f.publicAddress, disabled: ro, placeholder: 'Street Name, Suburb VIC 3000', oninput: onEdit('publicAddress', (e) => e.target.value) }), FIELD_HELP.publicAddress),
    !ro && sugg && sugg !== f.publicAddress ? lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { LS.form.publicAddress = sugg; LS.dirty = true; lsPaint(); lsLive(); }, text: 'Use suggested: ' + sugg }) : null,
    lsEl('div', { class: 'ls-row' }, field('Web pricing mode', 'pricingMode', sel), priceField),
    lsEl('label', { class: 'ls-check-row' }, lsEl('input', { type: 'checkbox', id: 'ls-f-featured', checked: f.featured, disabled: ro, onchange: (e) => { LS.form.featured = e.target.checked; LS.dirty = true; lsMarkDirty(); } }), ' Web featured (shown first when published)'));
}

function previewContent() {
  const pv = LS.live.preview;
  const card = lsEl('div', { class: 'ls-pv-card' }, lsEl('div', { class: 'ls-pv-photo', text: 'No photograph yet' }),
    lsEl('div', { class: 'ls-pv-body' }, lsEl('div', { class: 'ls-pv-chips' }, badge(pv.status, 'ls-badge-live'), ...pv.design.map((d) => badge(d, 'ls-badge-notion')), pv.featured ? badge('Featured', 'ls-badge-draft') : null),
      lsEl('h4', { text: pv.title || '(no title yet)' }), lsEl('div', { class: 'ls-pv-addr', text: pv.addressLine || '(no address yet)' }), lsEl('div', { class: 'ls-pv-price', text: pv.pricing || '(no pricing mode yet)' }),
      lsEl('p', { text: pv.summary || '(no description yet)' })));
  const detail = lsEl('div', { class: 'ls-pv-detail' }, lsEl('div', { class: 'ls-pv-photo ls-pv-photo-lg', text: 'Photo gallery: added in a later step' }),
    lsEl('h3', { text: pv.title || '(no title yet)' }), lsEl('div', { class: 'ls-pv-addr', text: pv.addressLine || '(no address yet)' }),
    lsEl('div', { class: 'ls-pv-price', text: pv.pricing || '(no pricing mode yet)' }),
    lsEl('div', { class: 'ls-pv-facts' }, pv.design.length ? lsEl('span', { text: 'Design category: ' + pv.design.join(', ') }) : null, pv.buildType ? lsEl('span', { text: 'Building: ' + pv.buildType }) : null),
    ...(pv.description.length ? pv.description.map((t) => lsEl('p', { text: t })) : [lsEl('p', { class: 'ls-sub', text: '(no description yet)' })]));
  return lsEl('div', null,
    lsEl('div', { class: 'ls-banner' }, 'Private preview. This is how the card and detail page will read, built from your current text. It is not on the website, and photographs are added in a later step.'),
    lsEl('div', { class: 'ls-pv-grid' }, lsEl('div', null, lsEl('h4', { class: 'ls-pv-h', text: 'Listing card' }), card), lsEl('div', null, lsEl('h4', { class: 'ls-pv-h', text: 'Detail page' }), detail)));
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
      lsEl('div', null, back('Back to Listings', '#/listings'), lsEl('h2', { class: 'panel-title', text: LS.d.property.fullName }),
        lsEl('div', { class: 'panel-sub', text: 'Website draft v' + d.version + ' · last saved by ' + d.updatedBy.split('@')[0] + ' ' + when(d.updatedAt) + ' · private, not on the website' })),
      lsEl('div', { class: 'ls-actions' }, lsEl('span', { id: 'ls-save-state', class: 'ls-sub', text: ro ? 'Read only' : LS.dirty ? 'Unsaved changes' : 'All changes saved' }),
        ro ? null : lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-save-btn', disabled: LS.saving, onclick: () => lsSave(false), text: LS.saving ? 'Saving...' : 'Save draft' }))),
    lsEl('div', { class: 'ls-tabs', role: 'tablist' },
      lsEl('a', { class: 'ls-tab' + (r.tab === 'edit' ? ' active' : ''), role: 'tab', href: '#/listings/draft/' + d.id, text: 'Edit' }),
      lsEl('a', { class: 'ls-tab' + (r.tab === 'preview' ? ' active' : ''), role: 'tab', href: '#/listings/draft/' + d.id + '/preview', text: 'Private preview' })),
    flash, conflict, pendingChange,
    ro ? lsEl('div', { class: 'ls-banner', text: 'You have read-only access. Editors can change this draft.' }) : null,
    lsEl('div', { class: 'ls-editor' },
      lsEl('div', { class: 'ls-main' }, r.tab === 'edit' ? editForm() : lsEl('div', { id: 'ls-preview-host' }, previewContent())),
      lsEl('aside', { class: 'ls-side', id: 'ls-side' }, sideContent()))));
}

/* ------------------------------------------------------------------ paint */
function lsPaint() {
  const root = lsRoot(); if (!root) return;
  root.replaceChildren();
  const r = lsRoute();
  if (r.name === 'list') paintList(root); else if (r.name === 'new') paintPicker(root); else paintDraft(root);
}
function lsPaintKeepFocus() { lsPaint(); const s = document.getElementById('ls-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
