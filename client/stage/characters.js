// Personajes ilustrados (recortes con fondo transparente en public/assets/arte/). Sus datos viven en
// personajes.json, que escribe scripts/optimizar-arte.py (comando `registrar`): tamaño y cuadros los pone
// el script; el nombre (el del bot que usa ese personaje), la cintura (`waist`), la cabeza (`face`) y el
// alto (`height`) se ponen o miden a mano en ese archivo. Especificación del arte: docs/ESPEC-PERSONAJES.md.
// El servidor lee el mismo archivo para darle a cada bot un personaje distinto con su nombre.
//
// Cada personaje tiene sus ángulos: `frente` (los del fondo) y `lado` (tres cuartos, para los de los lados;
// el de la derecha se dibuja en espejo). Si un personaje todavía no tiene `lado`, se usa `frente`.
//   size    tamaño de la imagen grande (la chica es la mitad)
//   waist   punto de la cintura, en fracción de la imagen: de ahí para abajo la tapa la mesa
//   face    caja de la cabeza (izquierda, arriba, derecha, abajo): nadie la tapa
//   height  alto de la imagen en unidades de la mesa (radio de la mesa = 1)
//   frames  cuadros que existen; archivo <id>-<ángulo>-<cuadro>.webp
// Un personaje con "retirado": true se queda en el registro (y sus imágenes en su lugar), pero no se usa.

import DATA from './personajes.json' with { type: 'json' };
import TABLE_ART from './mesa.json' with { type: 'json' };

// La misma lista que scripts/optimizar-arte.py. Solo espera es obligatorio: mientras falte otro cuadro,
// el personaje se queda en espera (no parpadea, no apuesta...); cuando se registra, se usa solo.
export const POSES = ['espera', 'parpadeo', 'espia', 'apuesta', 'retirarse', 'gana'];

export const CHARACTERS = Object.fromEntries(Object.entries(DATA).filter(([, c]) => !c.retirado).map(([id, c]) => [id, {
  name: c.name,
  angles: Object.fromEntries(Object.entries(c.angles).map(([angle, a]) => [angle, {
    ...a, poses: Object.fromEntries(a.frames.map(f => [f, `${id}-${angle}-${f}`])),
  }])),
}]));
const IDS = Object.keys(CHARACTERS);

// Ángulo que se dibuja: el que se pide, o `frente` si el personaje no lo tiene.
export function angleOf(charId, angle) {
  const a = CHARACTERS[charId].angles;
  return a[angle] ? angle : 'frente';
}
export const artOf = (charId, angle) => CHARACTERS[charId].angles[angleOf(charId, angle)];
// Si al personaje le falta un cuadro (p. ej. espia, que es opcional), se usa espera.
export const hasPose = (charId, angle, pose) => !!artOf(charId, angle).poses[pose];
export const poseFile = (charId, angle, pose) => { const p = artOf(charId, angle).poses; return p[pose] || p.espera; };

// Qué personaje dibuja a un jugador: el que le asignó el servidor (cada bot uno distinto, con su nombre;
// los humanos, los que no usa ningún bot). Si no trae uno que exista aquí (o es un asiento vacío), el primero.
export function characterFor(player) {
  return player && CHARACTERS[player.character] ? player.character : IDS[0];
}

export const artUrl = (file, small) => `/assets/arte/${file}${small ? '-chico' : ''}.webp`;

// Fondo: dos tamaños; se usa el grande cuando la pantalla tiene más pixeles de alto que el chico.
export const BACKGROUND = { file: 'fondo-garaje', sizes: [[1920, 1072], [3840, 2143]] };
export function backgroundUrl(h, dpr) {
  const [w] = BACKGROUND.sizes.find(([, bh]) => bh >= h * dpr * 0.9) || BACKGROUND.sizes[BACKGROUND.sizes.length - 1];
  return `/assets/arte/${BACKGROUND.file}-${w}.webp`;
}

// La mesa ilustrada (horizontal): dos tamaños; el grande cuando la mesa se ve más ancha que el chico.
// `w` es el ancho de la pantalla en px de CSS: la mesa se ve un poco más ancha (se sale por los lados).
export function tableArtUrl(w, dpr) {
  const [aw] = TABLE_ART.sizes.find(([sw]) => sw >= w * 1.1 * dpr) || TABLE_ART.sizes[TABLE_ART.sizes.length - 1];
  return `/assets/arte/${TABLE_ART.file}-${aw}.webp`;
}

// Carga y decodifica una imagen (para que el cambio de pose sea instantáneo).
const cache = new Map(), loaded = new Map();
export function loadImage(url) {
  if (!cache.has(url)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    cache.set(url, (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; }))
      .then(() => { loaded.set(url, img); return img; }));
  }
  return cache.get(url);
}
export const loadedImage = url => loaded.get(url) || null;

// Todos los cuadros que existen de todos los ángulos de todos los personajes (son pocos) más el fondo y la mesa
// (si la mesa no carga no pasa nada: se dibuja la de código). `dpr`: la resolución con que dibujará la escena.
export function preloadArt({ small = false, w = innerWidth, h = innerHeight, dpr = devicePixelRatio || 1 } = {}) {
  const urls = [backgroundUrl(h, dpr)];
  for (const c of Object.values(CHARACTERS)) for (const a of Object.values(c.angles)) for (const f of Object.values(a.poses)) urls.push(artUrl(f, small));
  const table = loadImage(tableArtUrl(w, dpr)).catch(() => null);
  return Promise.all([...urls.map(loadImage), table]);
}
