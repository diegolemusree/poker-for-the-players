// La mesa provisional dibujada con canvas imitando las ilustraciones: la orilla de config.js en
// perspectiva, riel de madera café oscuro, fieltro verde apagado con un octágono central más oscuro y
// una línea dorada en forma de pista, línea tinta delgada y uniforme, una sola sombra plana, mugre y el
// charco de luz cálida de la lámpara. Se dibuja solo al cambiar el tamaño. Después será una ilustración.

import { edgeRing, tableOutline, RAIL_Y, APRON, FELT_R, TRACK_R, CENTER_R, NEAR_Z, FAR_Z, mulberry } from './projection.js';

export const INK = '#1d1611';
const WOOD = '#6e4026', GRAIN = 'rgba(38,18,8,0.32)', WOOD_WALL = '#4f2c18', APRON_C = '#41241a';
const FELT = '#577a3d', FELT_CENTER = '#4b6b35', FELT_SHADE = 'rgba(24,36,12,0.34)', GOLD = '#c9a03a';

function poly(g, pts, close = true) {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (close) g.closePath();
}

// Baldosa de mugre: motas, manchas y rayones. Se hace una vez y se repite.
let dirt = null;
function dirtTile() {
  if (dirt) return dirt;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = mulberry(7);
  for (let i = 0; i < 7; i++) {
    const x = r() * 256, y = r() * 256, rad = 20 + r() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(30,20,10,${0.05 + r() * 0.06})`); gr.addColorStop(1, 'rgba(30,20,10,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 1600; i++) {
    const light = r() < 0.25;
    g.fillStyle = light ? `rgba(255,240,205,${0.04 + r() * 0.06})` : `rgba(25,16,8,${0.06 + r() * 0.16})`;
    g.beginPath(); g.arc(r() * 256, r() * 256, 0.4 + r() * 1.1, 0, Math.PI * 2); g.fill();
  }
  g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const x = r() * 256, y = r() * 256, a = r() * Math.PI, l = 6 + r() * 22;
    g.strokeStyle = `rgba(255,235,200,${0.06 + r() * 0.06})`; g.lineWidth = 0.6 + r() * 0.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  dirt = c;
  return c;
}

// Dibuja la mesa completa. `line` es el grueso de la línea de tinta en px de pantalla.
export function drawTable(g, v, line) {
  const P = p => v.project(p.x, p.y, p.z);
  const top = edgeRing(1, RAIL_Y), bottom = edgeRing(1, RAIL_Y - APRON), N = top.length;
  const rimTop = top.map(P), rimBottom = bottom.map(P);
  const railIn = edgeRing(FELT_R, RAIL_Y).map(P), feltIn = edgeRing(FELT_R, 0).map(P);
  const center = edgeRing(CENTER_R, 0).map(P), track = edgeRing(TRACK_R, 0).map(P);
  const shade = edgeRing(FELT_R - 0.05, 0).map(P);
  const outline = tableOutline(v);
  const faces = k => { // el lado k (entre las esquinas k y k+1) mira hacia la cámara?
    const a = top[k], b = top[(k + 1) % N];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, n = Math.hypot(mx, mz);
    return (-mx * mx / n) + ((v.cam.z - mz) * mz / n) > 0;
  };
  g.lineJoin = 'round'; g.lineCap = 'round';

  // sombra plana de la mesa sobre el piso, un poco corrida hacia abajo
  g.fillStyle = 'rgba(14,8,4,0.42)';
  g.beginPath(); poly(g, edgeRing(1.04, -0.32).map(p => P({ ...p, z: p.z + 0.04 }))); g.fill();

  // canto de la mesa en los lados que dan hacia mí
  for (let k = 0; k < N; k++) {
    if (!faces(k)) continue;
    const j = (k + 1) % N;
    g.beginPath(); poly(g, [rimTop[k], rimTop[j], rimBottom[j], rimBottom[k]]);
    g.fillStyle = APRON_C; g.fill();
    g.lineWidth = line; g.strokeStyle = INK; g.stroke();
  }

  // riel de madera
  g.beginPath(); poly(g, rimTop); poly(g, railIn);
  g.fillStyle = WOOD; g.fill('evenodd');
  g.save();
  g.beginPath(); poly(g, rimTop); poly(g, railIn); g.clip('evenodd');
  const r = mulberry(11);
  g.strokeStyle = GRAIN;
  for (let k = 0; k < N; k++) { // vetas a lo largo de cada tabla del riel
    const a = top[k], b = top[(k + 1) % N];
    for (let i = 0; i < 4; i++) {
      const f = 0.88 + r() * 0.11, t0 = r() * 0.3, t1 = 0.6 + r() * 0.4;
      const p0 = P({ x: (a.x + (b.x - a.x) * t0) * f, y: RAIL_Y, z: (a.z + (b.z - a.z) * t0) * f });
      const p1 = P({ x: (a.x + (b.x - a.x) * t1) * f, y: RAIL_Y, z: (a.z + (b.z - a.z) * t1) * f });
      g.lineWidth = line * (0.4 + r() * 0.4);
      g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke();
    }
  }
  g.restore();
  // juntas entre las tablas del riel
  g.lineWidth = line * 0.7; g.strokeStyle = INK;
  for (let k = 0; k < N; k++) { g.beginPath(); g.moveTo(rimTop[k].x, rimTop[k].y); g.lineTo(railIn[k].x, railIn[k].y); g.stroke(); }

  // pared interior del riel (se ve del lado lejano)
  for (let k = 0; k < N; k++) {
    if (faces(k)) continue;
    const j = (k + 1) % N;
    g.beginPath(); poly(g, [railIn[k], railIn[j], feltIn[j], feltIn[k]]);
    g.fillStyle = WOOD_WALL; g.fill();
  }

  // fieltro, su octágono central y la sombra plana del riel sobre el fieltro
  g.beginPath(); poly(g, feltIn); g.fillStyle = FELT; g.fill();
  g.beginPath(); poly(g, center); g.fillStyle = FELT_CENTER; g.fill();
  g.beginPath(); poly(g, feltIn); poly(g, shade); g.fillStyle = FELT_SHADE; g.fill('evenodd');

  // mugre: la baldosa sobre toda la mesa y unos aros de vaso en el fieltro y el riel
  g.save();
  g.beginPath(); poly(g, outline); g.clip();
  g.globalAlpha = 0.9;
  g.fillStyle = g.createPattern(dirtTile(), 'repeat');
  g.fillRect(0, 0, v.W, v.H);
  g.globalAlpha = 1;
  for (const [x, z, rad, a] of [[-0.42, -0.28, 0.07, 0.16], [0.5, 0.05, 0.06, 0.13], [0.82, -0.42, 0.05, 0.2], [-0.2, 0.5, 0.05, 0.1]]) {
    const ring = Array.from({ length: 24 }, (_, i) => P({ x: x + Math.cos(i / 24 * Math.PI * 2) * rad, y: 0, z: z + Math.sin(i / 24 * Math.PI * 2) * rad }));
    g.beginPath(); poly(g, ring);
    g.lineWidth = line * 1.6; g.strokeStyle = `rgba(40,22,10,${a})`; g.stroke();
  }
  g.restore();

  // luz de la lámpara (cuelga sobre el centro): brillo cálido suave en el centro del fieltro y las orillas
  // más oscuras. Va en la capa de la mesa, debajo de cartas y fichas, así que no cambia sus colores.
  // El charco es una elipse en pantalla que cubre de la orilla lejana a la cercana del fieltro (la mitad
  // cercana se ve más grande por la perspectiva, por eso su centro no es el centro proyectado).
  const yFar = P({ x: 0, y: 0, z: FAR_Z * FELT_R }).y, yNear = P({ x: 0, y: 0, z: NEAR_Z * FELT_R }).y;
  const cy = (yFar + yNear) / 2, ry = (yNear - yFar) / 2;
  const mid = P({ x: 0, y: 0, z: 0 }), rx = P({ x: FELT_R, y: 0, z: 0 }).x - mid.x;
  g.save();
  g.beginPath(); poly(g, outline); g.clip();
  g.translate(mid.x, cy); g.scale(1, ry / rx);
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, 'rgba(255,208,125,0.42)'); gr.addColorStop(0.4, 'rgba(255,200,110,0.3)');
  gr.addColorStop(0.75, 'rgba(255,190,100,0.1)'); gr.addColorStop(1, 'rgba(255,190,100,0)');
  g.globalCompositeOperation = 'screen';
  g.fillStyle = gr; g.fillRect(-rx * 1.5, -rx * 1.5, rx * 3, rx * 3);
  gr = g.createRadialGradient(0, 0, rx * 0.62, 0, 0, rx * 1.3);
  gr.addColorStop(0, 'rgba(60,38,20,0)'); gr.addColorStop(1, 'rgba(60,38,20,0.6)');
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = gr; g.fillRect(-rx * 2.5, -rx * 2.5, rx * 5, rx * 5);
  g.restore();

  // tinta: orilla de afuera, orilla de adentro del riel, fieltro contra la pared y octágono central
  g.strokeStyle = INK;
  g.lineWidth = line; g.beginPath(); poly(g, rimTop); g.stroke();
  g.beginPath(); poly(g, railIn); g.stroke();
  for (let k = 0; k < N; k++) {
    if (faces(k)) continue;
    const j = (k + 1) % N;
    g.beginPath(); g.moveTo(feltIn[k].x, feltIn[k].y); g.lineTo(feltIn[j].x, feltIn[j].y); g.stroke();
  }
  g.lineWidth = line * 0.8; g.beginPath(); poly(g, center); g.stroke();
  // línea dorada en forma de pista, delgada, siguiendo la forma de la mesa
  g.lineWidth = line * 1.5; g.strokeStyle = GOLD; g.globalAlpha = 0.85;
  g.beginPath(); poly(g, track); g.stroke();
  g.globalAlpha = 1;
  return outline;
}
