# Poker for the Players

## Objetivo

Construir **Poker for the Players**, una página web privada para jugar Texas Hold'em No Limit en línea entre un grupo de amigos, con fichas virtuales (sin dinero real). Cada jugador entra desde su celular o computadora, crea o se une a una mesa con un código, y juega en tiempo real.

Es un proyecto personal para el dueño y sus amigos, no un producto público: no necesita registro, marketing, anuncios ni páginas legales complejas. Sí necesita verse profesional, porque vivirá en un dominio propio.

Responde y comenta en español. El nombre de la marca va en inglés ("Poker for the Players"), pero todos los textos de la interfaz van en español de México.

## Identidad de la marca

- Nombre completo: **Poker for the Players**. Usarlo en el `<title>`, en la pantalla de inicio y en la vista previa al compartir el link.
- Logotipo con el mismo estilo de caricatura de la escena: letras Chewy mostaza con contorno de tinta y sombra ladrillo, un poco chuecas, y la "o" de Poker es un ojo de párpado caído que parpadea. Original, sin parecerse a logos de series existentes.
- Favicon e ícono para celular (`apple-touch-icon` y `manifest.json`) para que se pueda agregar a la pantalla de inicio como si fuera app.
- Etiquetas Open Graph (`og:title`, `og:description`, `og:image`) con una imagen de vista previa de 1200 x 630, para que el link se vea bien al mandarlo por WhatsApp.
- Pantalla de inicio con el cuarto de juego de fondo, el logo, y tres acciones claras: "Jugar contra la compu", "Crear mesa" y "Unirme con código".

## Archivo de referencia

`referencia/poker-referencia.html` es un prototipo funcional hecho para correr dentro de claude.ai. Úsalo como base para:

- **El motor del juego** (sección `game rules`): `startHand`, `act`, `progress`, `roundDone`, `nextStreet`, `showdown`, `winByFold`, `foldOut`. Ya está probado con miles de manos simuladas: conserva las fichas, maneja botes secundarios, empates, all-in y heads-up. Pórtalo casi tal cual, no lo reescribas desde cero.
- **El evaluador de manos** (`score5`, `bestHand`, `cmp`, `handName`).
- **La lógica de la interfaz**: qué botones aparecen según el estado, cálculo de montos mínimos de subida y atajos de bote. El estilo visual de la referencia es plano y 2D; esta versión lo reemplaza por completo con la escena en primera persona descrita en "Estilo visual".

Lo que **NO** se reutiliza: todo lo que usa `window.claude`, `db`, `user`, `acquire` y `onSnapshot`. Eso era la base de datos de claude.ai y aquí no existe.

## Problema principal que resuelve esta versión

En el prototipo, el estado completo (incluyendo el mazo y las cartas de todos) se guardaba en un documento compartido, así que cualquiera podía espiar cartas con las herramientas del navegador. En esta versión **el servidor es la autoridad**:

- Solo el servidor tiene el mazo y las cartas de todos.
- Cada cliente recibe una vista filtrada: sus propias cartas, y las de los demás solo cuando se revelan en el showdown.
- El cliente únicamente envía intenciones (`fold`, `check`, `call`, `raise` con monto). El servidor valida que sea su turno y que la jugada sea legal.

## Stack

- Node.js 20+ con Express y Socket.IO
- Frontend empaquetado con Vite, sin framework ni motor 3D: la mesa es una escena 2D por capas (ilustraciones WebP + canvas) y la interfaz es HTML, CSS y JavaScript encima.
- Sin base de datos al inicio: las mesas viven en memoria del servidor
- Entorno de desarrollo: Mac Intel con VS Code

## Estructura sugerida

