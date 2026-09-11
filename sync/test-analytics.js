// test-analytics.js — prueba que la clave anon puede LEER analytics (y NO tocar raw)
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Cliente con la clave ANON (la pública), apuntando al esquema analytics
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  db: { schema: 'analytics' },
});

async function main() {
  console.log('1) Probando LECTURA de analytics.deals con la clave anon...');
  const { data, error } = await supabase
    .from('deals')
    .select('name, stage, sdahc_revenue, weighted_revenue')
    .order('sdahc_revenue', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ No pudo leer analytics:', error.message);
  } else {
    console.log(`✅ Leyó ${data.length} deals. Top por revenue:`);
    data.forEach((d, i) => console.log(`   ${i+1}. ${d.name} — ${d.stage} — $${Math.round(d.sdahc_revenue)}`));
  }

  console.log('\n2) Probando que la anon NO puede leer raw.deals (debe FALLAR)...');
  const rawClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    db: { schema: 'raw' },
  });
  const { data: rawData, error: rawErr } = await rawClient.from('deals').select('name').limit(1);
  if (rawErr) {
    console.log(`✅ Correcto: la anon NO puede tocar raw (${rawErr.message})`);
  } else {
    console.log(`⚠️  ATENCIÓN: la anon SÍ leyó raw (${rawData.length} filas). Hay que cerrar eso.`);
  }
}

main().catch(err => console.error('❌ Error:', err.message));