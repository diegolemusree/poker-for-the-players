# Especificación de personajes

Cómo debe venir el arte de cada rival para que el juego lo pueda usar sin retoques. Vale igual para
dibujos hechos a mano y para imágenes generadas (los prompts de `scripts/prompts-personaje.toml`
siguen este documento).

## Cuántos y en qué ángulos

- Hasta **7 personajes**.
- Cada uno con **dos ángulos**:
  - **`frente`**: para los asientos del fondo. De frente a la cámara, simétrico.
  - **`lado`**: tres cuartos **mirando a la derecha**, para el asiento de la izquierda. El asiento de
    la derecha usa **la misma imagen en espejo**.

## Cuadros

| Cuadro | Obligatorio | Qué es | Cuándo lo usa el juego |
|---|---|---|---|
| `espera` | sí | sentado, aburrido, con sus dos cartas boca abajo | por omisión |
| `parpadeo` | sí | idéntico a `espera`, solo con los ojos cerrados | 150 ms cada 3 a 6 s, solo en `espera` |
| `apuesta` | sí | cartas en una mano y fichas en la otra, estirada hacia adelante | unos 2 s al igualar, apostar o subir |
| `retirarse` | sí | avienta sus cartas con desgano | al retirarse, antes de verse apagado |
| `espia` | no | levanta la esquina de sus cartas para verlas | al repartir y de vez en cuando; si falta, se usa `espera` |

Todos los cuadros de un mismo ángulo son **el mismo encuadre**: misma cámara, mismo tamaño y misma
posición del personaje; solo cambian los brazos, las manos y la cara. Si no, al cambiar de cuadro el
personaje brinca.

## Nombres de archivo

```
<id>-<ángulo>-<cuadro>.png
```

- `<id>`: corto, en minúsculas y sin acentos (`blorp`, `alien`, `pulpo`).
- `<ángulo>`: `frente` o `lado`.
- `<cuadro>`: `espera`, `parpadeo`, `espia`, `apuesta` o `retirarse`.

Ejemplos: `alien-frente-espera.png`, `alien-lado-retirarse.png`.

Van en `arte/personajes/<id>/` (fuera de git; son los originales pesados).

## Encuadre

- **Medio cuerpo**: de la cabeza a un poco debajo de la cintura.
- **Brazos, manos y cartas a la altura de la mesa**: todo lo que sostiene va bajo, frente al cuerpo,
  cerca de la cintura. En el juego la mesa lo tapa de la cintura para abajo, así que nada importante
  puede quedar por debajo.
- Cabeza completa con un poco de aire arriba.
- Nada más en la imagen: sin mesa, sin otros personajes, sin objetos sueltos.

## Fondo

- **Magenta puro `#FF00FF`**, liso, sin degradado, viñeta, piso ni sombra.
- **Nada magenta ni rosa en el personaje**: el chroma key lo borraría.
- Entregar en **PNG**. El JPEG ensucia la orilla.

## Estilo

- **Animación 2D para adultos**, dibujada a mano.
- **Línea delgada y uniforme, color negro-café** (`#1d1611`), del mismo grueso en todo el dibujo.
- **Sombras planas de un solo tono** por color: sin degradados, brillos, reflejos ni luz de borde.
- **Colores apagados y terrosos**, con **texturas sucias**: manchas, mugre, tela gastada y arrugada.
- **Todo original**: nada que se parezca a personajes, logos o diseños de series o franquicias existentes.
- **Sin texto** (letras, números, logos) **ni detalles de un solo lado** (un parche, un reloj en una
  muñeca, el peinado de lado): la imagen de `lado` también se ve en espejo y se notaría.

## Del arte al juego

```
arte/personajes/<id>/*.png
   │  scripts/optimizar-arte.py personajes <id>   quita el magenta, una caja de recorte por personaje
   │                                              y ángulo, reduce (frente ≤ 700 px de alto,
   │                                              lado ≤ 1200 px) y exporta en WebP
   ▼
public/assets/arte/<id>-<ángulo>-<cuadro>.webp  (+ -chico.webp)
   │  scripts/optimizar-arte.py gif <id>          arte/revision/<id>-<ángulo>.gif para revisar que no brinque
   │  scripts/optimizar-arte.py registrar <id>    lo agrega a client/stage/personajes.json
   ▼
client/stage/personajes.json   medir a mano waist, face y height (ver CLAUDE.md) y asignarlo en characterFor()
```

Para generar los cuadros con Gemini: `scripts/generar-personaje.py` (ver su uso al inicio del archivo).
Deja los cuadros aprobados directamente en `arte/personajes/<id>/`.
