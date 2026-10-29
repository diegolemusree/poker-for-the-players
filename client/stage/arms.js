// Mis brazos en primera persona (solo en la computadora; "Brazos del jugador" en CLAUDE.md): el izquierdo tiene mis
// cartas y el derecho juega con mis fichas. Cada personaje trae el arte de sus brazos en personajes.json (`brazos`) o,
// mientras no lo tenga completo, se dibujan siluetas de relleno de su `color` (RELLENO, con el mismo formato). Aquí va lo
// que no depende de la pantalla (el contrato, qué pose toca, el empujón, asomarse, el loop de las fichas) y el dibujo de
// la capa; la escena (index.js) dice dónde caen mis cartas, mi pila y el bote. Lo que hacen los brazos lo ve solo mi
// pantalla: nada pasa por el servidor. No toca document ni matchMedia al importarse (lo prueba test/brazos.test.js).
//
// El contrato, en fracciones de la imagen (de 0 a 1 desde arriba a la izquierda, como waist y face):
//   brazos.izquierdo | brazos.derecho
//     size   tamaño de la imagen grande: todas las poses de un brazo en el mismo lienzo y alineadas
//     ancla  el punto de la imagen que cae en la mesa: el del izquierdo, en el centro de mis dos cartas; el del derecho,
//            junto a mi pila (a su derecha)
//     alto   lo que mide la imagen de alto en unidades de la mesa (como `height` de los rivales)
//     mano   (opcional) [izquierda, arriba, derecha, abajo]: lo que ocupa la mano en todas las poses juntas, sin el
//            antebrazo (la mide optimizar-arte.py brazos); sin ella, una caja genérica alrededor del ancla
//     poses  izquierdo: ver, ocultar y vacio; derecho: descansar y jugar. Cada una con su `archivo` (sin carpeta ni
//            extensión: /<carpeta>/<archivo>.webp, y -chico.webp en calidad baja) y, según la pose:
//              ver.cartas    [{ c, ancho, angulo }, { … }]: el centro, el ancho (fracción del ancho de la imagen) y el
//                            giro en grados de cada carta en la mano
//              ver.pulgar    { archivo, caja }: el pulgar, que va encima de las cartas, y la caja que ocupa sobre el
//                            brazo (su imagen viene recortada a esa caja; [0, 0, 1, 1] si viene en el mismo lienzo)
//              jugar.fichas  el punto del fieltro donde van las fichas con que juega (su tamaño lo da la mesa)
// `color` es del personaje, no de `brazos`: el de sus manos, para el relleno.

import { CARD_W, CARD_H, CHIP_R, CHIP_H, FOLD, cardCorners, drawCard, drawFlap, chipColumn } from './items.js';
import { drawFlatCard, CARD_PX } from './cards.js';
import { INK } from './table.js';
import { downscale } from './rivals.js';
import { loadImage, artUrl } from './characters.js';
import { stackBreakdown } from '../chips.js';

const DEG = Math.PI / 180;
export const LADOS = ['izquierdo', 'derecho'];
export const POSES_BRAZO = { izquierdo: ['ver', 'ocultar', 'vacio'], derecho: ['descansar', 'jugar'] };
export const COLOR_POR_OMISION = '#c9a27e';

/* ---------- el contrato ---------- */

// Lo que les falta a los brazos de un personaje para usar su arte (vacío: están completos). `existe(archivo)` dice si su
// imagen está: en el juego no se sabe hasta cargarla (se supone que sí; si no carga, el relleno) y las pruebas revisan
// el disco.
export function faltanBrazos(b, existe = () => true) {
  if (!b || typeof b !== 'object') return ['sin brazos'];
  const faltan = [];
  const dentro = v => typeof v === 'number' && v >= 0 && v <= 1;
  const punto = p => Array.isArray(p) && p.length === 2 && p.every(dentro);
  const caja = c => Array.isArray(c) && c.length === 4 && c.every(dentro) && c[0] < c[2] && c[1] < c[3];
  const imagen = (archivo, donde) => {
    if (typeof archivo !== 'string' || !archivo) faltan.push(`${donde}: sin archivo`);
    else if (!existe(archivo)) faltan.push(`${donde}: no está ${archivo}`);
  };
  for (const lado of LADOS) {
    const a = b[lado];
    if (!a || typeof a !== 'object') { faltan.push(`sin ${lado}`); continue; }
    if (!(Array.isArray(a.size) && a.size.length === 2 && a.size.every(n => n > 0))) faltan.push(`${lado}: size`);
    if (!punto(a.ancla)) faltan.push(`${lado}: ancla`);
    if (!(a.alto > 0)) faltan.push(`${lado}: alto`);
    if (a.mano !== undefined && !caja(a.mano)) faltan.push(`${lado}: mano`);
    for (const pose of POSES_BRAZO[lado]) {
      const p = a.poses && a.poses[pose];
      if (!p) faltan.push(`${lado}: sin ${pose}`);
      else imagen(p.archivo, `${lado} ${pose}`);
    }
  }
  const ver = b.izquierdo && b.izquierdo.poses && b.izquierdo.poses.ver;
  if (ver) {
    const carta = c => c && punto(c.c) && c.ancho > 0 && c.ancho <= 1 && Number.isFinite(c.angulo);
    if (!(Array.isArray(ver.cartas) && ver.cartas.length === 2 && ver.cartas.every(carta))) faltan.push('izquierdo ver: cartas');
    if (!ver.pulgar) faltan.push('izquierdo ver: sin pulgar');
    else {
      imagen(ver.pulgar.archivo, 'izquierdo ver pulgar');
      if (!caja(ver.pulgar.caja)) faltan.push('izquierdo ver pulgar: caja');
    }
  }
  const jugar = b.derecho && b.derecho.poses && b.derecho.poses.jugar;
  if (jugar && !punto(jugar.fichas)) faltan.push('derecho jugar: fichas');
  return faltan;
}

