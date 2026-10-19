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
    bots.js         # decisiones de los bots por dificultad, y su personaje y nombre (lee personajes.json)
  client/
    index.html
    main.js         # arranque, conexión con Socket.IO
    hoja-baraja.html # hoja de revisión de la baraja a los tamaños del juego (solo en desarrollo, /hoja-baraja.html)
    stage/          # mesa ilustrada por capas (ver "Estilo visual")
      index.js        # arma las capas, acomoda la vista del servidor, etiquetas y ciclo de animación
      config.js       # orilla de la mesa (lista de puntos), cámaras y acomodo de los rivales
      projection.js   # cámara: convierte puntos de la mesa a pantalla y al revés; ajuste a la pantalla
      table.js        # la capa de la mesa: la ilustración (con la luz de la lámpara y la sombra en el piso) o, de respaldo, la mesa de código
      mesa.json       # la mesa ilustrada: tamaños, su proyección (F, cx, cy), la cámara y la orilla con que se calcó, y su silueta (lo escribe el script)
      items.js        # fichas, cartas y botón del dealer en perspectiva
      cards.js        # la baraja: caras y reversos en canvas, con el arte de carta-*.webp (cargarArte) y respaldo de código
      baraja.json     # de la baraja: los nombres de las figuras y la zona libre del reverso para la etiqueta (lo escribe el script)
      rivals.js       # poses, parpadeo, respiración de los rivales
      characters.js   # personajes (lee personajes.json) y precarga del arte
      personajes.json # registro de personajes: tamaño y cuadros (los escribe el script); nombre de su bot, cintura, cabeza y alto (a mano); "retirado"
    ui/             # palos clásicos en dos colores (suits.js), nombre de la mano y cartas ganadoras (hand.js), regla de "celular" (phone.js)
    audio/
  public/
    assets/         # logo, sonidos, íconos, imagen para compartir
      arte/         # ilustraciones optimizadas (WebP), generadas con scripts/optimizar-arte.py
      iconos/       # ícono de la app (icono.svg -> PNG con scripts/generar-iconos.mjs) y favicon
    manifest.json
    robots.txt
  test/
    engine.test.js  # simulación de manos aleatorias
    resultado.test.js # final de la mano: lo que recibe cada quien y el botón Listo
    bots.test.js    # bots: jugadas legales, sin cartas ajenas, y un personaje distinto con su nombre
    personajes.test.js # personajes registrados, cuadros que faltan, poses, hacia dónde miran
    asientos.test.js # Don Tentáculos al centro del fondo (práctica y quien creó la mesa)
    baraja.test.js  # la baraja: palos de cada carta, dos colores, arte exportado y zona de la etiqueta
  docs/
    ESPEC-PERSONAJES.md # cómo debe venir el arte de cada personaje (ángulos, cuadros, encuadre, fondo, estilo)
  referencia/
    poker-referencia.html
  scripts/
    generar-personaje.py      # genera cuadros con Gemini editando la base aprobada, una zona por llamada, con revisiones automáticas (arte/generadas/<id>/); aprobar los pasa a arte/personajes/<id>/
    prompts-personaje.toml    # plantilla de edición y los cambios de cada cuadro, en inglés, editables
    fichas/<id>.toml          # ficha de cada personaje para los prompts: fondo, cómo parpadea, a dónde mira, sonrisa, manos, fichas, partes opacas
    ocr.swift                 # OCR de macOS para la revisión "sin texto" del generador (se compila solo en .venv-rembg/bin/)
    extraer-mesa.py           # saca la mesa de referencia/composicion.png: la sube a 4K, Gemini quita los objetos por zonas (con revisiones y tope de llamadas), limpia sin IA lo que quedó, recorta el garaje por la silueta de la mesa y arma la hoja para aprobar; aprobar la pasa a arte/mesa/
    generar-baraja.py         # el arte de la baraja con Gemini, una imagen por corrida con revisiones y tope de llamadas: el reverso (y `limpiar`, que deja solo su marco), las figuras (y `editar`, que las ornamenta conservando cara y pose), la mitad de cada figura en sus cuatro palos (`carta`) y los adornos del reverso para el marco de las figuras (`adornos`); `probar` revisa las revisiones (arte/generadas/baraja/; aprobar pasa a arte/baraja/)
    prompts-baraja.toml       # los prompts de la baraja, en inglés, editables
    calcar-mesa.py            # calca la mesa aprobada: la cámara de la computadora (pitch dado, dist) y la orilla del juego (TABLE_EDGE, RAIL_Y, APRON, FELT_R) que la reproducen, y su proyección (arte/mesa/mesa-horizontal.json)
    recortar.py       # quita un fondo GRIS con rembg (solo para arte viejo; el nuevo viene en verde o magenta)
    optimizar-arte.py # arte/ -> public/assets/arte/*.webp (chroma key verde o magenta, cuadros alineados), GIF de revisión y registro; `mesa` exporta la mesa ilustrada y escribe client/stage/mesa.json; `baraja` exporta el arte de la baraja (carta-*.webp) y escribe client/stage/baraja.json
    generar-iconos.mjs # PNG del ícono de la app (32, 180, 192, 512) a partir de icono.svg, con Chrome sin ventana
  arte/               # originales pesados, fuera de git (se quedan en la Mac)
    personajes/<id>/  # cuadros de cada personaje sobre verde o magenta: <id>-<ángulo>-<cuadro>.png
    generadas/<id>/   # lo que hizo generar-personaje.py, por revisar: cuadro, lo crudo de Gemini, GIF, comparación y registro.jsonl (costos); generadas/mesa/, lo de extraer-mesa.py (zonas/: cada paso y lo crudo de cada llamada; descartadas/: los intentos anteriores)
    baraja/           # el arte aprobado de la baraja: el reverso (solo el marco, y su carta con la zona libre para la etiqueta), los adornos y las figuras
    mesa/             # la mesa ilustrada aprobada (mesa-horizontal.png sobre magenta, su silueta, su calco .json) y la calibración de la referencia
    respaldos/        # los cuadros que se reemplazaron
    revision/         # GIF de revisión de cada personaje y ángulo (y los restos del fondo, si quedan); camaras/, las capturas con que se eligió la cámara; mesa-*, las hojas y capturas de la mesa ilustrada
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
6. **Final de la mano (showdown)**: frente a cada jugador que llegó al final se voltean sus cartas, una tras otra; las de quien se retiró nunca se muestran y, si todos se retiraron menos uno, el ganador no enseña las suyas. Luego se resaltan las 5 cartas de la mano ganadora (las de la mesa y las propias que usó; con empate, las de todos los que empatan; con botes secundarios, la mejor mano de la mesa) y se apagan las demás. Un panel explica el resultado (ver "Interfaz"). El servidor manda las cartas ajenas solo al llegar al final y nunca las de quien se retiró: `viewFor` y el resultado (`results` en `server/engine.js`: cada bote con quién lo ganó, devoluciones, las 5 cartas y el nombre de la mano de cada quien) solo traen las de quienes llegaron. Lo que alguien apostó y nadie pudo igualar se le regresa y no se anuncia como premio.
7. **Turno con tiempo**: 45 segundos. Al vencer, el servidor pasa o retira automáticamente (ya no depende de que otro jugador presione un botón).
8. **Reconexión**: si alguien recarga la página, recupera su asiento y sus cartas. Usar un `playerToken` aleatorio guardado en `localStorage`, nunca el id del socket.
9. **Siguiente mano**: el resultado se ve 8 segundos (`RESULT_MS`), o 4 si todos se retiraron (`RESULT_FOLD_MS`; los dos en `server/engine.js`), con cuenta regresiva y botón "Listo". En práctica, Listo reparte de inmediato. En mesas con amigos se reparte cuando tocan Listo todos los humanos que siguen en el torneo y no están ausentes, o al acabarse el tiempo: no se espera a bots, eliminados ni espectadores, y si alguien se desconectó decide el reloj (si no queda nadie que cuente, por ejemplo en práctica después de quedar fuera, basta el Listo de cualquiera sentado). El Listo lleva el número de mano, así uno tardío no cuenta para la siguiente. En la última mano del torneo primero se ve el resultado y después el aviso de campeón.
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
- Cada bot es uno de los personajes del cuarto de juego y lleva siempre el nombre de ese personaje (el `name` de `personajes.json`): alien = El Compadre Zorg, blob = Tío Glub, turista = La Güera, robot = La Chispa, nerd = El Profe, pulpo = Don Tentáculos. Al agregar bots, el servidor le da a cada uno un personaje distinto, al azar entre los que no usa ningún otro bot (con 6 rivales o menos nunca se repite); si se acabaran los personajes, usa los nombres de repuesto (`BOT_NAMES`). Los humanos siguen con su apodo y se dibujan con los personajes que no usa ningún bot (si ya no queda ninguno, se repite uno; uno nunca se ve a sí mismo; Don Tentáculos solo lo usa el humano que le queda al centro a quien creó la mesa: ver "Asientos"). Junto al nombre, un ícono de bot discreto, para que siempre quede claro quién es bot. Su personalidad de juego puede ir con su personaje (el cabezón de cables es calculador, el del casco es impulsivo). El servidor lee los nombres al arrancar: si cambias un nombre o retiras un personaje, reinicia `npm run dev`.
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

