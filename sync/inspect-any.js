// inspect-any.js — inspecciona cualquier base de Notion
// Uso: node inspect-any.js NOMBRE_DE_LA_VARIABLE_ENV
// Ej:  node inspect-any.js NOTION_CONTACTS_DB_ID
require('dotenv').config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const envVar = process.argv[2];              // el argumento que pasas por terminal
const DB_ID = process.env[envVar];

if (!DB_ID) {
  console.error(`❌ No encuentro la variable ${envVar} en el .env`);
  process.exit(1);
}

async function main() {
  console.log(`Inspeccionando ${envVar} (${DB_ID})...\n`);
  const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 1 }),
  });

  if (!res.ok) {
    console.error(`❌ Notion respondió ${res.status}:`, await res.text());
    return;
  }

  const data = await res.json();
  if (data.results.length === 0) {
    console.log('⚠️  La base respondió pero está vacía o la integración no tiene acceso.');
    return;
  }

  const props = data.results[0].properties;
  console.log('=== PROPIEDADES (nombre → tipo) ===');
  for (const [name, prop] of Object.entries(props)) {
    console.log(`  "${name}"  →  ${prop.type}`);
  }
}

main().catch(err => console.error('❌ Error:', err.message));