// Los archivos del arte de unos brazos (sin carpeta ni extensión).
export const archivosBrazos = b => [
  ...POSES_BRAZO.izquierdo.map(p => b.izquierdo.poses[p].archivo), b.izquierdo.poses.ver.pulgar.archivo,
  ...POSES_BRAZO.derecho.map(p => b.derecho.poses[p].archivo),
];

// Con qué se dibujan los brazos de un personaje (el de CHARACTERS): su arte si está completo (`arte: true`) o, si le falta
// cualquier pieza, las siluetas de relleno de su color con las anclas por defecto: todo o nada. Nunca truena: sin
// personaje o sin color, el color por omisión.
export function brazosDe(personaje, existe) {
  const color = personaje && /^#[0-9a-f]{6}$/i.test(personaje.color || '') ? personaje.color : COLOR_POR_OMISION;
  const faltan = faltanBrazos(personaje && personaje.brazos, existe);
  const b = faltan.length ? RELLENO : personaje.brazos;
  return { arte: !faltan.length, color, faltan, izquierdo: b.izquierdo, derecho: b.derecho };
}

/* ---------- reglas ---------- */

// Si hay brazos: en la computadora (hover y puntero fino, lo dice ui/phone.js), en la mesa ilustrada en horizontal (en
// vertical va la mesa de código, con otra cámara) y sentado. La misma regla para la escena y para los botones.
export const brazosVisibles = ({ compu, W, H, sentado }) => !!(compu && sentado && W > 0 && H > 0 && W / H >= 0.9);

// Qué pose toca a cada brazo. `conCartas`: tengo mis dos cartas (no me retiré); `enseño`: al final de la mano mis cartas
// se enseñan (entonces se ven solas, con sus marcas); `cartas`: lo que elegí, 'ver' u 'ocultas'; `asomo`: estoy
// manteniendo Asomarse; `fichas`: elegí jugar con fichas; `pila`: mis fichas (sin fichas, la mano descansa).
export function posesDe({ conCartas, enseño, cartas, asomo, fichas, pila }) {
  const izquierdo = !conCartas ? 'vacio' : enseño || cartas !== 'ocultas' ? 'ver' : 'ocultar';
  return { izquierdo, asoma: izquierdo === 'ocultar' && !!asomo, derecho: fichas && pila > 0 ? 'jugar' : 'descansar' };
}

// Las capas de cada pose, de atrás hacia adelante (en ese orden las dibuja la capa de brazos). 'cartas': las mías boca
// abajo sobre la mesa; 'esquinas': lo que se levanta de ellas al asomarme (en el aire, encima de la mano); 'fichas': las
// columnitas con que juego; 'brinco': la ficha que va en el aire.
export function capas(lado, pose) {
  if (lado === 'izquierdo') {
    if (pose === 'ver') return ['brazo', 'carta1', 'carta2', 'pulgar'];
    if (pose === 'ocultar') return ['cartas', 'brazo', 'esquinas'];
    return ['brazo'];
  }
  return pose === 'jugar' ? ['fichas', 'brazo', 'brinco'] : ['brazo'];
}
// Las que se mueven con el brazo al empujar (las de la mesa se quedan donde están).
const EN_MANO = new Set(['brazo', 'carta1', 'carta2', 'pulgar']);

/* ---------- movimientos ---------- */