**Referencia oficial del dueño:** una ilustración de una mesa de póker en un garaje con seis rivales grandes alrededor y tu mano sosteniendo tus cartas abajo a la izquierda. `referencia/composicion.png` (fuera de git: tiene textos y diseños de una serie existente) es la referencia de **composición, cámara y acomodo**; de ella no se copia ningún texto, marca ni diseño. La única excepción, por decisión del dueño, es la mesa misma (una mesa de póker genérica: riel de madera, fieltro verde y pista dorada): la ilustración de la mesa del juego se sacó de esa imagen (`scripts/extraer-mesa.py`), sin personajes, objetos, letreros ni textos. De esa imagen manda el acomodo: brazos y manos sobre la mesa sosteniendo cartas, cámara algo alta viendo la mesa desde arriba, luz cálida de la lámpara que se apaga suave hacia las orillas y esquinas oscuras. El estilo de los personajes lo manda **`docs/ESPEC-PERSONAJES.md`**: línea delgada negro-café uniforme, colores limpios y planos con una sola sombra plana, sin texturas, luz de borde ni degradados, cuerpo completo sentado en su propia silla, todo original. Lo prohibido sigue siendo el neón chillón en la interfaz y cualquier elemento de series existentes.

Lo que NO queremos (así se veía la versión anterior y se descartó): colores neón saturados, materiales brillantes, casi sin contornos, un casino gigante y vacío, personajes hechos de bloques.

### Técnica: escena 2D por capas, como una animación de televisión

La mesa NO es 3D. Es una pila de capas 2D, de atrás hacia adelante (`client/stage/`):

1. **Fondo**: la ilustración del garaje (`fondo-garaje`) como imagen que cubre la pantalla, centrada en horizontal para que la lámpara quede al centro; en pantallas verticales se recortan los lados. La orilla de abajo del domo de la lámpara queda siempre arriba de la cabeza más alta de los rivales del fondo, con cualquier número de rivales: si no, el fondo se sube y, si hace falta, se agranda (`BACKDROP` en `config.js`). Un viñeteado CSS oscurece las esquinas.
2. **Mesa** (`table.js`, canvas, se redibuja solo al cambiar el tamaño). En horizontal es la **ilustración** de la mesa (`mesa-*.webp`): la de la referencia, con su riel de madera acolchado, el canto de los lados, el fieltro con su sombreado y la pista dorada, sin el frente (la referencia lo corta: de mi riel se ve la banda que sale por abajo de la pantalla). Se pone con su propia proyección (`mesa.json`: a la escala `view.F / F`, anclada en `cx, cy`), así cae exactamente en la perspectiva del juego. Encima, el brillo cálido de la lámpara sobre el fieltro y las orillas un poco más oscuras (menos que en la de código: el dibujo ya trae su sombreado), recortados con la misma imagen; detrás, la sombra plana de la mesa en el piso. Si la imagen no carga, o en vertical (el celular, por ahora), se dibuja la **mesa de código** a partir de la orilla de `config.js` (`TABLE_EDGE`), con la misma forma: Octágono más ancho que profundo en perspectiva, riel de madera café oscuro con vetas y juntas (encima del fieltro: de mi lado lo tapa justo en su orilla de adentro), canto visible en los lados que dan hacia mí, fieltro verde apagado con un octágono central un poco más oscuro y una línea dorada delgada en forma de pista, una sola sombra plana (la del riel sobre el fieltro y la de la mesa sobre el piso), mugre (baldosa de motas, manchas y rayones hecha una vez, más aros de vaso) y el charco de luz cálida de la lámpara: un brillo suave en el centro del fieltro y las orillas más oscuras (de mi lado la sombra empieza más lejos, para que mi riel se vea como madera), en la capa de la mesa (debajo de cartas y fichas, para no cambiar sus colores). Sin objetos decorativos por ahora.
   La ilustración se hizo así (originales en `arte/`): `scripts/extraer-mesa.py` sube la referencia a 4K sin cambiarla, Gemini quita los objetos de cuatro zonas (una llamada por zona, con revisiones de alineación, de la pista y la orilla del fieltro contra la calibración, de restos y de texto, y tope de llamadas), quita sin IA las manos que quedaron sobre el riel del fondo copiando el mismo riel de un tramo limpio o del lado espejo, y recorta el garaje por la silueta de la mesa (el riel y el canto, sin patas). `scripts/calcar-mesa.py` saca de la mesa aprobada la cámara y la orilla del juego, y `scripts/optimizar-arte.py mesa` la exporta con su `mesa.json`.
