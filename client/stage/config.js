// Configuración de la escena: la orilla de la mesa, las cámaras y dónde se sienta cada rival.
//
// Todo va en coordenadas de la mesa (ver projection.js): x a la derecha, z hacia mí, el fieltro en y = 0,
// y la unidad es el ancho de la mesa de su centro a la orilla de un lado. Así todo pasa por la misma perspectiva.
//
// En la computadora la mesa es una ilustración (la de referencia/composicion.png, extraída con
// scripts/extraer-mesa.py) y todo lo demás tiene que caer en su perspectiva: TABLE_EDGE, RAIL_Y, APRON, FELT_R y
// el `pitch` y la `dist` de CAMERAS.landscape salen de calcarla (scripts/calcar-mesa.py, que los imprime) y se
// copian aquí y en projection.js; mesa.json trae los mismos números con la ilustración (scripts/optimizar-arte.py
// mesa) y test/mesa.test.js revisa que coincidan. Cambiar cualquiera de ellos pide volver a calcar. A los rivales se
// les recorta en la orilla del propio dibujo (su silueta en mesa.json). La mesa de código queda de respaldo (vista
// en vertical y si la ilustración no carga), con esta misma orilla.

// Orilla de afuera de la mesa (arriba del riel), en orden, calcada de la ilustración: un lado plano frente a mí
// (z = 1.034), sus dos vecinos abriéndose en diagonal hacia los lados, dos lados a la izquierda y la derecha y otro
// lado plano al fondo. Más honda que ancha: la cámara de la ilustración es baja (19°) y la ve de lejos.
export const TABLE_EDGE = [
  { x: 1, z: 0.382 }, { x: 0.421, z: 1.034 }, { x: -0.421, z: 1.034 }, { x: -1, z: 0.382 },
  { x: -1, z: -0.382 }, { x: -0.421, z: -1.034 }, { x: 0.421, z: -1.034 }, { x: 1, z: -0.382 },
];

// Cámara de toma de serie, sin girar (mira al centro de la mesa). En la computadora, la de la ilustración: 19° hacia
// abajo (lo dicen las fichas dibujadas en la referencia) y lejos, con los ojos a 0.65 del fieltro; mi riel se ve
// pasando por abajo de la pantalla. En vertical (celular) ve más desde arriba y un poco más lejos.
//   pitch    grados hacia abajo
//   dist     distancia al centro de la mesa
//   width    ancho de la mesa en pantalla, en veces el ancho de la pantalla: más de 1 para que su
//            orilla se salga por los dos lados (es lo más angosta que puede quedar)
//   art      (horizontal) con la mesa ilustrada: el frente de la mesa no está en el dibujo (la referencia lo corta),
//            así que la orilla de abajo del dibujo queda en la orilla de abajo de la pantalla o más abajo; de mi
//            riel se ve la banda que sale por abajo
//   rail     (sin `art`) a cuántos px de la orilla de abajo de la pantalla queda la orilla de afuera de mi riel; sin
//            `rail` ni `art`, mi orilla se sale por abajo
//   headGap  espacio en px entre la franja de arriba y la cabeza del rival más alto del fondo
//   rivals   cuánto más grandes se dibujan los rivales que lo que mide su `height` (personajes.json): con la cámara
//            de la mesa ilustrada, baja y lejana, se verían chicos junto a la mesa; en la referencia son grandes
//   lean     grados que se levantan de más las cartas sobre la mesa, para que con una cámara más baja se
//            sigan leyendo igual
//   board    las cartas comunitarias: `scale` su tamaño (en el celular siempre son más grandes) y `z` lo más
//            que se acercan a mí desde el centro de la mesa (con la cámara baja, para que su orilla de arriba no
//            tape las fichas de los del fondo)
//   mine     mis dos cartas sobre la mesa: `scale` su tamaño y `x` dónde van, en fracción del ancho de la
//            pantalla (con la cámara baja se ven más grandes y van más a la orilla, para no tocar las comunitarias)
//   maxGrow  (vertical) cuánto pueden agrandarse los rivales para llenar el espacio de arriba
// En vertical la cámara se aleja un poco para que quepan los de los lados.
export const CAMERAS = {
  landscape: {
    pitch: 19, dist: 1.997, width: 0.9, art: true, headGap: 62, rivals: 1.6,
    lean: 6, board: { scale: 1.25, z: 0 }, mine: { scale: 1, x: 0.17 },
  },
  portrait: { pitch: 50, dist: 2.4, width: 1.18, headGap: 118, maxGrow: 2.6 },
};

