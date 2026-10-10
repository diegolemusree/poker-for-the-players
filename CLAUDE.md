# Poker for the Players

## Objetivo

Construir **Poker for the Players**, una página web privada para jugar Texas Hold'em No Limit en línea entre un grupo de amigos, con fichas virtuales (sin dinero real). Cada jugador entra desde su celular o computadora, crea o se une a una mesa con un código, y juega en tiempo real.

Es un proyecto personal para el dueño y sus amigos, no un producto público: no necesita registro, marketing, anuncios ni páginas legales complejas. Sí necesita verse profesional, porque vivirá en un dominio propio.

Responde y comenta en español. El nombre de la marca va en inglés ("Poker for the Players"), pero todos los textos de la interfaz van en español de México.

## Identidad de la marca

- Nombre completo: **Poker for the Players**. Usarlo en el `<title>`, en la pantalla de inicio y en la vista previa al compartir el link.
- Logotipo en SVG con el mismo estilo de animación 2D de la escena (ver "Estilo visual"): letras rotuladas a mano con línea delgada color tinta, colores de la paleta apagada y algún detalle alienígena o de palo de baraja. Original, sin parecerse a logos de series existentes.
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
- Frontend con three.js para la escena 3D, empaquetado con Vite. Sin framework de UI: HTML, CSS y JavaScript para la interfaz encima de la escena.
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
    scene/          # escena three.js: cuarto, cámara, materiales planos y contornos (ink.js)
    models/         # geometría por código de fichas, cartas, manos y criaturas
    animations/     # jugadas propias, rivales, reposo y "pensando"
    ui/             # barra de acciones, HUD, pantallas de inicio
    audio/
  public/
    assets/         # logo, sonidos, íconos, imagen para compartir
    manifest.json
    robots.txt
  test/
    engine.test.js  # simulación de manos aleatorias
  referencia/
    poker-referencia.html
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

Lo que NO queremos (así se veía la versión anterior y se descartó): colores neón saturados, materiales brillantes, casi sin contornos, un casino gigante y vacío, personajes hechos de bloques.

### Técnica de render

- **Sin iluminación realista.** Materiales planos de 2 tonos como máximo: el color base y una sola sombra plana un poco más oscura (`MeshToonMaterial` con rampa de 2 pasos, una luz ambiental y una direccional; ver `client/scene/toon.js`). Nada de brillos, reflejos, mapas de sombras ni degradados suaves.
- **La luz se pinta, no se simula.** La lámpara crea "charcos" de luz con bordes duros según la distancia al foco: la mesa iluminada, una penumbra cálida, un resplandor rojizo en paredes y piso cercanos, y el resto del cuarto más oscuro. El parche claro del fieltro y el cono de luz son formas planas.
- **Contornos color tinta `#1d1611` en todo**, siluetas y bordes internos, con línea delgada y uniforme como trazo de animación (no gruesa tipo cómic). Se hacen con un posproceso (`client/scene/ink.js`): la escena se dibuja una vez con dos salidas (color + número de trazo por material, y normales) y una pasada a pantalla completa pinta línea donde cambia la profundidad, la normal o el material. Materiales que no deben separarse con línea (el fieltro y su parche iluminado, el piso y sus manchas) comparten nombre de trazo (`edge`). Lo translúcido (cono de luz, humo) va en una capa aparte que se dibuja después, sin contorno.
- **Formas simples y un poco imperfectas**: nada de bloques perfectos; `wobble()` deforma levemente la geometría.
- Todo se modela con geometría por código y texturas pintadas en canvas; si se usan modelos externos, deben ser CC0 y anotarse en `public/assets/CREDITOS.md`.

### Paleta (apagada y terrosa)

| Elemento | Color |
|---|---|
| Tinta (contornos y texto dibujado) | `#1d1611` |
| Paredes | café rojizo oscuro `#6b3a2a` |
| Lambrín (mitad inferior) | madera `#5a4030`, moldura `#4a3324` |
| Piso | caqui desteñido `#7d7350`, manchas `#6b6243` |
| Tapete bajo la mesa | óxido gastado `#8c5b3b` |
| Fieltro | verde apagado `#5f9a3a`, más claro bajo la lámpara `#86b84e` |
| Madera de mesa y sillas | `#7a4a2c`, `#6a4530` |
| Lámpara | domo mostaza `#c9a03a` |
| Papel (cartas, paneles) | crema `#efe4c8` |

**Prohibido:** rosa neón, morado chillón, verde limón brillante, fondos saturados.

### Dirección de arte

