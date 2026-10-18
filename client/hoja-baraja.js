// Hoja de revisión de la baraja nueva (solo en desarrollo: /hoja-baraja.html). Dibuja las cartas con el mismo código y
// al mismo tamaño en pantalla que en el juego: las comunitarias del celular miden 27 px de ancho, las de la computadora
// 72 y mis cartas en el celular 67. El reverso es el marco de scripts/generar-baraja.py (limpiado) con la etiqueta de
// código.

import { cardImage, setArt, CARD_PX, ETIQUETA, largoEtiqueta } from './stage/baraja.js';
import { cardImage as cartaVieja } from './stage/cards.js';
import { PALOS, COLOR_PALO } from './ui/palos.js';
import marco from '../arte/baraja/reverso-carta.png';
import marcoDatos from '../arte/baraja/reverso-carta.json';
import reyH from '../arte/baraja/rey-carta-h.png';
import reyD from '../arte/baraja/rey-carta-d.png';
import reyC from '../arte/baraja/rey-carta-c.png';
import reyS from '../arte/baraja/rey-carta-s.png';
import reinaCrudo from '../arte/generadas/baraja/reina-1-crudo.png';
import reinaH from '../arte/generadas/baraja/reina-1-carta-h.png';
import reinaD from '../arte/generadas/baraja/reina-1-carta-d.png';
import reinaC from '../arte/generadas/baraja/reina-1-carta-c.png';
import reinaS from '../arte/generadas/baraja/reina-1-carta-s.png';
import adornoFlor from '../arte/baraja/adorno-flor.png';
import adornoBanda from '../arte/baraja/adorno-banda.png';

const RANGOS = 'A23456789TJQK', PALOS_ORDEN = 'shdc';
const NOMBRE = { s: 'Picas', h: 'Corazones', d: 'Diamantes', c: 'Tréboles' };
const dpr = window.devicePixelRatio || 1;
const hoja = document.getElementById('hoja');

function el(tag, cls, texto) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto) e.textContent = texto;
  return e;
}
// Una carta de `w` px de ancho en pantalla. Como en el juego, la textura (CARD_PX, o `k` veces para verla de cerca)
// se reduce al tamaño en que se ve.
function carta(code, w, { vieja = false, k = 1 } = {}) {
  const h = Math.round((w * CARD_PX[1]) / CARD_PX[0]);
  const c = el('canvas', 'carta');
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  c.getContext('2d').drawImage(vieja ? cartaVieja(code) : cardImage(code, k), 0, 0, c.width, c.height);
  c.setAttribute('aria-label', code || 'reverso');
  return c;
}
function seccion(titulo, nota) {
  const s = el('section');
  s.append(el('h2', '', titulo));
  if (nota) s.append(el('p', '', nota));
  hoja.append(s);
  return s;
}
function figura(contenido, pie) {
  const f = el('figure');
  f.append(contenido, el('figcaption', '', pie));
  return f;
}
function fieltro(...hijos) {
  const d = el('div', 'fieltro fila');
  d.append(...hijos);
  return d;
}
const cargar = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
// La carta chiquita del panel del resultado, con los palos nuevos (como miniCard en main.js con ?baraja=nueva).
function mini(code) {
  const s = el('span', 'mini');
  s.style.color = COLOR_PALO[code[1]];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', PALOS[code[1]]);
  svg.append(p);
  s.append(el('b', '', code[0] === 'T' ? '10' : code[0]), svg);
  return s;
}

