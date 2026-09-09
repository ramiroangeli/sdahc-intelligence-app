// inspect-deal.js — muestra la estructura completa de un deal (solo lee)
require('dotenv').config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DEALS_DB_ID;

async function main() {
  const response = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 1 }),   // solo 1 deal, para inspeccionar
  });

  const data = await response.json();
  const deal = data.results[0];

  console.log('=== notion_page_id ===');
  console.log(deal.id);
  console.log('\n=== last_edited_time ===');
  console.log(deal.last_edited_time);
  console.log('\n=== PROPIEDADES (nombre → tipo) ===');

  // Lista cada propiedad: su nombre y su tipo
  for (const [name, prop] of Object.entries(deal.properties)) {
    console.log(`  "${name}"  →  ${prop.type}`);
  }

  console.log('\n=== ESTRUCTURA COMPLETA (JSON crudo de las propiedades) ===');
  console.log(JSON.stringify(deal.properties, null, 2));
}

main().catch(err => console.error('❌ Error:', err.message));