// Empujón al igualar, apostar o subir: hacia el bote (`largo` en unidades de la mesa) y un poco más chico, ida con
// ease-out y regreso.
export const EMPUJON = { ida: 250, regreso: 200, escala: 0.92, largo: 0.05 };
// Cuánto va del empujón a `t` ms de empezado: 0 en reposo, 1 hasta adelante.
export function empujon(t) {
  if (!(t >= 0) || t >= EMPUJON.ida + EMPUJON.regreso) return 0;
  if (t < EMPUJON.ida) return 1 - (1 - t / EMPUJON.ida) ** 3;
  const k = (t - EMPUJON.ida) / EMPUJON.regreso;
  return 1 - (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
}

// Asomarse: la esquina sube en `sube` ms y, al soltar, baja en `baja` (con movimiento reducido, de golpe).
export const ASOMO = { sube: 180, baja: 150 };
export class Asomo {
  constructor() { this.desde = 0; this.hacia = 0; this.t0 = -Infinity; this.ms = 0; }
  en(now) {
    const k = this.ms > 0 ? Math.min(1, Math.max(0, (now - this.t0) / this.ms)) : 1;
    return this.desde + (this.hacia - this.desde) * (1 - (1 - k) ** 2);
  }
  poner(hacia, now, deGolpe = false) {
    if (hacia === this.hacia) return;
    this.desde = deGolpe ? hacia : this.en(now);
    this.hacia = hacia;
    this.t0 = now;
    this.ms = deGolpe ? 0 : hacia > this.desde ? ASOMO.sube : ASOMO.baja;
  }
  moviendo(now) { return this.ms > 0 && now - this.t0 < this.ms + 80; } // (unos cuadros de más para dibujar el final)
}

// Jugar con fichas: dos columnitas y, en un loop de `ciclo` ms, la ficha de arriba de la primera brinca en arco a la
// segunda y regresa. Dónde va la que brinca a `t` ms: 'a' o 'b' (encima de esa columna), o en el aire de una a la otra
// ('ab', 'ba') con `k` de 0 a 1. Quieta (movimiento reducido), siempre en 'a'.
export const FICHAS = { ciclo: 1600, quieta: 500, brinco: 300, altura: 0.05, columna: 4 };
export function fichasEn(t, quieta = false) {
  if (quieta) return { en: 'a', k: 0 };
  const { ciclo, brinco } = FICHAS, u = ((t % ciclo) + ciclo) % ciclo, medio = ciclo / 2, reposo = medio - brinco;
  if (u < reposo) return { en: 'a', k: 0 };
  if (u < medio) return { en: 'ab', k: (u - reposo) / brinco };
  if (u < medio + reposo) return { en: 'b', k: 0 };
  return { en: 'ba', k: (u - medio - reposo) / brinco };
}

// Mi última jugada según el servidor: la de la mesa (`v.lastAction`, que no se borra) si es mía, o la mía
// (`p.lastAction`, que el servidor borra cuando mi igualada cierra la ronda). Solo una jugada nueva empuja: igualar,
// apostar o subir, el derecho; si con eso quedé en all-in, los dos. Ciegas, pasar, retirarse y lo que hace el reloj, nada.
// `clave`: la mesa y mi asiento; la primera vez (al cargar, al reconectar en otra mesa) solo se recuerda.
export class Jugadas {
  constructor() { this.clave = null; this.visto = 0; }
  revisar(v, yo, clave) {
    const mias = [v && v.lastAction && yo && v.lastAction.id === yo.id ? v.lastAction : null, yo && yo.lastAction].filter(Boolean);
    const ultima = mias.reduce((a, b) => (!a || b.n > a.n ? b : a), null);
    if (clave !== this.clave) { this.clave = clave; this.visto = ultima ? ultima.n : 0; return null; }
    if (!ultima || !(ultima.n > this.visto)) return null;
    this.visto = ultima.n;
    if (!['call', 'bet', 'raise'].includes(ultima.type)) return null;
    return ultima.allIn ? 'ambos' : 'derecho';
  }
}

/* ---------- dónde van ---------- */

// Los puntos de la mesa de mis brazos, desde mi lugar (myPlace en projection.js) y el tamaño de mis cartas (`mine`): el
// izquierdo en el centro de mis dos cartas boca abajo (`cartasMesa`, donde las pone al ocultarlas), el derecho a la
// derecha de mi pila (sin taparla aunque tenga 5 columnas) y el bote, hacia donde empujan.
export function lugaresBrazos({ xCards, xStack, zMe, zPot }, mine = 1) {
  return {
    izquierdo: { x: xCards + 0.055, z: zMe - (CARD_H * mine) / 2 }, derecho: { x: xStack + 0.27, z: zMe - 0.04 }, bote: { x: 0, z: zPot },
    cartasMesa: [0, 1].map(i => ({ at: { x: xCards + i * 0.11, z: zMe + (i ? 0.004 : 0) }, yaw: i ? -0.05 : 0.04, scale: mine })),
  };
}

// Un brazo en la pantalla: su imagen con el `ancla` en `p` (el punto de la mesa ya proyectado, con su escala `p.s`) y
// `alto` unidades de la mesa de alto.
export function lugarBrazo(b, p) {
  const h = b.alto * p.s, w = (b.size[0] * h) / b.size[1];
  return { x: p.x - b.ancla[0] * w, y: p.y - b.ancla[1] * h, w, h, ax: p.x, ay: p.y };
}
// Las esquinas en pantalla de una carta en la mano (sus anclas `c`, `ancho` y `angulo`, en el lugar `l` del brazo).
export function esquinasCarta(c, l) {
  const cx = l.x + c.c[0] * l.w, cy = l.y + c.c[1] * l.h, w = c.ancho * l.w, h = (w * CARD_PX[1]) / CARD_PX[0];
  const co = Math.cos(c.angulo * DEG), si = Math.sin(c.angulo * DEG);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, t]) => ({ x: cx + (u * w / 2) * co - (t * h / 2) * si, y: cy + (u * w / 2) * si + (t * h / 2) * co }));
}
const cajaDe = pts => ({ x0: Math.min(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), x1: Math.max(...pts.map(p => p.x)), y1: Math.max(...pts.map(p => p.y)) });
const unir = cs => cs.filter(Boolean).reduce((a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b), null);

