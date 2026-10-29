"""Convierte el arte original (arte/) en WebP optimizado para el juego (public/assets/arte/).

USO (desde la carpeta poker-for-the-players/, con el entorno de recortar.py)
--------------------------------------------------------------------------
    .venv-rembg/bin/python scripts/optimizar-arte.py                     # fondos y todos los personajes
    .venv-rembg/bin/python scripts/optimizar-arte.py fondos
    .venv-rembg/bin/python scripts/optimizar-arte.py mesa                # la mesa ilustrada (después de calcar-mesa.py)
    .venv-rembg/bin/python scripts/optimizar-arte.py baraja              # el arte de la baraja (de generar-baraja.py)
    .venv-rembg/bin/python scripts/optimizar-arte.py personajes alien    # uno o varios (o todos sin nombre, menos los retirados)
    .venv-rembg/bin/python scripts/optimizar-arte.py personajes alien --angulo lado
    .venv-rembg/bin/python scripts/optimizar-arte.py gif alien           # GIF de revisión por ángulo
    .venv-rembg/bin/python scripts/optimizar-arte.py registrar alien --nombre "El Compadre Zorg"
    .venv-rembg/bin/python scripts/optimizar-arte.py brazos alien        # mis brazos (de generar-personaje.py brazos)

Para un personaje nuevo, los tres pasos en orden: personajes -> gif (revisar) -> registrar.
La especificación del arte está en docs/ESPEC-PERSONAJES.md.

QUÉ HACE
--------
- fondos: arte/fondo-*.png -> public/assets/arte/fondo-*-3840.webp y fondo-*-1920.webp

- mesa: arte/mesa/mesa-horizontal.png (sobre magenta) y su calco (mesa-horizontal.json, de scripts/calcar-mesa.py)
  -> public/assets/arte/mesa-<ancho>.webp en dos tamaños (recortada a la mesa; abajo llega a la orilla de la imagen
  porque el frente se sale) y client/stage/mesa.json: los tamaños, la proyección del dibujo en px del grande (F, cx,
  cy), la cámara con que se calcó y su silueta (ahí se recorta a los rivales). El juego la pone a la escala
  view.F / F con (cx, cy) como ancla.

- baraja: el arte aprobado de arte/baraja/ (scripts/generar-baraja.py) -> public/assets/arte/carta-reverso.webp (el
  marco del reverso), carta-<rey|reina|jota>-<palo>.webp (la mitad de cada figura con la túnica de su palo) y
  carta-adorno-flor.webp y carta-adorno-banda.webp (las volutas del reverso para el marco de las figuras), y
  client/stage/baraja.json con la zona libre de adentro del marco (ahí pone el código la etiqueta del logo).

- personajes: arte/personajes/<id>/<id>-<ángulo>-<cuadro>.png -> public/assets/arte/<id>-<ángulo>-<cuadro>.webp
  (grande) y <id>-<ángulo>-<cuadro>-chico.webp (mitad, para calidad baja). Ángulos: frente y lado.
  Cuadros: espera, parpadeo, espia, apuesta, retirarse, gana (solo espera es obligatorio; mientras falte
  otro, el juego usa espera). Cada personaje y ángulo es un grupo aparte:
    1. quita el fondo verde o magenta con chroma key (ver abajo); si la imagen ya es transparente, se usa
       tal cual; si el personaje tiene un corte abajo en CORTE_ABAJO (la tarima del pulpo), se aplica;
    2. escala todos los cuadros del grupo al mismo lienzo (deben tener la misma proporción);
    3. los recorta con UNA sola caja común (la unión de lo visible de todos los cuadros);
    4. los reduce con un solo factor: frente a 1000 px de alto como máximo, lado a 1200 px.
  Así todos los cuadros de un grupo salen del mismo tamaño y al cambiar de pose nada brinca.

- brazos: arte/personajes/<id>/<id>-brazo-*.png (ya sin fondo, de generar-personaje.py brazos y aprobar-brazos) ->
  public/assets/arte/<id>-brazo-*.webp y -chico.webp, a ALTO_BRAZOS px de alto como máximo y sin recortar (las anclas
  son fracciones de todo el lienzo), salvo el pulgar, que se recorta a su caja; y escribe su `brazos` en
  client/stage/personajes.json: la caja del pulgar y lo que ocupa cada mano (`mano`) se miden del arte; las anclas, las
  cartas y las fichas son las del relleno de client/stage/arms.js (el arte se dibujó sobre sus siluetas), o las que ya
  estaban.

- gif: arte/revision/<id>-<ángulo>.gif alterna espera con cada uno de los demás cuadros, sobre un fondo
  liso, con el marco de la imagen, la línea de la cintura y la caja de la cara (si ya están registradas).
  Si algo brinca, se ve.

- registrar: agrega o actualiza el personaje en client/stage/personajes.json (lo leen el juego y el
  servidor). Solo escribe el tamaño y la lista de cuadros; el nombre (el que usa el bot de ese personaje),
  la cintura, la cabeza, el alto, hacia dónde mira y las sillas se miden o ponen a mano y nunca se sobrescriben. Un personaje nuevo
  entra con valores provisionales y la marca "pendiente". Entra solo a la mesa: cada bot toma un personaje
  distinto (salvo los que tengan "retirado": true).

CHROMA KEY
----------
El color del fondo se toma de las cuatro esquinas de cada imagen: verde o magenta (se usa el que no tenga el
personaje). De cada píxel se mide cuánto de ese color tiene (verde: G sobre R y B; magenta: R y B sobre G).
El fondo es lo de ese color conectado a la orilla de la imagen (así un morado o un verde dentro del
personaje se respeta, porque la línea de tinta lo separa del fondo), más los huecos encerrados que sean
casi del color del fondo, aunque sean chiquitos (entre los brazos, la silla y los tentáculos). En la orilla
del contorno el alfa sale de cuánto color de fondo tiene cada píxel, y ese color se le quita, para que no
quede halo. Las manchitas sueltas se borran. Al final se cuentan los píxeles visibles que siguen teñidos del
fondo: si hay, se avisa y se deja arte/revision/<id>-<ángulo>-<cuadro>-restos.png con los restos en rojo.
"""
import argparse, glob, json, os, re, shutil, subprocess, sys
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "arte")
OUT = os.path.join(ROOT, "public", "assets", "arte")
REVISION = os.path.join(SRC, "revision")
REGISTRO = os.path.join(ROOT, "client", "stage", "personajes.json")
Q_FONDO, Q_PERSONAJE = 80, 86

