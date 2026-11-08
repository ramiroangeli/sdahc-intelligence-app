/* ============================================================================
   WEBSITE > LISTINGS  (read-only first slice)
   Talks ONLY to this app's own /api/listings endpoints with the user's Supabase
   session token. It holds no Notion, GitHub, Blob or database credentials, and
   it renders every server value as plain text, never as markup.
   Notion status is the commercial decision; "Website" is confirmed against the
   live site. The two are shown separately on purpose.
   ============================================================================ */

const LISTINGS_STATE = { loading: false, data: null, me: null, error: null, addOpen: false };

function lsEl(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
}

async function listingsFetch(path) {
  const { data } = await getCurrentSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  const res = await fetch(path, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON error */ }
  if (!res.ok) throw Object.assign(new Error((body && body.error) || 'request_failed'), { status: res.status });
  return body;
}

async function loadListings() {
  LISTINGS_STATE.loading = true;
  LISTINGS_STATE.error = null;
  paintListings();
  try {
    const [me, data] = await Promise.all([listingsFetch('/api/listings/me'), listingsFetch('/api/listings')]);
    LISTINGS_STATE.me = me;
    LISTINGS_STATE.data = data;
  } catch (e) {
    LISTINGS_STATE.error = e.status || 0;
  }
  LISTINGS_STATE.loading = false;
  paintListings();
}

function renderListingsPage() {
  loadListings();
}

const DEPLOY_LABEL = {
  live: ['Live', 'ls-badge-live'],
  not_live: ['Not responding', 'ls-badge-warn'],
  unknown: ['Unconfirmed', 'ls-badge-muted'],
  not_published: ['Not on website', 'ls-badge-muted'],
  withdrawn: ['Withdrawn', 'ls-badge-bad'],
};
const COMMERCIAL_LABEL = { available: 'Available', under_offer: 'Under offer', sold: 'Sold' };

function badge(text, cls) { return lsEl('span', { class: 'ls-badge ' + cls, text }); }

function listingRow(l) {
  const [dLabel, dClass] = DEPLOY_LABEL[l.deployment.state] || DEPLOY_LABEL.unknown;
  const nameCell = lsEl('td', null,
    lsEl('div', { class: 'ls-name', text: l.name }),
    lsEl('div', { class: 'ls-sub', text: [l.state, l.designCategories.join(', '), l.buildType].filter(Boolean).join(' · ') }));
  const notionCell = lsEl('td', null, l.notion ? badge(l.notion.status, 'ls-badge-notion') : badge('No Notion row', 'ls-badge-muted'));
  const siteCell = lsEl('td', null, badge(dLabel, dClass),
    l.deployment.checkedAt ? lsEl('div', { class: 'ls-sub', text: 'Checked ' + new Date(l.deployment.checkedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) }) : null);
  const commercialCell = lsEl('td', { text: l.website ? COMMERCIAL_LABEL[l.website.commercialStatus] : '' });
  const versionCell = lsEl('td', { text: l.website ? 'v' + l.website.version : '' });
  const urlCell = lsEl('td', null, l.website && l.website.url
    ? lsEl('a', { class: 'ls-link', href: l.website.url, target: '_blank', rel: 'noopener noreferrer', text: '/opportunities/' + l.website.slug + '/' })
    : null);
  const tr = lsEl('tr', null, nameCell, notionCell, siteCell, commercialCell, versionCell, urlCell);
  const frag = [tr];
  if (l.notes.length) {
    frag.push(lsEl('tr', { class: 'ls-note-row' }, lsEl('td', { colspan: '6' },
      lsEl('ul', { class: 'ls-notes' }, l.notes.map((n) => lsEl('li', { text: n }))))));
  }
  return frag;
}

function paintListings() {
  const root = document.getElementById('view-listings');
  if (!root) return;
  root.replaceChildren();
  const S = LISTINGS_STATE;

  if (S.loading && !S.data) { root.append(lsEl('div', { class: 'panel ls-state', text: 'Loading website listings...' })); return; }
  if (S.error) {
    const msg = S.error === 401 || S.error === 403
      ? 'You do not have access to Website Listings. Ask an administrator to add your Microsoft account.'
      : S.error === 503
        ? 'The Listings service is not configured yet. An administrator needs to finish the setup.'
        : 'The Listings service could not be reached. Please try again.';
    root.append(lsEl('div', { class: 'panel ls-state', role: 'alert' }, lsEl('h2', { text: 'Listings unavailable' }), lsEl('p', { text: msg }),
      lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: loadListings, text: 'Try again' })));
    return;
  }

  const d = S.data;
  const canEdit = S.me && S.me.canEdit;
  const add = lsEl('button', { class: 'btn btn-primary', type: 'button', id: 'ls-add-btn', disabled: !canEdit, title: canEdit ? '' : 'You need the Editor capability to add a listing',
    onclick: () => { S.addOpen = !S.addOpen; paintListings(); }, text: 'Add next listing' });
  const refresh = lsEl('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: loadListings, text: S.loading ? 'Checking...' : 'Refresh' });

  root.append(lsEl('div', { class: 'panel' },
    lsEl('div', { class: 'panel-head' },
      lsEl('div', null,
        lsEl('h2', { class: 'panel-title', text: 'Website listings' }),
        lsEl('div', { class: 'panel-sub', text: 'Properties managed for sdahomechoices.com.au. Notion holds the commercial decision. The Website column is confirmed against the live site.' })),
      lsEl('div', { class: 'ls-actions' }, refresh, add)),
    S.addOpen ? lsEl('div', { class: 'ls-add-panel', id: 'ls-add-panel' },
      lsEl('strong', { text: 'Create the next listing' }),
      lsEl('p', { text: 'Next increment: choose a property from Notion that is not on the website yet, then write the public copy and add photos. Nothing is created or changed by this screen today.' })) : null,
    sourceWarnings(d),
    d.listings.length === 0
      ? lsEl('div', { class: 'ls-state', text: 'No properties have a Web Listing Status in Notion yet.' })
      : lsEl('div', { class: 'table-wrap ls-table-wrap' }, lsEl('table', { class: 'deals-table ls-table' },
          lsEl('thead', null, lsEl('tr', null, ['Property', 'Notion status', 'Website', 'Commercial', 'Version', 'Page'].map((h) => lsEl('th', { scope: 'col', text: h })))),
          lsEl('tbody', null, d.listings.map(listingRow)))),
    lsEl('div', { class: 'ls-foot', text: 'Generated ' + new Date(d.generatedAt).toLocaleString('en-AU') + '. Read only: this screen cannot change Notion or the website.' })));
}

function sourceWarnings(d) {
  const msgs = [];
  if (d.sources.notion.state === 'not_configured') msgs.push('Notion is not connected to this service, so only what is already on the website is shown.');
  if (d.sources.notion.state === 'error') msgs.push(d.sources.notion.message + '. Showing the website state only.');
  if (d.sources.website.state === 'error') msgs.push(d.sources.website.message + '. Live status cannot be confirmed.');
  if (d.sources.website.state === 'warning') msgs.push(d.sources.website.message);
  return msgs.length ? lsEl('div', { class: 'ls-banner', role: 'status' }, msgs.map((m) => lsEl('div', { text: m }))) : null;
}
