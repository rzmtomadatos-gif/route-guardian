// Garantiza que dist/version.json existe tras `vite build`.
// Si Vite no copió public/version.json (o si public/ se quedó obsoleto),
// regeneramos y escribimos la versión definitiva en dist/version.json.
//
// Esto es CRÍTICO para que la PWA detecte nuevas versiones en producción:
// AboutSection y usePwaUpdate hacen fetch('/version.json'). Si devuelve 404,
// el usuario nunca verá "Actualizar ahora".
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');
const distFile = resolve(distDir, 'version.json');
const publicFile = resolve(root, 'public', 'version.json');

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// 1) Si Vite ya copió public/version.json a dist/, perfecto. Verificarlo.
if (existsSync(distFile)) {
  try {
    const parsed = JSON.parse(readFileSync(distFile, 'utf-8'));
    if (parsed && typeof parsed.version === 'string') {
      console.log('[ensure-dist-version] OK: dist/version.json ya existe →', parsed.version);
      process.exit(0);
    }
  } catch {
    // contenido inválido, lo regeneramos abajo
  }
}

// 2) Si public/version.json existe, copiarlo a dist/.
if (existsSync(publicFile)) {
  copyFileSync(publicFile, distFile);
  console.log('[ensure-dist-version] copiado public/version.json → dist/version.json');
  process.exit(0);
}

// 3) Último recurso: generar uno nuevo.
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const buildTime = new Date().toISOString();
const stamp = buildTime.replace(/[-:T]/g, '').slice(0, 12);
const version = `${pkg.version || '0.0.0'}+${stamp}`;
const payload = { version, buildTime };
writeFileSync(distFile, JSON.stringify(payload, null, 2));
// También actualizamos public/ por coherencia para futuros builds.
try {
  writeFileSync(publicFile, JSON.stringify(payload, null, 2));
} catch {
  /* no bloqueante */
}
console.log('[ensure-dist-version] generado dist/version.json →', version);
