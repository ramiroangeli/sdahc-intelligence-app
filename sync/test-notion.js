// test-notion.js — prueba de conexión a Notion (solo lee, no escribe nada)
require('dotenv').config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DEALS_DB_ID;

async function main() {
  console.log('Conectando a Notion...');

  const response = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 5 }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`❌ Notion respondió ${response.status}:`, errText);
    return;
  }

  const data = await response.json();
  console.log(`✅ Conexión OK. Deals recibidos en esta página: ${data.results.length}`);
  console.log(`¿Hay más? ${data.has_more}`);

  data.results.forEach((page, i) => {
    const props = page.properties;
    const titleProp = Object.values(props).find(p => p.type === 'title');
    const name = titleProp?.title?.[0]?.plain_text || '(sin nombre)';
    console.log(`  ${i + 1}. ${name}`);
  });
}

main().catch(err => console.error('❌ Error:', err.message));