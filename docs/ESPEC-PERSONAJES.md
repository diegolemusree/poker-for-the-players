# Especificación de personajes

Cómo debe venir el arte de cada rival para que el juego lo pueda usar sin retoques. Vale igual para
dibujos hechos a mano y para imágenes generadas (los prompts de `scripts/prompts-personaje.toml`
siguen este documento).

## Cuántos y en qué ángulos

- Hasta **7 personajes**. Cada uno tiene un nombre fijo, que es el del bot que lo usa (por ejemplo,
  el alien siempre es "El Compadre Zorg"); se pone al registrarlo (`registrar <id> --nombre "..."`).
- Cada uno con **dos ángulos**:
  - **`frente`**: para los asientos del fondo. De frente a la cámara, simétrico.
  - **`lado`**: tres cuartos **mirando a la derecha**, para el asiento de la izquierda. El asiento de
    la derecha usa **la misma imagen en espejo**. Mientras no exista, se usa `frente`.

## Cuadros

| Cuadro | Obligatorio | Qué es | Cuándo lo usa el juego |
|---|---|---|---|
| `espera` | sí | sentado, aburrido, con sus dos cartas boca abajo al pecho | por omisión |
| `parpadeo` | no | idéntico a `espera`, solo con los ojos cerrados | 150 ms cada 3 a 6 s, solo en `espera` |
| `apuesta` | no | cartas en una mano y fichas en la otra, estirada hacia adelante, a la altura del pecho | unos 2 s al igualar, apostar o subir |
| `retirarse` | no | avienta sus cartas con desgano | al retirarse, antes de verse apagado |
| `espia` | no | mira sus cartas (solo cambian los ojos; las manos se quedan como en `espera`) | al repartir y de vez en cuando |
| `gana` | no | sonrisa satisfecha, cartas al pecho y una pila de fichas en la mano | mientras se ve el resultado de una mano que ganó |

Por ahora **solo `espera` es obligatorio**: mientras falte otro cuadro, el personaje se queda en
`espera` (no parpadea, no apuesta...). En cuanto el cuadro se procesa y se registra, el juego lo usa
solo. Los de siempre, los que hay que hacer para cada personaje, son `espera`, `parpadeo`, `apuesta` y
`retirarse`; `espia` y `gana` son extras.

Todos los cuadros de un mismo ángulo son **el mismo encuadre**: misma cámara, mismo tamaño, misma
posición del personaje y la misma silla; solo cambian los brazos, las manos y la cara. Si no, al cambiar
de cuadro el personaje brinca.

## Nombres de archivo

```
<id>-<ángulo>-<cuadro>.png
```

- `<id>`: corto, en minúsculas y sin acentos (`alien`, `pulpo`, `turista`).
- `<ángulo>`: `frente` o `lado`.
- `<cuadro>`: `espera`, `parpadeo`, `espia`, `apuesta`, `retirarse` o `gana`.

Ejemplos: `alien-frente-espera.png`, `alien-lado-retirarse.png`.

Van en `arte/personajes/<id>/` (fuera de git; son los originales pesados). Otros archivos en esa carpeta
(por ejemplo una hoja de referencia como `robot-hoja.png`) no cuentan como cuadros: el optimizador los
salta.

## Encuadre

- **Cuerpo completo, sentado en su silla**: de la cabeza a los pies y las patas de la silla.
- **Cada personaje tiene su propia silla** (plegable, de playa, de oficina...), la misma en todos sus
  cuadros. La silla es parte del dibujo.
- **Las cartas al pecho**: todo lo que sostiene va a la altura del pecho, frente al cuerpo. En el juego
  la mesa lo recorta en la cintura, así que de ahí para abajo no se ve, pero las manos y las cartas sí.
- Cabeza completa con un poco de aire arriba.
- Nada más en la imagen: sin mesa, sin piso ni tarima bajo la silla, sin otros personajes, sin objetos
  sueltos. (Si algo así llega a venir abajo, se puede cortar al procesar: ver `CORTE_ABAJO` en
  `scripts/optimizar-arte.py`, como la tarima del pulpo.)

## Fondo

- **Verde puro `#00FF00` o magenta puro `#FF00FF`**, liso, sin degradado, viñeta, piso ni sombra.
- Se usa **el color que no tenga el personaje**: verde para uno morado, rosa, naranja o amarillo;
  magenta para uno verde. **Nada de ese color en el personaje ni en su silla**: el chroma key lo borraría.
