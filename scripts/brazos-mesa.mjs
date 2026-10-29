// Lo que necesitan los bocetos de mis brazos (scripts/generar-personaje.py brazos, optimizar-arte.py brazos), leído del
// código del juego: las siluetas de relleno (RELLENO, LIENZO, FIGURAS y FICHAS de client/stage/arms.js), el tamaño de las
// cartas y las fichas, y dónde caen mis cartas boca abajo en la imagen del brazo izquierdo (CARTAS_MESA: sus cuatro
// esquinas, de allá a la izquierda en el sentido del reloj, en unidades del lienzo), con la mesa de una pantalla de
// 1440 x 900 como la arma la escena (la misma que test/brazos.test.js; en otros tamaños varía unas 10 unidades de 1000).
// Uso: node scripts/brazos-mesa.mjs  (escribe JSON)
globalThis.document ??= { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({}) }) }) };
const { CHARACTERS } = await import('../client/stage/characters.js');
const { CAMERAS } = await import('../client/stage/config.js');
const { makeView, fit, myPlace } = await import('../client/stage/projection.js');
const { CARD_W, CARD_H, CHIP_R, CHIP_H, FOLD, cardCorners } = await import('../client/stage/items.js');
const { CARD_PX } = await import('../client/stage/cards.js');
const { Brazos, RELLENO, LIENZO, FIGURAS, FICHAS, lugaresBrazos } = await import('../client/stage/arms.js');

const CAM = CAMERAS.landscape, W = 1440, H = 900;
const HEAD = Math.max(...Object.values(CHARACTERS).map(c => c.angles.frente.height * c.angles.frente.waist[1])) * (CAM.rivals || 1);
const reserve = Math.min(210, Math.max(130, H * 0.21));
const v = fit(makeView({ W, H, top: 80, reserve, portrait: false, cam: CAM }), HEAD, CAM);
const geo = lugaresBrazos(myPlace(v, { W, H, reserve, mineX: CAM.mine.x, boardZ: CAM.board.z }), CAM.mine.scale);
const b = new Brazos({ cargar: () => Promise.resolve({}) });
b.acomodar({ v, line: 1.6, dpr: 2, small: false, ...geo });
b.poner({ personaje: { color: '#000000' }, conCartas: true, cartas: null, enseño: false, marcasDesde: 0, pila: 5000 }, 0);
const l = b.lugar('izquierdo');
const enImagen = p => [((p.x - l.x) / l.w) * LIENZO[0], ((p.y - l.y) / l.h) * LIENZO[1]];
const CARTAS_MESA = geo.cartasMesa.map(m => {
  const c = cardCorners(m.at, CARD_W * m.scale, CARD_H * m.scale, 0.03, m.yaw);
  return ['tl', 'tr', 'br', 'bl'].map(k => enImagen(v.project(c[k].x, c[k].y, c[k].z)));
});
console.log(JSON.stringify({ RELLENO, LIENZO, FIGURAS, FICHAS, FOLD, CARD_PX, CHIP_R, CHIP_H, CARTAS_MESA }));
