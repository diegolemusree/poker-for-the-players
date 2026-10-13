// Perspectiva de la mesa vista desde mi asiento. Una sola cámara convierte cualquier punto de la mesa
// a pixeles de pantalla: la mesa, las cartas, las fichas, los asientos y las etiquetas la usan todos,
// así que todo comparte la misma perspectiva aunque se dibuje en 2D.
//
// Mundo: la mesa está centrada en el origen con el fieltro en y = 0 y su orilla en TABLE_EDGE (config.js).
// x crece a la derecha, z hacia mí (mi lado es z > 0), y hacia arriba.

import { TABLE_EDGE, LAYOUTS } from './config.js';

export const DEG = Math.PI / 180;
export const RAIL_Y = 0.03;    // el riel de madera queda un poco más alto que el fieltro
export const APRON = 0.1;      // grueso del canto de la mesa
export const FELT_R = 0.85;    // donde termina la madera y empieza el fieltro (fracción de la orilla)
export const TRACK_R = 0.66;   // línea dorada en forma de pista
export const CENTER_R = 0.5;   // octágono central más oscuro
export const NEAR_Z = Math.max(...TABLE_EDGE.map(p => p.z)); // mi orilla
export const FAR_Z = Math.min(...TABLE_EDGE.map(p => p.z));  // la orilla del fondo

// La orilla encogida hacia el centro (k = 1 es la orilla misma) a la altura y.
export const edgeRing = (k = 1, y = 0) => TABLE_EDGE.map(p => ({ x: p.x * k, y, z: p.z * k }));
export const dirOf = deg => ({ x: Math.cos(deg * DEG), z: Math.sin(deg * DEG) });