```
poker-for-the-players/
  CLAUDE.md
  README.md
  package.json
  server/
    index.js        # Express + Socket.IO, manejo de salas
    engine.js       # motor del juego portado de la referencia (sin dependencias de red)
    hands.js        # evaluador de manos
    bots.js         # decisiones de los bots por dificultad
  client/
    index.html
    main.js         # arranque, conexión con Socket.IO
    stage/          # mesa ilustrada por capas (ver "Estilo visual")
      index.js        # arma las capas, acomoda la vista del servidor, etiquetas y ciclo de animación
      config.js       # orilla de la mesa (lista de puntos), cámaras y acomodo de los rivales
      projection.js   # cámara: convierte puntos de la mesa a pantalla y al revés; ajuste a la pantalla
      table.js        # la mesa provisional dibujada en canvas (después será una ilustración)
      items.js        # fichas, cartas y botón del dealer en perspectiva
      cards.js        # caras y reversos de las cartas (canvas)
      rivals.js       # poses, parpadeo, respiración de los rivales
      characters.js   # registro de personajes y precarga del arte
    ui/             # palos dibujados, nombre de la mano, regla de "celular" (phone.js)
    audio/
  public/
    assets/         # logo, sonidos, íconos, imagen para compartir
      arte/         # ilustraciones optimizadas (WebP), generadas con scripts/optimizar-arte.py
      iconos/       # ícono de la app (icono.svg -> PNG con scripts/generar-iconos.mjs) y favicon
    manifest.json
    robots.txt
  test/
    engine.test.js  # simulación de manos aleatorias
  referencia/
    poker-referencia.html
  scripts/
    generar-personaje.py      # genera las poses con Gemini (arte/generadas/<personaje>/), luego las recorta e iguala
    prompts-personaje.toml    # prompts en inglés de cada ángulo y pose, editables
    recortar.py       # quita el fondo gris de las poses (arte/ -> arte/recortes/)
    optimizar-arte.py # arte/ -> public/assets/arte/*.webp, con las poses alineadas
    generar-iconos.mjs # PNG del ícono de la app (32, 180, 192, 512) a partir de icono.svg, con Chrome sin ventana
  arte/               # originales pesados, fuera de git (se quedan en la Mac)
```

## Requisitos funcionales

1. **Mesas con código**: pantalla inicial con "Crear mesa" (genera un código de 5 letras) y "Unirme" (escribir código). El link `/?mesa=ABCDE` entra directo.
2. **Apodo**: el jugador escribe su apodo antes de sentarse. Se guarda en `localStorage` para la próxima vez.
3. **Asientos**: hasta 7, yo más 6 rivales (`MAXP` en `server/engine.js`, y la misma constante en `client/main.js` y `client/stage/index.js`). Click en un asiento libre para sentarse antes de que empiece el torneo.
4. **Formato torneo** (decisión del dueño, para una noche de póker a distancia de ~4 horas):
   - Todos empiezan con **5,000 fichas**.
   - Ciegas que suben por reloj: niveles de 15 minutos por omisión (configurable al crear la mesa: 2, 5, 10, 15, 20 o 30), empezando en 25/50 y subiendo hasta 3000/6000 (lista `BLINDS` en `server/engine.js`). El nivel nuevo aplica al repartir la siguiente mano.
   - **Una sola recompra por jugador** por torneo (5,000 fichas), cuando se queda sin fichas y entre manos. Sin recompra disponible, queda eliminado con su lugar final.
   - El torneo **termina cuando un jugador tiene todas las fichas**. Si solo queda uno con fichas y otros aún pueden recomprar, tienen 60 segundos para decidir.
   - Una vez empezado no entran jugadores nuevos; quien se va queda "ausente" (se retira solo cada mano y paga ciegas) hasta que vuelve.
   - Dealer rota cada mano, heads-up correcto (el dealer pone la ciega chica y habla primero preflop).
5. **Acciones**: retirarse, pasar, igualar, apostar o subir con slider y atajos (½ bote, bote, todo).
6. **Showdown**: mostrar cartas de los que llegaron, nombre de la jugada y ganador(es).
7. **Turno con tiempo**: 45 segundos. Al vencer, el servidor pasa o retira automáticamente (ya no depende de que otro jugador presione un botón).
8. **Reconexión**: si alguien recarga la página, recupera su asiento y sus cartas. Usar un `playerToken` aleatorio guardado en `localStorage`, nunca el id del socket.
9. **Siguiente mano**: se reparte automáticamente 5 segundos después del showdown.
10. **Recompra única** cuando un jugador se queda en cero (ver formato torneo), y **levantarse** de la mesa antes de empezar o **ausentarse** durante el torneo. Si alguien deja pasar dos turnos seguidos, queda ausente.
11. **Mesas vacías** se borran de memoria después de 30 minutos sin jugadores.
12. **Acceso solo para el grupo**: código de acceso general del sitio, configurado con la variable de entorno `ACCESS_CODE`. Se pide una sola vez al entrar y se recuerda en el dispositivo. Si `ACCESS_CODE` no está definida (por ejemplo en desarrollo), no se pide. Validar en el servidor, no solo en el navegador.
13. El sitio no debe aparecer en buscadores: `robots.txt` con `Disallow: /` y la etiqueta `noindex`.

## Modo contra la computadora

Dos formas de jugar con bots:

1. **Práctica en solitario**: desde "Jugar contra la compu", el jugador elige cuántos rivales (1 a 6) y la dificultad, y empieza de inmediato. Es una mesa privada que nadie más puede ver ni unirse.
2. **Rellenar asientos en una mesa con amigos**: en una mesa normal, cualquier jugador sentado puede agregar o quitar bots en los asientos libres entre manos. Útil cuando son pocos.

### Dificultades