/* ---------- el relleno: siluetas de código mientras no haya arte ---------- */

// Mismo formato que el arte, en un lienzo de 1000 × 1400. Sus figuras (cada una, una curva cerrada y suave por sus puntos)
// van por pose y capa: 'brazo' (el antebrazo y la mano, con un solo contorno) y 'pulgar'. `mano`: lo que ocupa la mano en
// cada pose (para que las apuestas no queden debajo); con arte, una caja alrededor del ancla. LIENZO y FIGURAS se exportan
// para scripts/generar-personaje.py brazos: sus bocetos para Gemini son estas siluetas, así el arte cae en las mismas anclas.
export const LIENZO = [1000, 1400];
export const RELLENO = {
  izquierdo: {
    size: LIENZO, ancla: [0.6, 0.26], alto: 0.69,
    poses: {
      ver: {
        cartas: [{ c: [0.53, 0.179], ancho: 0.226, angulo: -11 }, { c: [0.66, 0.164], ancho: 0.226, angulo: 7 }],
        pulgar: { caja: [0, 0, 1, 1] },
      },
      ocultar: {}, vacio: {},
    },
  },
  // un poco más chico que el izquierdo: una mano dibujada es más ancha que la manopla, y entre mi pila y la orilla de
  // la pantalla en 4:3 cabe justa (LUGAR en scripts/generar-personaje.py); por lo mismo, las fichas con que juega van un
  // poco a la izquierda de la manopla: una mano que llega a ellas con el índice y el medio se abre hacia la derecha, y así
  // queda al centro de lo que cabe
  derecho: { size: LIENZO, ancla: [0.4, 0.25], alto: 0.67, poses: { descansar: {}, jugar: { fichas: [0.37, 0.12] } } },
};
const ANTEBRAZO_VER = [[468, 440], [655, 475], [590, 680], [470, 1000], [360, 1440], [70, 1440], [200, 1000], [330, 680], [400, 510]];
const PALMA_VER = [[452, 342], [560, 300], [690, 232], [780, 166], [838, 198], [842, 288], [790, 374], [700, 450], [600, 502], [505, 500], [446, 448]];
const PULGAR_VER = [[430, 462], [452, 400], [492, 350], [536, 332], [566, 358], [548, 402], [506, 458], [466, 500]];
// sobre la mesa la mano izquierda llega de la izquierda: el antebrazo pasa a un lado de mis cartas (sus esquinas de mi
// lado quedan libres para asomarse) y la mano tapa la mitad de allá de las dos
const MANO_MESA = [[300, 286], [380, 246], [500, 226], [640, 222], [770, 236], [836, 272], [820, 318], [720, 336], [580, 342], [460, 348], [360, 356], [300, 340]];
const ANTEBRAZO_MESA = [[180, 300], [330, 300], [310, 560], [250, 900], [200, 1440], [-60, 1440], [0, 900], [80, 560], [140, 400]];
// la derecha descansa a la derecha de mi pila (sin taparla aunque tenga 5 columnas), con los dedos hacia el centro y el
// pulgar abajo; al jugar, estira los dedos hacia las fichas, que van detrás de ella en la mesa (arriba en la pantalla),
// lejos de mi pila
const MANO_DESCANSA = [[240, 300], [280, 268], [360, 252], [450, 258], [520, 286], [560, 330], [548, 380], [490, 404], [420, 404], [350, 380], [300, 356], [250, 336]];
const PULGAR_DESCANSA = [[320, 356], [362, 368], [384, 404], [354, 428], [304, 418], [276, 390]];
const MANO_JUEGA = [[300, 300], [352, 250], [420, 212], [490, 206], [548, 240], [572, 300], [556, 368], [490, 404], [410, 400], [340, 372], [304, 340]];
const PULGAR_JUEGA = [[318, 352], [360, 362], [382, 398], [352, 422], [302, 412], [276, 384]];
const ANTEBRAZO_DER = [[470, 360], [570, 340], [630, 600], [700, 1000], [740, 1440], [480, 1440], [460, 1000], [420, 640], [410, 420]];
export const FIGURAS = {
  izquierdo: {
    ver: { brazo: [ANTEBRAZO_VER, PALMA_VER], pulgar: [PULGAR_VER], mano: [PALMA_VER, PULGAR_VER] },
    ocultar: { brazo: [ANTEBRAZO_MESA, MANO_MESA], mano: [MANO_MESA] },
    vacio: { brazo: [ANTEBRAZO_MESA, MANO_MESA], mano: [MANO_MESA] },
  },
  derecho: {
    descansar: { brazo: [ANTEBRAZO_DER, MANO_DESCANSA, PULGAR_DESCANSA], mano: [MANO_DESCANSA, PULGAR_DESCANSA] },
    jugar: { brazo: [ANTEBRAZO_DER, MANO_JUEGA, PULGAR_JUEGA], mano: [MANO_JUEGA, PULGAR_JUEGA] },
  },
};
// De dónde viene la luz (la lámpara, arriba al centro): la sombra plana queda del otro lado.
const LUZ = { izquierdo: [14, -12], derecho: [-14, -12] };

