// sync-contacts.js — lee todos los contactos de Notion y los escribe en raw.contacts de Supabase
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_CONTACTS_DB_ID;

// Cliente de Supabase con la service_role (ignora RLS, puede escribir en raw)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  db: { schema: 'raw' },
});

/* ---------- Ayudantes de extracción (Notion → valor simple) ---------- */
const getTitle       = p => p?.title?.[0]?.plain_text ?? null;
const getSelect      = p => p?.select?.name ?? null;
const getMulti       = p => (p?.multi_select ?? []).map(o => o.name);
const getEmail       = p => p?.email ?? null;
const getPhone       = p => p?.phone_number ?? null;
const getCheckbox    = p => p?.checkbox ?? false;
const getRelationIds = p => (p?.relation ?? []).map(r => r.id);

/* ---------- Trae todos los contactos (paginado) ---------- */
async function fetchAllContacts() {
  let all = [], cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
    const data = await res.json();
    all = all.concat(data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

/* ---------- Transforma un contacto de Notion a una fila de raw.contacts ----------
   OJO: "Last Touchpointa" es un last_edited_time de Notion (se actualiza solo cuando
   se edita la página), NO es una fecha real de "último contacto" — a propósito NO
   se mapea a ninguna columna, para no hacer creer que es algo que no es. Sigue
   disponible en raw_data si hace falta.
   Las relaciones "| ABS" (Deals | ABS, Businesses | ABS, Buyers | ABS ) son de otro
   negocio — tampoco se mapean, quedan solo en raw_data. */
function toRow(page) {
  const p = page.properties;
  return {
    notion_page_id:       page.id,
    last_edited_time:     page.last_edited_time,
    created_time: page.created_time,
    synced_at:            new Date().toISOString(),
    is_archived:          false,
    name:                 getTitle(p['Name']),
    email:                getEmail(p['Email']),
    phone:                getPhone(p['Phone Number']),
    relationship_status:  getSelect(p['Relationship Status']),
    contact_type:         getMulti(p['Contact Type']),
    source:               getMulti(p['Source']),
    state:                getSelect(p['State']),
    business_origin:      getSelect(p['Business Origin']),
    non_active:           getCheckbox(p['Non-active']),
    rel_deals:            getRelationIds(p['Deals']),
    rel_group:            getRelationIds(p['Group']),
    rel_tasks:            getRelationIds(p['Tasks']),
    raw_data:             p,   // el JSON completo, red de seguridad
  };
}

/* ---------- Principal ---------- */
async function main() {
  console.log('Trayendo contactos de Notion...');
  const contacts = await fetchAllContacts();
  console.log(`  ${contacts.length} contactos traídos.`);

  const rows = contacts.map(toRow);
  console.log('Escribiendo en Supabase (raw.contacts)...');

  const { data, error } = await supabase
    .from('contacts')
    .upsert(rows, { onConflict: 'notion_page_id' });

  if (error) {
    console.error('❌ Error escribiendo en Supabase:', error.message);
    return;
  }
  console.log(`✅ Sync completo. ${rows.length} contactos escritos/actualizados en raw.contacts.`);
}

main().catch(err => console.error('❌ Error:', err.message));