3. **Cartas, bote y fichas** (`items.js`, canvas, se redibuja con cada jugada): en perspectiva sobre el fieltro, con una sombra plana debajo y contorno de tinta. Las comunitarias en fila al centro de la mesa; el bote, un montón desordenado de fichas cerca de mí abajo al centro; la pila de cada rival frente a él y su apuesta un poco más hacia el centro, en un lugar fijo por asiento que nunca tapa las comunitarias (sus 5 lugares, aunque aún no salgan), el bote ni mis cartas, sin cruzarse con las de sus vecinos (`planBets` en `index.js`; mi apuesta sigue la misma regla); mis dos cartas abajo a la izquierda (ahí irá la ilustración de mi mano) y mi pila a la derecha, justo arriba de la barra de acciones.
4. **Rivales** (`rivals.js`, canvas animado a 30 cuadros, 20 en calidad baja): recortes ilustrados en sus asientos, del tamaño que les toca por su distancia a la cámara. Cada uno se sienta con la cintura en la orilla de la mesa y se le recorta en la línea de esa orilla: se esconde lo que queda debajo de la línea de arriba de la silueta de la mesa (alargada más allá de las orillas de la pantalla) y debajo de su cintura, así la mesa lo tapa de la cintura para abajo y sus brazos y cartas quedan sobre la mesa. Lleva una sombra plana de contacto sobre el fieltro. Orden de dibujo: primero los del fondo (del más lejano al más cercano) y al final los de los lados.
5. **Etiquetas y montos** en HTML, y encima la interfaz.

Reglas:

- **Una sola perspectiva** (`projection.js`): todo (mesa, cartas, fichas, asientos, etiquetas, recorte de los rivales) usa la misma función que convierte un punto de la mesa a pantalla, y los datos de la escena (orilla, cámaras, asientos) viven en `config.js`. La mesa ilustrada se dibujó con una cámara: la de la computadora es esa misma (`pitch`, `dist`) y la orilla del juego es la suya (`TABLE_EDGE`, `RAIL_Y`, `APRON`, `FELT_R`), calcadas del dibujo; a los rivales se les recorta en la orilla del propio dibujo (su silueta en `mesa.json`). En horizontal la cabeza del rival más alto del fondo queda justo debajo de la franja de arriba y la orilla de abajo del dibujo (donde se corta el frente) queda en la orilla de abajo de la pantalla o más abajo (`art` en `CAMERAS`): mi riel se ve pasando por abajo, a los lados y detrás de la barra. El tamaño de la mesa lo deciden las cabezas y el dibujo, y el ancho solo pone un mínimo (`width`): como en la referencia, la mesa ocupa casi todo el ancho (en 16:10 se sale un poco por los lados; en 16:9 los de los lados quedan junto a sus puntas). En vertical la cámara ve más desde arriba y un poco más lejos, mi orilla se esconde detrás de la barra y los rivales se agrandan para llenar el espacio de arriba.
- **Línea de tinta `#1d1611` delgada y uniforme**, igual que la de las ilustraciones: su grueso se calcula con el tamaño al que se ve el fondo, así coincide a cualquier tamaño de pantalla.
- **Formas planas**: color base y una sola sombra plana; nada de brillos ni reflejos. La luz se pinta. La excepción es la mesa ilustrada, que trae el sombreado suave del fieltro de la referencia (más claro al centro, más oscuro en las orillas).
- Lo que se dibuja con código (mesa, fichas, cartas) imita el estilo de las ilustraciones; las ilustraciones nunca se re-dibujan con código.

### Archivos de arte

Originales en `arte/` (fuera de git, pesados). Versiones para el juego en `public/assets/arte/`, generadas con `scripts/optimizar-arte.py`:

| Archivo | Qué es |
|---|---|
| `fondo-garaje-3840.webp`, `fondo-garaje-1920.webp` | el cuarto, sin mesa ni personajes (se usa el chico si la pantalla no necesita más) |
| `mesa-3537.webp`, `mesa-1768.webp` | la mesa ilustrada, recortada a la mesa (se usa la chica si la mesa no se ve más ancha, y en calidad baja) |
| `<id>-<ángulo>-<cuadro>.webp` | cada cuadro de cada personaje, por ejemplo `alien-frente-espera.webp` |
| `*-chico.webp` | cada cuadro a la mitad, para calidad baja |
| `carta-reverso.webp` | el marco del reverso de la baraja (sin la etiqueta: la pone el código) |
| `carta-<rey\|reina\|jota>-<palo>.webp` | la mitad de arriba de cada figura, con la túnica del color de su palo (`h`, `d`, `c`, `s`) |
| `carta-adorno-flor.webp`, `carta-adorno-banda.webp` | las volutas del reverso que adornan el marco de las figuras |

