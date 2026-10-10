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
      projection.js   # cámara: convierte puntos de la mesa a pantalla; asientos y ajuste a la pantalla
      table.js        # la mesa dibujada en canvas
      items.js        # fichas, cartas y botón del dealer en perspectiva
      cards.js        # caras y reversos de las cartas (canvas)
      rivals.js       # poses, parpadeo, respiración de los rivales
      characters.js   # registro de personajes y precarga del arte
    ui/             # palos dibujados, nombre de la mano
    audio/
  public/
    assets/         # logo, sonidos, íconos, imagen para compartir
      arte/         # ilustraciones optimizadas (WebP), generadas con scripts/optimizar-arte.py
    manifest.json
    robots.txt
  test/
    engine.test.js  # simulación de manos aleatorias
  referencia/
    poker-referencia.html
  scripts/
    recortar.py       # quita el fondo gris de las poses (arte/ -> arte/recortes/)
    optimizar-arte.py # arte/ -> public/assets/arte/*.webp, con las poses alineadas
  arte/               # originales pesados, fuera de git (se quedan en la Mac)
```

## Requisitos funcionales

1. **Mesas con código**: pantalla inicial con "Crear mesa" (genera un código de 5 letras) y "Unirme" (escribir código). El link `/?mesa=ABCDE` entra directo.
2. **Apodo**: el jugador escribe su apodo antes de sentarse. Se guarda en `localStorage` para la próxima vez.
3. **Asientos**: hasta 6 (`MAXP` en `server/engine.js`; la mesa redonda chica está pensada para 6). Click en un asiento libre para sentarse antes de que empiece el torneo.
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

1. **Práctica en solitario**: desde "Jugar contra la compu", el jugador elige cuántos rivales (1 a 5) y la dificultad, y empieza de inmediato. Es una mesa privada que nadie más puede ver ni unirse.
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

La experiencia es en **primera persona**: la cámara son los ojos del jugador sentado en su silla. Frente a él ve el borde de la mesa, sus dos cartas sobre el fieltro, su pila de fichas al alcance de la mano y, al otro lado de la mesa chica, a los rivales enmarcados por el cuarto.

**Todo debe parecer un cuadro dibujado a mano de un capítulo de una serie animada de televisión para adultos de ciencia ficción, no un videojuego.** Todo es **original**: no usar personajes, objetos, lugares, logos, frases ni diseños reconocibles de ninguna serie o franquicia existente. Si algo se parece demasiado a algo conocido, cambiarlo. Lo absurdo está en los personajes y los objetos, no en luces de neón.

**Referencia oficial del dueño:** una ilustración de una mesa de póker en un garaje con seis rivales grandes alrededor y tu mano sosteniendo tus cartas abajo a la izquierda. Manda el *tipo de dibujo* de esa imagen: personajes ilustrados con luz de borde, sombras y detalles (arrugas, ojeras, manchas), brazos y manos sobre la mesa sosteniendo cartas, cámara algo alta viendo la mesa desde arriba, luz cálida de la lámpara que se apaga suave hacia las orillas, esquinas oscuras y colores vivos de personaje (blob azul cielo, pulpo morado, alien verde). Esto sustituye las reglas anteriores de "paleta apagada" y "sin degradados" para personajes y luz; lo prohibido sigue siendo el neón chillón en la interfaz y cualquier elemento de series existentes.

Lo que NO queremos (así se veía la versión anterior y se descartó): colores neón saturados, materiales brillantes, casi sin contornos, un casino gigante y vacío, personajes hechos de bloques.

### Técnica: escena 2D por capas, como una animación de televisión

La mesa NO es 3D. Es una pila de capas 2D, de atrás hacia adelante (`client/stage/`):

1. **Fondo**: la ilustración del garaje (`fondo-garaje`) como imagen que cubre la pantalla, centrada en horizontal para que la lámpara quede al centro; en pantallas verticales se recortan los lados. Un viñeteado CSS oscurece las esquinas.
2. **Mesa** (`table.js`, canvas, se redibuja solo al cambiar el tamaño): octágono en perspectiva visto desde mi asiento, riel de madera café oscuro con vetas y juntas, canto visible en los lados que dan hacia mí, fieltro verde apagado con un octágono central un poco más oscuro, una sola sombra plana (la del riel sobre el fieltro y la de la mesa sobre el piso), mugre (baldosa de motas, manchas y rayones hecha una vez, más aros de vaso) y el charco de luz cálida de la lámpara en el centro, con las orillas más oscuras.
3. **Cartas, bote y fichas** (`items.js`, canvas, se redibuja con cada jugada): en perspectiva sobre el fieltro, con una sombra plana debajo y contorno de tinta. Las comunitarias van grandes e inclinadas hacia el jugador; mis dos cartas boca arriba frente a mí, justo arriba de la barra de acciones, y mi pila a la derecha.
4. **Rivales** (`rivals.js`, canvas animado a 30 cuadros, 20 en calidad baja): recortes ilustrados en sus asientos, más chicos mientras más lejos. La mesa los tapa de la cintura para abajo: a cada rival se le recorta la parte de la mesa que queda debajo de su cintura (la mesa que está delante de él), con una sombra plana de contacto sobre el fieltro. Se dibujan después de la mesa (no antes) para que la parte lejana del fieltro no tape el pecho de los de los lados.
5. **Etiquetas y montos** en HTML, y encima la interfaz.

Reglas:

- **Una sola perspectiva** (`projection.js`): todo (mesa, cartas, fichas, asientos, etiquetas) usa la misma función que convierte un punto de la mesa a pantalla. La escala se ajusta para que la mesa y los rivales quepan entre la franja de arriba y la barra de acciones; el borde cercano de la mesa ocupa la parte de abajo. En vertical la cámara ve más desde arriba, la mesa ocupa casi todo el ancho y los personajes se agrandan para llenar el espacio de arriba.
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

1. Generar sus poses sentado de frente sobre fondo gris liso, en el mismo cuadro: `<nombre>-espera`, `-espera-parpadeo`, `-espia`, `-apuesta`, `-apuesta-parpadeo` (`.png` en `arte/`).
2. Quitar el fondo: `.venv-rembg/bin/python scripts/recortar.py arte/<nombre>-*.png`.
3. Optimizar: `.venv-rembg/bin/python scripts/optimizar-arte.py`. Escala todas las poses al mismo lienzo, las recorta con una sola caja común (para que al cambiar de pose nada brinque) y las exporta en WebP.
4. Agregar su entrada en `CHARACTERS` de `client/stage/characters.js`: tamaño, punto de la cintura (debajo de la mano más baja con cartas o fichas: ahí lo tapa la mesa), ancho de lo de abajo (silla incluida) y alto en unidades de mesa.
5. Asignarlo en `characterFor(jugador)`.

### Asientos

Mi lugar es el lado cercano del octágono. Los 5 rivales se sientan en el lado izquierdo, la diagonal lejana izquierda, el lado lejano, la diagonal lejana derecha y el lado derecho (las dos diagonales cercanas quedan vacías). Con pocos rivales se reparten: 1 enfrente; 2 en las diagonales lejanas; 3 en diagonal, enfrente y diagonal; 4 en los lados y las diagonales. Los lugares no cambian durante el torneo aunque alguien quede eliminado. Sin asiento y antes de empezar, cada asiento queda en su lugar fijo con su botón "Sentarme aquí". En vertical los rivales de los lados quedan cortados por la orilla de la pantalla y los de enfrente se enciman un poco.

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
- **Mesa**: octagonal, pequeña, de madera, para máximo 6 jugadores. Fieltro verde apagado con un octágono central más oscuro, riel de madera café oscuro (ver "Técnica").
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
  - aro mostaza en el fieltro frente a quien está pensando.
- **Manos del jugador**: por ahora mis dos cartas van boca arriba sobre la mesa frente a mí. Después: ilustraciones de mis manos sosteniendo las cartas (el jugador podrá elegir color de piel o mano alienígena).

### Cámara

- Fija en el asiento del jugador, algo alta, viendo la mesa desde arriba como en una toma de la serie (`projection.js`). No se puede arrastrar para mirar alrededor.
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
- Una sola franja discreta arriba con bote, cuánto te toca igualar, tus fichas, ciegas (y cuándo suben) y la ronda (Antes del flop, Flop, Turn, River). En la misma franja, las cartas de la mesa en chico y **"Tu mano"** con el nombre de tu mejor jugada (`client/ui/hand.js`).
- **Que siempre se entienda qué pasa:**
  - Cada rival muestra en su etiqueta su última jugada como sello de color: Pasa, Iguala 50, Sube a 200, All-in, Se retira, Ciega. Si es su turno, "Pensando…" con su tiempo. El sello salta cuando la jugada es nueva. El servidor lo manda en `player.lastAction`.
  - Un historial en vivo (abajo a la izquierda) cuenta las últimas jugadas en palabras, incluido "Sale el flop: 4♥ 2♥ 4♠".
  - Cada apuesta sobre la mesa y el bote llevan su monto escrito encima, para no tener que contar fichas. El valor de cada color de ficha está en el panel "Posiciones".
  - Las cartas comunitarias van grandes e inclinadas hacia el jugador.
  - Cuando es tu turno, la barra se marca en mostaza y el aviso dice qué opciones tienes ("¡Te toca! Para seguir tienes que igualar 50").
- Botón para silenciar y botón de calidad gráfica (alta, media, baja).

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

`test/engine.test.js` con `node --test`: simular al menos 3,000 partidas aleatorias de 2 a 6 jugadores y verificar que las fichas totales nunca cambian y que ninguna mano se queda atorada. Incluir bots en esas simulaciones (mesas solo de bots en las 3 dificultades) y verificar que nunca hagan jugadas ilegales ni reciban cartas ajenas. Probar el evaluador con casos conocidos (escalera real, escalera baja A-2-3-4-5, full contra color, empates).

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
