// Genera public/version.json en cada build con marca temporal y versión.
// Esto NO requiere consulta a Supabase. Es la fuente runtime de "qué versión sirve el origen".
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const buildTime = new Date().toISOString();
// Versión legible: package.version + sufijo timestamp corto (YYYYMMDD-HHmm)
const stamp = buildTime.replace(/[-:T]/g, '').slice(0, 12);
const version = `${pkg.version || '0.0.0'}+${stamp}`;

const out = { version, buildTime };
const payload = JSON.stringify(out, null, 2);
const destinations = [
  resolve(root, 'public', 'version.json'),
  resolve(root, 'public', '.well-known', 'vialroute-version.json'),
  resolve(root, 'public', 'app-version.json'),
];

for (const dest of destinations) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, payload);
  console.log('[version] wrote', dest, out);
}