Una sola lista de cuadros en todo el proyecto: `espera`, `parpadeo`, `espia`, `apuesta`, `retirarse`, `gana` (`POSES` en `characters.js`, `CUADROS` en `optimizar-arte.py`, `POSES` en `generar-personaje.py`). Por ahora **solo espera es obligatorio**: mientras falte otro cuadro, el personaje se queda en espera (no parpadea, no espía, no apuesta ni se retira con pose, no celebra) y el juego no falla; en cuanto se procesa y se registra el cuadro, se usa solo. Los de siempre son espera, parpadeo, apuesta y retirarse; espia y gana son extras. La especificación completa del arte está en `docs/ESPEC-PERSONAJES.md`.

**Personajes en uso**: alien, blob, nerd, pulpo, robot y turista (de cuerpo completo, por ahora solo con `frente-espera`). Madame Blorp está retirada: sigue en `personajes.json` con `"retirado": true` y sus archivos se quedan, pero el juego no la carga ni la usa.

**Receta para agregar un personaje**:

1. Poner su base `frente-espera` sobre verde o magenta (el color que no tenga el personaje) en `arte/personajes/<id>/<id>-frente-espera.png`, según `docs/ESPEC-PERSONAJES.md`; nunca se genera desde cero. Los demás cuadros se pueden generar después de los pasos 2 a 5 con `scripts/generar-personaje.py`, que edita esa base una zona a la vez (API key de Gemini en `.env`, ficha en `scripts/fichas/<id>.toml`; ver el uso al inicio del script); su comando `aprobar` los deja en `arte/personajes/<id>/`, y luego se vuelve a optimizar y registrar.
2. Optimizar: `.venv-rembg/bin/python scripts/optimizar-arte.py personajes <id>`. Toma el color del fondo de las esquinas de cada imagen (verde o magenta) y lo quita con chroma key, también en los huecos encerrados (entre brazos, silla y tentáculos); avisa si quedan píxeles teñidos del fondo y deja `arte/revision/<cuadro>-restos.png` con los restos en rojo. Si algo sobra abajo (como la tarima del pulpo), se corta con `CORTE_ABAJO`. Luego, por cada ángulo aparte, escala todos los cuadros al mismo lienzo, los recorta con una sola caja común (para que al cambiar de cuadro nada brinque), los reduce (frente a 1000 px de alto como máximo, porque la mitad de abajo queda bajo la mesa; lado a 1200) y los exporta en WebP.
3. Revisar: `.venv-rembg/bin/python scripts/optimizar-arte.py gif <id>` arma `arte/revision/<id>-<ángulo>.gif` alternando espera con cada cuadro, con la línea de la cintura y la caja de la cara.
4. Registrar: `.venv-rembg/bin/python scripts/optimizar-arte.py registrar <id> --nombre "..."` lo agrega a `client/stage/personajes.json` (tamaño y cuadros). El nombre es el del bot que usa ese personaje. Ya entra a la mesa: el servidor le da a cada bot un personaje distinto (reinicia `npm run dev` para que lo vea). Volver a registrar nunca sobrescribe el nombre ni las medidas.
5. Medir a mano en `personajes.json`, por ángulo (los números son fracciones de la imagen, de 0 a 1, contando desde arriba a la izquierda), y borrar la línea `pendiente`:
   - `waist: [x, y]`: el punto donde la mesa corta al personaje y que se pone en la orilla de la mesa. `y`, justo debajo de la mano más baja que sostiene cartas (más grande = más abajo = se ve más cuerpo; si queda arriba de las manos, la mesa tapa las cartas). `x`, el centro del cuerpo a esa altura.
   - `face: [izquierda, arriba, derecha, abajo]`: la caja de la cabeza; ninguna etiqueta la tapa y los rivales de los lados no se le encima.
   - `height`: el alto de toda la imagen en unidades de la mesa (más grande = personaje más grande). Lo que se ve es `height × y` de la cintura; con los seis actuales va de 0.36 a 0.43.
   - `mira`: hacia dónde ve la imagen, `izquierda`, `derecha` o `frente` (la cara y el cuerpo; varias bases quedaron un poco giradas). El juego la pone en espejo en los asientos del otro lado para que siempre vea hacia el centro de la mesa; una de `frente` nunca va en espejo. La de `lado` ve a la derecha.
   - Del personaje (no de un ángulo), `sillas`: 2 si ocupa dos sillas (Don Tentáculos); sin ella, 1.
   - Para verlo: guarda el archivo, recarga la página y abre una mesa con `?medidas` en la dirección (por ejemplo `http://localhost:3000/?medidas` y luego "Jugar contra la compu"). Sobre cada rival se dibujan el marco de su imagen, la caja de la cara (roja, punteada) y la línea de la cintura con su punto (mostaza). Cambiar las medidas no necesita reiniciar el servidor.
   - Si un personaje no tiene `lado`, se usa `frente`.
6. Para dejar de usar un personaje sin borrar nada, ponle `"retirado": true` en `personajes.json` (y reinicia el servidor). `optimizar-arte.py` sin nombres se lo salta, así sus WebP se quedan como están; para reprocesarlo hay que nombrarlo (`personajes blorp`).

### Asientos

Mi lugar es el lado cercano del octágono. Hasta 6 rivales, acomodados como en la composición de referencia (`LAYOUTS` en `config.js`):

- **Fondo**: hasta 4 en fila detrás del borde lejano, de frente. En horizontal se reparten a lo ancho (los de las puntas sobre las diagonales lejanas) para que el espacio entre todos los rivales se vea parejo; en vertical van más juntos (`portrait` en `config.js`).
- **Lados**: uno a la izquierda y otro a la derecha, más cerca de la cámara y más grandes, cortados por la orilla de la pantalla (en horizontal se les ve casi toda la cara) y girados hacia el centro (imagen `lado`).

Cada rival ve hacia el centro de la mesa: si su imagen ve hacia el otro lado (`mira` en `personajes.json`), se dibuja en espejo, en cualquier asiento; al centro y con imagen de frente, nunca.

**Don Tentáculos** ocupa dos sillas (`sillas: 2`) y necesita más espacio:

- En práctica, cuando sale entre los bots (los personajes siguen al azar), se sienta en el asiento que me queda al centro del fondo (con 2, 4 o 6 rivales, el de la izquierda de los dos de en medio).
- En mesas con amigos, cada quien ve la mesa girada desde su asiento, así que solo se puede para uno: quien creó la mesa. Antes de que empiece el torneo, cada vez que alguien se sienta o se levanta o cambian los bots, el servidor (`arrange()` en `server/room.js`) busca el asiento que le queda al centro a quien creó la mesa (con el mismo orden que la pantalla) y, si ahí hay otro bot, cambian de silla (cada uno conserva su nombre, su personaje y su dificultad). A los humanos nunca se les mueve: si ahí hay un humano, va al asiento de bot más cercano al centro. Ya empezado el torneo los asientos no cambian; si quien creó la mesa se va antes, el siguiente humano toma su lugar y se recalcula. Si ningún bot es Don Tentáculos, lo usa el humano que le queda más al centro a quien creó la mesa (los demás humanos, nunca).
- En cualquier asiento (para los demás jugadores puede quedar en una diagonal o en un lado), lo que se ve de él no se encima con lo que se ve de sus vecinos (`makeRoom` en `client/stage/index.js`): se recorre sobre la orilla hacia donde hay más espacio y sus vecinos del fondo se recorren hacia afuera (sin que el de un lado les tape la cara y sin que su cabeza suba más que la más alta); en un lado, se recorre hacia la orilla de la pantalla mientras se le vea la cara. Si ni así cabe, se achica solo él, hasta 85 %.

El orden visual respeta el orden real de juego: el primero es el que habla después de mí (a mi izquierda) y sigue el reloj por el fondo hasta el de mi derecha. Con menos rivales se llena primero el fondo desde el centro (1 al centro, 2, 3 y 4 en fila) y luego los dos lados a la vez (5: 3 al fondo y los dos lados; 6: 4 al fondo y los dos lados), para que nunca quede un lado vacío y el otro lleno. Los lugares no cambian durante el torneo aunque alguien quede eliminado. Sin asiento y antes de empezar, los 6 lugares quedan fijos con su botón "Sentarme aquí".

Los de los lados pueden tapar un poco los hombros de los del fondo, nunca la cara: si la tapan, el del fondo se recorre hacia el centro sobre la orilla, y si aun así alguno le tapa la cara a otro (pantallas angostas), se achican todos un poco. Las etiquetas de nombre van compactas encima de cada rival; si chocan, se recorren de lado o suben, sin taparle la cara a nadie. Cada asiento tiene un lugar fijo para su etiqueta: se calcula una vez por acomodo con el tamaño de la etiqueta más grande (la del nombre de bot más largo, que en la computadora cabe completo en un renglón) y se ancla por la orilla que da a su rival, con un piquito que apunta a su cabeza, así no brinca cuando cambia lo que dice. En etiquetas angostas (ventana de 640 px o menos, celular), un nombre largo va en dos renglones en vez de cortarse.

### Paleta (apagada y terrosa)

| Elemento | Color |
|---|---|
| Tinta (contornos y texto dibujado) | `#1d1611` |
| Paredes | tablas de madera `#75614c` / `#6d5946` |
| Tablero de herramientas | `#b39a6e`; repisa metálica `#7d8a86` |
| Piso | concreto `#77705f` con manchas de aceite |
| Fieltro | verde apagado `#577a3d`, centro `#4b6b35` |
| Madera de la mesa (la de código; la ilustrada trae los suyos) | riel `#6e4026`, pared interior `#4f2c18`, canto `#41241a` |
| Lámpara | domo mostaza `#c9a03a` |
| Papel (cartas, paneles) | crema `#efe4c8` |

**Prohibido:** rosa neón, morado chillón, verde limón brillante, fondos saturados.

### Dirección de arte

- **Escenario**: un garaje-taller chico, sucio y acogedor, no un casino. Es la ilustración `fondo-garaje`: tablero perforado con herramientas, bobinas que echan chispas, osciloscopio, repisa con frascos raros, lavadora vieja con un frasco que brilla, cables por el piso y la lámpara mostaza colgando al centro. Nada de elementos de series existentes. Ideas para después: humo de algún rival, un mesero que pasa al fondo, botella y cenicero sobre la mesa.
- **Mesa**: la de la referencia (ver "Técnica"): octagonal, muy grande (ocupa casi todo el ancho de la pantalla), de madera, para máximo 7 jugadores, con riel de madera acolchado con vetas, fieltro verde con sombreado suave y una línea dorada en forma de pista. Objetos decorativos (vasos, mazo, dados, cenicero) para después, sin estorbar a las cartas ni al bote.
- **Lámpara**: colgante de domo mostaza justo encima de la mesa, con un cono de luz cálida que pinta un círculo en la mesa y un resplandor rojizo en la pared.
- **Fichas** con colores desaturados por denominación: **crema 10, oliva 25, ladrillo 50, negra 100, marino 500, mostaza 1,000**, con franjas en el canto y el valor impreso en la ficha de arriba de cada columna (10, 25, 50, 100, 500, 1K), de cara al jugador. Cada jugador recibe 32 fichas = 5,000: 2 de 1,000, 3 de 500, 10 de 100, 6 de 50, 6 de 25 y 5 de 10 (`client/chips.js`, que también calcula con qué fichas se forma cualquier monto). Como con fichas de 10 y 25 se forma cualquier múltiplo de 5 desde 20, las apuestas van en múltiplos de 5 (salvo el all-in) y los botes divididos se reparten en unidades de 5.
- **Cartas**: tarjetas de esquinas redondas dibujadas en canvas (`client/stage/cards.js`) y puestas en perspectiva sobre la mesa, de papel blanco cálido, con índices grandes en Chewy (para que se lean aunque la carta mida 27 px de ancho en el celular) y palos de forma clásica en dos colores: corazones y diamantes en rojo ladrillo, picas y tréboles en tinta (`client/ui/suits.js`, los mismos en la mesa, en el panel del resultado y en la vista 2D). Del 2 al 10, la distribución tradicional de los palos (los de la mitad de abajo, de cabeza). Los ases, los cuatro iguales: el palo grande y, abajo, la etiqueta del logo en chico.
  - **Figuras** (rey, reina y jota): personajes originales en caricatura para adultos, al estilo de las figuras de las barajas clásicas: pose rígida de frente, un objeto en diagonal y la otra mano al pecho, ropa cubierta de patrones, párpados pesados y cara de "ya me quiero ir". Gemini dibujó la mitad de arriba (`scripts/generar-baraja.py`); el código pone la de abajo (la misma girada 180°), el marco de doble línea con las volutas del reverso, la franja del centro, el palo junto a la cabeza y los índices. La túnica va del color de su palo: corazones rojo ladrillo, diamantes marino, tréboles oliva y picas gris pizarra.
  - **Reverso**: el marco de volutas rojo ladrillo sobre blanco (de Gemini, con el centro limpiado por código) y, al centro, la etiqueta del logo: un rectángulo rojo con "Poker for the Players" en letras blancas, sin contorno, dibujada por código. La misma función la pone en los ases: el texto, los colores y el tamaño están en `ETIQUETA` de `cards.js`, para cambiar los dos a la vez cuando se rediseñe el logo.
  - El arte se precarga con el resto; si alguna imagen no carga, esa carta se dibuja solo con código (el reverso con un marco rojo sencillo, las figuras con su marco, su letra y su palo) y el juego sigue. En la vista 2D las cartas son HTML con los mismos palos, y boca abajo llevan un reverso en CSS (papel, marco rojo y la franja de la etiqueta).
  - Las cartas que tienen los rivales en la mano (dibujadas en sus ilustraciones) siguen con el reverso azul de antes: ver "Pendientes".
