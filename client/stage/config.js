// Configuración de la escena: la orilla de la mesa, las cámaras y dónde se sienta cada rival.
//
// Todo va en coordenadas de la mesa (ver projection.js): x a la derecha, z hacia mí, el fieltro en y = 0,
// y la unidad es el radio de la mesa a sus esquinas. Así todo pasa por la misma perspectiva.
//
// La mesa provisional se dibuja con código a partir de TABLE_EDGE, y a cada rival se le recorta en la
// línea de esa orilla. Cuando la mesa sea una ilustración, se dibujará con esta misma cámara (para que
// las fichas y las cartas caigan sobre su fieltro); entonces se calca su orilla sobre la imagen, se pasa a
// coordenadas de la mesa con view.unproject() de projection.js y se pegan aquí los puntos.

// Orilla de afuera de la mesa (arriba del riel), en orden. Octágono más ancho que profundo, como el de la
// composición de referencia: un lado plano largo frente a mí (z = 0.62), sus dos vecinos abriéndose en
// diagonal hacia los lados, dos lados cortos a la izquierda y la derecha, y otro lado plano largo al fondo.
export const TABLE_EDGE = [
  { x: 1, z: 0.2 }, { x: 0.58, z: 0.62 }, { x: -0.58, z: 0.62 }, { x: -1, z: 0.2 },
  { x: -1, z: -0.2 }, { x: -0.58, z: -0.62 }, { x: 0.58, z: -0.62 }, { x: 1, z: -0.2 },
];

// Cámara de toma de serie, sin girar (mira al centro de la mesa) y cerca de mi orilla, como en la
// composición de referencia: la mitad lejana de la mesa se ve comprimida y la cercana amplia.
//   pitch    grados hacia abajo
//   dist     distancia al centro de la mesa
//   width    ancho de la mesa en pantalla, en veces el ancho de la pantalla: más de 1 para que su
//            orilla se salga por los dos lados
//   headGap  espacio en px entre la franja de arriba y la cabeza del rival más alto del fondo
//   maxGrow  (vertical) cuánto pueden agrandarse los rivales para llenar el espacio de arriba
// En vertical la cámara se aleja un poco para que quepan los de los lados.
export const CAMERAS = {
  landscape: { pitch: 30, dist: 1.3, width: 1.16, headGap: 62 },
  portrait: { pitch: 64, dist: 2.1, width: 1.18, headGap: 118, maxGrow: 2.6 },
};

// Fondo del garaje: dónde está la lámpara en la imagen (`lamp`: centro del domo y su orilla de abajo, en
// fracción del ancho y del alto de la imagen) y cuántos px quedan libres entre ella y la cabeza más alta de
// los rivales del fondo (`gap`). El fondo cubre la pantalla con la lámpara al centro; si la lámpara quedaría
// detrás de una cabeza, el fondo se sube y, si hace falta para seguir cubriendo, se agranda.
export const BACKDROP = { lamp: [0.5, 0.23], gap: 10 };

// Lugares para los rivales, por el ángulo desde el centro de la mesa (90° = mi lado, 270° = el fondo).
// Cada rival se sienta con la cintura en la orilla, en ese ángulo.
//   row    'back' (fila del fondo, de frente) o 'side' (los de los lados, más cerca y más grandes)
//   side   'left' o 'right': usan la imagen de lado (tres cuartos); la de la derecha va en espejo
//   scale  cuánto más grandes se dibujan (los de los lados están más cerca de la cámara que la mesa)
const back = ang => ({ ang, row: 'back' });
const LEFT = { ang: 189, row: 'side', side: 'left', scale: 1.35 };
const RIGHT = { ang: 351, row: 'side', side: 'right', scale: 1.35 };

// Acomodo según cuántos rivales hay, en el orden real de juego: el que habla después de mí es el
// primero (a mi izquierda) y sigue el reloj por el fondo hasta el de mi derecha. Se llena primero el
// fondo desde el centro y luego los dos lados a la vez, para que nunca quede un lado vacío y el otro lleno.
export const LAYOUTS = [
  [],
  [back(270)],
  [back(252), back(288)],
  [back(235), back(270), back(305)],
  [back(226), back(252), back(288), back(314)],
  [LEFT, back(235), back(270), back(305), RIGHT],
  [LEFT, back(226), back(252), back(288), back(314), RIGHT],
];