- **Fácil**: juega muchas manos, iguala seguido, casi no farolea, comete errores obvios. Para aprender.
- **Normal**: selección de manos razonable por posición, apuesta con manos fuertes, farolea de vez en cuando.
- **Difícil**: considera fuerza de la mano, posición, odds del bote, número de rivales y tamaño de las fichas; varía tamaños de apuesta y farolea de forma equilibrada.

### Reglas para los bots

- Viven en el servidor, en `server/bots.js`, separados del motor. Reciben exactamente la misma vista filtrada que un humano (`viewFor`): **nunca ven el mazo ni las cartas de los demás**. Esto debe tener una prueba.
- Calculan la fuerza de su mano con el evaluador existente. Para postflop, estimar equidad con simulación Monte Carlo (unas 300 a 1,000 repeticiones, ajustado por dificultad) usando solo la información visible.
- Tienen un pequeño componente aleatorio para no ser predecibles.
- Esperan entre 1 y 3 segundos antes de actuar, para que se sienta natural y se vean las animaciones.
- Siempre envían jugadas legales a través del mismo `act()` del motor que usan los humanos.
- Cada bot es uno de los personajes del cuarto de juego, con nombre inventado y gracioso en español (por ejemplo "Don Chepe", "La Güera", "El Profe") y un ícono de bot discreto junto a su nombre, para que siempre quede claro quién es bot. Su personalidad de juego puede ir con su personaje (el cabezón de cables es calculador, el del casco es impulsivo).
- Si se quedan sin fichas, usan su única recompra casi siempre; si no, quedan eliminados.
- En práctica en solitario, si el humano se queda sin fichas, ofrecer "Recomprar" (si le queda) o quedar fuera y ver cómo termina; al final, "Volver al inicio" para una nueva partida.

## Reglas de implementación

- `engine.js` debe ser puro: recibe estado y acción, modifica o devuelve estado, lanza errores con mensajes en español. Nada de sockets ahí dentro.
- El servidor emite a cada socket su propia vista con una función `viewFor(state, playerId)` que borra `deck` y las cartas ajenas.
- Validar todo en el servidor: turno, montos enteros, mínimo de subida, que no apueste más de lo que tiene.
- Barajar con `crypto.randomInt` en el servidor.
- Escapar o usar `textContent` para apodos, nunca `innerHTML` con texto de usuarios.
- Mantener el diseño accesible: foco visible, botones de al menos 44px de alto, `prefers-reduced-motion`.

## Estilo visual: primera persona en un cuarto de juego de animación 2D

La experiencia es en **primera persona**: la cámara son los ojos del jugador sentado en su silla. Frente a él ve la mesa grande, sus dos cartas abajo a la izquierda, su pila de fichas a la derecha, el bote cerca de él y, alrededor de la mesa, a los rivales enmarcados por el cuarto.

**Todo debe parecer un cuadro dibujado a mano de un capítulo de una serie animada de televisión para adultos de ciencia ficción, no un videojuego.** Todo es **original**: no usar personajes, objetos, lugares, logos, frases ni diseños reconocibles de ninguna serie o franquicia existente. Si algo se parece demasiado a algo conocido, cambiarlo. Lo absurdo está en los personajes y los objetos, no en luces de neón.

**Referencia oficial del dueño:** una ilustración de una mesa de póker en un garaje con seis rivales grandes alrededor y tu mano sosteniendo tus cartas abajo a la izquierda. `referencia/composicion.png` (fuera de git: tiene textos y diseños de una serie existente) es la referencia de **composición, cámara y acomodo**; de ella no se copia ningún texto, marca ni diseño. Manda el *tipo de dibujo* de esa imagen: personajes ilustrados con luz de borde, sombras y detalles (arrugas, ojeras, manchas), brazos y manos sobre la mesa sosteniendo cartas, cámara algo alta viendo la mesa desde arriba, luz cálida de la lámpara que se apaga suave hacia las orillas, esquinas oscuras y colores vivos de personaje (blob azul cielo, pulpo morado, alien verde). Esto sustituye las reglas anteriores de "paleta apagada" y "sin degradados" para personajes y luz; lo prohibido sigue siendo el neón chillón en la interfaz y cualquier elemento de series existentes.

Lo que NO queremos (así se veía la versión anterior y se descartó): colores neón saturados, materiales brillantes, casi sin contornos, un casino gigante y vacío, personajes hechos de bloques.

### Técnica: escena 2D por capas, como una animación de televisión

La mesa NO es 3D. Es una pila de capas 2D, de atrás hacia adelante (`client/stage/`):