ANGULOS = ["frente", "lado"]
CUADROS = ["espera", "parpadeo", "espia", "apuesta", "retirarse", "gana"]   # la misma lista que client/stage/characters.js
OBLIGATORIOS = ["espera"]                                # sin él no hay personaje; los demás se usan cuando existen
COMPLETOS = ["espera", "parpadeo", "apuesta", "retirarse"]   # los de siempre (espia y gana son extras)
# Personajes de cuerpo completo: la mitad de abajo queda bajo la mesa, así que lo visible es la mitad de esto.
ALTO_MAX = {"frente": 1000, "lado": 1200}
NOMBRE = re.compile(rf"^(?P<id>[a-z0-9]+(?:-[a-z0-9]+)*?)-(?P<angulo>{'|'.join(ANGULOS)})-(?P<cuadro>{'|'.join(CUADROS)})$")
# Lo que se quita abajo de cada cuadro, en fracción del alto (mucho más abajo de la cintura: en la mesa no se
# ve). La tarima del pulpo hace su imagen casi del ancho de la pantalla y estorba para acomodar a los rivales.
CORTE_ABAJO = {("pulpo", "frente"): 0.875}

TOL_FONDO = 70      # distancia de color al fondo de la imagen para contar como fondo (conectado a la orilla)
HUECO = 0.3         # cuánto color de fondo (0 a 1) debe tener un hueco encerrado para quitarlo
MIN_HUECO = 1       # px: hasta las rendijas entre las barras de la silla
RESTO = 0.35        # en lo que queda visible, más color de fondo que esto cuenta como resto
BANDA = 3           # px alrededor del fondo donde se calcula el alfa suave y se quita el color del fondo
MIN_MANCHA = 0.0005 # pedazos visibles más chicos que esto (fracción de la imagen) se borran

# Valores provisionales al registrar un ángulo nuevo, para un personaje de cuerpo completo sentado (hay que
# medirlos sobre la imagen; ver CLAUDE.md).
# `mira`: hacia dónde ve la imagen (izquierda, derecha o frente); la de lado, por regla, ve a la derecha.
PROVISIONAL = {
    "frente": {"waist": [0.5, 0.6], "face": [0.25, 0, 0.75, 0.3], "height": 0.8, "mira": "frente"},
    "lado": {"waist": [0.5, 0.6], "face": [0.25, 0, 0.75, 0.3], "height": 0.8, "mira": "derecha"},
}
PENDIENTE = "medir waist, face, height y mira y luego borrar esta línea"


def rel(path):
    return os.path.relpath(path, ROOT)


def escalar(img, w, h):
    """Escala con alfa premultiplicado (sin halos claros en la orilla)."""
    if img.size == (w, h):
        return img
    if img.mode == "RGBA":
        img = img.convert("RGBa")
        fx, fy = img.size[0] / w, img.size[1] / h
        if fx == fy and fx == int(fx):
            img = img.reduce(int(fx))
        else:
            img = img.resize((w, h), Image.LANCZOS)
        return img.convert("RGBA")
    return img.resize((w, h), Image.LANCZOS)


def guardar(img, path, q):
    img.save(path, "WEBP", quality=q, method=6, alpha_quality=90)
    print(f"  {rel(path)}  {img.size[0]}x{img.size[1]}  {os.path.getsize(path) // 1024} KB", flush=True)


# ---------- fondos ----------

def fondos():
    for path in sorted(glob.glob(os.path.join(SRC, "fondo-*.png"))):
        name = os.path.splitext(os.path.basename(path))[0]
        img = Image.open(path).convert("RGB")
        for w in (3840, 1920):
            h = round(img.size[1] * w / img.size[0])
            guardar(escalar(img, w, h), os.path.join(OUT, f"{name}-{w}.webp"), Q_FONDO)


# ---------- mesa ----------

MESA = os.path.join(SRC, "mesa", "mesa-horizontal.png")
MESA_JSON = os.path.join(ROOT, "client", "stage", "mesa.json")


