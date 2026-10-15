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
| `espia` | no | levanta la esquina de sus cartas para verlas | al repartir y de vez en cuando |
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
- Entregar en **PNG**. El JPEG ensucia la orilla.

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

Para generar los cuadros con Gemini: `scripts/generar-personaje.py` (ver su uso al inicio del archivo).
Deja los cuadros aprobados directamente en `arte/personajes/<id>/`.