- No tiene que ser exacto: el optimizador toma el color de las cuatro esquinas de cada imagen (un verde
  amarillento también sirve).
- Entregar en **PNG**. El JPEG ensucia la orilla. (La API de Gemini solo entrega JPEG: por eso el generador
  toma de Gemini solo lo que cambia y todo lo demás sale de la base.)

## Estilo

- **Animación 2D para adultos**, dibujada a mano.
- **Línea delgada y uniforme, color negro-café** (`#1d1611`), del mismo grueso en todo el dibujo.
- **Colores limpios y planos**, con **una sola sombra plana** por color: sin degradados, brillos,
  reflejos, luz de borde, texturas, mugre ni manchas.
- **Todo original**: nada que se parezca a personajes, logos o diseños de series o franquicias existentes.
- **Sin texto** (letras, números, logos) **ni detalles de un solo lado** (un parche, un reloj en una
  muñeca, el peinado de lado): la imagen de `lado` también se ve en espejo y se notaría.

## Del arte al juego

```
arte/personajes/<id>/*.png
   │  scripts/optimizar-arte.py personajes <id>   quita el fondo verde o magenta (también en los huecos
   │                                              entre brazos, silla y tentáculos), una caja de recorte por
   │                                              personaje y ángulo, reduce (frente ≤ 1000 px de alto,
   │                                              lado ≤ 1200 px) y exporta en WebP; avisa si quedan restos
   ▼                                              del fondo (arte/revision/<cuadro>-restos.png)
public/assets/arte/<id>-<ángulo>-<cuadro>.webp  (+ -chico.webp)
   │  scripts/optimizar-arte.py gif <id>          arte/revision/<id>-<ángulo>.gif para revisar que no brinque,
   │                                              con la línea de la cintura y la caja de la cara
   │  scripts/optimizar-arte.py registrar <id> --nombre "..."   lo agrega a client/stage/personajes.json
   ▼
client/stage/personajes.json   medir a mano waist, face y height (ver CLAUDE.md); ya entra a la mesa
```

## Cuadros generados con Gemini

`scripts/generar-personaje.py` (ver su uso al inicio del archivo) hace los cuadros que faltan sin generar nada
desde cero:

- **La base es `frente-espera`, ya aprobada**, en `arte/personajes/<id>/`, con el personaje ya registrado y
  medido en `personajes.json`. Cada cuadro es uno o dos cambios a esa base, **uno por llamada**. `gana` son dos
  (los brazos con las fichas y luego la sonrisa), cada uno sobre la base.
- **Ficha por personaje** en `scripts/fichas/<id>.toml`: fondo, ojos y cómo parpadea (la robot no tiene
  párpados: se le oscurece el visor; el nerd cierra los ojos detrás de los lentes; el alien cierra sus cuatro
  ojos), a dónde mira, sonrisa, manos, color de las fichas de póker (nunca el del fondo), partes opacas y rasgos
  que deben quedar igual. Una ficha con `pendiente` no se usa para gastar.
- **Por zonas**: de cada llamada solo se toma la zona que debe cambiar. Los ojos (la caja `face` de
  `personajes.json`) en `parpadeo`, `espia` y la sonrisa de `gana`; los brazos, las manos y las cartas (de la
  barbilla a un poco abajo de la cintura) en `apuesta`, `retirarse` y `gana`. Todo lo demás sale de la base
  píxel por píxel.
- **Revisiones automáticas** antes de enseñar nada: la silueta coincide con la base fuera de la zona, sin
  costuras, sí hubo cambio (y en la cara no de más), sin colores cercanos al fondo ni restos ni manchas (con el
  chroma key del juego), sin texto (OCR de macOS) y sin salirse de la caja de recorte. Si algo falla, reintenta
  una vez; si vuelve a fallar, lo guarda como `-FALLA.png` y avisa. **Máximo 2 llamadas por cambio** (así que
  `gana`, que son dos cambios, como mucho 4).
- Deja en `arte/generadas/<id>/` el cuadro, su GIF como se verá en el juego y una hoja de comparación;
  `aprobar` lo pasa a `arte/personajes/<id>/` (y respalda en `arte/respaldos/` lo que reemplace).
- **Lado**: su base será la única excepción a "nunca desde cero". Se generará a partir de la base de frente
  (para la robot, también de `robot-hoja.png`) y se aprueba antes de generar sus cuadros. Mientras no exista,
  el juego usa `frente`.
