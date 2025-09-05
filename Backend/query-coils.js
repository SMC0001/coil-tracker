import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'tracker.db');
const db = new Database(dbPath, { readonly: true });

const coils = db.prepare('SELECT id, rn, purchase_weight_kg FROM coils').all();

console.log('Coils in database:');
if (coils.length === 0) {
  console.log('No coils found.');
} else {
  coils.forEach(coil => {
    console.log(`ID: ${coil.id}, RN: ${coil.rn}, Weight: ${coil.purchase_weight_kg}kg`);
  });
}

db.close();