// Punto de la orilla en la dirección `deg` desde el centro.
export function rimPoint(deg) {
  const d = dirOf(deg);
  let best = Infinity;
  for (let i = 0; i < TABLE_EDGE.length; i++) {
    const a = TABLE_EDGE[i], b = TABLE_EDGE[(i + 1) % TABLE_EDGE.length];
    const ex = b.x - a.x, ez = b.z - a.z, den = d.x * ez - d.z * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (a.x * ez - a.z * ex) / den, u = (a.x * d.z - a.z * d.x) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return { x: d.x * best, z: d.z * best };
}

// Cámara de toma de serie, alta y cerca, mirando hacia abajo al centro de la mesa (config.js: CAMERAS).
export function makeView({ W, H, top, reserve, near, portrait, cam }) {
  const pitch = cam.pitch * DEG, dist = cam.dist;
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const C = { y: dist * sp, z: dist * cp };
  const v = { W, H, F: 1, cx: 0, cy: 0, pitch, portrait, reserve, near, top, cam: { x: 0, y: C.y, z: C.z } };
  v.project = (x, y, z) => {
    const dy = y - C.y, dz = z - C.z;
    const depth = -dy * sp - dz * cp;
    const up = dy * cp - dz * sp;
    const s = v.F / depth;
    return { x: v.cx + x * s, y: v.cy - up * s, s, depth };
  };
  // Al revés: qué punto de la mesa (a la altura y) se ve en el pixel (sx, sy).
  v.unproject = (sx, sy, y = 0) => {
    const ux = (sx - v.cx) / v.F, uy = (v.cy - sy) / v.F;
    const t = (y - C.y) / (uy * cp - sp);
    return { x: t * ux, y, z: C.z - t * (cp + uy * sp) };
  };
  return v;
}

// Ajusta escala y centro. La mesa es más ancha que la pantalla (`cam.width`) y se sale por los lados.
// En horizontal la cabeza del rival más alto del fondo queda justo debajo de la franja de arriba y mi
// orilla de la mesa se sale por abajo (si la pantalla es muy alta, se acerca más para que no quede flotando).
// En vertical la mesa queda limitada por el ancho: mi orilla se esconde detrás de la barra y los rivales
// se agrandan (`v.grow`) para llenar el espacio de arriba.
export function fit(v, headWorld, cam) {
  const { W, H, top, reserve, portrait } = v;
  const backs = LAYOUTS.flat().filter(s => s.row === 'back').map(s => rimPoint(s.ang));
  v.F = 1; v.cx = 0; v.cy = 0;
  const halfWidth = Math.max(...TABLE_EDGE.map(p => Math.abs(v.project(p.x, RAIL_Y, p.z).x)));
  const headY = Math.min(...backs.map(p => { const q = v.project(p.x, RAIL_Y, p.z); return q.y - q.s * headWorld; }));
  const nearY = v.project(0, RAIL_Y, NEAR_Z).y;
  const wantHead = top + cam.headGap;
  // en horizontal mi orilla queda debajo de la pantalla; en vertical, escondida detrás de la barra
  // (en el celular, detrás de mis cartas: `near`)
  const wantNear = v.near ?? (portrait ? H - reserve * 0.62 : H + 8);
  const byWidth = (cam.width * W) / 2 / halfWidth;
  const byHeight = (wantNear - wantHead) / (nearY - headY);
  v.cx = W / 2;
  v.grow = 1;
  if (portrait) {
    v.F = byWidth;
    v.cy = wantNear - v.F * nearY;
    const room = Math.min(...backs.map(p => { const q = v.project(p.x, RAIL_Y, p.z); return (q.y - wantHead) / (q.s * headWorld); }));
    if (room >= 1) { v.grow = Math.min(room, cam.maxGrow || 1); return v; }
  } else {
    // en pantallas muy bajitas (celular acostado) se aleja lo necesario para que el centro de la mesa
    // quede arriba de la barra de acciones, aunque la mesa ya no se salga por los lados
    const centerY = v.project(0, 0, 0).y;
    const byCenter = (H - reserve - 30 - wantHead) / (centerY - headY);
    v.F = Math.max(1, Math.min(Math.max(byWidth, byHeight), byCenter));
  }
  v.cy = wantHead - v.F * headY;
  return v;
}

// Lo más alto (en px) que llega la cabeza de un rival del fondo, con cualquier acomodo.
export function headTop(v, headWorld) {
  const backs = LAYOUTS.flat().filter(s => s.row === 'back').map(s => rimPoint(s.ang));
  return Math.min(...backs.map(p => { const q = v.project(p.x, RAIL_Y, p.z); return q.y - q.s * headWorld * v.grow; }));
}

// Polígono convexo de la silueta de la mesa en pantalla (riel arriba + canto abajo).
export function tableOutline(v) {
  const top = edgeRing(1, RAIL_Y).map(p => v.project(p.x, p.y, p.z));
  const bottom = edgeRing(1, RAIL_Y - APRON).map(p => v.project(p.x, p.y, p.z));
  return hull([...top, ...bottom]);
}

// Lo que queda delante de la orilla de la mesa: todo lo que está debajo de la línea de arriba de su silueta,
// alargada en horizontal más allá de las orillas de la pantalla. Ahí se recorta a los rivales.
export function frontRegion(outline) {
  const n = outline.length;
  let iL = 0, iR = 0;
  outline.forEach((p, i) => { if (p.x < outline[iL].x) iL = i; if (p.x > outline[iR].x) iR = i; });
  const walk = step => { const out = []; for (let i = iL; ; i = (i + step + n) % n) { out.push(outline[i]); if (i === iR) return out; } };
  const a = walk(1), b = walk(-1);
  const avg = c => c.reduce((s, p) => s + p.y, 0) / c.length;
  const line = avg(a) <= avg(b) ? a : b; // la cadena de arriba (y menor en pantalla)
  const L = line[0], R = line[line.length - 1], BIG = 1e5;
  return [{ x: -BIG, y: L.y }, ...line, { x: BIG, y: R.y }, { x: BIG, y: BIG }, { x: -BIG, y: BIG }];
}

// Altura en pantalla de la línea de arriba de la orilla en la columna x.
export function edgeYAt(region, x) {
  const span = colSpan(region, x);
  return span ? span[0] : null;
}
function colSpan(poly, x) {
  let a = Infinity, b = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if ((p.x - x) * (q.x - x) > 0 || p.x === q.x) continue;
    const y = p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y);
    a = Math.min(a, y); b = Math.max(b, y);
  }
  return a <= b ? [a, b] : null;
}

function hull(points) {
  const p = points.map(q => ({ x: q.x, y: q.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// La parte del polígono que queda debajo de la fila y (recorte de Sutherland-Hodgman con una recta).
export function belowRow(poly, y) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const pin = p.y >= y, qin = q.y >= y;
    if (pin) out.push(p);
    if (pin !== qin) out.push({ x: p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x), y });
  }
  return out;
}

// Generador de números al azar con semilla, para que la mugre y el desorden sean siempre iguales.
export function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
