// Mis brazos en primera persona (client/stage/arms.js; "Brazos del jugador" en CLAUDE.md): cada personaje trae sus brazos
// completos o cae al relleno de su color sin errores; qué pose toca según mis cartas y lo que elegí; el empujón con mis
// jugadas; el orden de las capas; y dónde caen en pantallas horizontales de 4:3 a 21:9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CHARACTERS } from '../client/stage/characters.js';
import { CAMERAS } from '../client/stage/config.js';
import { makeView, fit, myPlace, DEG } from '../client/stage/projection.js';
import { CARD_W, CARD_H, CHIP_R, cardCorners } from '../client/stage/items.js';
import {
  Brazos, Jugadas, Asomo, RELLENO, POSES_BRAZO, COLOR_POR_OMISION, EMPUJON, brazosDe, faltanBrazos, archivosBrazos,
  brazosVisibles, posesDe, capas, empujon, fichasEn, lugaresBrazos, esquinasCarta,
} from '../client/stage/arms.js';

// En node no hay canvas: uno de mentira que acepta cualquier dibujo. Cada canvas recuerda la imagen que se le dibujó
// (las del arte se reducen a su tamaño en un canvas), así se puede ver en qué orden quedaron las capas.
function contexto(canvas, registro) {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k === 'drawImage') return img => { const o = img.origen || img; if (canvas) canvas.origen = o; if (registro) registro.push(o); };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
globalThis.document ??= { createElement: () => { const c = { width: 0, height: 0 }; c.getContext = () => contexto(c); return c; } };
globalThis.Path2D ??= class {};

const enUso = Object.entries(CHARACTERS);
const arte = (p, archivo) => new URL(`../public/${p.carpeta}/${archivo}.webp`, import.meta.url);
const enDisco = p => archivo => existsSync(arte(p, archivo)) && existsSync(arte(p, `${archivo}-chico`));
// unos brazos con arte completo, de mentira (los archivos no existen: `existe` dice que sí)
const pose = archivo => ({ archivo });
const COMPLETOS = {
  izquierdo: {
    size: [820, 1150], ancla: [0.66, 0.3], alto: 0.86,
    poses: {
      ver: {
        archivo: 'x-brazo-izq-ver', cartas: [{ c: [0.57, 0.17], ancho: 0.17, angulo: -9 }, { c: [0.71, 0.16], ancho: 0.17, angulo: 6 }],
        pulgar: { archivo: 'x-brazo-izq-ver-pulgar', caja: [0.46, 0.14, 0.64, 0.34] },
      },
      ocultar: pose('x-brazo-izq-ocultar'), vacio: pose('x-brazo-izq-vacio'),
    },
  },
  derecho: {
    size: [820, 1150], ancla: [0.3, 0.28], alto: 0.8,
    poses: { descansar: pose('x-brazo-der-descansar'), jugar: { archivo: 'x-brazo-der-jugar', fichas: [0.22, 0.2] } },
  },
};
const copia = o => JSON.parse(JSON.stringify(o));