1. **Fondo**: la ilustración del garaje (`fondo-garaje`) como imagen que cubre la pantalla, centrada en horizontal para que la lámpara quede al centro; en pantallas verticales se recortan los lados. La orilla de abajo del domo de la lámpara queda siempre arriba de la cabeza más alta de los rivales del fondo, con cualquier número de rivales: si no, el fondo se sube y, si hace falta, se agranda (`BACKDROP` en `config.js`). Un viñeteado CSS oscurece las esquinas.
2. **Mesa** (`table.js`, canvas, se redibuja solo al cambiar el tamaño): provisional, dibujada a partir de la orilla de `config.js` (`TABLE_EDGE`). Octágono más ancho que profundo en perspectiva, riel de madera café oscuro con vetas y juntas, canto visible en los lados que dan hacia mí, fieltro verde apagado con un octágono central un poco más oscuro y una línea dorada delgada en forma de pista, una sola sombra plana (la del riel sobre el fieltro y la de la mesa sobre el piso), mugre (baldosa de motas, manchas y rayones hecha una vez, más aros de vaso) y el charco de luz cálida de la lámpara: un brillo suave en el centro del fieltro y las orillas más oscuras, en la capa de la mesa (debajo de cartas y fichas, para no cambiar sus colores). Sin objetos decorativos por ahora. Después la mesa será una ilustración dibujada con la misma cámara: se calca su orilla, se pasa a coordenadas de la mesa con `view.unproject()` y se pegan los puntos en `TABLE_EDGE`.
3. **Cartas, bote y fichas** (`items.js`, canvas, se redibuja con cada jugada): en perspectiva sobre el fieltro, con una sombra plana debajo y contorno de tinta. Las comunitarias en fila al centro de la mesa; el bote, un montón desordenado de fichas cerca de mí abajo al centro; la pila de cada rival frente a él y su apuesta un poco más hacia el centro; mis dos cartas abajo a la izquierda (ahí irá la ilustración de mi mano) y mi pila a la derecha, justo arriba de la barra de acciones.
4. **Rivales** (`rivals.js`, canvas animado a 30 cuadros, 20 en calidad baja): recortes ilustrados en sus asientos, del tamaño que les toca por su distancia a la cámara. Cada uno se sienta con la cintura en la orilla de la mesa y se le recorta en la línea de esa orilla: se esconde lo que queda debajo de la línea de arriba de la silueta de la mesa (alargada más allá de las orillas de la pantalla) y debajo de su cintura, así la mesa lo tapa de la cintura para abajo y sus brazos y cartas quedan sobre la mesa. Lleva una sombra plana de contacto sobre el fieltro. Orden de dibujo: primero los del fondo (del más lejano al más cercano) y al final los de los lados.
5. **Etiquetas y montos** en HTML, y encima la interfaz.

Reglas:

- **Una sola perspectiva** (`projection.js`): todo (mesa, cartas, fichas, asientos, etiquetas, recorte de los rivales) usa la misma función que convierte un punto de la mesa a pantalla, y los datos de la escena (orilla, cámaras, asientos) viven en `config.js`. En horizontal la mesa es más ancha que la pantalla y se sale por los dos lados, la cabeza del rival más alto del fondo queda justo debajo de la franja de arriba y el lado cercano de la mesa se sale por abajo. En vertical la cámara ve más desde arriba y un poco más lejos, mi orilla se esconde detrás de la barra y los rivales se agrandan para llenar el espacio de arriba.
- **Línea de tinta `#1d1611` delgada y uniforme**, igual que la de las ilustraciones: su grueso se calcula con el tamaño al que se ve el fondo, así coincide a cualquier tamaño de pantalla.
- **Formas planas**: color base y una sola sombra plana; nada de brillos ni reflejos. La luz se pinta.
- Lo que se dibuja con código (mesa, fichas, cartas) imita el estilo de las ilustraciones; las ilustraciones nunca se re-dibujan con código.

### Archivos de arte

Originales en `arte/` (fuera de git, pesados). Versiones para el juego en `public/assets/arte/`, generadas con `scripts/optimizar-arte.py`:

| Archivo | Qué es |
|---|---|
| `fondo-garaje-3840.webp`, `fondo-garaje-1920.webp` | el cuarto, sin mesa ni personajes (se usa el chico si la pantalla no necesita más) |
| `blorp-espera.webp`, `blorp-espera-parpadeo.webp` | Madame Blorp sentada de frente, esperando, y su parpadeo |
| `blorp-espia.webp` | viendo sus cartas |
| `blorp-apuesta.webp`, `blorp-apuesta-parpadeo.webp` | con fichas en la mano, y su parpadeo |
| `*-chico.webp` | cada pose a la mitad, para calidad baja |
| `personajes.json` | tamaño final y caja de recorte de cada personaje (para revisar) |

**Receta para agregar un personaje** (todos los bots usan a Madame Blorp por ahora):

