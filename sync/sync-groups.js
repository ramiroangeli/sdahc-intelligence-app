// sync-groups.js — lee todos los grupos de Notion y los escribe en raw.groups de Supabase
//
// OJO: Groups es distinto a Deals/Contacts/Tasks. NOTION_GROUPS_DB_ID no es el ID
// de una "database" clásica sino de un DATA SOURCE de Notion — hay que usar el
// endpoint /v1/data_sources/{id}/query con Notion-Version 2025-09-03 (no
// /v1/databases/{id}/query con 2022-06-28 como los otros tres syncs).
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_GROUPS_DB_ID;

// Cliente de Supabase con la service_role (ignora RLS, puede escribir en raw)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  db: { schema: 'raw' },
});

/* ---------- Ayudantes de extracción (Notion → valor simple) ---------- */
const getTitle       = p => p?.title?.[0]?.plain_text ?? null;
const getSelect      = p => p?.select?.name ?? null;
const getMulti       = p => (p?.multi_select ?? []).map(o => o.name);
const getRelationIds = p => (p?.relation ?? []).map(r => r.id);

/* ---------- Trae todos los grupos (paginado) ----------
   Groups tiene 117 filas → con page_size 100 esto pagina 2 veces (100 + 17).
   Misma lógica de has_more/next_cursor que fetchAllDeals, solo cambia la URL
   y la versión del header. */
async function fetchAllGroups() {
  let all = [], cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2025-09-03',
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

/* ---------- Transforma un grupo de Notion a una fila de raw.groups ----------
   La relación "Deals | ABS" es de otro negocio — no se mapea, queda en raw_data. */
function toRow(page) {
  const p = page.properties;
  return {
    notion_page_id:   page.id,
    last_edited_time: page.last_edited_time,
    synced_at:        new Date().toISOString(),
    is_archived:      false,
    name:             getTitle(p['Name']),
    status:           getSelect(p['Status']),
    source:           getSelect(p['Source']),
    classification:   getMulti(p['Classification']),
    business_origin:  getSelect(p['Business Origin']),
    rel_contacts:     getRelationIds(p['Contacts']),
    rel_deals:        getRelationIds(p['Deals']),
    rel_tasks:        getRelationIds(p['Tasks']),
    rel_states:       getRelationIds(p['States/Territories']),
    raw_data:         p,   // el JSON completo, red de seguridad
  };
}

/* ---------- Principal ---------- */
async function main() {
  console.log('Trayendo grupos de Notion (data source)...');
  const groups = await fetchAllGroups();
  console.log(`  ${groups.length} grupos traídos.`);

  const rows = groups.map(toRow);
  console.log('Escribiendo en Supabase (raw.groups)...');

  const { data, error } = await supabase
    .from('groups')
    .upsert(rows, { onConflict: 'notion_page_id' });

  if (error) {
    console.error('❌ Error escribiendo en Supabase:', error.message);
    return;
  }
  console.log(`✅ Sync completo. ${rows.length} grupos escritos/actualizados en raw.groups.`);
}

main().catch(err => console.error('❌ Error:', err.message));
