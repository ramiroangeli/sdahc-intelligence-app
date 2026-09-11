// sync-all.js — corre todos los syncs en el orden correcto
// Uso: node sync-all.js
// Orden importa: deals PRIMERO (raw al día), luego el resto, e history AL FINAL
// (history compara el raw actualizado contra la foto anterior).

const { execSync } = require('child_process');

const steps = [
  'sync-deals.js',
  'sync-contacts.js',
  'sync-tasks.js',
  'sync-groups.js',
  'sync-history.js',   // SIEMPRE al final: necesita raw.deals ya actualizado
];

console.log(`\n===== SYNC COMPLETO — ${new Date().toISOString()} =====\n`);

let failed = false;
for (const script of steps) {
  console.log(`\n----- Ejecutando ${script} -----`);
  try {
    // Corre cada script y muestra su salida en vivo
    execSync(`node ${script}`, { stdio: 'inherit', cwd: __dirname });
  } catch (err) {
    console.error(`\n❌ FALLÓ ${script}. Deteniendo el sync completo.`);
    failed = true;
    break;   // si uno falla, paramos (no seguimos con datos a medias)
  }
}

if (failed) {
  console.error('\n===== SYNC INCOMPLETO — revisar el error de arriba =====\n');
  process.exit(1);   // señala "falló" (importante para que GitHub Actions lo sepa)
} else {
  console.log('\n===== ✅ SYNC COMPLETO — todo OK =====\n');
}