- **Rivales**: ilustraciones recortadas de cuerpo completo, sentados en su propia silla y con las cartas al pecho (ver "Archivos de arte" y `docs/ESPEC-PERSONAJES.md`); la mesa los recorta en la cintura, así que las manos y las cartas se siguen viendo. Mismo estilo para todos: formas simples, ojos grandes con párpados caídos, expresiones secas, aburridas o sospechosas, mezcla de criaturas alienígenas y equipo improvisado. Cada uno con una silueta distinta y reconocible. Los humanos en la mesa usan uno de estos personajes como avatar, con su apodo encima.
- **Animación de los rivales** (cambio de pose, como en una serie animada):
  - **espera** por omisión, con **parpadeo** cada 3 a 6 s al azar (150 ms; solo en espera);
  - **espia** justo después de que le reparten (escalonado, como si fueran repartiendo) y de vez en cuando mientras espera (si no tiene ese cuadro, se queda en espera);
  - **apuesta** unos 2 s cuando iguala, apuesta o sube (no con ciegas, pasar ni retirarse), y luego regresa a espera;
  - **retirarse** 1.4 s al retirarse (si tiene ese cuadro y no está ausente), y después se apaga;
  - **gana** mientras se ve el resultado de una mano que ganó (también si los demás se retiraron o si empató; no por fichas que le regresan), desde que se resalta la mano ganadora y hasta la mano siguiente, si tiene ese cuadro;
  - respiración muy sutil (escala vertical de 1 a 1.5 % desde la cintura), a un ritmo distinto para cada uno;
  - si se retira o está ausente, se ve apagado (desaturado y oscuro) y un poco transparente;
  - aro mostaza en el fieltro alrededor de la pila de quien está pensando, centrado frente a él; las fichas y las cartas comunitarias quedan encima. (En el celular sigue a un lado de la pila, entre ella y la orilla.)
- **Manos del jugador**: por ahora mis dos cartas van boca arriba sobre la mesa, abajo a la izquierda (en el celular vertical van fuera de la mesa: ver "Celular"). Después: ilustraciones de mis manos sosteniendo las cartas (el jugador podrá elegir color de piel o mano alienígena).

### Cámara

- Fija en el asiento del jugador, sin girar (`CAMERAS` en `config.js`). No se puede arrastrar para mirar alrededor.
- En la computadora es la cámara de la mesa ilustrada: 19° hacia abajo y lejos (`dist` 1.997, los ojos a 0.65 del fieltro en unidades de la mesa). Con una sola imagen, una mesa más honda vista desde más abajo se ve igual que una menos honda vista desde más arriba; el ángulo sale de las fichas dibujadas en la referencia (sus elipses dicen que la cámara se ve a unos 20° desde la mesa). Por eso la mesa del juego es más honda que ancha.
- Con esa cámara los rivales se verían chicos junto a la mesa: se dibujan 1.6 veces su `height` (`rivals`), como en la referencia. Las comunitarias van más grandes (`board.scale`) y en el centro (`board.z`), las cartas sobre la mesa se levantan un poco más (`lean`) para que se lean, mis cartas van hacia la orilla (`mine.x`) y el botón del dealer queda justo a la derecha de mis cartas.
- **`pitch`, `dist`, `TABLE_EDGE`, `RAIL_Y`, `APRON` y `FELT_R` salen de calcar la mesa ilustrada** (`scripts/calcar-mesa.py` los imprime) y viven también en `mesa.json`; `test/mesa.test.js` revisa que coincidan y que el frente cortado nunca se vea. Cambiar cualquiera pide volver a calcar (o rehacer la ilustración). Lo demás (`headGap`, `width`, `rivals`, `lean`, `board`, `mine` y los asientos) solo cambia la escala, el acomodo o dónde van las cosas, y se puede ajustar sin rehacerla.
- En vertical (celular) va la mesa de código con la misma orilla y su propia cámara (50° desde más arriba): falta revisar el celular con la mesa nueva (ver "Pendientes").
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
- Una sola franja discreta arriba con el **bote total** (incluye las apuestas de la ronda; el "Bote" escrito en la mesa es solo el montón del centro), cuánto te toca igualar, tus fichas, ciegas (y cuándo suben) y la ronda (Antes del flop, Flop, Turn, River). En la misma franja, **"Tu mano"** con el nombre de tu mejor jugada (`client/ui/hand.js`); las cartas de la mesa ya se ven en la mesa.
- **Que siempre se entienda qué pasa:**
  - Cada rival muestra en su etiqueta su última jugada como sello de color: Pasa, Iguala 50, Sube a 200, All-in, Se retira, Ciega. Si es su turno, "Pensando…" con su tiempo. El sello salta cuando la jugada es nueva. El servidor lo manda en `player.lastAction`. Quien se retira de la mano queda solo con su nombre, apagado (sin fichas ni sello).
  - Un historial en vivo (abajo a la izquierda, junto a la barra de acciones, donde no tapa fichas, cartas ni caras) cuenta las últimas 3 jugadas en palabras, incluido "Sale el flop: 4♥ 2♥ 4♠". En pantallas de menos de 1200 px de ancho no cabe ahí y solo se ve la última jugada, dentro de la barra.
  - Cada apuesta sobre la mesa y el bote llevan su monto escrito encima, para no tener que contar fichas. El valor de cada color de ficha está en el panel "Posiciones".
  - Las cartas comunitarias van grandes e inclinadas hacia el jugador.
  - Cuando es tu turno, la barra se marca en mostaza y el aviso dice qué opciones tienes ("¡Te toca! Para seguir tienes que igualar 50").
  - **Resultado de la mano**: un panel en lugar de la barra de acciones (en pantallas anchas, más ancho que la barra y bajito, para no tapar mis cartas). Arriba, quién ganó, cuánto y con qué mano ("La Güera gana 450 con color de corazones"; con empate, cuánto le toca a cada quien); con botes secundarios, un renglón por bote ("Bote principal (900): …", "Bote secundario (1,800): …") y lo que se le regresa a alguien. Abajo, una línea por jugador que llegó al final, de la mejor mano a la peor: sus dos cartas (chiquitas, con los mismos palos de la mesa), su nombre y su mano ("Escalera del 5 al 9"), y lo que ganó; en la de quien ganó, la carta propia que no usó se ve apagada. Al lado (abajo en el celular), "Siguiente mano en 7 s" y Listo; después de tocarlo, a quién se espera. Si me quedé sin fichas, Recomprar y Quedarme fuera van dentro del panel. Mientras se ve, no hay historial a la izquierda ni aviso del centro: todo lo dice el panel.
