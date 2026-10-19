// Hoja de revisión de la baraja (solo en desarrollo: /hoja-baraja.html). Dibuja las cartas con el mismo código y al
// mismo tamaño en pantalla que en el juego: las comunitarias del celular miden 27 px de ancho, las de la computadora 72
// y mis cartas en el celular 67. Sirve para revisar cambios, por ejemplo al rediseñar la etiqueta del logo (ETIQUETA en
// client/stage/cards.js).

import { cardImage, cargarArte, CARD_PX } from './stage/cards.js';
import { SUIT_PATH, SUIT_COLOR } from './ui/suits.js';

const RANGOS = 'A23456789TJQK', PALOS_ORDEN = 'shdc';
const dpr = window.devicePixelRatio || 1;
const hoja = document.getElementById('hoja');

function el(tag, cls, texto) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto) e.textContent = texto;
  return e;
}
// Una carta de `w` px de ancho en pantalla. Como en el juego, la textura (CARD_PX, o `k` veces para verla de cerca) se
// reduce al tamaño en que se ve.
function carta(code, w, k = 1) {
  const h = Math.round((w * CARD_PX[1]) / CARD_PX[0]);
  const c = el('canvas', 'carta');
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  c.getContext('2d').drawImage(cardImage(code, k), 0, 0, c.width, c.height);
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
// Las cartas a 150 (de cerca, sobre el papel) o a un tamaño del juego (sobre el fieltro).
function fila(codes, w) {
  const d = el('div', w > 100 ? 'fila' : 'fieltro fila');
  d.append(...codes.map(c => carta(c, w, w > 100 ? 2 : 1)));
  return figura(d, `${w} px`);
}
// La carta chiquita del panel del resultado (como miniCard en main.js).
function mini(code) {
  const s = el('span', 'mini');
  s.style.color = SUIT_COLOR[code[1]];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', SUIT_PATH[code[1]]);
  svg.append(p);
  s.append(el('b', '', code[0] === 'T' ? '10' : code[0]), svg);
  return s;
}

async function armar() {
  await Promise.all([document.fonts.load('94px Chewy'), document.fonts.load('18px "Patrick Hand"'), cargarArte()]);

  const sr = seccion('Reverso y ases', 'La etiqueta del logo sale de la misma función en el reverso y en los ases.');
  for (const w of [150, 72, 27]) sr.append(fila([null, 'Ah', 'Ad', 'Ac', 'As'], w));

  const sf = seccion('Figuras', 'El rey, la reina y la jota de cada palo.');
  const figuras = [...'hdcs'].flatMap(p => ['K', 'Q', 'J'].map(r => r + p));
  for (const w of [150, 72, 27]) sf.append(fila(figuras, w));

  const sp = seccion('Palos en dos colores');
  const minis = el('div', 'fila');
  minis.append(...['As', 'Ac', 'Kh', 'Kd', 'Qs', 'Qc', 'Ts', 'Tc', '7h', '7d', '2s', '2c'].map(mini));
  sp.append(figura(minis, 'Las cartitas del panel del resultado (33 px)'));
  sp.append(fila([...RANGOS].flatMap(r => [r + 's', r + 'c']), 27));

  for (const w of [27, 72]) {
    const s = seccion(`Las 52 a ${w} px`, w === 27 ? 'Las comunitarias del celular.' : 'Las comunitarias de la computadora.');
    for (const p of PALOS_ORDEN) s.append(fila([...RANGOS].map(r => r + p), w));
  }
  seccion('Mis cartas en el celular').append(fila(['Ah', 'Kd', 'Tc', '7s', '9d', '6h', 'Qs', '2c'], 67));
  document.body.dataset.lista = '1';   // para las capturas
}

armar();
