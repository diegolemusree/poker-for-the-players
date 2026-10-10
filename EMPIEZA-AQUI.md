# Empieza aquí

Guía para arrancar Poker for the Players con Claude Code en VS Code. Este archivo es para ti; las instrucciones del proyecto para Claude Code están en `CLAUDE.md`.

## Antes de empezar

1. Abre la Terminal y revisa tu versión de Node con `node -v`. Necesitas la 20 o más nueva. Si no lo tienes o es más vieja, instálalo desde nodejs.org (versión LTS).
2. Descomprime esta carpeta donde guardes tus proyectos, por ejemplo en `Documentos/Proyectos/poker-for-the-players`.
3. En VS Code: Archivo > Abrir carpeta, y elige `poker-for-the-players`.
4. Abre Claude Code dentro de VS Code.
5. Recomendado: inicia Git para poder regresar a una versión anterior si algo se rompe. Pídele a Claude Code: "Inicializa un repositorio git con un .gitignore para Node y haz el primer commit."

## Construcción por fases

Pega un prompt a la vez. No pases a la siguiente fase hasta probar que la anterior funciona. Al terminar cada fase, pide un commit.

### Fase 1: motor del juego y pruebas

> Lee CLAUDE.md y la referencia. Crea package.json y porta el motor del juego y el evaluador de manos a server/engine.js y server/hands.js, con las pruebas de test/engine.test.js. Todavía no hagas interfaz. Al final corre npm test y enséñame los resultados.

### Fase 2: bots

> Crea server/bots.js con las tres dificultades descritas en CLAUDE.md. Agrega las pruebas de mesas solo de bots y la prueba de que los bots nunca ven cartas ajenas. Corre npm test.

### Fase 3: servidor y vista sencilla

> Crea el servidor con Express y Socket.IO, el modo contra la compu y las mesas con código para amigos, con una interfaz 2D sencilla y funcional (puede parecerse a la referencia). Todavía nada de 3D. Quiero poder jugar contra bots en localhost:3000.

Pruébalo tú solo contra bots. Luego abre otra ventana de incógnito para simular a un amigo.

### Fase 4: escena 3D en primera persona

> Ahora la escena three.js en primera persona según la sección Estilo visual de CLAUDE.md: casino interdimensional, mesa, cartas, fichas, criaturas rivales, cámara, sombreado toon y contornos. Sin animaciones de manos todavía. Mantén la vista 2D como respaldo.

### Fase 5: animaciones

> Agrega las manos en primera persona y las animaciones de jugadas propias. Después las de rivales.

Y luego, en otro mensaje:

> Agrega las animaciones en reposo y de "pensando" según CLAUDE.md.

### Fase 6: sonido, marca y pulido

> Agrega sonido, logo, favicon, manifest, imagen para compartir, código de acceso, robots.txt y el modo de calidad baja automático.

### Fase 7: publicar

> Prepara el proyecto para publicarlo en Render con mi dominio y escribe el README.md con los pasos explicados para principiante.

## Consejos

- Si algo no te gusta, descríbelo con detalle: qué ves, qué esperabas, en qué momento pasa. Una captura de pantalla ayuda mucho.
- Si Claude Code se confunde después de muchos cambios, empieza una conversación nueva; leerá CLAUDE.md otra vez.
- Si cambias de idea sobre algo del proyecto, pídele que también actualice CLAUDE.md, para que no se pierda.
