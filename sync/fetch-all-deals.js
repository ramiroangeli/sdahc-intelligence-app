// fetch-all-deals.js — trae TODOS los deals de Notion con paginación (solo lee)
require('dotenv').config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DEALS_DB_ID;

// Pide una tanda de deals. startCursor = desde dónde seguir (null = desde el principio)
async function fetchPage(startCursor) {
  const body = { page_size: 100 };            // el máximo que Notion permite por tanda
  if (startCursor) body.start_cursor = startCursor;

  const response = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Notion respondió ${response.status}: ${errText}`);
  }
  return response.json();
}

// Recorre TODAS las tandas hasta traer todos los deals
async function fetchAllDeals() {
  let allDeals = [];
  let cursor = null;
  let pageNum = 0;

  do {
    pageNum++;
    const data = await fetchPage(cursor);
    allDeals = allDeals.concat(data.results);
    console.log(`  Tanda ${pageNum}: +${data.results.length} deals (total acumulado: ${allDeals.length})`);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);   // sigue mientras haya cursor (= mientras haya más)

  return allDeals;
}

async function main() {
  console.log('Trayendo todos los deals de Notion...');
  const deals = await fetchAllDeals();

  console.log(`\n✅ Total de deals traídos: ${deals.length}`);

  // Listado rápido de todos, por nombre, para verificar
  deals.forEach((page, i) => {
    const titleProp = Object.values(page.properties).find(p => p.type === 'title');
    const name = titleProp?.title?.[0]?.plain_text || '(sin nombre)';
    console.log(`  ${String(i + 1).padStart(2, ' ')}. ${name}`);
  });
}

main().catch(err => console.error('❌ Error:', err.message));