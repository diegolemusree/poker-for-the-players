# Poker for the Players

Torneo privado de Texas Hold'em No Limit para jugar con amigos a distancia, con fichas virtuales (sin dinero real).
Cada quien entra desde su celular o su computadora con un link, pone el código del grupo, crea una mesa o se une con
su código, y se juega en tiempo real. También se puede practicar solo contra la computadora.

Cómo funciona: un solo servidor en internet (Node con Express y Socket.IO) hace de mesa: tiene el mazo, reparte, revisa
cada jugada y le manda a cada jugador solo lo que le toca ver. Las mesas viven en la memoria de ese servidor. Las reglas
del proyecto y todos los detalles están en `CLAUDE.md`.

## Publicar en Render (la primera vez)

Render mantiene el servidor prendido y acepta las conexiones en vivo que usa el juego. La configuración ya está en
`render.yaml`, así que Render la lee solo.

1. Entra a [render.com](https://render.com) y crea una cuenta con **Sign up with GitHub**, usando la cuenta de GitHub
   donde está este repositorio. Si te pregunta a qué repositorios puede entrar, dale acceso a **poker-for-the-players**.
2. En el panel de Render: **New** → **Blueprint**. Elige el repositorio **poker-for-the-players** (rama `main`).
3. Render enseña el servicio `poker-for-the-players` que viene en `render.yaml` y te pide el valor de **ACCESS_CODE**:
   escribe el código que les vas a dar a tus amigos (por ejemplo una palabra y un número). Se pide una sola vez en cada
   celular o computadora y se recuerda. Si lo dejas vacío, el juego no pide código: cualquiera con el link podría entrar.
4. Dale **Apply** (o **Deploy Blueprint**). La primera vez tarda unos minutos: instala, arma la página y arranca. Cuando
   diga **Live**, arriba aparece la dirección del juego, algo como `https://poker-for-the-players.onrender.com`.
5. Ábrela, pon el código y prueba "Jugar contra la compu". Luego pásales a tus amigos el link y el código. Para jugar
   juntos: uno toca "Crear mesa" y comparte el link de la mesa (`…/?mesa=ABCDE`) por WhatsApp.

### Cambiar el código de acceso

En Render: tu servicio → **Environment** → `ACCESS_CODE` → edítalo y guarda. El servicio se reinicia solo (las mesas
abiertas se pierden) y a cada quien se le vuelve a pedir el código.

### Actualizar el juego

Cada commit que llega a la rama `main` de GitHub se publica solo: Render vuelve a armar el juego y lo reinicia en unos
minutos. Mientras se reinicia, las mesas en memoria se pierden; mejor no publicar a media partida.

## El plan gratis de Render

- Si **nadie tiene el juego abierto** durante 15 minutos, el servidor se duerme. La siguiente persona que entre espera
  como un minuto a que la página cargue mientras despierta.
- Mientras alguien tenga el juego abierto en su pantalla (aunque sea mirando la mesa), el servidor se queda despierto.
- Al dormirse o reiniciarse se pierden las mesas: quien vuelva ve "Tu mesa anterior ya no existe. Puedes crear otra."
- Para una noche de póker esto no estorba. Si algún día molesta, un plan de pago de Render no se duerme.

## Dominio propio (después)

Cuando tengas tu dominio (por ejemplo `pokerfortheplayers.com`):

1. En Render: tu servicio → **Settings** → **Custom Domains** → **Add Custom Domain** y escribe tu dominio (y también la
   versión con `www`, si la quieres).
2. Render te enseña exactamente qué registros DNS poner. Normalmente:
   - para `www`: un registro **CNAME** que apunta a la dirección de tu servicio (`poker-for-the-players.onrender.com`);
   - para el dominio sin `www`: el registro **A** (o **ALIAS/ANAME**) con el valor que te dé Render.
3. Ponlos en el panel de donde compraste el dominio (GoDaddy, Namecheap, Cloudflare…), en la sección de DNS.
4. Regresa a Render y dale **Verify**. Los cambios de DNS pueden tardar desde minutos hasta unas horas. Render pone el
   HTTPS (el candado) solo y gratis.

## En tu computadora (solo para programar)

Para jugar no hace falta nada en tu computadora. Para cambiar el juego:

```
npm install
npm run dev     # el juego en http://localhost:3000, con los cambios al momento
npm test        # las pruebas
npm run build   # arma la página en dist/ (Render lo hace solo)
npm start       # como en Render: sirve dist/ (antes corre npm run build)
```

Sin `ACCESS_CODE` en tu computadora no se pide código. Para probar desde el celular en la misma red WiFi, usa la IP
local de tu computadora (por ejemplo `http://192.168.1.50:3000`).