// Fondo del garaje: dónde está la lámpara en la imagen (`lamp`: centro del domo y su orilla de abajo, en
// fracción del ancho y del alto de la imagen) y cuántos px quedan libres entre ella y la cabeza más alta de
// los rivales del fondo (`gap`). El fondo cubre la pantalla con la lámpara al centro; si la lámpara quedaría
// detrás de una cabeza, el fondo se sube y, si hace falta para seguir cubriendo, se agranda.
export const BACKDROP = { lamp: [0.5, 0.23], gap: 10 };

// Lugares para los rivales, por el ángulo desde el centro de la mesa (90° = mi lado, 270° = el fondo).
// Cada rival se sienta con la cintura en la orilla, en ese ángulo.
//   row    'back' (fila del fondo, de frente) o 'side' (los de los lados, más cerca y más grandes)
//   side   'left' o 'right': usan la imagen de lado (tres cuartos). Cada rival ve hacia el centro de la mesa: va
//          en espejo si su imagen ve hacia el otro lado (`mira` en personajes.json), en cualquier asiento
//   scale  cuánto más grandes se dibujan (los de los lados están más cerca de la cámara que la mesa)
//   out    cuánto se sientan detrás de la orilla, en unidades de la mesa, hacia afuera en la dirección `ang`
//   cut    'edge': se recortan justo en la línea de la orilla de afuera del riel, con la cintura en esa
//          línea (la mesa los tapa hasta la cintura) y una sombra suave sobre el riel donde la tocan.
//          Sin `cut`, la mesa solo tapa lo que queda debajo de su cintura.
//   portrait  valores que cambian en vertical (celular): la pantalla es angosta, los de los lados van menos
//             afuera y los del fondo, más juntos
// Los de los lados: `ang` más hacia el fondo (mayor a 180 a la izquierda, menor a 360 a la derecha) los
// pasa detrás de la diagonal lejana; `out` los saca hacia la orilla de la pantalla. En horizontal se les ve
// casi toda la cara (86 % en 1440 x 900, más en pantallas más anchas).
// En horizontal los del fondo se reparten a lo ancho para que el espacio entre todos los rivales (los de
// los lados incluidos) se vea parejo; los de las puntas quedan sobre las diagonales lejanas.
// En horizontal los del fondo también se recortan en la orilla (`cut: 'edge'`): la de la ilustración no coincide
// exacto con TABLE_EDGE (en las diagonales lejanas el riel dibujado queda hasta ~10 px más arriba) y, con el corte en
// su cintura, se veían sentados encima del riel. En vertical (mesa de código) su cintura ya cae en la orilla.
const back = (ang, portrait) => ({ ang, row: 'back', cut: 'edge', portrait: { ang: portrait ?? ang, cut: undefined } });
const LEFT = { ang: 197, out: 0.22, row: 'side', side: 'left', scale: 1.15, cut: 'edge', portrait: { ang: 205, out: 0.02 } };
const RIGHT = { ang: 343, out: 0.22, row: 'side', side: 'right', scale: 1.15, cut: 'edge', portrait: { ang: 335, out: 0.02 } };

// Acomodo según cuántos rivales hay, en el orden real de juego: el que habla después de mí es el
// primero (a mi izquierda) y sigue el reloj por el fondo hasta el de mi derecha. Se llena primero el
// fondo desde el centro y luego los dos lados a la vez, para que nunca quede un lado vacío y el otro lleno.
export const LAYOUTS = [
  [],
  [back(270)],
  [back(252), back(288)],
  [back(235), back(270), back(305)],
  [back(213, 226), back(247, 252), back(293, 288), back(327, 314)],
  [LEFT, back(222, 235), back(270), back(318, 305), RIGHT],
  [LEFT, back(213, 226), back(247, 252), back(293, 288), back(327, 314), RIGHT],
];
