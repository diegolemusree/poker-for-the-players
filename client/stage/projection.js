// Perspectiva de la mesa vista desde mi asiento. Una sola cámara convierte cualquier punto de la mesa
// a pixeles de pantalla: la mesa, las cartas, las fichas, los asientos y las etiquetas la usan todos,
// así que todo comparte la misma perspectiva aunque se dibuje en 2D.
//
// Mundo: la mesa es un octágono de radio 1 (a las esquinas) centrado en el origen, con el fieltro en y = 0.
// x crece a la derecha, z hacia mí (mi lado es z > 0), y hacia arriba.

export const DEG = Math.PI / 180;
export const APOTHEM = Math.cos(22.5 * DEG); // del centro a la mitad de cada lado
export const RAIL_Y = 0.03;    // el riel de madera queda un poco más alto que el fieltro
export const APRON = 0.1;      // grueso del canto de la mesa
export const FELT_R = 0.85;    // donde termina la madera y empieza el fieltro
export const CENTER_R = 0.5;   // octágono central más oscuro

// Lados del octágono donde se sientan los rivales (ángulo desde el centro; 90° = mi lado). Los de las
// diagonales y los lados se corren un poco hacia el fondo para que no se tapen entre ellos.
export const SLOT = { L: 192, FL: 234, F: 270, FR: 306, R: 348 };
// Con pocos rivales se reparten para que la mesa se vea pareja (1 rival: enfrente).
export const SPREAD = [[], ['F'], ['FL', 'FR'], ['FL', 'F', 'FR'], ['L', 'FL', 'FR', 'R'], ['L', 'FL', 'F', 'FR', 'R']];

export function octagon(r = 1, y = 0) {
  return Array.from({ length: 8 }, (_, k) => {
    const t = (22.5 + 45 * k) * DEG;
    return { x: r * Math.cos(t), y, z: r * Math.sin(t) };
  });
}
export const dirOf = deg => ({ x: Math.cos(deg * DEG), z: Math.sin(deg * DEG) });
// Distancia del centro a la orilla de la mesa en la dirección `deg`.
export function rimR(deg) {
  const off = ((deg % 45) + 45) % 45; // los lados están centrados en múltiplos de 45°
  return APOTHEM / Math.cos(Math.min(off, 45 - off) * DEG);
}

// Cámara de toma de serie: algo alta, mirando hacia abajo al centro de la mesa.
// `fit` escoge la escala para que la mesa y los rivales quepan entre la franja de arriba y la barra de abajo.
export function makeView({ W, H, top, reserve, portrait }) {
  const pitch = (portrait ? 43 : 38) * DEG, dist = portrait ? 3.3 : 3.4;
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const C = { y: dist * sp, z: dist * cp + (portrait ? 0.05 : 0.1) };
  const v = { W, H, F: 1, cx: 0, cy: 0, pitch, portrait, reserve, top, cam: { x: 0, y: C.y, z: C.z } };
  v.project = (x, y, z) => {
    const dy = y - C.y, dz = z - C.z;
    const depth = -dy * sp - dz * cp;
    const up = dy * cp - dz * sp;
    const s = v.F / depth;
    return { x: v.cx + x * s, y: v.cy - up * s, s, depth };
  };
  return v;
}

// Ajusta escala y centro: el borde cercano abajo, la cabeza del rival de enfrente debajo de la franja,
// y que la mesa no se salga de lado (en vertical se permite un poco, como acordamos).
export function fit(v, headWorld) {
  const rim = octagon(1, RAIL_Y);
  const pts = rim.map(p => v.project(p.x, p.y, p.z));
  const near = v.project(0, RAIL_Y, APOTHEM);
  const far = v.project(0, RAIL_Y, -APOTHEM);
  const nearY = near.y, headY = far.y - far.s * headWorld;
  const width = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
  const { W, H, top, reserve, portrait } = v;
  // dónde quiere quedar el borde cercano: en horizontal al fondo de la pantalla; en vertical arriba de la barra
  const wantNear = portrait ? H - reserve * 0.55 : H + 6;
  const wantHead = top + (portrait ? 56 : 64);
  const byHeight = (wantNear - wantHead) / (nearY - headY);
  const byWidth = (portrait ? 1.1 : 0.9) * W / width;
  v.F = Math.min(byHeight, byWidth);
  v.cx = W / 2;
  v.cy = wantNear - v.F * nearY;
  return v;
}

// Polígono convexo de la silueta de la mesa en pantalla (riel arriba + canto abajo).
export function tableOutline(v) {
  const top = octagon(1, RAIL_Y).map(p => v.project(p.x, p.y, p.z));
  const bottom = octagon(1, RAIL_Y - APRON).map(p => v.project(p.x, p.y, p.z));
  return hull([...top, ...bottom]);
}

function hull(points) {
  const p = points.map(q => ({ x: q.x, y: q.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// De dónde a dónde (en x) ocupa el polígono en la fila y; null si no la toca.
export function rowSpan(poly, y) {
  let a = Infinity, b = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if ((p.y - y) * (q.y - y) > 0 || p.y === q.y) continue;
    const x = p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x);
    a = Math.min(a, x); b = Math.max(b, x);
  }
  return a <= b ? [a, b] : null;
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

// Punto del fieltro (y = 0) que cae en la fila de pantalla `sy` sobre la línea x = 0.
export function feltZAtRow(v, sy, y = 0) {
  let a = -APOTHEM, b = APOTHEM * 1.6;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (v.project(0, y, m).y < sy) a = m; else b = m;
  }
  return (a + b) / 2;
}

// Generador de números al azar con semilla, para que la mugre y el desorden sean siempre iguales.
export function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
