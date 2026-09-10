// sync-history.js — toma la foto diaria de cada deal y detecta cambios de stage
// Debe correr DESPUÉS de sync-deals.js (que ya actualizó raw.deals con lo de hoy)
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const today = new Date().toISOString().slice(0, 10);  // 'YYYY-MM-DD'

// Un cliente por esquema (Supabase liga el cliente a un esquema)
const rawDb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { db: { schema: 'raw' } });
const historyDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { db: { schema: 'history' } });

// SDAHC revenue por deal (misma fórmula que usa la app)
function sdahcRevenue(d) {
  const brokerage = (d.transaction_value || 0) * (d.commission_pct || 0);
  const advisory  = d.advisory_fee || 0;
  return brokerage + advisory;
}

async function main() {
  console.log(`Historial para el día ${today}...`);

  // 1. Trae todos los deals actuales de raw (el estado "de hoy")
  const { data: deals, error: readErr } = await rawDb
    .from('deals')
    .select('notion_page_id, stage, outcome, transaction_value, advisory_fee, commission_pct, probability')
    .eq('is_archived', false);
  if (readErr) { console.error('❌ Error leyendo raw.deals:', readErr.message); return; }
  console.log(`  ${deals.length} deals actuales.`);

  // 2. Trae la foto más reciente ANTERIOR a hoy, por deal, para saber el stage previo
  const { data: prevSnaps, error: snapErr } = await historyDb
    .from('deal_snapshots')
    .select('notion_page_id, stage, snapshot_date')
    .lt('snapshot_date', today)
    .order('snapshot_date', { ascending: false });
  if (snapErr) { console.error('❌ Error leyendo snapshots previos:', snapErr.message); return; }

  // Nos quedamos con el stage de la foto MÁS reciente de cada deal
  const prevStageByDeal = {};
  for (const s of (prevSnaps || [])) {
    if (!(s.notion_page_id in prevStageByDeal)) {
      prevStageByDeal[s.notion_page_id] = s.stage;   // el primero que aparece = el más reciente
    }
  }

  // 3. Detecta cambios de stage → eventos
  const events = [];
  for (const d of deals) {
    const prev = prevStageByDeal[d.notion_page_id];
    if (prev !== undefined && prev !== d.stage) {
      events.push({
        notion_page_id: d.notion_page_id,
        from_stage: prev,
        to_stage: d.stage,
        changed_at: today,
      });
    }
  }

  if (events.length > 0) {
    const { error: evErr } = await historyDb.from('deal_stage_events').insert(events);
    if (evErr) { console.error('❌ Error insertando eventos:', evErr.message); return; }
  }
  console.log(`  ${events.length} cambios de stage detectados.`);

  // 4. Toma la foto de hoy (upsert: una por deal por día, no duplica si ya corrió)
  const snapshots = deals.map(d => ({
    notion_page_id: d.notion_page_id,
    snapshot_date: today,
    stage: d.stage,
    outcome: d.outcome,
    transaction_value: d.transaction_value,
    advisory_fee: d.advisory_fee,
    probability: d.probability,
    sdahc_revenue: sdahcRevenue(d),
  }));

  const { error: snapWriteErr } = await historyDb
    .from('deal_snapshots')
    .upsert(snapshots, { onConflict: 'notion_page_id,snapshot_date' });
  if (snapWriteErr) { console.error('❌ Error escribiendo snapshots:', snapWriteErr.message); return; }

  console.log(`✅ ${snapshots.length} fotos guardadas para ${today}.`);
}

main().catch(err => console.error('❌ Error:', err.message));