- Botón para silenciar y botón de calidad gráfica (alta, media, baja).
- Retirarse cuando se puede pasar gratis pide confirmación ("Puedes pasar gratis, ¿seguro que te retiras?").

### Celular

"Celular" es una pantalla táctil de 640 px de ancho o menos (`client/ui/phone.js`, la misma regla en `style.css`); una ventana angosta en la computadora no cuenta. En la computadora todo se queda como arriba.

- **El juego es vertical.** Con el celular acostado (táctil, de 500 px de alto o menos y al menos 4:3 de ancho; no se usa la orientación porque en Android el teclado abierto deja la pantalla vertical "acostada") un aviso tapa todo y pide girarlo.
- La regla principal: cuando es mi turno siguen viéndose la mesa, el flop y mis cartas. De arriba hacia abajo:
  1. **Franja de una línea**: Bote total, Para igualar y Tus fichas, y el menú ≡ con todo lo demás (código de mesa, ciegas y cuándo suben, ronda, mano, opciones, posiciones, valor de las fichas, últimas jugadas y Salir de la mesa).
  2. **La mesa** con los rivales y las comunitarias (más grandes que en la computadora).
  3. **Mis dos cartas grandes y derechas**, entre la mesa y el panel (`.mycards`; las dibuja la escena en esa caja, es la excepción a "una sola perspectiva"). Junto a ellas, "Tu mano" y un solo aviso de una línea (la última jugada o un error) que se borra a los 4.5 s.
  4. **Panel de acciones**, nunca más de un cuarto de la pantalla: "¡Te toca!…" y una fila con Retirarse, Pasar o Igualar, y Subir (Apostar si nadie ha apostado). Subir cambia esa fila por ½ bote, Bote, Todo, ✕ y abajo − slider + y el botón que confirma; − y + mueven una ciega grande.
- La escena mide `.mycards` para acomodar la mesa arriba (mi orilla queda detrás de mis cartas), así la mesa no brinca al abrir Subir.
- **Resultado de la mano**: el panel crece hacia arriba desde la barra y tapa, como mucho, la franja de mis cartas (salen en mi línea del panel), nunca la mesa; cuando se enseñan cartas la tapa completa, para que no se asomen. Si no cabe todo (muchos jugadores o botes), se desliza por dentro y Listo se queda abajo a la vista. Las cartas que enseña cada rival se dibujan más grandes que en la computadora para que se lean.
- Sin el aviso "Turno de…": lo dicen el aro y el "Pensando…" de la etiqueta, y mi turno, el panel en mostaza.
- Etiquetas de los rivales: siempre en la versión compacta (nombre arriba, en dos renglones si es largo, como "El Compadre / Zorg"; fichas y jugada abajo), en un lugar fijo por asiento: encima de la cabeza los del fondo y, si arriba ya no cabe, debajo de la cara (los de los lados prefieren debajo de la cara antes que irse muy arriba, donde quedarían junto a las de los del fondo). El piquito apunta a su rival. Nunca tapan caras (en ninguna pantalla).
- **Agregar a pantalla de inicio** (`manifest.json`, `apple-touch-icon` y etiquetas `apple-mobile-web-app-*`): se abre como app sin la barra de Safari, con la barra de estado translúcida (todo respeta las orillas seguras). En iPhone la app guarda sus datos aparte de Safari: la primera vez pide de nuevo el código de acceso y el apodo.

### Sonido

Efectos de caricatura: cartas, fichas cayendo y deslizándose, golpecitos en la mesa, burbujas del vaso, zumbido de la lámpara, pasos y vasos del mesero, y un aviso cuando es tu turno. Música de fondo opcional tipo lounge espacial, apagada por defecto. Todo con licencia libre o generado con Web Audio. El sonido empieza solo después de la primera interacción del usuario.

### Rendimiento y accesibilidad

- Debe correr fluido en celulares de gama media y en una MacBook Pro Intel de 2018 con 8 GB. La escena no usa WebGL: la mesa se dibuja una vez por tamaño, las fichas y cartas una vez por jugada, y solo la capa de los rivales se anima (30 cuadros por segundo; cada pose se reduce una sola vez al tamaño en que se ve).
- Las ilustraciones se precargan y decodifican antes de mostrar la mesa ("Abriendo el garaje…"), también el arte de la baraja (si una imagen de la baraja no carga, esa carta va de código). Si no cargan el fondo o los personajes, queda la vista 2D simple.
- Calidad (Auto, Alta, Media, Baja): resolución del canvas (hasta 2x, 1.5x o 1x). En baja, poses chicas, fondo chico y 20 cuadros por segundo. En automático se usa baja solo en equipos con muy pocos núcleos o poca memoria.
- Pausar la animación cuando la pestaña no está visible.
- Con `prefers-reduced-motion`: sin respiración ni pulso del aro de turno.
- La vista 2D simple (botón "2D") sigue disponible como respaldo para quien la prefiera.