1. Generar sus poses sentado de frente sobre fondo gris liso, en el mismo cuadro: `<nombre>-espera`, `-espera-parpadeo`, `-espia`, `-apuesta`, `-apuesta-parpadeo` (`.png` en `arte/`). Se pueden generar con `scripts/generar-personaje.py` a partir de una ilustración de referencia (ángulos `frente` y `lado`; API key de Gemini en `.env`; ver el uso al inicio del script).
2. Quitar el fondo: `.venv-rembg/bin/python scripts/recortar.py arte/<nombre>-*.png`.
3. Optimizar: `.venv-rembg/bin/python scripts/optimizar-arte.py`. Escala todas las poses al mismo lienzo, las recorta con una sola caja común (para que al cambiar de pose nada brinque) y las exporta en WebP.
4. Agregar su entrada en `CHARACTERS` de `client/stage/characters.js`, con un bloque por ángulo (`frente` para los del fondo; `lado`, tres cuartos viendo a la derecha, para los de los lados): tamaño, punto de la cintura (debajo de la mano más baja con cartas o fichas: ahí lo tapa la mesa), caja de la cabeza (que nadie tapa) y alto en unidades de mesa. Si un personaje no tiene `lado`, se usa `frente`. El rival de la derecha se dibuja en espejo.
5. Asignarlo en `characterFor(jugador)`.

### Asientos

Mi lugar es el lado cercano del octágono. Hasta 6 rivales, acomodados como en la composición de referencia (`LAYOUTS` en `config.js`):

- **Fondo**: hasta 4 en fila detrás del borde lejano, de frente. En horizontal se reparten a lo ancho (los de las puntas sobre las diagonales lejanas) para que el espacio entre todos los rivales se vea parejo; en vertical van más juntos (`portrait` en `config.js`).
- **Lados**: uno a la izquierda y otro a la derecha, más cerca de la cámara y más grandes, cortados por la orilla de la pantalla (en horizontal se les ve casi toda la cara) y girados hacia el centro (imagen `lado`; el de la derecha en espejo).

El orden visual respeta el orden real de juego: el primero es el que habla después de mí (a mi izquierda) y sigue el reloj por el fondo hasta el de mi derecha. Con menos rivales se llena primero el fondo desde el centro (1 al centro, 2, 3 y 4 en fila) y luego los dos lados a la vez (5: 3 al fondo y los dos lados; 6: 4 al fondo y los dos lados), para que nunca quede un lado vacío y el otro lleno. Los lugares no cambian durante el torneo aunque alguien quede eliminado. Sin asiento y antes de empezar, los 6 lugares quedan fijos con su botón "Sentarme aquí".

Los de los lados pueden tapar un poco los hombros de los del fondo, nunca la cara: si la tapan, el del fondo se recorre hacia el centro sobre la orilla, y si aun así alguno le tapa la cara a otro (pantallas angostas), se achican todos un poco. Las etiquetas de nombre van compactas encima de cada rival; si chocan, se recorren de lado o suben, sin taparle la cara a nadie.

### Paleta (apagada y terrosa)

| Elemento | Color |
|---|---|
| Tinta (contornos y texto dibujado) | `#1d1611` |
| Paredes | tablas de madera `#75614c` / `#6d5946` |
| Tablero de herramientas | `#b39a6e`; repisa metálica `#7d8a86` |
| Piso | concreto `#77705f` con manchas de aceite |
| Fieltro | verde apagado `#577a3d`, centro `#4b6b35` |
| Madera de la mesa | riel `#6e4026`, pared interior `#4f2c18`, canto `#41241a` |
| Lámpara | domo mostaza `#c9a03a` |
| Papel (cartas, paneles) | crema `#efe4c8` |

**Prohibido:** rosa neón, morado chillón, verde limón brillante, fondos saturados.

### Dirección de arte