def mesa():
    calco_path = MESA.replace(".png", ".json")
    if not os.path.exists(calco_path):
        sys.exit("Falta el calco: corre primero  .venv-rembg/bin/python scripts/calcar-mesa.py")
    calco = json.load(open(calco_path))
    img = cargar(MESA)
    alfa = np.asarray(img)[..., 3]
    ys, xs = np.nonzero(alfa > 8)
    x0, x1, y0 = max(0, xs.min() - 4), min(img.size[0], xs.max() + 5), max(0, ys.min() - 4)
    img = img.crop((x0, y0, x1, img.size[1]))
    sizes = []
    for f in (1, 0.5):
        w, h = round(img.size[0] * f), round(img.size[1] * f)
        guardar(escalar(img, w, h), os.path.join(OUT, f"mesa-{w}.webp"), Q_PERSONAJE)
        sizes.append([w, h])
    pr = calco["proyeccion"]
    datos = {
        "file": "mesa", "sizes": sizes[::-1],
        "F": pr["F"], "cx": round(pr["cx"] - x0, 2), "cy": round(pr["cy"] - y0, 2),
        "camara": calco["camara"], "mesa": calco["mesa"],
        "silueta": (np.array(calco["silueta"]) - [x0, y0]).round(1).tolist(),
    }
    with open(MESA_JSON, "w") as f:
        json.dump(datos, f, separators=(",", ":"))
        f.write("\n")
    print(f"  {rel(MESA_JSON)}: F {datos['F']}, cx {datos['cx']}, cy {datos['cy']}, cámara {datos['camara']}")


# ---------- baraja ----------

BARAJA = os.path.join(SRC, "baraja")
BARAJA_JSON = os.path.join(ROOT, "client", "stage", "baraja.json")
FIGURAS_BARAJA = {"K": "rey", "Q": "reina", "J": "jota"}
PANEL_FIGURA = (256, 324)   # la mitad de cada figura, al doble de su panel en client/stage/cards.js (128 × 162)


def baraja():
    """El arte aprobado de la baraja (arte/baraja/, de scripts/generar-baraja.py) -> public/assets/arte/carta-*.webp y
    client/stage/baraja.json: los nombres de las figuras y la zona libre de adentro del marco del reverso (donde el
    código pone la etiqueta del logo sin tocar el marco)."""
    falta = []

    def exportar(src, nombre, tam=None):
        path = os.path.join(BARAJA, src)
        if not os.path.exists(path):
            falta.append(src)
            return
        img = Image.open(path)
        img = img.convert("RGBA" if "A" in img.mode else "RGB")
        guardar(escalar(img, *tam) if tam else img, os.path.join(OUT, f"carta-{nombre}.webp"), Q_PERSONAJE)

    exportar("reverso-carta.png", "reverso")
    for fig in FIGURAS_BARAJA.values():
        for palo in "hdcs":
            exportar(f"{fig}-carta-{palo}.png", f"{fig}-{palo}", PANEL_FIGURA)
    exportar("adorno-flor.png", "adorno-flor")
    exportar("adorno-banda.png", "adorno-banda")
    libre = json.load(open(os.path.join(BARAJA, "reverso-carta.json")))["libre"]
    with open(BARAJA_JSON, "w") as f:
        json.dump({"figuras": FIGURAS_BARAJA, "libre": libre}, f, separators=(",", ":"))
        f.write("\n")
    print(f"  {rel(BARAJA_JSON)}: zona libre de {libre['columnas']}×{libre['filas']} celdas")
    if falta:
        print(f"  OJO, faltan en {rel(BARAJA)}/: {', '.join(falta)} (esas cartas se dibujan solo con código)")


# ---------- chroma key ----------

def orillas(a, b=4):
    c = a.shape[-1]
    return np.concatenate([a[:b].reshape(-1, c), a[-b:].reshape(-1, c), a[:, :b].reshape(-1, c), a[:, -b:].reshape(-1, c)])


def ya_transparente(img):
    if img.mode not in ("RGBA", "LA", "PA") and "transparency" not in img.info:
        return False
    alfa = np.asarray(img.convert("RGBA").getchannel("A"))[..., None]
    return (orillas(alfa) < 8).mean() > 0.9


