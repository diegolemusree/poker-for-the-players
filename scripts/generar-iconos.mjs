// Genera los PNG del ícono de la app a partir de public/assets/iconos/icono.svg, con Chrome sin ventana.
// Uso: node scripts/generar-iconos.mjs   (otra ruta de Chrome: CHROME=/ruta/al/chrome node scripts/generar-iconos.mjs)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = fileURLToPath(new URL('../public/assets/iconos/', import.meta.url));
const svg = 'file://' + path.join(dir, 'icono.svg');
// 32: pestaña del navegador; 180: iPhone (apple-touch-icon); 192 y 512: manifest.json
for (const size of [32, 180, 192, 512]) {
  const out = path.join(dir, `icono-${size}.png`);
  execFileSync(chrome, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size},${size}`, `--screenshot=${out}`, svg], { stdio: 'ignore' });
  console.log(out);
}
