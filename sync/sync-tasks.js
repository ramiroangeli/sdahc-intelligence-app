// sync-tasks.js — lee todas las tareas de Notion y las escribe en raw.tasks de Supabase
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_TASKS_DB_ID;

// Cliente de Supabase con la service_role (ignora RLS, puede escribir en raw)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  db: { schema: 'raw' },
});

/* ---------- Ayudantes de extracción (Notion → valor simple) ---------- */
const getTitle       = p => p?.title?.[0]?.plain_text ?? null;
const getSelect      = p => p?.select?.name ?? null;
const getStatus      = p => p?.status?.name ?? null;   // OJO: "Status" es type "status", no "select"
const getDate        = p => p?.date?.start ?? null;
const getPeople      = p => (p?.people ?? []).map(u => u.name).join(', ') || null;
const getCheckbox    = p => p?.checkbox ?? false;
const getRelationIds = p => (p?.relation ?? []).map(r => r.id);

/* ---------- Trae todas las tareas (paginado) ---------- */
async function fetchAllTasks() {
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

/* ---------- Transforma una tarea de Notion a una fila de raw.tasks ----------
   OJO: la propiedad título es "Task Name " CON espacio al final — así está en
   Notion, no es un error de tipeo. Y "Status" es type "status" (se extrae
   .status.name), no type "select" como Priority/Task Type.
   La relación "Deals | ABS" es de otro negocio — no se mapea, queda en raw_data. */
function toRow(page) {
  const p = page.properties;
  return {
    notion_page_id:   page.id,
    last_edited_time: page.last_edited_time,
    created_time:     page.created_time,
    synced_at:        new Date().toISOString(),
    is_archived:      false,
    name:             getTitle(p['Task Name ']),
    status:           getStatus(p['Status']),
    priority:         getSelect(p['Priority']),
    task_type:        getSelect(p['Task Type']),
    due_date:         getDate(p['Due Date']),
    completed_date:   getDate(p['Completed Date']),
    assigned_to:      getPeople(p['Assigned To']),
    auto_generated:   getCheckbox(p['Auto-Generated']),
    rel_deals:        getRelationIds(p['Deals']),
    rel_contacts:     getRelationIds(p['Contacts']),
    rel_groups:       getRelationIds(p['Groups']),
    raw_data:         p,   // el JSON completo, red de seguridad
  };
}

/* ---------- Principal ---------- */
async function main() {
  console.log('Trayendo tareas de Notion...');
  const tasks = await fetchAllTasks();
  console.log(`  ${tasks.length} tareas traídas.`);

  const rows = tasks.map(toRow);
  console.log('Escribiendo en Supabase (raw.tasks)...');

  const { data, error } = await supabase
    .from('tasks')
    .upsert(rows, { onConflict: 'notion_page_id' });

  if (error) {
    console.error('❌ Error escribiendo en Supabase:', error.message);
    return;
  }
  console.log(`✅ Sync completo. ${rows.length} tareas escritas/actualizadas en raw.tasks.`);
}

main().catch(err => console.error('❌ Error:', err.message));