- **Escenario**: un garaje-taller chico, sucio y acogedor, no un casino. Es la ilustración `fondo-garaje`: tablero perforado con herramientas, bobinas que echan chispas, osciloscopio, repisa con frascos raros, lavadora vieja con un frasco que brilla, cables por el piso y la lámpara mostaza colgando al centro. Nada de elementos de series existentes. Ideas para después: humo de algún rival, un mesero que pasa al fondo, botella y cenicero sobre la mesa.
- **Mesa**: octagonal, muy grande (ocupa casi toda la pantalla y se sale por los lados), de madera, para máximo 7 jugadores. Fieltro verde apagado con un octágono central más oscuro y una línea dorada en forma de pista, riel de madera café oscuro (ver "Técnica"). Objetos decorativos (vasos, mazo, dados, cenicero) para después, sin estorbar a las cartas ni al bote.
- **Lámpara**: colgante de domo mostaza justo encima de la mesa, con un cono de luz cálida que pinta un círculo en la mesa y un resplandor rojizo en la pared.
- **Fichas** con colores desaturados por denominación: **crema 10, oliva 25, ladrillo 50, negra 100, marino 500, mostaza 1,000**, con franjas en el canto y el valor impreso en la ficha de arriba de cada columna (10, 25, 50, 100, 500, 1K), de cara al jugador. Cada jugador recibe 32 fichas = 5,000: 2 de 1,000, 3 de 500, 10 de 100, 6 de 50, 6 de 25 y 5 de 10 (`client/chips.js`, que también calcula con qué fichas se forma cualquier monto). Como con fichas de 10 y 25 se forma cualquier múltiplo de 5 desde 20, las apuestas van en múltiplos de 5 (salvo el all-in) y los botes divididos se reparten en unidades de 5.
- **Cartas**: tarjetas de esquinas redondas dibujadas en canvas (`client/stage/cards.js`) y puestas en perspectiva sobre la mesa, papel crema, números grandes en Chewy con contorno de tinta y palos dibujados a mano y panzones (`client/ui/suits.js`, los mismos en la mesa y en la interfaz), en tinta y rojo ladrillo. Las figuras J, Q, K son criaturas inventadas con ojos de párpado caído. El reverso es azul marino con el logo de Poker for the Players en mostaza.
- **Rivales**: ilustraciones recortadas (ver "Archivos de arte"), sentados de frente en sillas plegables, con sus cartas en la mano. Mismo estilo para todos: formas simples, ojos grandes con párpados caídos, expresiones secas, aburridas o sospechosas, mezcla de criaturas alienígenas y equipo improvisado. Cada uno con una silueta distinta y reconocible. Los humanos en la mesa usan uno de estos personajes como avatar, con su apodo encima.
- **Animación de los rivales** (cambio de pose, como en una serie animada):
  - **espera** por omisión, con parpadeo cada 3 a 6 s al azar (150 ms con la imagen de parpadeo);
  - **espia** justo después de que le reparten (escalonado, como si fueran repartiendo) y de vez en cuando mientras espera;
  - **apuesta** unos 2 s cuando iguala, apuesta o sube (no con ciegas, pasar ni retirarse), y luego regresa a espera;
  - respiración muy sutil (escala vertical de 1 a 1.5 % desde la cintura), a un ritmo distinto para cada uno;
  - si se retira o está ausente, se ve apagado (desaturado y oscuro) y un poco transparente;
  - aro mostaza en el fieltro alrededor de la pila de quien está pensando, centrado frente a él; las fichas y las cartas comunitarias quedan encima. (En el celular sigue a un lado de la pila, entre ella y la orilla.)
- **Manos del jugador**: por ahora mis dos cartas van boca arriba sobre la mesa, abajo a la izquierda (en el celular vertical van fuera de la mesa: ver "Celular"). Después: ilustraciones de mis manos sosteniendo las cartas (el jugador podrá elegir color de piel o mano alienígena).

### Cámara

- Fija en el asiento del jugador, sin girar, cerca de mi orilla y viendo la mesa en ángulo desde arriba como en la composición de referencia: la mitad lejana de la mesa se ve comprimida y la cercana amplia (`CAMERAS` en `config.js`). No se puede arrastrar para mirar alrededor.
- Ideas para después (eran de la versión 3D): voltear levemente hacia quien habla, bajar la mirada al salir el flop.

### Animaciones de las jugadas propias

Cada botón dispara una animación en primera persona con las manos del jugador **antes** de que el resultado se vea en la mesa. La jugada se envía al servidor al presionar el botón; la animación es visual y dura de 0.6 a 1.2 segundos.

- **Pasar (check)**: dos golpecitos con los dedos sobre el fieltro.
- **Igualar (call)**: la mano toma de su pila la cantidad exacta y la desliza hacia adelante.
- **Apostar o subir**: la mano toma las fichas y las lanza o las pone con estilo frente a sí; con montos grandes, usa las dos manos.
- **All-in**: las dos manos empujan toda la pila hacia el centro, con un pequeño temblor de cámara y efecto de sonido dramático.
- **Retirarse (fold)**: la mano avienta las cartas boca abajo hacia el centro, con algo de desgano.
- **Ganar el bote**: las dos manos jalan las fichas del centro hacia su lugar y las apilan.
- **Ver tus cartas**: al repartir, la mano levanta las esquinas de las cartas para "espiarlas", y luego las deja sobre la mesa.

Estas animaciones de las manos propias llegarán con las ilustraciones de las manos; por ahora la jugada se ve en la mesa (fichas, montos, sello en la etiqueta).

### Animaciones mientras esperas o piensas

Mientras no es el turno del jugador, cada pocos segundos se reproduce al azar una animación en reposo, sin repetir la misma dos veces seguidas:

