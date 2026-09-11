// inspect-datasource.js — inspecciona un DATA SOURCE de Notion (API nueva)
// Uso: node inspect-datasource.js DATA_SOURCE_ID
require('dotenv').config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const dsId = process.argv[2];

if (!dsId) {
  console.error('❌ Pásame el data source ID: node inspect-datasource.js <id>');
  process.exit(1);
}

async function main() {
  console.log(`Inspeccionando data source ${dsId}...\n`);
  const res = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2025-09-03',        // versión nueva, soporta data sources
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 100 }),  // traemos hasta 100 para contar
  });

  if (!res.ok) {
    console.error(`❌ Notion respondió ${res.status}:`, await res.text());
    return;
  }

  const data = await res.json();
  console.log(`Filas en esta tanda: ${data.results.length}  (¿hay más? ${data.has_more})`);

  if (data.results.length === 0) {
    console.log('⚠️  Vacío o sin acceso.');
    return;
  }

  // Muestra los campos del primer registro
  console.log('\n=== PROPIEDADES (nombre → tipo) ===');
  for (const [name, prop] of Object.entries(data.results[0].properties)) {
    console.log(`  "${name}"  →  ${prop.type}`);
  }

  // Muestra los primeros nombres, para reconocer qué datos son
  console.log('\n=== PRIMEROS REGISTROS (por título) ===');
  data.results.slice(0, 10).forEach((row, i) => {
    const titleProp = Object.values(row.properties).find(p => p.type === 'title');
    const name = titleProp?.title?.[0]?.plain_text || '(sin título)';
    console.log(`  ${i + 1}. ${name}`);
  });
}

main().catch(err => console.error('❌ Error:', err.message));