- **Escenario**: un cuarto de juego chico, sucio y acogedor, no un casino. Paredes café rojizo con lambrín de madera, piso caqui con manchas, tapete redondo gastado bajo la mesa, cuadros enmarcados con paisajes de planetas raros, una puerta con un letrero chueco, manchas de humedad. Una botella y un cenicero sobre la mesa. Humo que sube en espiral de algún rival y se disuelve. Un mesero alienígena original que de vez en cuando pasa al fondo con una charola.
- **Mesa**: redonda, pequeña, de madera, para máximo 6 jugadores, con una sola pata central. Fieltro verde gastado y riel de cuero café.
- **Lámpara**: colgante de domo mostaza justo encima de la mesa, con un cono de luz cálida que pinta un círculo en la mesa y un resplandor rojizo en la pared.
- **Fichas** con colores desaturados por denominación: **crema 10, oliva 25, ladrillo 50, negra 100, marino 500, mostaza 1,000**, con franjas en el canto. Cada jugador recibe 32 fichas = 5,000: 2 de 1,000, 3 de 500, 10 de 100, 6 de 50, 6 de 25 y 5 de 10 (`client/chips.js`, que también calcula con qué fichas se forma cualquier monto). Como con fichas de 10 y 25 se forma cualquier múltiplo de 5 desde 20, las apuestas van en múltiplos de 5 (salvo el all-in) y los botes divididos se reparten en unidades de 5.
- **Cartas**: papel crema, índices grandes y claros en tinta y rojo ladrillo. Las figuras J, Q, K son criaturas inventadas con ojos de párpado caído. El reverso es azul marino con el logo de Poker for the Players en mostaza.
- **Rivales**: personajes originales dibujados en el mismo estilo, de la cintura para arriba: formas simples, extremidades delgadas, ojos grandes con pupilas pequeñas, párpados caídos y expresiones secas, aburridas o sospechosas. Mezcla de criaturas alienígenas y seres con equipo tecnológico improvisado (cables, tubos, cascos). Cada uno con una silueta distinta y reconocible. Animaciones en reposo sutiles y secas: parpadeo, mirar de reojo, fumar, rascarse. Los humanos en la mesa usan uno de estos personajes como avatar, con su apodo flotando encima.
- **Manos del jugador**: manos de caricatura en el mismo estilo de línea delgada. El jugador puede elegir el color de piel o un tipo de mano alienígena.

### Cámara

- Fija en el asiento del jugador, a la altura de los ojos de alguien sentado en una silla, mirando ligeramente hacia abajo a la mesa. Como la mesa es chica, los rivales se ven cerca y enmarcados por el cuarto, como en una toma de la serie.
- Respiración sutil (balanceo mínimo) para que se sienta vivo.
- El jugador puede mirar un poco alrededor arrastrando con el dedo o el mouse (límite de unos 40 grados a cada lado y 15 arriba y abajo), y la cámara regresa sola al centro.
- Cuando habla otro jugador, la cámara gira levemente hacia él, como cuando volteas a ver quién apuesta.
- Al llegar el flop, turn o river, la cámara baja un poco la mirada hacia el centro de la mesa.

### Animaciones de las jugadas propias

Cada botón dispara una animación en primera persona con las manos del jugador **antes** de que el resultado se vea en la mesa. La jugada se envía al servidor al presionar el botón; la animación es visual y dura de 0.6 a 1.2 segundos.

- **Pasar (check)**: dos golpecitos con los dedos sobre el fieltro.
- **Igualar (call)**: la mano toma de su pila la cantidad exacta y la desliza hacia adelante.
- **Apostar o subir**: la mano toma las fichas y las lanza o las pone con estilo frente a sí; con montos grandes, usa las dos manos.
- **All-in**: las dos manos empujan toda la pila hacia el centro, con un pequeño temblor de cámara y efecto de sonido dramático.
- **Retirarse (fold)**: la mano avienta las cartas boca abajo hacia el centro, con algo de desgano.
- **Ganar el bote**: las dos manos jalan las fichas del centro hacia su lugar y las apilan.
- **Ver tus cartas**: al repartir, la mano levanta las esquinas de las cartas para "espiarlas", y luego las deja sobre la mesa.

Las animaciones de los rivales son equivalentes pero vistas desde enfrente (las criaturas aventando sus fichas, retirando cartas, etc.).

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

Los rivales también tienen animaciones en reposo propias de su personaje, secas y sutiles (el del casco echa humo por una válvula, la de cuatro brazos se rasca la nuca mientras tamborilea).

### Interfaz encima de la escena

- Paneles color papel crema desteñido (`#efe4c8`), línea delgada color tinta como trazo a mano y sombras planas mínimas. Nada de botones neón: los colores de acento salen de la paleta (mostaza, ladrillo, oliva, marino).
- Tipografía de rotulado a mano de caricatura de Google Fonts, legible y con acentos, ñ, ¿ y ¡.
- Barra de acciones abajo con botones grandes de al menos 44px: Retirarse, Pasar o Igualar, Apostar o Subir con slider y atajos (½ bote, bote, todo).
- Una sola franja discreta arriba con bote, tus fichas, cuánto te toca igualar y temporizador de turno.
- Botón para silenciar y botón de calidad gráfica (alta, media, baja).

### Sonido

Efectos de caricatura: cartas, fichas cayendo y deslizándose, golpecitos en la mesa, burbujas del vaso, zumbido de la lámpara, pasos y vasos del mesero, y un aviso cuando es tu turno. Música de fondo opcional tipo lounge espacial, apagada por defecto. Todo con licencia libre o generado con Web Audio. El sonido empieza solo después de la primera interacción del usuario.

### Rendimiento y accesibilidad

- Debe correr fluido en celulares de gama media y en una MacBook Pro Intel de 2018 con 8 GB.
- Detectar equipos lentos y bajar la calidad automáticamente. En calidad baja: resolución 1x, 30 cuadros por segundo y menos elementos animados en el fondo (el mesero pasa menos, menos humo). Los contornos se quedan siempre porque son parte del estilo; cuestan una sola pasada a pantalla completa.
- Pausar el render cuando la pestaña no está visible.
- Con `prefers-reduced-motion`: sin respiración de cámara, sin temblores, animaciones cortas.
- Si el navegador no soporta WebGL, mostrar una vista 2D simple funcional para que nadie se quede sin jugar.

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
