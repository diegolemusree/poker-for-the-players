// Personajes ilustrados (recortes con fondo transparente en public/assets/arte/, generados con
// scripts/optimizar-arte.py). Para agregar uno: poner sus poses en arte/, recortarlas, optimizarlas,
// agregar su entrada aquí y asignarlo en characterFor().

export const POSES = ['espera', 'espera-parpadeo', 'espia', 'apuesta', 'apuesta-parpadeo'];

export const CHARACTERS = {
  blorp: {
    name: 'Madame Blorp',
    size: [935, 1395],      // tamaño de la imagen grande (la chica es la mitad)
    waist: [0.52, 0.835],   // punto de la cintura, en fracción de la imagen: de ahí para abajo la tapa la mesa
    lap: [0.05, 0.99],      // de dónde a dónde llega lo de abajo (silla incluida), en fracción del ancho
    height: 0.95,           // alto de la imagen en unidades de la mesa (radio de la mesa = 1)
    poses: Object.fromEntries(POSES.map(p => [p, `blorp-${p}`])),
  },
};

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

// Todas las poses de todos los personajes (son pocos) más el fondo.
export function preloadArt({ small = false, h = innerHeight, dpr = devicePixelRatio || 1 } = {}) {
  const urls = [backgroundUrl(h, dpr)];
  for (const c of Object.values(CHARACTERS)) for (const p of POSES) urls.push(artUrl(c.poses[p], small));
  return Promise.all(urls.map(loadImage));
}
