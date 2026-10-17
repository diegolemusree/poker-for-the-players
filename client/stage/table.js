// La capa de la mesa. En la computadora es la ilustración (public/assets/arte/mesa-*.webp, puesta con su proyección
// de mesa.json) con la sombra en el piso detrás y el brillo cálido de la lámpara encima. Si no hay ilustración (en
// vertical o si no cargó) se dibuja la mesa de código, imitando las ilustraciones: la orilla de config.js en
// perspectiva, riel de madera café oscuro, fieltro verde apagado con un octágono central más oscuro y una línea
// dorada en forma de pista, línea tinta delgada y uniforme, una sola sombra plana, mugre y el charco de luz de la
// lámpara. Se dibuja solo al cambiar el tamaño, por capas: la sombra en el piso, el cuerpo de la mesa, la luz y la
// tinta.

import { edgeRing, tableOutline, artOutline, TABLE_ART, RAIL_Y, APRON, FELT_R, TRACK_R, CENTER_R, NEAR_Z, FAR_Z, mulberry } from './projection.js';

export const INK = '#1d1611';
const WOOD = '#6e4026', GRAIN = 'rgba(38,18,8,0.32)', WOOD_WALL = '#4f2c18', APRON_C = '#41241a';
const FELT = '#577a3d', FELT_CENTER = '#4b6b35', FELT_SHADE = 'rgba(24,36,12,0.34)', GOLD = '#c9a03a';
const NEAR_SHADE = 1.5; // de mi lado la sombra de las orillas empieza más lejos del centro (mi riel se ve abajo)

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

// Lo que se calcula una vez por tamaño: las orillas en pantalla y qué lados dan hacia la cámara.
function parts(v) {
  const P = p => v.project(p.x, p.y, p.z);
  const top = edgeRing(1, RAIL_Y), bottom = edgeRing(1, RAIL_Y - APRON), N = top.length;
  const faces = k => { // el lado k (entre las esquinas k y k+1) mira hacia la cámara?
    const a = top[k], b = top[(k + 1) % N];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, n = Math.hypot(mx, mz);
    return (-mx * mx / n) + ((v.cam.z - mz) * mz / n) > 0;
  };
  return {
    P, top, N, faces, rimTop: top.map(P), rimBottom: bottom.map(P),
    railIn: edgeRing(FELT_R, RAIL_Y).map(P), feltIn: edgeRing(FELT_R, 0).map(P),
    center: edgeRing(CENTER_R, 0).map(P), track: edgeRing(TRACK_R, 0).map(P),
    shade: edgeRing(FELT_R - 0.05, 0).map(P), outline: tableOutline(v),
  };
}

// Dibuja la mesa completa. `line` es el grueso de la línea de tinta en px de pantalla. Con `art` (la imagen de la
// mesa ilustrada ya cargada), la ilustración. Regresa la silueta de lo que dibujó (ahí se recorta a los rivales).
export function drawTable(g, v, line, art = null) {
  const m = parts(v);
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (art) {
    // la ilustración a la escala de esta vista, anclada en su proyección; encima la luz (que se queda solo sobre la
    // mesa: se recorta con la misma imagen) y detrás la sombra en el piso
    const k = v.F / TABLE_ART.F, [w, h] = TABLE_ART.sizes[TABLE_ART.sizes.length - 1];
    const put = () => g.drawImage(art, v.cx - TABLE_ART.cx * k, v.cy - TABLE_ART.cy * k, w * k, h * k);
    const outline = artOutline(v);
    put();
    drawLampLight(g, { ...m, outline }, ART_SHADE);
    g.save();
    g.globalCompositeOperation = 'destination-in'; put();
    g.globalCompositeOperation = 'destination-over'; drawFloorShadow(g, m);
    g.restore();
    return outline;
  }
  drawFloorShadow(g, m);
  drawBody(g, v, m, line, true);
  drawLampLight(g, m);
  drawInk(g, m, line);
  return m.outline;
}
// sobre la ilustración, las orillas se oscurecen menos: ya trae su propio sombreado
const ART_SHADE = 0.45;

// sombra plana de la mesa sobre el piso, un poco corrida hacia abajo
function drawFloorShadow(g, { P }) {
  g.fillStyle = 'rgba(14,8,4,0.42)';
  g.beginPath(); poly(g, edgeRing(1.04, -0.32).map(p => P({ ...p, z: p.z + 0.04 }))); g.fill();
}

