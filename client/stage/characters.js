// Personajes ilustrados (recortes con fondo transparente en public/assets/arte/). Sus datos viven en
// personajes.json, que escribe scripts/optimizar-arte.py (comando `registrar`): tamaño y cuadros los pone
// el script; cintura (`waist`), cabeza (`face`) y alto (`height`) se miden a mano en ese archivo.
// Especificación del arte: docs/ESPEC-PERSONAJES.md.
//
// Cada personaje tiene sus ángulos: `frente` (los del fondo) y `lado` (tres cuartos, para los de los lados;
// el de la derecha se dibuja en espejo). Si un personaje todavía no tiene `lado`, se usa `frente`.
//   size    tamaño de la imagen grande (la chica es la mitad)
//   waist   punto de la cintura, en fracción de la imagen: de ahí para abajo la tapa la mesa
//   face    caja de la cabeza (izquierda, arriba, derecha, abajo): nadie la tapa
//   height  alto de la imagen en unidades de la mesa (radio de la mesa = 1)
//   frames  cuadros que existen; archivo <id>-<ángulo>-<cuadro>.webp

import DATA from './personajes.json' with { type: 'json' };

// La misma lista que scripts/optimizar-arte.py. Obligatorios: espera, parpadeo, apuesta, retirarse.
// Opcionales: espia y gana (si faltan, se usa espera). gana todavía no está en los scripts de arte.
export const POSES = ['espera', 'parpadeo', 'espia', 'apuesta', 'retirarse', 'gana'];

export const CHARACTERS = Object.fromEntries(Object.entries(DATA).map(([id, c]) => [id, {
  name: c.name,
  angles: Object.fromEntries(Object.entries(c.angles).map(([angle, a]) => [angle, {
    ...a, poses: Object.fromEntries(a.frames.map(f => [f, `${id}-${angle}-${f}`])),
  }])),
}]));

// Ángulo que se dibuja: el que se pide, o `frente` si el personaje no lo tiene.
export function angleOf(charId, angle) {
  const a = CHARACTERS[charId].angles;
  return a[angle] ? angle : 'frente';
}
export const artOf = (charId, angle) => CHARACTERS[charId].angles[angleOf(charId, angle)];
// Si al personaje le falta un cuadro (p. ej. espia, que es opcional), se usa espera.
export const hasPose = (charId, angle, pose) => !!artOf(charId, angle).poses[pose];
export const poseFile = (charId, angle, pose) => { const p = artOf(charId, angle).poses; return p[pose] || p.espera; };

// Qué personaje usa cada jugador. Por ahora todos son Madame Blorp; después se puede asignar por
// bot (p. ej. por su apodo) o dejar que cada humano elija el suyo.
export function characterFor(player) { // eslint-disable-line no-unused-vars
  return 'blorp';
}

export const artUrl = (file, small) => `/assets/arte/${file}${small ? '-chico' : ''}.webp`;

// Fondo: dos tamaños; se usa el grande cuando la pantalla tiene más pixeles de alto que el chico.
export const BACKGROUND = { file: 'fondo-garaje', sizes: [[1920, 1072], [3840, 2143]] };
export function backgroundUrl(h, dpr) {
  const [w] = BACKGROUND.sizes.find(([, bh]) => bh >= h * dpr * 0.9) || BACKGROUND.sizes[BACKGROUND.sizes.length - 1];
  return `/assets/arte/${BACKGROUND.file}-${w}.webp`;
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

// Todos los cuadros que existen de todos los ángulos de todos los personajes (son pocos) más el fondo.
export function preloadArt({ small = false, h = innerHeight, dpr = devicePixelRatio || 1 } = {}) {
  const urls = [backgroundUrl(h, dpr)];
  for (const c of Object.values(CHARACTERS)) for (const a of Object.values(c.angles)) for (const f of Object.values(a.poses)) urls.push(artUrl(f, small));
  return Promise.all(urls.map(loadImage));
}
