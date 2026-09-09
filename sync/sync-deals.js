// sync-deals.js — lee todos los deals de Notion y los escribe en raw.deals de Supabase
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DEALS_DB_ID;

// Cliente de Supabase con la service_role (ignora RLS, puede escribir en raw)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  db: { schema: 'raw' },
});

/* ---------- Ayudantes de extracción (Notion → valor simple) ---------- */
const getTitle    = p => p?.title?.[0]?.plain_text ?? null;
const getSelect   = p => p?.select?.name ?? null;
const getMulti    = p => (p?.multi_select ?? []).map(o => o.name);
const getNumber   = p => (p?.number ?? null);
const getDate     = p => p?.date?.start ?? null;
const getRichText = p => p?.rich_text?.[0]?.plain_text ?? null;
const getPeople   = p => (p?.people ?? []).map(u => u.name).join(', ') || null;
// Las fórmulas: el valor vive según su tipo interno (number | string | ...)
const getFormula  = p => {
  const f = p?.formula;
  if (!f) return null;
  return f[f.type] ?? null;   // f.number, f.string, etc.
};

/* ---------- Trae todos los deals (paginado) ---------- */
async function fetchAllDeals() {
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

/* ---------- Transforma un deal de Notion a una fila de raw.deals ---------- */
function toRow(page) {
  const p = page.properties;
  return {
    notion_page_id:        page.id,
    last_edited_time:      page.last_edited_time,
    synced_at:             new Date().toISOString(),
    is_archived:           false,
    name:                  getTitle(p['Name']),
    stage:                 getSelect(p['Stage']),
    outcome:               getSelect(p['Outcome']),
    deal_type:             getMulti(p['Deal Type']),
    entity:                getSelect(p['Entity']),
    owner:                 getPeople(p['Assigned To']),
    transaction_value:     getNumber(p['Sale Price']),
    commission_pct:        getNumber(p['Comission']),          // sic
    advisory_fee:          getNumber(p['Consultancy Fee (Total)']),
    tranche1_amount:       getNumber(p['Tranche 1 (consultancy)']),
    tranche1_status:       getSelect(p['T1 status']),
    tranche2_amount:       getNumber(p['Tranche 2 (consultancy)']),
    tranche2_status:       getSelect(p['T2 status']),
    probability:           getNumber(p['Probability']),
    score:                 getFormula(p['Score']),
    close_date:            getDate(p['Close Date']),
    next_action:           getRichText(p['Next action']),
    next_action_date:      getDate(p['Next action date']),
    days_stale:            getFormula(p['Days Stale']),
    pipeline_status:       getFormula(p['Pipeline Status']),
    deal_value_calculated: getFormula(p['Deal Value (calculated)']),
    raw_data:              p,   // el JSON completo, red de seguridad
  };
}

/* ---------- Principal ---------- */
async function main() {
  console.log('Trayendo deals de Notion...');
  const deals = await fetchAllDeals();
  console.log(`  ${deals.length} deals traídos.`);

  const rows = deals.map(toRow);
  console.log('Escribiendo en Supabase (raw.deals)...');

  const { data, error } = await supabase
    .from('deals')
    .upsert(rows, { onConflict: 'notion_page_id' });

  if (error) {
    console.error('❌ Error escribiendo en Supabase:', error.message);
    return;
  }
  console.log(`✅ Sync completo. ${rows.length} deals escritos/actualizados en raw.deals.`);
}

main().catch(err => console.error('❌ Error:', err.message));