// Todas las figuras en el mismo sentido, para que se unan sin hoyos.
const area = pts => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
for (const poses of Object.values(FIGURAS)) for (const porCapa of Object.values(poses)) {
  for (const k of Object.keys(porCapa)) porCapa[k] = porCapa[k].map(f => (area(f) < 0 ? f.slice().reverse() : f));
}
// Una curva cerrada y suave que pasa por los puntos (Catmull-Rom, como curvas de Bézier).
function curva(g, pts) {
  const n = pts.length;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  g.closePath();
}
// El mismo color un poco más oscuro: la sombra plana.
export function oscuro(hex, k = 0.78) {
  const n = parseInt(hex.slice(1), 16), f = c => Math.round(c * k).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
// Unas figuras como una sola silueta: color plano, una sombra plana del lado contrario a la luz y un solo contorno de
// tinta (cada figura con el doble de grueso y el relleno encima tapa las líneas de adentro).
function pintarSilueta(g, figuras, color, luz, ancho) {
  g.lineJoin = 'round'; g.lineWidth = ancho * 2; g.strokeStyle = INK;
  for (const f of figuras) { g.beginPath(); curva(g, f); g.stroke(); }
  g.save();
  g.beginPath(); for (const f of figuras) curva(g, f); g.clip();
  g.fillStyle = oscuro(color); g.fillRect(-LIENZO[0], -LIENZO[1], LIENZO[0] * 3, LIENZO[1] * 3);
  g.translate(luz[0], luz[1]);
  g.fillStyle = color; g.beginPath(); for (const f of figuras) curva(g, f); g.fill();
  g.restore();
}
// La caja (en fracciones del lienzo) de unas figuras, con un margen por lo que se abomba la curva.
function cajaFiguras(figuras) {
  const pts = figuras.flat(), m = 18;
  return [Math.min(...pts.map(p => p[0])) - m, Math.min(...pts.map(p => p[1])) - m, Math.max(...pts.map(p => p[0])) + m, Math.max(...pts.map(p => p[1])) + m]
    .map((v, i) => v / LIENZO[i % 2]);
}
// Con arte sin `mano` medida: lo que ocupa la mano, alrededor del ancla (en fracciones de la imagen).
const MANO_ARTE = { izquierda: 0.24, derecha: 0.24, arriba: 0.14, abajo: 0.06 };

/* ---------- la capa ---------- */

// La capa de mis brazos. La escena le pasa lo que tiene (poner), dónde caen las cosas (acomodar) y lo que elijo (elegir,
// asomarse); dibujar() la pinta y ocupado() dice si hay que volver a pintarla (algo se mueve o cambió).
export class Brazos {
  // `cargar(url)`: carga una imagen (en las pruebas, una de mentira)
  constructor({ cargar = loadImage } = {}) {
    this.cargar = cargar;
    this.personaje = null; this.def = null;
    this.imgs = new Map(); this.pendientes = new Set(); this.escaladas = new Map();
    this.opciones = { cartas: 'ver', fichas: false };
    this.asomo = false; this.esquina = new Asomo();
    this.jugadas = new Jugadas(); this.empujes = { izquierdo: -Infinity, derecho: -Infinity };
    this.fichasDesde = 0;
    this.estado = null; this.poses = null; this.geo = null; this.small = false;
    this.cambio = true;
  }

  // Lo que hay: `personaje` (el mío, de CHARACTERS), `conCartas`, `cartas` ([{ code, mark }] o null), `enseño`,
  // `marcasDesde` (cuándo se resalta la mano ganadora) y `pila` (mis fichas).
  poner(e, now, quieto = false) {
    if (e.personaje !== this.personaje) { this.personaje = e.personaje; this.def = brazosDe(e.personaje); this.escaladas.clear(); }
    this.estado = e;
    this.sincronizar(now, quieto);
  }
  // Dónde caen las cosas: `v` (la proyección), `line`, `dpr`, `small` (calidad baja), los puntos de la mesa `izquierdo`
  // (el centro de mis cartas) y `derecho` (junto a mi pila), `bote` (hacia dónde empujan) y `cartasMesa` ([{ at, yaw,
  // scale }]: dónde van mis cartas boca abajo).
  acomodar(geo) {
    if (geo.small !== this.small || (this.geo && geo.dpr !== this.geo.dpr)) this.escaladas.clear();
    this.small = geo.small;
    this.geo = geo;
    this.cambio = true;
  }
  // Lo que elegí: `cartas` ('ver' u 'ocultas') y `fichas` (jugar con ellas).
  elegir(opciones, now, quieto = false) {
    this.opciones = { cartas: opciones.cartas === 'ocultas' ? 'ocultas' : 'ver', fichas: !!opciones.fichas };
    if (this.opciones.cartas === 'ver') this.asomo = false;
    this.sincronizar(now, quieto);
  }
  asomarse(on, now, quieto = false) { this.asomo = !!on; this.sincronizar(now, quieto); }
  sincronizar(now, quieto) {
    if (!this.estado) return;
    const antes = this.poses, e = this.estado;
    this.poses = posesDe({ conCartas: e.conCartas, enseño: e.enseño, cartas: this.opciones.cartas, asomo: this.asomo, fichas: this.opciones.fichas, pila: e.pila });
    // sin cartas ocultas no hay nada a qué asomarse: la esquina regresa de golpe
    this.esquina.poner(this.poses.asoma ? 1 : 0, now, quieto || this.poses.izquierdo !== 'ocultar');
    if (this.poses.derecho === 'jugar' && (!antes || antes.derecho !== 'jugar')) this.fichasDesde = now;
    this.cambio = true;
  }
  // Mi jugada nueva (si la hay) empuja.
  revisarJugada(v, yo, clave, now) {
    const quien = this.jugadas.revisar(v, yo, clave);
    if (quien) this.empujar(quien, now);
    return quien;
  }
  empujar(quien, now) {
    this.empujes.derecho = now;
    if (quien === 'ambos') this.empujes.izquierdo = now;
    this.cambio = true;
  }

  // El relleno siempre está listo; el arte, cuando cargó todo (si algo no carga, el relleno de su color).
  listo() {
    if (!this.def) return false;
    if (!this.def.arte) return true;
    const urls = archivosBrazos(this.def).map(a => this.url(a));
    if (urls.some(u => this.imgs.get(u) === null)) { this.def = brazosDe({ color: this.def.color }); this.escaladas.clear(); return true; }
    if (urls.every(u => this.imgs.get(u))) return true;
    for (const u of urls) {
      if (this.imgs.has(u) || this.pendientes.has(u)) continue;
      this.pendientes.add(u);
      this.cargar(u).then(img => this.imgs.set(u, img), () => this.imgs.set(u, null)).then(() => { this.pendientes.delete(u); this.cambio = true; });
    }
    return false;
  }
  url(archivo) { return artUrl(`${(this.personaje && this.personaje.carpeta) || 'assets/arte'}/${archivo}`, this.small); }
  // Una imagen del arte reducida al tamaño en que se ve (una sola vez por tamaño).
  escalada(archivo, hCss) {
    const pxH = Math.max(1, Math.round(hCss * this.geo.dpr)), u = this.url(archivo), key = `${u}|${pxH}`;
    if (!this.escaladas.has(key)) this.escaladas.set(key, downscale(this.imgs.get(u), pxH, false));
    return this.escaladas.get(key);
  }

  lugar(lado) {
    const g = this.geo, b = this.def[lado], P = g[lado];
    const p = g.v.project(P.x, 0, P.z), l = lugarBrazo(b, p);
    const q = g.v.project(g.bote.x, 0, g.bote.z), d = Math.hypot(q.x - p.x, q.y - p.y) || 1, largo = EMPUJON.largo * p.s;
    l.hacia = { x: ((q.x - p.x) / d) * largo, y: ((q.y - p.y) / d) * largo };
    return l;
  }
  // Mis cartas boca abajo sobre la mesa (con lo que va de asomarse).
  cartasEnMesa(now) {
    const cs = (this.estado && this.estado.cartas) || [], fold = this.esquina.en(now);
    return this.geo.cartasMesa.slice(0, cs.length).map((m, i) => ({ kind: 'card', code: cs[i].code, at: m.at, yaw: m.yaw, tilt: 0.03, scale: m.scale, down: true, fold }));
  }
  // Las columnitas con que juego: dónde caen en el fieltro (bajo el ancla `fichas` de la imagen) y de qué valor (las dos
  // que más tengo en mi pila).
  fichasEnMesa(l) {
    const f = this.def.derecho.poses.jugar.fichas, w = this.geo.v.unproject(l.x + f[0] * l.w, l.y + f[1] * l.h, 0);
    const cs = stackBreakdown(Math.max(1, (this.estado && this.estado.pila) || 0)).chips.slice().sort((a, b) => b.count - a.count);
    const va = cs.length ? cs[0].value : 10, vb = cs.length > 1 ? cs[1].value : va, sep = CHIP_R + 0.008;
    return { a: { x: w.x - sep, z: w.z, value: va }, b: { x: w.x + sep, z: w.z, value: vb } };
  }

  dibujar(g, now, quieto = false) {
    this.cambio = false;
    if (!this.estado || !this.geo || !this.poses || !this.listo()) return;
    for (const lado of LADOS) {
      const pose = this.poses[lado], l = this.lugar(lado), e = quieto ? 0 : empujon(now - this.empujes[lado]);
      for (const capa of capas(lado, pose)) {
        g.save();
        if (e > 0 && EN_MANO.has(capa)) {
          const sc = 1 - (1 - EMPUJON.escala) * e;
          g.translate(l.ax + l.hacia.x * e, l.ay + l.hacia.y * e); g.scale(sc, sc); g.translate(-l.ax, -l.ay);
        }
        this.capa(g, lado, pose, capa, l, now, quieto);
        g.restore();
      }
    }
  }
  capa(g, lado, pose, capa, l, now, quieto) {
    const { v, line } = this.geo, def = this.def, b = def[lado];
    if (capa === 'brazo' || capa === 'pulgar') {
      if (!def.arte) {
        const k = l.w / LIENZO[0];
        g.translate(l.x, l.y); g.scale(k, k);
        pintarSilueta(g, FIGURAS[lado][pose][capa], def.color, LUZ[lado], (line * 1.15) / k);
      } else if (capa === 'brazo') g.drawImage(this.escalada(b.poses[pose].archivo, l.h), l.x, l.y, l.w, l.h);
      else {
        const p = b.poses.ver.pulgar, c = p.caja, w = (c[2] - c[0]) * l.w, h = (c[3] - c[1]) * l.h;
        g.drawImage(this.escalada(p.archivo, h), l.x + c[0] * l.w, l.y + c[1] * l.h, w, h);
      }
    } else if (capa === 'carta1' || capa === 'carta2') {
      const i = capa === 'carta1' ? 0 : 1, c = b.poses.ver.cartas[i], card = this.estado.cartas && this.estado.cartas[i];
      if (!card) return;
      const marca = now >= (this.estado.marcasDesde || 0) ? card.mark : null;
      drawFlatCard(g, card.code, l.x + c.c[0] * l.w, l.y + c.c[1] * l.h, c.ancho * l.w, c.angulo * DEG, { mark: marca, line });
    } else if (capa === 'cartas') for (const it of this.cartasEnMesa(now)) drawCard(g, v, it, line);
    else if (capa === 'esquinas') for (const it of this.cartasEnMesa(now)) drawFlap(g, v, it, line);
    else if (capa === 'fichas' || capa === 'brinco') {
      const m = this.fichasEnMesa(l), f = fichasEn(now - this.fichasDesde, quieto), n = FICHAS.columna;
      if (capa === 'fichas') {
        chipColumn(g, v, { ...m.a, n }, line);
        chipColumn(g, v, { ...m.b, n }, line);
        if (f.en === 'a' || f.en === 'b') chipColumn(g, v, { ...m[f.en], value: m.a.value, n: 1, y: n * CHIP_H }, line);
      } else if (f.en === 'ab' || f.en === 'ba') {
        const [de, a] = f.en === 'ab' ? [m.a, m.b] : [m.b, m.a], k = f.k, s = k * k * (3 - 2 * k);
        chipColumn(g, v, { x: de.x + (a.x - de.x) * s, z: de.z, value: m.a.value, n: 1, y: n * CHIP_H + Math.sin(Math.PI * k) * FICHAS.altura }, line);
      }
    }
  }

  // Si hay que volver a pintar: algo cambió, se mueve (empujón, asomarse, fichas) o falta resaltar la mano ganadora.
  ocupado(now, quieto = false) {
    if (this.cambio) return true;
    if (!this.estado || !this.poses) return false;
    const total = EMPUJON.ida + EMPUJON.regreso + 80;
    if (!quieto && (now - this.empujes.derecho < total || now - this.empujes.izquierdo < total)) return true;
    if (this.esquina.moviendo(now)) return true;
    if (!quieto && this.poses.derecho === 'jugar') return true;
    return !!(this.estado.enseño && now < (this.estado.marcasDesde || 0) + 80);
  }

  // Lo que ocupan mis brazos en la pantalla, uno por brazo y con todas sus poses juntas (para que nada brinque al cambiar
  // de pose): las apuestas y el botón del dealer no van debajo. Solo la mano y lo que tiene, no el antebrazo.
  cajas() {
    if (!this.def || !this.geo) return [];
    return LADOS.map(lado => {
      const l = this.lugar(lado), b = this.def[lado], enImagen = c => ({ x0: l.x + c[0] * l.w, y0: l.y + c[1] * l.h, x1: l.x + c[2] * l.w, y1: l.y + c[3] * l.h });
      const manos = !this.def.arte ? POSES_BRAZO[lado].map(p => enImagen(cajaFiguras(FIGURAS[lado][p].mano)))
        : b.mano ? [enImagen(b.mano)]
        : [enImagen([b.ancla[0] - MANO_ARTE.izquierda, b.ancla[1] - MANO_ARTE.arriba, b.ancla[0] + MANO_ARTE.derecha, b.ancla[1] + MANO_ARTE.abajo])];
      const extra = [];
      if (lado === 'izquierdo') {
        extra.push(...b.poses.ver.cartas.map(c => cajaDe(esquinasCarta(c, l))));
        if (this.def.arte) extra.push(enImagen(b.poses.ver.pulgar.caja));
        // mis cartas boca abajo y lo que se levanta de ellas al asomarme
        for (const m of this.geo.cartasMesa) {
          const c = cardCorners(m.at, CARD_W * m.scale, CARD_H * m.scale, 0.03, m.yaw);
          const pts = [c.tl, c.tr, c.bl, c.br].map(p => this.geo.v.project(p.x, 0, p.z)), bx = cajaDe(pts);
          bx.y0 -= FOLD.izquierda * CARD_H * m.scale * this.geo.v.project(m.at.x, 0, m.at.z).s;
          extra.push(bx);
        }
      } else {
        const m = this.fichasEnMesa(l), pts = [m.a, m.b].flatMap(p => [-1, 1].map(s => this.geo.v.project(p.x + s * CHIP_R, 0, p.z)));
        const bx = cajaDe(pts), alto = this.geo.v.project(m.a.x, 0, m.a.z).s * ((FICHAS.columna + 1) * CHIP_H + FICHAS.altura);
        extra.push({ ...bx, y0: bx.y0 - alto });
      }
      return unir([...manos, ...extra]);
    });
  }

  // Con ?medidas: el marco de cada imagen, el ancla, las cartas en la mano, la caja del pulgar y el punto de las fichas.
  medidas(g) {
    if (!this.def || !this.geo) return;
    g.save();
    g.lineWidth = 2; g.font = '15px "Patrick Hand", sans-serif'; g.textBaseline = 'bottom';
    for (const lado of LADOS) {
      const l = this.lugar(lado), b = this.def[lado];
      g.setLineDash([]); g.strokeStyle = 'rgba(239,228,200,0.55)'; g.strokeRect(l.x, l.y, l.w, l.h);
      g.strokeStyle = '#e0b552'; g.beginPath(); g.arc(l.ax, l.ay, 6, 0, Math.PI * 2); g.stroke();
      g.setLineDash([6, 4]); g.strokeStyle = '#d24a2f';
      if (lado === 'izquierdo') {
        for (const c of b.poses.ver.cartas) { const p = esquinasCarta(c, l); g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.stroke(); }
        const c = b.poses.ver.pulgar.caja;
        if (this.def.arte) g.strokeRect(l.x + c[0] * l.w, l.y + c[1] * l.h, (c[2] - c[0]) * l.w, (c[3] - c[1]) * l.h);
      } else {
        const f = b.poses.jugar.fichas;
        g.beginPath(); g.arc(l.x + f[0] * l.w, l.y + f[1] * l.h, 5, 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = '#efe4c8'; g.fillText(`${lado}${this.def.arte ? '' : ' (relleno)'}`, l.x + 4, l.y + l.h * 0.06);
    }
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(80,200,255,0.8)';
    for (const c of this.cajas()) if (c) g.strokeRect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0);
    g.restore();
  }
}