- Barajar fichas entre los dedos (el truco de intercalar dos pilas)
- Hacer girar una ficha sobre los nudillos
- Apilar y desapilar fichas
- Tamborilear los dedos sobre la mesa
- Volver a espiar las esquinas de sus cartas
- Poner una ficha encima de sus cartas como protector
- Tomar un trago de un vaso con un líquido de color raro que burbujea
- Voltear a ver al mesero cuando pasa al fondo
- Rascarse la cabeza o estirar los dedos

Cuando **sí es su turno**, las animaciones cambian a "pensando": tamborileo más rápido, mirar el bote, mirar sus cartas, sopesar una pila de fichas en la mano. El jugador nunca pierde control: si presiona un botón, la animación en reposo se corta suavemente y empieza la de la jugada.

Los rivales tienen sus propias animaciones de pose (ver "Animación de los rivales").

### Interfaz encima de la escena

- Paneles color papel crema desteñido (`#efe4c8`), línea delgada color tinta como trazo a mano y sombras planas mínimas. Nada de botones neón: los colores de acento salen de la paleta (mostaza, ladrillo, oliva, marino).
- Tipografía: **Chewy** (Google Fonts, redonda y gordita de caricatura) para títulos, números, nombres y botones; **Patrick Hand** para textos descriptivos. No usar la letra de ninguna serie existente: su rotulado es parte de su logo.
- Formas redondas, nada geométrico: botones de píldora, paneles con esquinas grandes y desiguales, contornos de tinta de 2.5–3 px, sombras planas, letras del logo un poco chuecas. La pantalla de inicio va sobre el tapiz del cuarto con el charco de luz de la lámpara.
- Barra de acciones abajo con botones grandes de al menos 44px: Retirarse, Pasar o Igualar, Apostar o Subir con slider y atajos (½ bote, bote, todo).
- Una sola franja discreta arriba con bote, cuánto te toca igualar, tus fichas, ciegas (y cuándo suben) y la ronda (Antes del flop, Flop, Turn, River). En la misma franja, **"Tu mano"** con el nombre de tu mejor jugada (`client/ui/hand.js`); las cartas de la mesa ya se ven en la mesa.
- **Que siempre se entienda qué pasa:**
  - Cada rival muestra en su etiqueta su última jugada como sello de color: Pasa, Iguala 50, Sube a 200, All-in, Se retira, Ciega. Si es su turno, "Pensando…" con su tiempo. El sello salta cuando la jugada es nueva. El servidor lo manda en `player.lastAction`.
  - Un historial en vivo (abajo a la izquierda, junto a la barra de acciones, donde no tapa fichas, cartas ni caras) cuenta las últimas 3 jugadas en palabras, incluido "Sale el flop: 4♥ 2♥ 4♠". En pantallas de menos de 1200 px de ancho no cabe ahí y solo se ve la última jugada, dentro de la barra.
  - Cada apuesta sobre la mesa y el bote llevan su monto escrito encima, para no tener que contar fichas. El valor de cada color de ficha está en el panel "Posiciones".
  - Las cartas comunitarias van grandes e inclinadas hacia el jugador.
  - Cuando es tu turno, la barra se marca en mostaza y el aviso dice qué opciones tienes ("¡Te toca! Para seguir tienes que igualar 50").
- Botón para silenciar y botón de calidad gráfica (alta, media, baja).
- Retirarse cuando se puede pasar gratis pide confirmación ("Puedes pasar gratis, ¿seguro que te retiras?").

### Celular

"Celular" es una pantalla táctil de 640 px de ancho o menos (`client/ui/phone.js`, la misma regla en `style.css`); una ventana angosta en la computadora no cuenta. En la computadora todo se queda como arriba.

- **El juego es vertical.** Con el celular acostado (táctil, de 500 px de alto o menos y al menos 4:3 de ancho; no se usa la orientación porque en Android el teclado abierto deja la pantalla vertical "acostada") un aviso tapa todo y pide girarlo.
- La regla principal: cuando es mi turno siguen viéndose la mesa, el flop y mis cartas. De arriba hacia abajo:
  1. **Franja de una línea**: Bote, Para igualar y Tus fichas, y el menú ≡ con todo lo demás (código de mesa, ciegas y cuándo suben, ronda, mano, opciones, posiciones, valor de las fichas, últimas jugadas y Salir de la mesa).
  2. **La mesa** con los rivales y las comunitarias (más grandes que en la computadora).
  3. **Mis dos cartas grandes y derechas**, entre la mesa y el panel (`.mycards`; las dibuja la escena en esa caja, es la excepción a "una sola perspectiva"). Junto a ellas, "Tu mano" y un solo aviso de una línea (la última jugada o un error) que se borra a los 4.5 s.
  4. **Panel de acciones**, nunca más de un cuarto de la pantalla: "¡Te toca!…" y una fila con Retirarse, Pasar o Igualar, y Subir (Apostar si nadie ha apostado). Subir cambia esa fila por ½ bote, Bote, Todo, ✕ y abajo − slider + y el botón que confirma; − y + mueven una ciega grande.