## Pruebas

`test/engine.test.js` con `node --test`: simular al menos 3,000 partidas aleatorias de 2 a 7 jugadores y verificar que las fichas totales nunca cambian y que ninguna mano se queda atorada. Incluir bots en esas simulaciones (mesas solo de bots en las 3 dificultades) y verificar que nunca hagan jugadas ilegales ni reciban cartas ajenas. Probar el evaluador con casos conocidos (escalera real, escalera baja A-2-3-4-5, full contra color, empates).

En esas simulaciones, el resultado de cada mano cuadra: botes + devoluciones = lo apostado, cada bote se reparte entre quienes lo ganaron, solo se le regresa a quien apostó más que todos y las 5 cartas de cada mano son de verdad su mejor mano. El evaluador también da los nombres para los jugadores ("Color de corazones", "Escalera del A al 5").

**Seguridad del final de la mano** (`test/resultado.test.js` con cartas acomodadas en una mesa, y `test/server.test.js` por sockets con tres jugadores y un espectador): se revisa todo lo que recibe cada quien, incluidos el resultado y el historial, sin fiarse de la lista del servidor de quién enseñó: antes del final nadie recibe cartas ajenas; al final llegan las de quienes llegaron y nunca las de quien se retiró; si todos se retiran, nadie ve las del ganador; con all-in, las cartas se enseñan hasta que termina la mano. También el Listo: práctica, amigos (falta uno, todos), un Listo de otra mano, ausentes y espectadores, y la duración de cada resultado.

`test/mesa.test.js`: la cámara de la computadora y la orilla del juego son las de la mesa ilustrada (las de `mesa.json`), sus imágenes existen, y en pantallas horizontales de 4:3 a 21:9 la orilla de abajo del dibujo queda siempre en la de la pantalla o más abajo y la orilla dibujada cruza toda la pantalla (ahí se recorta a los rivales).

`test/baraja.test.js`: cada carta del 2 al 10 lleva tantos palos como su número, adentro de la carta y sin tocar los índices, con la distribución de siempre (igual al girar la carta, salvo el palo de en medio del 7, y los de abajo de cabeza); los palos van en dos colores; el arte de la baraja está exportado (el reverso, las 12 figuras y los adornos), y la etiqueta del reverso cabe adentro del marco.

`test/asientos.test.js`: Don Tentáculos es el único de dos sillas; en práctica, cuando sale, se sienta al centro del fondo con 1 a 6 rivales; en mesas con amigos, al centro de quien creó la mesa, sin mover a ningún humano y sin cambios ya empezado el torneo; con un humano en ese lugar, en el asiento de bot más cercano; y si ningún bot es él, lo usa el humano del centro.

`test/personajes.test.js`: cada personaje en uso de `personajes.json` tiene `frente` con `espera`, solo cuadros de la lista y sus WebP (grande y chico); los retirados no se usan y el juego dibuja el personaje que manda el servidor; cada uno dice hacia dónde mira y cuántas sillas ocupa, y va en espejo solo en el lado contrario a donde mira (al centro y de frente, nunca); un cuadro que falta se dibuja con espera; con solo `espera` no parpadea, no espía, no apuesta ni se retira con pose, y en cuanto llega otro cuadro se usa; solo espera parpadea; al retirarse se ve `retirarse` y no se apaga hasta que termina; con cuadro `gana`, el que gana lo enseña mientras dura el resultado (sin él se queda en espera) y deja de celebrar con la mano nueva.

`test/bots.test.js`, además de las jugadas: cada personaje tiene siempre el mismo nombre de bot y Madame Blorp ya no sale; con 1 a 6 bots, cada uno con un personaje distinto y su nombre; nunca repite el personaje de otro bot ni un nombre que ya se use (si se acaban, nombres de repuesto); en la mesa, los humanos se dibujan con los personajes que sobran y todos ven lo mismo.

## Comandos esperados

```
npm install
npm run dev     # servidor + Vite (como middleware) en http://localhost:3000
npm test
npm run build   # empaqueta el cliente en dist/
npm start       # producción: sirve dist/ (corre antes npm run build)
```

`npm run dev` levanta el servidor y Vite juntos en el mismo puerto. Para probar multijugador en local, abrir varias pestañas o ventanas de incógnito. Para probar desde el celular en la misma red WiFi, usar la IP local de la Mac (por ejemplo `http://192.168.1.50:3000`).

## Pendientes

- **Cartas en la mano de los rivales**: sus ilustraciones tienen las cartas con el reverso azul marino de la baraja anterior. Hay que cambiarlas al reverso de la baraja (marco rojo de volutas y la etiqueta roja), editando la zona de las manos con `scripts/generar-personaje.py`.

- **Celular con la mesa nueva**: en vertical sigue la mesa de código, pero con la orilla nueva (más honda que ancha, calcada de la ilustración), así que su cámara se bajó a 50° (`CAMERAS.portrait`) para que los rivales no se vieran diminutos. Falta decidir si el celular usa una segunda ilustración (vista más desde arriba) o la misma adaptada, y revisar sus asientos y etiquetas.
- **Memoria en iPhone con todos los cuadros**: el máximo de frente subió a 1000 px de alto (la mitad de abajo queda bajo la mesa). Cuando cada personaje tenga todos sus cuadros de frente y de lado, revisar cuánta memoria usa la mesa en un iPhone: hoy se precargan y decodifican todos los cuadros de todos los personajes en uso (6 personajes × hasta 6 cuadros × 2 ángulos, más los reducidos al tamaño en que se ven). Si pesa, cargar solo los personajes que están en la mesa o bajar el máximo.
- **Blob y turista en más resolución**: sus originales miden 1024 × 559 (los demás 1024 × 1024), así que en pantallas retina de computadora se ven un poco menos nítidos. No se arregla con código: cuando haya versiones más grandes (el mismo dibujo a 1024 px de alto o más), reemplazar los PNG en `arte/personajes/<id>/`, correr `optimizar-arte.py personajes blob turista` y volver a registrar cada uno (`registrar blob`, `registrar turista`) para que se actualice su tamaño; el nombre y las medidas no se tocan y, si el encuadre es el mismo, siguen sirviendo.

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
