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

  // 2. Trae la foto más reciente ANTERIOR a hoy, por deal, para saber el stage
  //    Y el outcome previos — una sola lectura, se compara todo contra ella
  //    (no hace falta un segundo viaje a Supabase para el outcome).
  const { data: prevSnaps, error: snapErr } = await historyDb
    .from('deal_snapshots')
    .select('notion_page_id, stage, outcome, snapshot_date')
    .lt('snapshot_date', today)
    .order('snapshot_date', { ascending: false });
  if (snapErr) { console.error('❌ Error leyendo snapshots previos:', snapErr.message); return; }

  // Nos quedamos con el stage/outcome de la foto MÁS reciente de cada deal
  const prevStageByDeal = {};
  const prevOutcomeByDeal = {};
  for (const s of (prevSnaps || [])) {
    if (!(s.notion_page_id in prevStageByDeal)) {
      prevStageByDeal[s.notion_page_id] = s.stage;     // el primero que aparece = el más reciente
      prevOutcomeByDeal[s.notion_page_id] = s.outcome;
    }
  }

  // 3. Detecta cambios de stage Y de outcome → eventos (mismo loop, misma foto previa)
  const events = [];
  const outcomeEvents = [];
  for (const d of deals) {
    const prevStage = prevStageByDeal[d.notion_page_id];
    if (prevStage !== undefined && prevStage !== d.stage) {
      events.push({
        notion_page_id: d.notion_page_id,
        from_stage: prevStage,
        to_stage: d.stage,
        changed_at: today,
      });
    }

    const prevOutcome = prevOutcomeByDeal[d.notion_page_id];
    if (prevOutcome !== undefined && prevOutcome !== d.outcome) {
      outcomeEvents.push({
        notion_page_id: d.notion_page_id,
        from_outcome: prevOutcome,
        to_outcome: d.outcome,
        changed_at: today,
      });
    }
  }

  if (events.length > 0) {
    const { error: evErr } = await historyDb.from('deal_stage_events').insert(events);
    if (evErr) { console.error('❌ Error insertando eventos:', evErr.message); return; }
  }
  console.log(`  ${events.length} cambios de stage detectados.`);

  if (outcomeEvents.length > 0) {
    const { error: outEvErr } = await historyDb.from('deal_outcome_events').insert(outcomeEvents);
    if (outEvErr) { console.error('❌ Error insertando eventos de outcome:', outEvErr.message); return; }
  }
  console.log(`  ${outcomeEvents.length} cambios de outcome detectados.`);

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