def esquinas(a):
    """Los píxeles de las cuatro esquinas (de ahí sale el color del fondo)."""
    b = max(8, min(a.shape[:2]) // 40)
    return [a[:b, :b].reshape(-1, 3), a[:b, -b:].reshape(-1, 3), a[-b:, :b].reshape(-1, 3), a[-b:, -b:].reshape(-1, 3)]


def tipo_fondo(K):
    """'verde' o 'magenta' según el color K del fondo, o None si no es ninguno de los dos."""
    if K[1] - max(K[0], K[2]) > 100:
        return "verde"
    if min(K[0], K[2]) - K[1] > 100:
        return "magenta"
    return None


def croma(a, K, tipo):
    """Cuánto color de fondo tiene cada píxel: 1 = como el fondo; 0 o menos = nada de ese color."""
    if tipo == "verde":
        return (a[..., 1] - np.maximum(a[..., 0], a[..., 2])) / max(1.0, K[1] - max(K[0], K[2]))
    return (np.minimum(a[..., 0], a[..., 2]) - a[..., 1]) / max(1.0, min(K[0], K[2]) - K[1])


def fondo_de(a, nombre):
    """El color real del fondo de una imagen (mediana de sus cuatro esquinas), si es 'verde' o 'magenta', y las
    esquinas (el generador no siempre da el verde o el magenta exacto)."""
    partes = esquinas(a)
    K = np.median(np.concatenate(partes), axis=0)
    tipo = tipo_fondo(K)
    if not tipo:
        sys.exit(f"{nombre}: el fondo de las esquinas no es verde ni magenta (RGB {K.astype(int).tolist()}).")
    return K, tipo, partes


def quitar_fondo(img, nombre, reportar=True):
    """RGBA sin el fondo. reportar: avisos de esquinas y de restos (generar-personaje.py hace sus propias revisiones)."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    K, tipo, partes = fondo_de(a, nombre)
    for lado, p in zip(["arriba a la izquierda", "arriba a la derecha", "abajo a la izquierda", "abajo a la derecha"], partes):
        if reportar and np.abs(np.median(p, axis=0) - K).max() > 60:
            print(f"  AVISO {nombre}: la esquina de {lado} no es del color del fondo; revisa el resultado")
    dist = np.linalg.norm(a - K, axis=2)
    cr = croma(a, K, tipo)

    # fondo: lo de ese color conectado a la orilla, más los huecos encerrados casi del color del fondo
    lab, _ = ndi.label(dist < TOL_FONDO)
    borde = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    fondo = np.isin(lab, borde[borde > 0])
    lab, n = ndi.label((cr > HUECO) & ~fondo)
    if n:
        areas = ndi.sum(np.ones_like(dist), lab, index=np.arange(1, n + 1))
        fondo |= np.isin(lab, np.arange(1, n + 1)[areas >= MIN_HUECO])

    # orilla: el alfa sale de cuánto color de fondo tiene el píxel
    spill = np.clip(cr, 0, 1)
    # la banda llega hasta la tinta del contorno pero no la atraviesa: con línea delgada, si no, se metería
    # al relleno y un morado o un malva quedarían medio transparentes junto a la línea
    tinta = a @ np.array([0.3, 0.59, 0.11], np.float32) < 60
    banda = ndi.binary_dilation(ndi.binary_dilation(fondo, iterations=BANDA, mask=~tinta)) & ~fondo
    alfa = np.ones((h, w), np.float32)
    alfa[fondo] = 0
    alfa[banda] = 1 - spill[banda]
    alfa[alfa < 0.04] = 0
    # y se le quita el color del fondo: píxel = alfa * color + (1 - alfa) * K
    m = banda & (alfa > 0)
    color = a.copy()
    color[m] = (a[m] - (1 - alfa[m, None]) * K) / alfa[m, None]

    # manchitas sueltas (ruido del JPEG, chispas del generador)
    lab, n = ndi.label(alfa > 0)
    if n > 1:
        areas = ndi.sum(np.ones_like(alfa), lab, index=np.arange(1, n + 1))
        alfa[np.isin(lab, np.arange(1, n + 1)[areas < MIN_MANCHA * h * w])] = 0

    color = np.clip(color, 0, 255)
    if reportar:
        revisar_restos(color, alfa, K, tipo, nombre)
    rgba = np.dstack([color, alfa * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def mascara_restos(color, alfa, K, tipo):
    """Lo visible que sigue teñido del fondo (por ejemplo un hueco que no se quitó)."""
    return (alfa > 0.5) & (croma(color, K, tipo) > RESTO)


def revisar_restos(color, alfa, K, tipo, nombre):
    """Cuenta lo visible que sigue teñido del fondo y, si hay, deja una imagen en arte/revision/ con los restos en
    rojo sobre el personaje en gris."""
    restos = mascara_restos(color, alfa, K, tipo)
    n = int(restos.sum())
    if not n:
        print(f"  {nombre}: fondo {tipo}, sin restos")
        return
    ys, xs = np.where(restos)
    print(f"  AVISO {nombre}: fondo {tipo}, quedan {n} px teñidos del fondo (x {xs.min()}-{xs.max()}, y {ys.min()}-{ys.max()})")
    gris = (color @ np.array([0.3, 0.59, 0.11], np.float32))[..., None].repeat(3, axis=2) * 0.5 + 60
    vista = np.where((alfa > 0)[..., None], gris, 25)
    vista[ndi.binary_dilation(restos, iterations=2)] = (255, 0, 0)
    os.makedirs(REVISION, exist_ok=True)
    destino = os.path.join(REVISION, os.path.splitext(nombre)[0] + "-restos.png")
    Image.fromarray(vista.astype(np.uint8), "RGB").save(destino)
    print(f"    revisa {rel(destino)}")


def cargar(path, reportar=True):
    img = Image.open(path)
    nombre = os.path.basename(path)
    if ya_transparente(img):
        return img.convert("RGBA")
    if reportar and path.lower().endswith((".jpg", ".jpeg")):
        print(f"  AVISO {nombre}: es JPEG; con PNG la orilla sale más limpia")
    return quitar_fondo(img, nombre, reportar)


# ---------- personajes ----------

def entradas(ids=None):
    """{(id, ángulo): {cuadro: ruta}} de arte/personajes/<id>/. Sin ids, todos menos los retirados."""
    grupos = defaultdict(dict)
    retirados = {pid for pid, c in leer_registro().items() if c.get("retirado")}
    for carpeta in sorted(glob.glob(os.path.join(SRC, "personajes", "*"))):
        pid = os.path.basename(carpeta)
        if not os.path.isdir(carpeta) or ids and pid not in ids:
            continue
        if not ids and pid in retirados:   # sus WebP se quedan como están; para rehacerlos hay que nombrarlo
            print(f"  (me salto {pid}: está retirado en {rel(REGISTRO)}; para procesarlo, nómbralo: personajes {pid})")
            continue
        for path in sorted(glob.glob(os.path.join(carpeta, "*"))):
            base, ext = os.path.splitext(os.path.basename(path))
            if ext.lower() not in (".png", ".webp", ".jpg", ".jpeg"):
                continue
            if base.startswith(f"{pid}-brazo-"):   # mis brazos: los exporta el comando brazos
                continue
            m = NOMBRE.match(base)
            if not m or m["id"] != pid:
                print(f"  (me salto {rel(path)}: el nombre debe ser {pid}-<ángulo>-<cuadro>)")
                continue
            grupos[(pid, m["angulo"])][m["cuadro"]] = path
    for pid in ids or []:
        if not any(k[0] == pid for k in grupos):
            sys.exit(f"No encuentro cuadros de '{pid}' en {rel(os.path.join(SRC, 'personajes', pid))}/")
    return grupos


def grupo(pid, angulo, paths):
    """Procesa todos los cuadros de un personaje en un ángulo con la misma caja y la misma escala."""
    if "espera" not in paths:
        sys.exit(f"{pid} {angulo}: falta el cuadro espera (es la base de todos los demás).")
    faltan = [c for c in COMPLETOS if c not in paths]
    if faltan:
        print(f"  {pid} {angulo}: todavía sin {', '.join(faltan)} (mientras, el juego usa espera)")
    imgs, box, tam = preparar(pid, angulo, {c: cargar(paths[c]) for c in CUADROS if c in paths})
    W, H = next(iter(imgs.values())).size
    print(f"{pid} {angulo}: lienzo {W}x{H}, caja común {box}, final {tam[0]}x{tam[1]}")

    for viejo in glob.glob(os.path.join(OUT, f"{pid}-{angulo}-*.webp")):   # por si se quitó un cuadro
        os.remove(viejo)
    for c, i in imgs.items():
        img = escalar(i.crop(box), *tam)
        guardar(img, os.path.join(OUT, f"{pid}-{angulo}-{c}.webp"), Q_PERSONAJE)
        guardar(escalar(img, tam[0] // 2, tam[1] // 2), os.path.join(OUT, f"{pid}-{angulo}-{c}-chico.webp"), Q_PERSONAJE)


def preparar(pid, angulo, imgs):
    """Lleva los cuadros (RGBA, sin fondo) de un personaje en un ángulo al mismo lienzo, aplica CORTE_ABAJO y
    calcula la caja común y el tamaño final. Regresa (cuadros en el lienzo común, caja, tamaño final).
    generar-personaje.py también la usa, para ubicar en la imagen original las medidas de personajes.json."""
    proporciones = {round(i.size[0] / i.size[1], 3) for i in imgs.values()}
    if len(proporciones) > 1:
        sys.exit(f"Los cuadros de {pid} {angulo} tienen proporciones distintas: no se pueden alinear.")
    W = min(i.size[0] for i in imgs.values())
    H = round(W / proporciones.pop())
    imgs = {c: escalar(i, W, H) for c, i in imgs.items()}
    corte = CORTE_ABAJO.get((pid, angulo))
    if corte:   # lo de abajo de la línea se quita (en la mesa no se ve; ver CORTE_ABAJO)
        y = round(corte * H)
        for c, i in imgs.items():
            alfa = np.asarray(i.getchannel("A")).copy()
            alfa[y:] = 0
            i.putalpha(Image.fromarray(alfa))
        print(f"  {pid} {angulo}: corto abajo de y = {y} px ({corte:.0%} del alto)")

    # caja común: unión de lo visible de todos los cuadros, con un margen chico (abajo no: ahí corta la mesa)
    vis = np.zeros((H, W), bool)
    for i in imgs.values():
        vis |= np.asarray(i.getchannel("A")) > 8
    if not vis.any():
        sys.exit(f"{pid} {angulo}: después de quitar el fondo no queda nada visible.")
    ys, xs = np.where(vis)
    m = 6
    box = (max(0, int(xs.min()) - m), max(0, int(ys.min()) - m), min(W, int(xs.max()) + 1 + m), min(H, int(ys.max()) + 1))
    bw, bh = box[2] - box[0], box[3] - box[1]
    f = min(1, ALTO_MAX[angulo] / bh)
    return imgs, box, (round(bw * f), round(bh * f))


def personajes(ids=None, angulo=None):
    grupos = entradas(ids)
    if not grupos:
        print(f"No hay personajes en {rel(os.path.join(SRC, 'personajes'))}/")
    for (pid, ang), paths in sorted(grupos.items()):
        if not angulo or ang == angulo:
            grupo(pid, ang, paths)


# ---------- mis brazos ----------

# Los archivos del arte de mis brazos (ver "Brazos del jugador" en CLAUDE.md): <id>-brazo-<nombre>.png en
# arte/personajes/<id>/, ya sin fondo (scripts/generar-personaje.py brazos les quita el fondo y el papel de las cartas).
ARCHIVOS_BRAZO = ["izq-ver", "izq-ver-pulgar", "izq-ocultar", "izq-vacio", "der-descansar", "der-jugar"]
ALTO_BRAZOS = 1600   # px de alto como máximo: en una pantalla 5K el brazo se ve de unos 1550 px
MUÑECA = 0.05        # la mano llega hasta esto abajo del ancla (fracción del alto); más abajo es el antebrazo
MARGEN_PULGAR = 6    # px alrededor del pulgar al recortarlo


def relleno_brazos():
    """Lo que el juego sabe de mis brazos, leído con node (scripts/brazos-mesa.mjs): las siluetas de relleno de
    client/stage/arms.js (RELLENO, LIENZO, FIGURAS y FICHAS), el tamaño de las cartas y las fichas, el doblez de
    asomarse (FOLD) y dónde caen mis cartas boca abajo en la imagen del brazo izquierdo (CARTAS_MESA). El arte de los
    brazos se dibuja sobre esas siluetas, así que usa su mismo lienzo y sus mismas anclas."""
    r = subprocess.run(["node", os.path.join("scripts", "brazos-mesa.mjs")], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"No pude leer lo de los brazos del juego con node (scripts/brazos-mesa.mjs):\n{r.stderr[-800:]}")
    return json.loads(r.stdout)


def caja_visible(alfa, hasta=None):
    """La caja [izquierda, arriba, derecha, abajo] en fracciones de lo visible, solo de la fila `hasta` para arriba."""
    a = alfa > 127
    if hasta is not None:
        a = a[:hasta]
    ys, xs = np.where(a)
    h, w = alfa.shape
    return [xs.min() / w, ys.min() / h, (xs.max() + 1) / w, (ys.max() + 1) / h]


def brazos(pid, entrega=None):
    """arte/personajes/<id>/<id>-brazo-*.png -> public/assets/arte/<id>-brazo-*.webp (grande y -chico) y su `brazos`
    en personajes.json: el tamaño y los archivos; lo que ocupa cada mano (`mano`, de la punta de los dedos a MUÑECA
    abajo del ancla, en todas sus poses) y el pulgar, recortado a su caja, se miden del arte; las anclas, las cartas y
    las fichas son las del relleno (el arte se dibujó sobre sus siluetas) o, si ya estaban, se quedan. Con `entrega`
    (una carpeta) no toca el juego: deja en <entrega>/<id>/ los PNG, webp/ (grande y -chico) y brazos.json."""
    src = os.path.join(SRC, "personajes", pid)
    paths = {n: os.path.join(src, f"{pid}-brazo-{n}.png") for n in ARCHIVOS_BRAZO}
    faltan = [rel(p) for p in paths.values() if not os.path.exists(p)]
    if faltan:
        sys.exit("Faltan imágenes de los brazos (todo o nada):\n  " + "\n  ".join(faltan))
    imgs = {n: Image.open(p).convert("RGBA") for n, p in paths.items()}
    if len({i.size for i in imgs.values()}) > 1:
        sys.exit(f"{pid}: las imágenes de los brazos no miden lo mismo: {sorted({i.size for i in imgs.values()})}")
    w, h = next(iter(imgs.values())).size
    k = min(1, ALTO_BRAZOS / h)
    tam = (round(w * k), round(h * k))

    datos = leer_registro()
    if pid not in datos:
        sys.exit(f"{pid} no está en {rel(REGISTRO)}: primero registrar.")
    R, previo = relleno_brazos()["RELLENO"], datos[pid].get("brazos") or {}
    izq, der = previo.get("izquierdo") or R["izquierdo"], previo.get("derecho") or R["derecho"]

    # lo que ocupa cada mano, en todas sus poses (para que las apuestas y el dealer no queden debajo)
    alfas = {n: np.asarray(img)[..., 3] for n, img in imgs.items()}
    def mano(lado, nombres):
        cajas = [caja_visible(alfas[n], round((lado["ancla"][1] + MUÑECA) * h)) for n in nombres]
        return [round(min(c[0] for c in cajas), 3), round(min(c[1] for c in cajas), 3),
                round(max(c[2] for c in cajas), 3), round(max(c[3] for c in cajas), 3)]
    mano_izq = mano(izq, ["izq-ver", "izq-ocultar", "izq-vacio"])
    mano_der = mano(der, ["der-descansar", "der-jugar"])
    # el pulgar, recortado a su caja (con un margen): el juego lo pone en esa caja sobre el brazo
    ys, xs = np.where(alfas["izq-ver-pulgar"] > 0)
    x0, y0 = max(0, xs.min() - MARGEN_PULGAR), max(0, ys.min() - MARGEN_PULGAR)
    x1, y1 = min(w, xs.max() + 1 + MARGEN_PULGAR), min(h, ys.max() + 1 + MARGEN_PULGAR)
    imgs["izq-ver-pulgar"] = imgs["izq-ver-pulgar"].crop((x0, y0, x1, y1))
    caja_pulgar = [x0 / w, y0 / h, x1 / w, y1 / h]

    out = os.path.join(entrega, pid, "webp") if entrega else OUT
    os.makedirs(out, exist_ok=True)
    for n, img in imgs.items():
        t = tuple(max(1, round(v * k)) for v in img.size)
        guardar(escalar(img, *t), os.path.join(out, f"{pid}-brazo-{n}.webp"), Q_PERSONAJE)
        guardar(escalar(img, max(1, t[0] // 2), max(1, t[1] // 2)), os.path.join(out, f"{pid}-brazo-{n}-chico.webp"),
                Q_PERSONAJE)

    archivo = lambda n: f"{pid}-brazo-{n}"
    bloque = {
        "izquierdo": {"size": list(tam), "ancla": izq["ancla"], "alto": izq["alto"], "mano": mano_izq, "poses": {
            "ver": {"archivo": archivo("izq-ver"), "cartas": izq["poses"]["ver"]["cartas"],
                    "pulgar": {"archivo": archivo("izq-ver-pulgar"), "caja": [round(v, 4) for v in caja_pulgar]}},
            "ocultar": {"archivo": archivo("izq-ocultar")}, "vacio": {"archivo": archivo("izq-vacio")}}},
        "derecho": {"size": list(tam), "ancla": der["ancla"], "alto": der["alto"], "mano": mano_der, "poses": {
            "descansar": {"archivo": archivo("der-descansar")},
            "jugar": {"archivo": archivo("der-jugar"), "fichas": der["poses"]["jugar"]["fichas"]}}},
    }
    if entrega:
        carpeta = os.path.join(entrega, pid)
        for p in paths.values():
            shutil.copy2(p, carpeta)
        with open(os.path.join(carpeta, "brazos.json"), "w") as f:
            f.write(a_texto(bloque) + "\n")
        print(f"Los brazos de {pid}, listos para el juego, en {carpeta}/ (el juego no cambió).")
        return
    datos[pid]["brazos"] = bloque
    escribir_registro(datos)
    print(f"{'Actualizados' if previo else 'Agregados'} los brazos de {pid} en {rel(REGISTRO)} ({tam[0]}x{tam[1]}). "
          "Recarga la página: mis brazos ya son su arte.")


# ---------- GIF de revisión ----------

def cuadros_publicados(pid, angulo):
    return [c for c in CUADROS if os.path.exists(os.path.join(OUT, f"{pid}-{angulo}-{c}.webp"))]


def gif(pid, angulo=None):
    reg = leer_registro().get(pid, {}).get("angles", {})
    hechos = 0
    for ang in [angulo] if angulo else ANGULOS:
        cuadros = cuadros_publicados(pid, ang)
        if not cuadros:
            continue
        # espera, parpadeo, espera, espia, espera, apuesta, ...: cada cuadro contra la base
        orden = ["espera"] + [x for c in cuadros if c != "espera" for x in (c, "espera")]
        imgs = {c: Image.open(os.path.join(OUT, f"{pid}-{ang}-{c}.webp")).convert("RGBA") for c in cuadros}
        destino = os.path.join(REVISION, f"{pid}-{ang}.gif")
        dibujar_gif(imgs, orden, destino, reg.get(ang, {}).get("waist"), reg.get(ang, {}).get("face"))
        print(f"  {rel(destino)}  ({', '.join(orden)})")
        hechos += 1
    if not hechos:
        sys.exit(f"No hay cuadros optimizados de '{pid}' en {rel(OUT)}/: corre antes  personajes {pid}")


def dibujar_gif(imgs, orden, destino, cintura=None, cara=None, duracion=600):
    """GIF con los cuadros en ese orden sobre la pared del garaje, con el marco de la imagen, la línea de la cintura
    y la caja de la cara. imgs: {cuadro: RGBA ya recortado como en el juego}; duracion: ms por foto, o una lista
    (generar-personaje.py la usa con el ritmo del parpadeo del juego)."""
    w, h = imgs[orden[0]].size
    if h > 800:   # el GIF de lado se ve a menos tamaño; la alineación se nota igual
        w, h = round(w * 800 / h), 800
        imgs = {c: escalar(i, w, h) for c, i in imgs.items()}
    pad = 24
    fotos = []
    for c in orden:
        lienzo = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (117, 97, 76, 255))   # pared del garaje
        lienzo.alpha_composite(imgs[c], (pad, pad))
        d = ImageDraw.Draw(lienzo)
        d.rectangle((pad - 1, pad - 1, pad + w, pad + h), outline=(239, 228, 200, 255))
        if cintura:   # donde la corta la mesa (y el punto que va en la orilla)
            y = pad + round(cintura[1] * h)
            d.line((0, y, w + 2 * pad, y), fill=(201, 160, 58, 255), width=1)
            x = pad + round(cintura[0] * w)
            d.ellipse((x - 4, y - 4, x + 4, y + 4), outline=(201, 160, 58, 255), width=2)
        if cara:      # la caja de la cabeza, que ninguna etiqueta tapa
            d.rectangle((pad + round(cara[0] * w), pad + round(cara[1] * h), pad + round(cara[2] * w), pad + round(cara[3] * h)),
                        outline=(164, 69, 47, 255), width=2)
        d.text((6, 6), c, fill=(239, 228, 200, 255))
        fotos.append(lienzo.convert("RGB"))
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    fotos[0].save(destino, save_all=True, append_images=fotos[1:], duration=duracion, loop=0)


# ---------- registro (client/stage/personajes.json) ----------

def leer_registro():
    if not os.path.exists(REGISTRO):
        return {}
    with open(REGISTRO) as f:
        return json.load(f)


def a_texto(datos):
    """JSON con las listas en una sola línea, para que se lea como el resto del código."""
    texto = json.dumps(datos, indent=2, ensure_ascii=False)
    return re.sub(r"\[\s+([^\[\]{}]*?)\s+\]", lambda m: "[" + re.sub(r",\s+", ", ", m[1]) + "]", texto)


def escribir_registro(datos):
    with open(REGISTRO, "w") as f:
        f.write(a_texto(datos) + "\n")


def registrar(pid, nombre=None):
    datos = leer_registro()
    nuevo = pid not in datos
    c = datos.setdefault(pid, {"name": nombre or pid.capitalize(), "angles": {}})
    if nombre:
        c["name"] = nombre
    for ang in ANGULOS:
        cuadros = cuadros_publicados(pid, ang)
        if not cuadros:
            if ang in c["angles"]:
                print(f"  AVISO {pid} {ang}: está registrado pero no hay imágenes en {rel(OUT)}/")
            continue
        if "espera" not in cuadros:
            sys.exit(f"{pid} {ang}: falta el cuadro espera.")
        size = list(Image.open(os.path.join(OUT, f"{pid}-{ang}-espera.webp")).size)
        previo = c["angles"].get(ang) or {**PROVISIONAL[ang], "pendiente": PENDIENTE}
        c["angles"][ang] = {"size": size, "waist": previo["waist"], "face": previo["face"], "height": previo["height"],
                            "mira": previo.get("mira", PROVISIONAL[ang]["mira"]), "frames": cuadros,
                            **({"pendiente": previo["pendiente"]} if "pendiente" in previo else {})}
        # lo que el registro no calcula (como las franjas de las cartas, de generar-personaje.py aprobar-cartas) se queda
        c["angles"][ang].update({k: v for k, v in previo.items() if k not in c["angles"][ang]})
        faltan = [x for x in COMPLETOS if x not in cuadros]
        print(f"  {pid} {ang}: {size[0]}x{size[1]}, cuadros {', '.join(cuadros)}"
              + (f"  (todavía sin {', '.join(faltan)}: mientras, se usa espera)" if faltan else ""))
    if "frente" not in c["angles"]:
        sys.exit(f"{pid}: hace falta el ángulo frente (es el que se usa cuando no hay lado). No registré nada.")
    escribir_registro(datos)
    print(f"{'Agregado' if nuevo else 'Actualizado'} {pid} ({c['name']}) en {rel(REGISTRO)}")
    for ang, a in c["angles"].items():
        if "pendiente" in a:
            print(f"  PENDIENTE {ang}: waist, face, height y mira son provisionales; mídelos y borra \"pendiente\".")
    if c.get("retirado"):
        print("  Está marcado \"retirado\": el juego no lo usa hasta que quites esa línea.")
    else:
        print(f"  Ya entra a la mesa: el bot que lo use se llama \"{c['name']}\" (cambia el nombre con --nombre).")


def main():
    ap = argparse.ArgumentParser(description="Optimiza el arte para el juego (sin comando: fondos y todos los personajes).")
    sub = ap.add_subparsers(dest="comando")
    sub.add_parser("fondos", help="fondos del cuarto")
    sub.add_parser("mesa", help="la mesa ilustrada (después de scripts/calcar-mesa.py)")
    sub.add_parser("baraja", help="el arte aprobado de la baraja (arte/baraja/) y client/stage/baraja.json")
    p = sub.add_parser("personajes", help="quita el fondo verde o magenta, recorta, reduce y exporta en WebP")
    p.add_argument("ids", nargs="*", help="personajes a procesar (todos si no se pone ninguno)")
    p.add_argument("--angulo", choices=ANGULOS)
    g = sub.add_parser("gif", help="GIF de revisión por ángulo en arte/revision/")
    g.add_argument("id")
    g.add_argument("--angulo", choices=ANGULOS)
    r = sub.add_parser("registrar", help="agrega o actualiza el personaje en client/stage/personajes.json")
    r.add_argument("id")
    r.add_argument("--nombre", help='nombre del bot que usa este personaje, por ejemplo "El Compadre Zorg"')
    b = sub.add_parser("brazos", help="mis brazos de un personaje (arte/personajes/<id>/<id>-brazo-*.png) y su "
                       "`brazos` en client/stage/personajes.json")
    b.add_argument("id")
    b.add_argument("--entrega", help="en vez de tocar el juego, dejarlos en esta carpeta (una subcarpeta por personaje)")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    if args.comando in (None, "fondos"):
        fondos()
    if args.comando == "mesa":
        mesa()
    if args.comando == "baraja":
        baraja()
    if args.comando in (None, "personajes"):
        personajes(getattr(args, "ids", None) or None, getattr(args, "angulo", None))
    if args.comando == "gif":
        gif(args.id, args.angulo)
    if args.comando == "registrar":
        registrar(args.id, args.nombre)
    if args.comando == "brazos":
        brazos(args.id, args.entrega)


if __name__ == "__main__":
    main()