test('cada personaje en uso tiene el color de sus manos', () => {
  for (const [id, c] of enUso) assert.match(c.color || '', /^#[0-9a-f]{6}$/i, `${id}: falta "color" en personajes.json (o no es #rrggbb)`);
});

test('cada personaje tiene sus brazos completos (con sus imágenes) o cae al relleno de su color', () => {
  for (const [id, c] of enUso) {
    const b = brazosDe(c, enDisco(c));
    if (c.brazos && b.arte) {
      assert.deepEqual(faltanBrazos(c.brazos, enDisco(c)), []);
      for (const a of archivosBrazos(c.brazos)) assert.ok(enDisco(c)(a), `${id}: falta public/${c.carpeta}/${a}.webp (o su -chico)`);
    } else {
      // sin arte (o incompleto): las siluetas de relleno con sus anclas por defecto y su color
      assert.equal(b.arte, false, id);
      assert.equal(b.izquierdo, RELLENO.izquierdo, id);
      assert.equal(b.derecho, RELLENO.derecho, id);
      assert.equal(b.color, c.color, id);
      if (c.brazos) console.log(`  ${id}: sus brazos están incompletos (${b.faltan.join('; ')}); mientras, el relleno`);
    }
  }
});

test('todo o nada: un brazo incompleto, una imagen que falta o un ancla fuera de la imagen dan el relleno', () => {
  const si = () => true;
  const completo = brazosDe({ color: '#123456', brazos: COMPLETOS }, si);
  assert.equal(completo.arte, true);
  assert.deepEqual(completo.faltan, []);
  assert.equal(archivosBrazos(COMPLETOS).length, 6, 'seis imágenes por personaje');
  const sinPose = copia(COMPLETOS); delete sinPose.izquierdo.poses.ocultar;
  const sinPulgar = copia(COMPLETOS); delete sinPulgar.izquierdo.poses.ver.pulgar;
  const fuera = copia(COMPLETOS); fuera.derecho.ancla = [1.2, 0.3];
  const unaCarta = copia(COMPLETOS); unaCarta.izquierdo.poses.ver.cartas.pop();
  const sinFichas = copia(COMPLETOS); delete sinFichas.derecho.poses.jugar.fichas;
  const sinDerecho = copia(COMPLETOS); delete sinDerecho.derecho;
  const manoMala = copia(COMPLETOS); manoMala.izquierdo.mano = [0.5, 0.2, 0.4, 0.3];
  for (const [nombre, brazos, existe] of [
    ['sin la pose ocultar', sinPose, si], ['sin pulgar', sinPulgar, si], ['ancla fuera de la imagen', fuera, si],
    ['con una sola carta', unaCarta, si], ['sin el punto de las fichas', sinFichas, si], ['sin brazo derecho', sinDerecho, si],
    ['sin una de sus imágenes', COMPLETOS, a => a !== 'x-brazo-der-jugar'], ['sin brazos', undefined, si],
    ['con una mano que no es caja', manoMala, si],
  ]) {
    const b = brazosDe({ color: '#123456', brazos }, existe);
    assert.equal(b.arte, false, nombre);
    assert.ok(b.faltan.length > 0, nombre);
    assert.equal(b.izquierdo, RELLENO.izquierdo, nombre);
    assert.equal(b.color, '#123456', nombre);
  }
  // sin color (o con uno que no es color), el de por omisión; sin personaje tampoco truena
  assert.equal(brazosDe({ brazos: COMPLETOS }, si).color, COLOR_POR_OMISION);
  assert.equal(brazosDe({ color: 'verde' }).color, COLOR_POR_OMISION);
  assert.equal(brazosDe(null).arte, false);
  assert.equal(brazosDe(undefined).color, COLOR_POR_OMISION);
});

test('con arte, lo que ocupa cada mano es su `mano` medida o, si no la trae, una caja alrededor del ancla', () => {
  const conMano = copia(COMPLETOS); conMano.derecho.mano = [0.1, 0.15, 0.45, 0.35];
  const [, sinMedir] = brazos({ color: '#123456', brazos: COMPLETOS }).cajas();
  const b = brazos({ color: '#123456', brazos: conMano }), l = b.lugar('derecho'), [, medida] = b.cajas();
  assert.ok(Math.abs(medida.x0 - (l.x + 0.1 * l.w)) < 1e-6, 'empieza donde empieza su mano');
  assert.ok(medida.x1 < sinMedir.x1, 'la medida es más angosta que la genérica');
});

test('las anclas por defecto del relleno están dentro de su imagen', () => {
  const dentro = v => v >= 0 && v <= 1;
  for (const lado of ['izquierdo', 'derecho']) {
    const a = RELLENO[lado];
    assert.ok(a.ancla.every(dentro) && a.alto > 0 && a.size.every(n => n > 0), lado);
    assert.deepEqual(Object.keys(a.poses), POSES_BRAZO[lado], lado);
  }
  const ver = RELLENO.izquierdo.poses.ver;
  assert.equal(ver.cartas.length, 2);
  for (const c of ver.cartas) assert.ok(c.c.every(dentro) && c.ancho > 0 && c.ancho <= 1 && Number.isFinite(c.angulo));
  assert.ok(ver.pulgar.caja.every(dentro));
  assert.ok(RELLENO.derecho.poses.jugar.fichas.every(dentro));
});

test('solo hay brazos en la computadora, en horizontal y sentado', () => {
  assert.equal(brazosVisibles({ compu: true, W: 1440, H: 900, sentado: true }), true);
  assert.equal(brazosVisibles({ compu: true, W: 900, H: 1000, sentado: true }), true, 'W/H = 0.9 todavía es horizontal');
  assert.equal(brazosVisibles({ compu: false, W: 1440, H: 900, sentado: true }), false, 'celular o tablet');
  assert.equal(brazosVisibles({ compu: true, W: 1440, H: 900, sentado: false }), false, 'quien solo mira');
  assert.equal(brazosVisibles({ compu: true, W: 800, H: 1100, sentado: true }), false, 'ventana vertical');
});

test('qué pose toca: ver, ocultar, asomarse solo con las cartas ocultas, sin cartas la mano vacía', () => {
  const base = { conCartas: true, enseño: false, cartas: 'ver', asomo: false, fichas: false, pila: 5000 };
  assert.deepEqual(posesDe(base), { izquierdo: 'ver', asoma: false, derecho: 'descansar' });
  assert.equal(posesDe({ ...base, cartas: 'ocultas' }).izquierdo, 'ocultar');
  assert.equal(posesDe({ ...base, asomo: true }).asoma, false, 'con las cartas a la vista no hay a qué asomarse');
  assert.equal(posesDe({ ...base, cartas: 'ocultas', asomo: true }).asoma, true);
  // me retiré o entre manos: la mano vacía, aunque siga presionando Asomarse
  assert.deepEqual(posesDe({ ...base, conCartas: false, cartas: 'ocultas', asomo: true }), { izquierdo: 'vacio', asoma: false, derecho: 'descansar' });
  // al final de la mano, si mis cartas se enseñan, se ven solas
  assert.equal(posesDe({ ...base, cartas: 'ocultas', enseño: true }).izquierdo, 'ver');
  // jugar con fichas, y sin fichas (all-in) descansa
  assert.equal(posesDe({ ...base, fichas: true }).derecho, 'jugar');
  assert.equal(posesDe({ ...base, fichas: true, pila: 0 }).derecho, 'descansar');
});

test('el orden de las capas: Ver es brazo, mis dos cartas y el pulgar; lo levantado al asomarse va encima de la mano', () => {
  assert.deepEqual(capas('izquierdo', 'ver'), ['brazo', 'carta1', 'carta2', 'pulgar']);
  assert.deepEqual(capas('izquierdo', 'ocultar'), ['cartas', 'brazo', 'esquinas']);
  assert.deepEqual(capas('izquierdo', 'vacio'), ['brazo']);
  assert.deepEqual(capas('derecho', 'descansar'), ['brazo']);
  assert.deepEqual(capas('derecho', 'jugar'), ['fichas', 'brazo', 'brinco']);
});

// Una mesa de 1440 x 900 como la de la escena (index.js) y unos brazos acomodados en ella.
const CAM = CAMERAS.landscape;
const SALE_EN_4_3 = 0.03; // lo que la mano derecha puede salirse por la orilla derecha en 4:3, en fracción del ancho
const HEAD = Math.max(...Object.values(CHARACTERS).map(c => c.angles.frente.height * c.angles.frente.waist[1])) * (CAM.rivals || 1);
function mesa(W, H) {
  const reserve = Math.min(210, Math.max(130, H * 0.21));
  const v = fit(makeView({ W, H, top: 80, reserve, portrait: false, cam: CAM }), HEAD, CAM);
  return { W, H, reserve, v, lugar: myPlace(v, { W, H, reserve, mineX: CAM.mine.x, boardZ: CAM.board.z }) };
}
function brazos(personaje, m = mesa(1440, 900), cargar = () => Promise.resolve({ naturalWidth: 820, naturalHeight: 1150 })) {
  const b = new Brazos({ cargar });
  b.acomodar({ v: m.v, line: 1.6, dpr: 2, small: false, ...lugaresBrazos(m.lugar, CAM.mine.scale) });
  b.poner({ personaje, conCartas: true, cartas: [{ code: 'Ah', mark: null }, { code: 'Kd', mark: null }], enseño: false, marcasDesde: 0, pila: 5000 }, 0);
  return b;
}

test('mi jugada nueva empuja: igualar, apostar o subir el derecho; all-in los dos; lo demás nada', () => {
  const j = new Jugadas(), yo = { id: 'yo', lastAction: null }, mesaClave = 'ABCDE:yo';
  let n = 10;
  const jugada = (type, { allIn = false, mia = true, borrada = false } = {}) => {
    const a = { type, amount: 50, allIn, n: ++n };
    if (mia) yo.lastAction = borrada ? null : a;
    return { lastAction: { id: mia ? 'yo' : 'rival', ...a } };
  };
  // al cargar (o reconectar) la última jugada solo se recuerda: no se repite
  yo.lastAction = { type: 'raise', amount: 200, allIn: false, n: 10 };
  assert.equal(j.revisar({ lastAction: { id: 'yo', ...yo.lastAction } }, yo, mesaClave), null);
  const v = jugada('call');
  assert.equal(j.revisar(v, yo, mesaClave), 'derecho');
  assert.equal(j.revisar(v, yo, mesaClave), null, 'la misma jugada no empuja dos veces');
  assert.equal(j.revisar(jugada('bet'), yo, mesaClave), 'derecho');
  assert.equal(j.revisar(jugada('raise'), yo, mesaClave), 'derecho');
  assert.equal(j.revisar(jugada('raise', { allIn: true }), yo, mesaClave), 'ambos');
  assert.equal(j.revisar(jugada('call', { allIn: true }), yo, mesaClave), 'ambos');
  for (const t of ['check', 'fold', 'sb', 'bb']) assert.equal(j.revisar(jugada(t), yo, mesaClave), null, t);
  assert.equal(j.revisar(jugada('raise', { mia: false }), yo, mesaClave), null, 'la de un rival');
  // mi igualada cierra la ronda: el servidor ya borró la mía, pero la de la mesa (que no se borra) es mía
  assert.equal(j.revisar(jugada('call', { borrada: true }), yo, mesaClave), 'derecho');
  // igualé y un rival jugó enseguida: la de la mesa ya es suya, pero la mía es nueva
  jugada('call');
  assert.equal(j.revisar({ lastAction: { id: 'rival', type: 'check', n: ++n } }, yo, mesaClave), 'derecho');
  // en otra mesa se empieza de nuevo
  assert.equal(j.revisar(jugada('raise'), yo, 'FGHIJ:yo'), null);
});

test('el empujón va y regresa en ~450 ms; asomarse y las fichas; con movimiento reducido nada se anima', () => {
  assert.equal(empujon(-1), 0);
  assert.equal(empujon(0), 0);
  assert.ok(empujon(120) > 0.5 && empujon(120) < 1, 'ease-out: a la mitad de la ida ya va más de la mitad');
  assert.equal(empujon(EMPUJON.ida), 1);
  assert.ok(empujon(EMPUJON.ida + 100) > 0 && empujon(EMPUJON.ida + 100) < 1);
  assert.equal(empujon(EMPUJON.ida + EMPUJON.regreso), 0);
  assert.equal(EMPUJON.escala, 0.92);
  // asomarse: sube en 180 ms y baja en 150; de golpe con movimiento reducido
  const a = new Asomo();
  a.poner(1, 0);
  assert.ok(a.en(90) > 0 && a.en(90) < 1);
  assert.equal(a.en(180), 1);
  a.poner(0, 1000);
  assert.ok(a.en(1075) > 0 && a.en(1075) < 1);
  assert.equal(a.en(1150), 0);
  const quieta = new Asomo();
  quieta.poner(1, 0, true);
  assert.equal(quieta.en(0), 1);
  assert.ok(!quieta.moviendo(0));
  // la ficha que brinca: reposo, al aire, en la otra columna y de regreso; quieta, siempre en su columna
  assert.deepEqual([0, 600, 1000, 1400].map(t => fichasEn(t).en), ['a', 'ab', 'b', 'ba']);
  assert.deepEqual([0, 600, 1000, 1400].map(t => fichasEn(t, true).en), ['a', 'a', 'a', 'a']);
  // la capa: con movimiento, el empujón y las fichas piden volver a pintar; con movimiento reducido, no
  const g = contexto();
  const b = brazos(CHARACTERS.alien);
  b.elegir({ cartas: 'ver', fichas: true }, 0);
  b.dibujar(g, 10, false);
  assert.ok(b.ocupado(20, false), 'jugando con fichas se anima');
  b.dibujar(g, 30, true);
  assert.ok(!b.ocupado(40, true), 'con movimiento reducido las fichas se quedan quietas');
  b.elegir({ cartas: 'ver', fichas: false }, 50);
  b.empujar('ambos', 100);
  b.dibujar(g, 110, false);
  assert.ok(b.ocupado(200, false), 'empujando');
  assert.ok(!b.ocupado(200 + EMPUJON.ida + EMPUJON.regreso, false), 'ya regresó');
  b.dibujar(g, 120, true);
  assert.ok(!b.ocupado(130, true), 'con movimiento reducido no hay empujón');
});

test('sin errores: cada pose se dibuja con el relleno de cada personaje y con arte, también asomándose, empujando y con marcas', async () => {
  const conArte = { name: 'Con arte', carpeta: 'assets/arte', color: '#123456', brazos: COMPLETOS };
  const todos = [...enUso.map(([, c]) => c), conArte, { name: 'Sin color', carpeta: 'assets/arte' }];
  for (const p of todos) {
    const b = brazos(p);
    b.listo(); // el arte empieza a cargar
    await new Promise(r => setTimeout(r, 0));
    assert.ok(b.listo(), p.name);
    const g = contexto();
    for (const cartas of ['ver', 'ocultas']) for (const fichas of [false, true]) for (const conCartas of [true, false]) {
      b.poner({ personaje: p, conCartas, cartas: conCartas ? [{ code: 'Ah', mark: 'win' }, { code: 'Td', mark: 'dim' }] : null, enseño: false, marcasDesde: 0, pila: fichas ? 5000 : 0 }, 0);
      b.elegir({ cartas, fichas }, 0);
      b.asomarse(true, 0);
      b.empujar('ambos', 0);
      for (const t of [0, 90, 250, 400, 1000]) for (const quieto of [false, true]) b.dibujar(g, t, quieto);
      b.medidas(g);
    }
    assert.equal(b.cajas().length, 2, p.name);
  }
  // si una imagen del arte no carga, ese personaje se dibuja con el relleno de su color
  const falla = brazos(conArte, mesa(1440, 900), url => (url.includes('pulgar') ? Promise.reject(new Error('no está')) : Promise.resolve({ naturalWidth: 820, naturalHeight: 1150 })));
  falla.listo();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(falla.listo());
  assert.equal(falla.def.arte, false);
  assert.equal(falla.def.color, '#123456');
});

test('con arte, Ver se dibuja en este orden: el brazo, mis dos cartas y el pulgar', async () => {
  const img = nombre => ({ nombre, naturalWidth: 820, naturalHeight: 1150 });
  const b = brazos({ name: 'Con arte', carpeta: 'assets/arte', color: '#123456', brazos: COMPLETOS }, mesa(1440, 900), url => Promise.resolve(img(url.split('/').pop())));
  b.listo();
  await new Promise(r => setTimeout(r, 0));
  const registro = [];
  b.dibujar(contexto(null, registro), 0, true);
  // las cartas son canvas de cards.js (sin nombre); las del arte, sus imágenes
  const orden = registro.map(o => (o.nombre ? o.nombre.replace('.webp', '') : 'carta'));
  assert.deepEqual(orden, ['x-brazo-izq-ver', 'carta', 'carta', 'x-brazo-izq-ver-pulgar', 'x-brazo-der-descansar']);
});

test('en pantallas horizontales de 4:3 a 21:9: los antebrazos salen por abajo y mis manos y mis cartas no tapan nada', () => {
  const tapa = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const caja = pts => ({ x0: Math.min(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), x1: Math.max(...pts.map(p => p.x)), y1: Math.max(...pts.map(p => p.y)) });
  // cada personaje con sus brazos (su arte si lo tiene; si no, el relleno)
  for (const [id, personaje] of enUso) for (const [W, H] of [[1024, 768], [1280, 800], [1366, 768], [1440, 900], [1920, 1080], [2560, 1080]]) {
    const m = mesa(W, H), b = brazos(personaje, m), donde = `${id} ${W}x${H}`;
    for (const lado of ['izquierdo', 'derecho']) {
      const l = b.lugar(lado), abajo = l.y + l.h;
      // empujando, el brazo sube y se achica hacia su ancla: aun así su orilla de abajo queda fuera de la pantalla
      const empujado = l.ay + l.hacia.y + EMPUJON.escala * (abajo - l.ay);
      assert.ok(empujado >= H, `${donde} ${lado}: la orilla de abajo del brazo queda en ${empujado.toFixed(0)}, arriba de la pantalla`);
    }
    // mis manos (con lo que tienen, en todas sus poses) adentro de la pantalla, abajo de la franja de arriba; en 4:3 la
    // derecha puede salirse un poco por la orilla derecha (una mano que juega con fichas no cabe entre mi pila y la
    // orilla), como el antebrazo por abajo
    const manos = b.cajas();
    for (const [i, c] of manos.entries()) {
      const derecha = i === 1 && W / H < 1.5 ? W * (1 + SALE_EN_4_3) : W;
      assert.ok(c.x0 >= 0 && c.x1 <= derecha && c.y0 >= 80, `${donde}: una mano se sale (${JSON.stringify(c)})`);
    }
    // las cartas en la mano, arriba de la barra de acciones
    const l = b.lugar('izquierdo');
    for (const c of RELLENO.izquierdo.poses.ver.cartas) {
      const k = caja(esquinasCarta(c, l));
      assert.ok(k.y1 <= m.H - m.reserve + 2 && k.x0 >= 0, `${donde}: una carta en la mano queda debajo de la barra o se sale (${JSON.stringify(k)})`);
    }
    // ni las comunitarias (sus 5 lugares, como index.js) ni el bote quedan debajo de mis manos
    const scale = CAM.board.scale, tilt = 0.62 + CAM.lean * DEG;
    for (let i = 0; i < 5; i++) {
      const c = cardCorners({ x: (i - 2) * (CARD_W * scale + 0.014), z: m.lugar.zBoard }, CARD_W * scale, CARD_H * scale, tilt, 0);
      const k = caja([c.tl, c.tr, c.bl, c.br].map(p => m.v.project(p.x, p.y, p.z)));
      for (const c2 of manos) assert.ok(!tapa(k, c2), `${donde}: una mano tapa la comunitaria ${i + 1}`);
    }
    const bote = caja([-1, 1].flatMap(sx => [-1, 1].map(sz => m.v.project(sx * (2 * (CHIP_R * 2 + 0.005) + CHIP_R), 0, m.lugar.zPot + sz * 0.07))));
    for (const c2 of manos) assert.ok(!tapa(bote, c2), `${donde}: una mano tapa el bote`);
    // la mano derecha (y las fichas con que juega) no tapa mi pila, aunque tenga 5 columnas de 12 fichas y dos filas
    // (como la acomoda items.js: columnas a lo ancho, filas hacia el fondo, en { x: xStack, z: zMe - 0.03 })
    const gap = CHIP_R * 2 + 0.005, pila = [];
    for (const u of [-2 * gap - CHIP_R, 2 * gap + CHIP_R]) for (const w of [-CHIP_R, gap * 0.95 + CHIP_R]) for (const y of [0, 12 * 0.008]) {
      pila.push(m.v.project(m.lugar.xStack + u, y, m.lugar.zMe - 0.03 - w));
    }
    assert.ok(!tapa(caja(pila), manos[1]), `${donde}: mi mano derecha tapa mi pila`);
  }
});