async function armar() {
  await Promise.all([document.fonts.load('94px Chewy'), document.fonts.load('18px "Patrick Hand"')]);

  // 0. la reina, por aprobar, junto al rey aprobado, en los cuatro palos y a 150, 72 y 27 px
  const rey = await Promise.all([reyH, reyD, reyC, reyS].map(cargar));
  const reina = await Promise.all([reinaH, reinaD, reinaC, reinaS].map(cargar));
  const adornos = { flor: await cargar(adornoFlor), banda: await cargar(adornoBanda) };
  const porPalo = arr => ({ h: arr[0], d: arr[1], c: arr[2], s: arr[3] });
  setArt({ reverso: await cargar(marco), libre: marcoDatos.libre, figuras: { K: porPalo(rey), Q: porPalo(reina) }, adornos });
  const sq = seccion('Reina (por aprobar), junto al rey', 'Cada pareja: el rey y la reina del mismo palo. La reina la dibujó Gemini ya '
    + 'ornamentada, con el rey aprobado como referencia de estilo; el marco, la línea del centro, el palo y los índices los pone el código.');
  const crudo = el('img');
  crudo.src = reinaCrudo; crudo.style.width = '230px'; crudo.style.border = '2px solid #1d1611'; crudo.alt = 'Reina, cruda de Gemini';
  sq.append(figura(crudo, 'La reina, como la regresó Gemini'));
  const parejas = ['h', 'd', 'c', 's'].flatMap(p => ['K' + p, 'Q' + p]);
  for (const w of [150, 72, 27]) {
    const cartas = parejas.map(c => carta(c, w, { k: w > 100 ? 2 : 1 }));
    const caja = w > 100 ? el('div', 'fila') : fieltro();
    caja.append(...cartas);
    sq.append(figura(caja, `${w} px`));
  }

  // 1. reverso: el marco de Gemini, limpio, y la etiqueta de código
  const sr = seccion('Reverso', `El marco lo dibujó Gemini (opción 2, con el centro borrado por código); la etiqueta y las letras `
    + `las dibuja el código: ${ETIQUETA.angulo}°, ${Math.round(largoEtiqueta() * 100)} % del ancho de largo y `
    + `${Math.round(ETIQUETA.grueso * 100)} % de grueso. En el juego, el reverso se ve un instante al voltear las cartas del `
    + 'final de la mano (72 px en la computadora).');
  const op = el('div', 'op');
  op.append(carta(null, 230, { k: 3 }), fieltro(carta(null, 72), carta(null, 27)));
  sr.append(op);

  // 2. los palos en dos colores y las cartitas del panel del resultado
  const sp = seccion('Palos clásicos en dos colores');
  const pal = el('div', 'palos');
  for (const s of PALOS_ORDEN) {
    const c = el('canvas');
    c.style.width = c.style.height = '84px';
    c.width = c.height = Math.round(84 * dpr);
    const g = c.getContext('2d');
    g.scale((84 * dpr) / 100, (84 * dpr) / 100);
    g.fillStyle = COLOR_PALO[s]; g.fill(new Path2D(PALOS[s]));
    const d = el('div');
    d.append(c, el('span', '', NOMBRE[s]), el('span', '', COLOR_PALO[s]));
    pal.append(d);
  }
  sp.append(pal, el('p', '', 'Las cartitas del panel del resultado (33 px):'));
  const minis = el('div', 'fila');
  for (const code of ['As', 'Ac', 'Kh', 'Kd', 'Qs', 'Qc', 'Ts', 'Tc', '7h', '7d', '2s', '2c']) minis.append(mini(code));
  sp.append(minis);

  // 3. picas y tréboles juntos, al tamaño del celular: que se distingan aunque sean del mismo color
  const st = seccion('Picas y tréboles juntos: 27 px de ancho', 'Las comunitarias del celular. Cada pareja: la pica y luego el trébol.');
  st.append(fieltro(...[...RANGOS].flatMap(r => [carta(r + 's', 27), carta(r + 'c', 27)])));
  st.append(el('p', '', 'Y los rojos, corazón y luego diamante:'));
  st.append(fieltro(...[...RANGOS].flatMap(r => [carta(r + 'h', 27), carta(r + 'd', 27)])));

  // 4. a los tamaños del juego, las 52
  for (const [titulo, w] of [['Comunitarias en el celular: 27 px de ancho', 27], ['Comunitarias en la computadora: 72 px de ancho', 72]]) {
    const s = seccion(titulo, 'Así de chicas se ven en la mesa (sin la inclinación de la mesa; las capturas del juego la traen).');
    for (const p of PALOS_ORDEN) s.append(fieltro(...[...RANGOS].map(r => carta(r + p, w))));
  }
  const sm = seccion('Mis cartas en el celular: 67 px de ancho');
  sm.append(fieltro(...['Ah', 'Kd', 'Tc', '7s', '9d', '6h', 'Qs', '2c'].map(c => carta(c, 67))));

  // 5. de cerca
  const sc = seccion('De cerca', 'Para ver el dibujo: en el juego nunca se ven tan grandes. Las figuras y el as de picas son provisionales.');
  sc.append(el('div', 'fila'));
  sc.lastChild.append(...['Ah', '2c', '5d', '7s', '9h', 'Td', 'As', 'Kc'].map(c => carta(c, 150, { k: 2 })));

  // 6. antes y después
  const sa = seccion('Antes y después');
  const ad = el('div', 'antes');
  for (const w of [72, 27]) {
    for (const vieja of [true, false]) {
      ad.append(figura(fieltro(...['Ah', 'Ts', 'Qd', '7c'].map(c => carta(c, w, { vieja }))),
        `${vieja ? 'Antes' : 'Ahora'}, ${w} px`));
    }
  }
  sa.append(ad);
  document.body.dataset.lista = '1';   // para las capturas
}

armar();