// Fieltro, pared interior, canto y riel, en ese orden: el riel va encima del fieltro, así que de mi lado (donde el
// fieltro, más abajo, se asoma por debajo de la orilla de adentro del riel) lo tapa justo en esa orilla.
// Con `dirt`, la mugre encima.
function drawBody(g, v, m, line, dirt) {
  const { P, top, N, faces, rimTop, rimBottom, railIn, feltIn, center, shade, outline } = m;
  // fieltro, su octágono central y la sombra plana del riel sobre el fieltro
  g.beginPath(); poly(g, feltIn); g.fillStyle = FELT; g.fill();
  g.beginPath(); poly(g, center); g.fillStyle = FELT_CENTER; g.fill();
  g.beginPath(); poly(g, feltIn); poly(g, shade); g.fillStyle = FELT_SHADE; g.fill('evenodd');

  // pared interior del riel (se ve del lado lejano)
  for (let k = 0; k < N; k++) {
    if (faces(k)) continue;
    const j = (k + 1) % N;
    g.beginPath(); poly(g, [railIn[k], railIn[j], feltIn[j], feltIn[k]]);
    g.fillStyle = WOOD_WALL; g.fill();
  }

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
  if (!dirt) return;

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
}

// luz de la lámpara (cuelga sobre el centro): brillo cálido suave en el centro del fieltro y las orillas
// más oscuras. Va en la capa de la mesa, debajo de cartas y fichas, así que no cambia sus colores.
// El charco es una elipse en pantalla que cubre de la orilla lejana a la cercana del fieltro (la mitad
// cercana se ve más grande por la perspectiva, por eso su centro no es el centro proyectado).
function drawLampLight(g, { P, outline }, shade = 1) {
  const yFar = P({ x: 0, y: 0, z: FAR_Z * FELT_R }).y, yNear = P({ x: 0, y: 0, z: NEAR_Z * FELT_R }).y;
  const cy = (yFar + yNear) / 2, ry = (yNear - yFar) / 2;
  const mid = P({ x: 0, y: 0, z: 0 }), rx = P({ x: FELT_R, y: 0, z: 0 }).x - mid.x;
  g.save();
  g.beginPath(); poly(g, outline); g.clip();
  g.translate(mid.x, cy); g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, 'rgba(255,208,125,0.42)'); gr.addColorStop(0.4, 'rgba(255,200,110,0.3)');
  gr.addColorStop(0.75, 'rgba(255,190,100,0.1)'); gr.addColorStop(1, 'rgba(255,190,100,0)');
  g.globalCompositeOperation = 'screen';
  g.fillStyle = gr; g.fillRect(-rx * 1.5, -rx * 1.5, rx * 3, rx * 3);
  g.restore();
  // las orillas más oscuras; de mi lado la sombra se estira hacia abajo (NEAR_SHADE), para que mi riel, que se ve
  // abajo de la pantalla, siga viéndose como madera. Las dos mitades coinciden en la fila del centro, que cae justo
  // en un pixel para que no se note la unión.
  const px = g.getTransform().a || 1, cut = Math.round(cy * px) / px;
  for (const [k, y0, y1] of [[1, -1e4, cut], [NEAR_SHADE, cut, 1e4]]) {
    g.save();
    g.beginPath(); poly(g, outline); g.clip();
    g.beginPath(); g.rect(-1e4, y0, 2e4, y1 - y0); g.clip();
    g.translate(mid.x, cy); g.scale(1, (ry * k) / rx);
    const sh = g.createRadialGradient(0, 0, rx * 0.62, 0, 0, rx * 1.3);
    sh.addColorStop(0, 'rgba(60,38,20,0)'); sh.addColorStop(1, `rgba(60,38,20,${0.6 * shade})`);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = sh; g.fillRect(-rx * 6, -rx * 6, rx * 12, rx * 12);
    g.restore();
  }
}

// tinta: orilla de afuera, orilla de adentro del riel, fieltro contra la pared y octágono central; y la línea
// dorada en forma de pista, delgada, siguiendo la forma de la mesa
function drawInk(g, { N, faces, rimTop, railIn, feltIn, center, track }, line) {
  g.strokeStyle = INK;
  g.lineWidth = line; g.beginPath(); poly(g, rimTop); g.stroke();
  g.beginPath(); poly(g, railIn); g.stroke();
  // el fieltro contra la pared solo adentro de la orilla del riel (en las diagonales de mi lado se alargaría por
  // debajo de la esquina, sobre la madera)
  g.save();
  g.beginPath(); poly(g, railIn); g.clip();
  for (let k = 0; k < N; k++) {
    if (faces(k)) continue;
    const j = (k + 1) % N;
    g.beginPath(); g.moveTo(feltIn[k].x, feltIn[k].y); g.lineTo(feltIn[j].x, feltIn[j].y); g.stroke();
  }
  g.restore();
  g.lineWidth = line * 0.8; g.beginPath(); poly(g, center); g.stroke();
  g.lineWidth = line * 1.5; g.strokeStyle = GOLD; g.globalAlpha = 0.85;
  g.beginPath(); poly(g, track); g.stroke();
  g.globalAlpha = 1;
}
