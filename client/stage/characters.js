// Personajes ilustrados (recortes con fondo transparente en public/assets/arte/, generados con
// scripts/optimizar-arte.py). Para agregar uno: poner sus poses en arte/, recortarlas, optimizarlas,
// agregar su entrada aquí y asignarlo en characterFor().
//
// Cada personaje tiene sus ángulos: `frente` (los del fondo) y `lado` (tres cuartos, para los de los lados;
// el de la derecha se dibuja en espejo). Si un personaje todavía no tiene `lado`, se usa `frente`.

export const POSES = ['espera', 'espera-parpadeo', 'espia', 'apuesta', 'apuesta-parpadeo'];
const posesOf = prefix => Object.fromEntries(POSES.map(p => [p, `${prefix}-${p}`]));

export const CHARACTERS = {
  blorp: {
    name: 'Madame Blorp',
    angles: {
      frente: {
        size: [935, 1395],      // tamaño de la imagen grande (la chica es la mitad)
        waist: [0.52, 0.835],   // punto de la cintura, en fracción de la imagen: de ahí para abajo la tapa la mesa
        face: [0.25, 0, 0.82, 0.38], // caja de la cabeza (izquierda, arriba, derecha, abajo): nadie la tapa
        height: 0.54,           // alto de la imagen en unidades de la mesa (radio de la mesa = 1)
        poses: posesOf('blorp'),
      },
      // lado: { size, waist, face, height, poses: posesOf('blorp-lado') },  // cuando existan sus poses
    },
  },
};

// Ángulo que se dibuja: el que se pide, o `frente` si el personaje no lo tiene.
export function angleOf(charId, angle) {
  const a = CHARACTERS[charId].angles;
  return a[angle] ? angle : 'frente';
}
export const artOf = (charId, angle) => CHARACTERS[charId].angles[angleOf(charId, angle)];

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

// Todas las poses de todos los ángulos de todos los personajes (son pocos) más el fondo.
export function preloadArt({ small = false, h = innerHeight, dpr = devicePixelRatio || 1 } = {}) {
  const urls = [backgroundUrl(h, dpr)];
  for (const c of Object.values(CHARACTERS)) for (const a of Object.values(c.angles)) for (const p of POSES) urls.push(artUrl(a.poses[p], small));
  return Promise.all(urls.map(loadImage));
}