- La escena mide `.mycards` para acomodar la mesa arriba (mi orilla queda detrás de mis cartas), así la mesa no brinca al abrir Subir.
- Sin el aviso "Turno de…": lo dicen el aro y el "Pensando…" de la etiqueta, y mi turno, el panel en mostaza.
- Etiquetas de los rivales: si no caben justo encima de su rival, todas pasan a la versión compacta (nombre arriba, fichas y jugada abajo) y cada una busca el lugar libre más cercano arriba o abajo de la cara. Nunca tapan caras (en ninguna pantalla).
- **Agregar a pantalla de inicio** (`manifest.json`, `apple-touch-icon` y etiquetas `apple-mobile-web-app-*`): se abre como app sin la barra de Safari, con la barra de estado translúcida (todo respeta las orillas seguras). En iPhone la app guarda sus datos aparte de Safari: la primera vez pide de nuevo el código de acceso y el apodo.

### Sonido

Efectos de caricatura: cartas, fichas cayendo y deslizándose, golpecitos en la mesa, burbujas del vaso, zumbido de la lámpara, pasos y vasos del mesero, y un aviso cuando es tu turno. Música de fondo opcional tipo lounge espacial, apagada por defecto. Todo con licencia libre o generado con Web Audio. El sonido empieza solo después de la primera interacción del usuario.

### Rendimiento y accesibilidad

- Debe correr fluido en celulares de gama media y en una MacBook Pro Intel de 2018 con 8 GB. La escena no usa WebGL: la mesa se dibuja una vez por tamaño, las fichas y cartas una vez por jugada, y solo la capa de los rivales se anima (30 cuadros por segundo; cada pose se reduce una sola vez al tamaño en que se ve).
- Las ilustraciones se precargan y decodifican antes de mostrar la mesa ("Abriendo el garaje…"). Si no cargan, queda la vista 2D simple.
- Calidad (Auto, Alta, Media, Baja): resolución del canvas (hasta 2x, 1.5x o 1x). En baja, poses chicas, fondo chico y 20 cuadros por segundo. En automático se usa baja solo en equipos con muy pocos núcleos o poca memoria.
- Pausar la animación cuando la pestaña no está visible.
- Con `prefers-reduced-motion`: sin respiración ni pulso del aro de turno.
- La vista 2D simple (botón "2D") sigue disponible como respaldo para quien la prefiera.

## Pruebas

`test/engine.test.js` con `node --test`: simular al menos 3,000 partidas aleatorias de 2 a 7 jugadores y verificar que las fichas totales nunca cambian y que ninguna mano se queda atorada. Incluir bots en esas simulaciones (mesas solo de bots en las 3 dificultades) y verificar que nunca hagan jugadas ilegales ni reciban cartas ajenas. Probar el evaluador con casos conocidos (escalera real, escalera baja A-2-3-4-5, full contra color, empates).

## Comandos esperados

```
npm install
npm run dev     # servidor + Vite (como middleware) en http://localhost:3000
npm test
npm run build   # empaqueta el cliente en dist/
npm start       # producción: sirve dist/ (corre antes npm run build)
```

`npm run dev` levanta el servidor y Vite juntos en el mismo puerto. Para probar multijugador en local, abrir varias pestañas o ventanas de incógnito. Para probar desde el celular en la misma red WiFi, usar la IP local de la Mac (por ejemplo `http://192.168.1.50:3000`).

## Fuera de alcance por ahora

- Dinero real, pagos o cualquier tipo de apuesta con valor monetario
- Cuentas de usuario y contraseñas
- Varias mesas en un mismo torneo, premios o antes (ante)

## Publicación con dominio propio (cuando funcione en local)

- Publicar en Render o Railway (ambos soportan WebSockets) y conectar el dominio propio del proyecto.
- HTTPS obligatorio (ambos servicios lo dan gratis con el dominio conectado).
- Configurar `ACCESS_CODE` y `PORT` como variables de entorno en el servicio, nunca dentro del código.
- Agregar un `README.md` con los pasos de despliegue y de conexión del dominio (registros DNS), explicados para alguien que lo hace por primera vez.
- Ojo con planes gratuitos que "duermen" el servidor: si el servidor se reinicia, las mesas en memoria se pierden. Para un grupo de amigos es aceptable, pero la pantalla debe avisar claramente si la mesa ya no existe y ofrecer crear otra.
