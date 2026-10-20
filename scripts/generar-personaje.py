"""Genera con Gemini los cuadros de un personaje editando su base aprobada, una zona a la vez.

Sigue docs/ESPEC-PERSONAJES.md. Nunca genera desde cero: la base es arte/personajes/<id>/<id>-frente-espera.png
(ya aprobada) y cada cuadro es uno o dos cambios a esa base, uno por llamada. De cada llamada solo se toma la zona
que debe cambiar (los ojos, o los brazos, las manos y las cartas); todo lo demás sale de la base píxel por píxel.
Así nada brinca al cambiar de cuadro, y el ruido del JPEG que entrega la API queda solo en lo que cambió.

USO (desde la carpeta poker-for-the-players/, con el entorno de recortar.py)
----------------------------------------------------------------------------
Una sola vez:

    .venv-rembg/bin/pip install google-genai
    # y poner la API key en .env:  GEMINI_API_KEY=...

1. Ver los prompts, las zonas y el costo estimado, sin gastar nada (deja zona-<cuadro>.png para ver la zona):

       .venv-rembg/bin/python scripts/generar-personaje.py generar alien --pose frente-parpadeo --simular

2. Generar (pide confirmación antes de gastar):

       .venv-rembg/bin/python scripts/generar-personaje.py generar alien --pose frente-parpadeo

   Sin --pose genera los cuadros de siempre que no estén aprobados (parpadeo, apuesta, retirarse); espia y gana,
   con --pose. Cada vez sale una versión nueva (-v2, -v3...): nada se sobrescribe.

3. Revisar en arte/generadas/<id>/: el cuadro (<id>-frente-<cuadro>.png), su GIF como se verá en el juego
   (.gif) y la hoja -comparacion.jpg (la base, lo que regresó Gemini, el cuadro y qué cambió).

4. Pasar el aprobado a arte/personajes/<id>/ (respalda en arte/respaldos/ lo que reemplace) y al juego:

       .venv-rembg/bin/python scripts/generar-personaje.py aprobar alien --pose frente-parpadeo
       .venv-rembg/bin/python scripts/optimizar-arte.py personajes alien
       .venv-rembg/bin/python scripts/optimizar-arte.py registrar alien

CÓMO SE ARMA CADA CUADRO
------------------------
- Ficha del personaje, scripts/fichas/<id>.toml: fondo, ojos y cómo parpadea, a dónde mira, sonrisa, manos, color
  de las fichas de póker, partes opacas y rasgos que deben quedar igual. Con "pendiente" no se gasta.
- Prompts, scripts/prompts-personaje.toml: cada cuadro es una lista de cambios; cada cambio, UNA llamada que edita
  la base, con su zona:
    cara    la caja "face" de client/stage/personajes.json (parpadeo, espia y la sonrisa de gana)
    brazos  de la barbilla a un poco abajo de la cintura (apuesta, retirarse y los brazos de gana)
  Las medidas de personajes.json son fracciones de la imagen ya recortada para el juego: se pasan a la base con la
  misma caja de recorte que calcula optimizar-arte.py. De la zona solo se toman los píxeles que de verdad cambiaron
  (más de UMBRAL), sin las motas sueltas del JPEG (menos de MIN_PARTE px), sin huecos y con borde suave.
- Revisiones antes de enseñar nada. Si una falla, se reintenta una vez con una frase sobre lo que falló; si vuelve a
  fallar, el cuadro se guarda como -FALLA.png y se avisa. Máximo MAX_LLAMADAS peticiones por cambio, cuenten o no
  (también las que la API rechaza o que se pasan de tiempo):
    alineacion  la silueta de Gemini coincide con la base fuera de la zona (si no, la mezcla tendría costuras)
    costura     alrededor de lo que se toma, Gemini y la base casi no difieren, y nada cruza el borde de la zona
    cambio      sí cambió algo en la zona, y en la cara no de más
    fondo       con el chroma key del juego, ni restos teñidos del fondo ni manchas sueltas nuevas
    texto       el OCR de macOS (scripts/ocr.swift, se compila solo la primera vez) no lee letras ni números nuevos
    caja        lo visible no se sale de la caja de recorte (si no, cambiarían el recorte y las medidas del juego)
- A la API siempre se le manda la base completada a cuadrado con su color de fondo (blob y turista miden 1024x559)
  y se pide 1:1, la única salida que mide justo lo pedido; al regresar se recorta.
- Solo el ángulo frente. La base de lado será la única excepción a "nunca desde cero": se generará a partir de la de
  frente y se aprueba antes de generar sus cuadros (ver docs/ESPEC-PERSONAJES.md).

CARTAS: EL REVERSO DE LA BARAJA Y EL MISMO TAMAÑO PARA TODOS
-----------------------------------------------------------
El comando cartas edita la espera aprobada (la única vez que se toca la base) para que las cartas de la mano lleven el
reverso de la baraja y midan en la mesa lo mismo para todos (CARTA_MESA de ancho). Gemini respeta la forma de lo que
recibe y no cambia tamaños si se le piden, así que las cartas se dibujan por código (entrada_dibujada): las viejas se
tapan, las nuevas van con el reverso aprobado (arte/baraja/reverso-carta.png) y la franja de la etiqueta vacía, al
ancho objetivo, y los dedos que estaban encima se quedan encima, sin tapar las franjas. Gemini solo redibuja las manos
y los antebrazos alrededor; la zona es caja_cartas (crecida si las cartas crecen) más caja_manos, y de ella solo se
toma lo que cambió contra el dibujo. Además de las revisiones de siempre: el ancho medido (TOL_TAMANO), cada franja
visible y del rojo de la etiqueta (FRANJA_MIN), los dedos encima de la carta (DEDOS_MIN), sin restos del azul viejo,
el rojo entero con el chroma key y la misma caja de recorte. Si el dibujo mismo no pasa, no se gasta. El parpadeo no
se genera: sus ojos cerrados se pegan sobre la espera nueva. Las letras de la franja las pone el juego con etiqueta()
de client/stage/cards.js, con las franjas que aprobar-cartas anota en client/stage/personajes.json.

    .venv-rembg/bin/python scripts/generar-personaje.py cartas --simular          # la tabla y los dibujos, sin gastar
    .venv-rembg/bin/python scripts/generar-personaje.py cartas blob               # genera (pide confirmación)
    .venv-rembg/bin/python scripts/generar-personaje.py aprobar-cartas blob       # espera, parpadeo y franjas
"""
import argparse, base64, glob, importlib.util, io, json, os, re, shutil, subprocess, sys, tempfile, threading, time, tomllib
from datetime import datetime

sys.dont_write_bytecode = True   # optimizar-arte.py se carga como módulo: que no deje __pycache__ en scripts/
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTE = os.path.join(ROOT, "arte")
PROMPTS = os.path.join(ROOT, "scripts", "prompts-personaje.toml")
FICHAS = os.path.join(ROOT, "scripts", "fichas")
OCR_FUENTE = os.path.join(ROOT, "scripts", "ocr.swift")
OCR_BINARIO = os.path.join(ROOT, ".venv-rembg", "bin", "ocr-texto")

# el mismo chroma key, la misma caja de recorte y el mismo GIF que usa el juego
_spec = importlib.util.spec_from_file_location("optimizar_arte", os.path.join(ROOT, "scripts", "optimizar-arte.py"))
OPT = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OPT)

ANGULOS = ["frente"]   # lado: cuando exista su base aprobada (ver docs/ESPEC-PERSONAJES.md)
POSES = [c for c in OPT.CUADROS if c != "espera"]   # espera es la base: nunca se genera
DE_SIEMPRE = ["parpadeo", "apuesta", "retirarse"]   # los que genera si no dices --pose (espia y gana son extras)
MAX_LLAMADAS = 2       # peticiones por cambio, cuenten o no
UMBRAL = 40            # diferencia por canal (0 a 255) para contar un píxel como cambiado
MIN_PARTE = 40         # px: una parte cambiada más chica y suelta es ruido del JPEG, no el cambio pedido
MARGEN_CINTURA = 0.06  # la zona de brazos baja esto de la cintura (fracción del alto de la caja de recorte)
PARPADEO_MS = [1500, 150]   # GIF del parpadeo: ojos abiertos y cerrados (en el juego, 150 ms cada 3 a 6 s)

# USD, de ai.google.dev/gemini-api/docs/pricing (octubre 2026). imagen: por imagen de salida (para estimar);
# imagen_token, entrada y texto (incluye "thinking"): por millón de tokens (para el costo con la respuesta).
PRECIOS = {
    "gemini-nano-banana-2.1": {"imagen": {"1K": 0.0336, "2K": 0.0504, "4K": 0.113}, "imagen_token": 30.00,
                               "entrada": 1.50, "texto": 7.50},
    "gemini-3.1-flash-image": {"imagen": {"1K": 0.067, "2K": 0.101, "4K": 0.151}, "imagen_token": 60.00,
                               "entrada": 0.50, "texto": 3.00},
    "gemini-3-pro-image": {"imagen": {"1K": 0.134, "2K": 0.134, "4K": 0.24}, "imagen_token": 120.00,
                           "entrada": 2.00, "texto": 12.00},
}
TOKENS_POR_IMAGEN_ENTRADA = 1120   # lo que cobró la API por una base de 1024 px
TOKENS_TEXTO_ESTIMADOS = 650       # thinking y otra salida por llamada (la edición de las cartas usó 641)

# límites de las revisiones (calibrados con la edición de las cartas del alien, que pasa todas)
ORILLA = 2             # px de la orilla de la silueta que no cuentan (el JPEG la mueve siempre)
SILUETA_MAX = 0.002    # fracción de la silueta de la base que puede no coincidir fuera de la zona y de la orilla
COSTURA_DIF = 25       # alrededor de lo que se toma, diferencia que ya cuenta como costura...
COSTURA_MAX = 0.10     # ...y fracción de ese contorno que puede tenerla
CORTE_MAX = 20         # px con cambio fuerte justo afuera de la zona, junto a lo que se toma (algo la cruza)
MIN_CAMBIO = 150       # px cambiados en la zona para contar como cambio
CARA_MAX = 0.40        # fracción de la caja de la cara que puede cambiar
CERCANOS_MAX = 30      # px nuevos de un color cercano al del fondo (más ya es una parte que se volvería agujero)

# cartas: el ancho de las cartas en la mano, en unidades de la mesa (la mediana de lo que medían en las seis bases; la
# baraja de la mesa, CARD_W en client/stage/items.js, mide 0.1 porque se dibuja más grande para que se lea)
CARTA_MESA = 0.070
RIVALES = 1.6          # CAMERAS.landscape.rivals de client/stage/config.js: los rivales se dibujan height × 1.6
REVERSO = os.path.join(ARTE, "baraja", "reverso-carta.png")   # el reverso aprobado: el marco, sin la etiqueta
TOL_TAMANO = 0.06      # diferencia permitida entre el ancho medido y el objetivo (el medidor se equivoca ~2 %)
MARGEN_CARTAS = 10     # px alrededor de las cartas (ya crecidas, si crecen) en la zona
CONTORNO = 3           # px por lado de la tinta alrededor de las cartas (la de las bases): el medidor mide la cara sin
                       # ella, y las cartas dibujadas la llevan de este grueso
AZUL_MAX = 30          # px del azul marino viejo que pueden quedar en la zona
ROJO_MAX = 10          # px del marco rojo que el chroma key puede volver transparentes (lejos de la orilla del fondo)
LUMA = np.array([0.3, 0.59, 0.11], np.float32)


# ---------- archivos ----------

def rel(path):
    return os.path.relpath(path, ROOT)


def carpeta(pid):
    return os.path.join(ARTE, "generadas", pid)


def aprobado(pid, angulo, cuadro):
    return os.path.join(ARTE, "personajes", pid, f"{pid}-{angulo}-{cuadro}.png")


def versiones(pid, nombre):
    """Las versiones de un cuadro que pasaron las revisiones: {n: ruta} (<nombre>.png, <nombre>-v2.png...)."""
    patron = re.compile(rf"^{re.escape(nombre)}(?:-v(\d+))?\.png$")
    d = carpeta(pid)
    return {int(m.group(1) or 1): os.path.join(d, f) for f in (os.listdir(d) if os.path.isdir(d) else [])
            if (m := patron.match(f))}


def siguiente_version(pid, nombre):
    """El número de una generación nueva: después de todo lo que ya hay de ese cuadro, también lo que falló."""
    patron = re.compile(rf"^{re.escape(nombre)}(?:-v(\d+))?(?:-.+)?\.(?:png|jpg|gif)$")
    d = carpeta(pid)
    ns = [int(m.group(1) or 1) for f in (os.listdir(d) if os.path.isdir(d) else []) if (m := patron.match(f))]
    return max(ns) + 1 if ns else 1


def con_version(nombre, n):
    return nombre + (f"-v{n}" if n > 1 else "")


def gastado_en_total():
    """USD de todas las llamadas anotadas en arte/generadas/*/registro.jsonl."""
    total = 0
    for path in glob.glob(os.path.join(ARTE, "generadas", "*", "registro.jsonl")):
        with open(path) as f:
            total += sum(json.loads(linea).get("costo_usd") or 0 for linea in f if linea.strip())
    return total


# ---------- ficha y prompts ----------

def cargar_toml(path):
    with open(path, "rb") as f:
        return tomllib.load(f)


def cargar_ficha(pid):
    path = os.path.join(FICHAS, f"{pid}.toml")
    if not os.path.exists(path):
        sys.exit(f"Falta la ficha {rel(path)}: copia la de otro personaje y ajústala.")
    return cargar_toml(path)


def limpiar(texto):
    return " ".join(texto.split())


def prompt_de(P, ficha, cambio, correcciones=()):
    """El prompt de un cambio: [edicion] con el texto del cambio, lo que se queda igual en su zona y la ficha."""
    valores = dict(ficha, rasgos="".join(f", {r}" for r in ficha.get("rasgos", [])))
    opacas = ficha.get("opacas", [])
    valores["opacas"] = P["edicion"]["opacas"].format(lista=", ".join(opacas)) if opacas else ""
    try:
        valores["cambio"] = limpiar(cambio["texto"]).format_map(valores)
        valores["se_queda"] = P["zonas"][cambio["zona"]]["se_queda"].format_map(valores)
        prompt = limpiar(P["edicion"]["texto"]).format_map(valores)
    except KeyError as e:
        sys.exit(f"A la ficha le falta {e}, que pide el prompt de la zona {cambio['zona']}.")
    return " ".join([prompt] + [P["correcciones"][c] for c in correcciones])


# ---------- zonas ----------

def medidas(pid, angulo, base):
    """Las zonas en píxeles de la base: la cara (caja "face" de personajes.json), los brazos (de la barbilla a un poco
    abajo de la cintura) y la caja de recorte del juego, calculada por optimizar-arte.py con los cuadros aprobados."""
    reg = OPT.leer_registro().get(pid, {}).get("angles", {}).get(angulo)
    if not reg:
        sys.exit(f"{pid} {angulo} no está en {rel(OPT.REGISTRO)}: primero optimizar-arte.py personajes y registrar.")
    if "pendiente" in reg:
        sys.exit(f"{pid} {angulo}: sus medidas en personajes.json son provisionales (\"pendiente\"): mídelas antes.")
    aprobados = OPT.entradas([pid]).get((pid, angulo), {})
    lienzo, box, tam = OPT.preparar(pid, angulo, {c: OPT.cargar(p, reportar=False) for c, p in aprobados.items()})
    if list(tam) != reg["size"]:
        sys.exit(f"{pid} {angulo}: el tamaño registrado {reg['size']} no es el de sus cuadros aprobados {list(tam)}. "
                 f"Corre optimizar-arte.py personajes {pid} y registrar {pid}.")
    k = base.size[0] / next(iter(lienzo.values())).size[0]   # del lienzo común a la base (1 si miden lo mismo)
    bw, bh = box[2] - box[0], box[3] - box[1]
    px = lambda fx, fy: (round((box[0] + fx * bw) * k), round((box[1] + fy * bh) * k))
    f = reg["face"]
    cara = (*px(f[0], f[1]), *px(f[2], f[3]))
    abajo = min(base.size[1], px(*reg["waist"])[1] + round(MARGEN_CINTURA * bh * k))
    return {"cara": cara, "brazos": (0, cara[3], base.size[0], abajo), "box": tuple(round(v * k) for v in box),
            "reg": reg, "pid": pid, "angulo": angulo}


def vista_zona(base, zona, nombre_zona, destino):
    """La base con la zona que se tomará de Gemini marcada encima (para revisarla con --simular)."""
    img = base.convert("RGBA")
    capa = Image.new("RGBA", img.size, (0, 0, 0, 0))
    color = (255, 220, 0) if nombre_zona == "cara" else (0, 200, 255)
    ImageDraw.Draw(capa).rectangle(zona, fill=color + (70,), outline=color + (255,), width=4)
    img.alpha_composite(capa)
    img.convert("RGB").save(destino)


def sin_motas(cambio):
    """Quita las partes cambiadas sueltas y chiquitas (ruido del JPEG en las orillas, no el cambio pedido), salvo las
    que están junto a un cambio grande: esas son pedazos del mismo cambio."""
    lab, n = ndi.label(cambio)
    if not n:
        return cambio
    tam = ndi.sum(cambio, lab, index=np.arange(1, n + 1))
    grandes = np.isin(lab, np.arange(1, n + 1)[tam >= MIN_PARTE])
    return grandes | (cambio & ndi.binary_dilation(grandes, iterations=6))


def componer(base, gen, zona, sobre=None):
    """Toma de gen solo lo que cambió de verdad respecto a la base dentro de la zona (sin huecos, ensanchado unos
    píxeles y con borde suave) y lo pone sobre `sobre` (la base, o el cuadro con los cambios anteriores)."""
    A = np.asarray(base).astype(np.int16)
    d = np.abs(A - np.asarray(gen).astype(np.int16)).max(axis=2)
    z = np.zeros(d.shape, bool)
    x0, y0, x1, y1 = zona
    z[y0:y1, x0:x1] = True
    cambio = sin_motas((d > UMBRAL) & z)
    m = Image.fromarray(cambio.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(5))
    tomado = (np.asarray(m) > 0) & z
    M = np.asarray(Image.fromarray(tomado.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(1.5)))
    M = (M.astype(np.float32) / 255 * z)[..., None]
    S = np.asarray(sobre if sobre is not None else base).astype(np.float32)
    final = (S * (1 - M) + np.asarray(gen).astype(np.float32) * M).round().astype(np.uint8)
    return Image.fromarray(final), {"d": d, "z": z, "cambio": cambio, "tomado": tomado}



CARTA_IGUAL = 60   # dentro de las cartas nuevas: diferencia por canal hasta la que Gemini se quedó con la carta del dibujo


def componer_cartas(base, entrada, gen, zona, datos):
    """La combinada de cartas. De la respuesta de Gemini se toma lo que cambió contra la base dentro de la zona, como en
    componer (las manos redibujadas, el cuerpo donde estaban las cartas viejas y las cartas nuevas), y todo lo demás es
    la base píxel por píxel; luego, dentro de las cartas nuevas, donde Gemini dejó la carta (no puso un dedo encima) va
    la carta exacta del dibujo. (Componer contra el dibujo dejaba parches del relleno: donde Gemini pintó el cuerpo
    limpio con un color parecido al del relleno, no pasaba del umbral.)"""
    cand, mz = componer(base, gen, zona)
    E, G, C = (np.asarray(i).astype(np.float32) for i in (entrada, gen, cand))
    en_cartas = np.zeros(E.shape[:2], bool)
    for n in datos["nuevas"]:   # cada carta con su contorno
        en_cartas |= _mascara_poligono(poligono_carta({**n, "u0": n["u0"] - CONTORNO, "v0": n["v0"] - CONTORNO,
                                                       "W": n["W"] + 2 * CONTORNO, "H": n["H"] + 2 * CONTORNO}), base.size)
    carta = en_cartas & (np.abs(G - E).max(axis=2) <= CARTA_IGUAL)
    # adentro de las cartas, lo distinto que queda suelto y chico (motas, el redibujo de Gemini de las líneas finas del
    # marco) también es la carta del dibujo; lo que toca una parte grande (un dedo encima) se queda
    adentro = ndi.binary_erosion(en_cartas, iterations=CONTORNO + 2)
    distinto = adentro & ~carta
    lab, n = ndi.label(distinto, structure=np.ones((3, 3)))
    if n:
        tam = ndi.sum(distinto, lab, index=np.arange(1, n + 1))
        grandes = np.isin(lab, np.arange(1, n + 1)[tam >= 60])
        cerca = ndi.binary_dilation(grandes, iterations=2)
        chicas = np.isin(lab, np.arange(1, n + 1)[tam < 20]) & ~cerca
        carta |= chicas
    M = np.asarray(Image.fromarray(carta.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(0.7))).astype(np.float32)
    M = (M / 255 * en_cartas)[..., None]
    return Image.fromarray((C * (1 - M) + E * M).round().astype(np.uint8)), mz

# ---------- revisiones ----------

def sin_fondo(img):
    """RGBA sin el fondo (el chroma key del juego) y lo visible que sigue teñido del fondo."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    K, tipo, _ = OPT.fondo_de(a, "cuadro")
    rgba = OPT.quitar_fondo(img, "cuadro", reportar=False)
    r = np.asarray(rgba).astype(np.float32)
    return rgba, OPT.mascara_restos(r[..., :3], r[..., 3] / 255, K, tipo)


def cercanos_al_fondo(img):
    """Píxeles de un color cercano al del fondo sin ser fondo (rosas o morados con fondo magenta, verdes con fondo
    verde), lejos de la orilla de cualquier fondo: el chroma key del juego los volvería agujeros o los dejaría teñidos."""
    a = np.asarray(img).astype(np.float32)
    K, tipo, _ = OPT.fondo_de(a, "cuadro")
    dist = np.linalg.norm(a - K, axis=2)
    junto_al_fondo = ndi.binary_dilation(dist < OPT.TOL_FONDO, iterations=OPT.BANDA + 1)
    return (OPT.croma(a, K, tipo) > OPT.HUECO) & (dist >= OPT.TOL_FONDO) & ~junto_al_fondo


def ocr_listo():
    """El OCR de macOS (scripts/ocr.swift), compilado la primera vez o si cambió. None si no hay swiftc."""
    if os.path.exists(OCR_BINARIO) and os.path.getmtime(OCR_BINARIO) >= os.path.getmtime(OCR_FUENTE):
        return OCR_BINARIO
    if not shutil.which("swiftc"):
        return None
    print("    (compilo el OCR de macOS; solo esta vez, cerca de un minuto)", flush=True)
    r = subprocess.run(["swiftc", "-O", OCR_FUENTE, "-o", OCR_BINARIO], capture_output=True, text=True)
    return OCR_BINARIO if r.returncode == 0 else None


def textos(img, zona):
    """Lo que el OCR lee en la imagen completa y en la zona ampliada al triple (None si no hay OCR)."""
    binario = ocr_listo()
    if not binario:
        return None
    x0, y0, x1, y1 = zona
    vistas = [img, img.crop(zona).resize(((x1 - x0) * 3, (y1 - y0) * 3), Image.LANCZOS)]
    leidos = set()
    for vista in vistas:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
            vista.save(t.name)
        try:
            r = subprocess.run([binario, t.name], capture_output=True, text=True, timeout=120)
        finally:
            os.remove(t.name)
        for linea in r.stdout.splitlines():
            conf, _, texto = linea.partition("\t")
            if any(c.isalnum() for c in texto) and float(conf) >= 0.3:
                leidos.add(texto.strip())
    return leidos


def revisar(base, gen, cand, nombre_zona, zona, mz, med, cache):
    """Las revisiones de un cambio. Regresa ({revisión: motivo} de lo que falló, {medida: valor})."""
    fallas, v = {}, {}
    A, G = (np.asarray(i).astype(np.float32) for i in (base, gen))
    K = OPT.fondo_de(A, "base")[0]
    z, d, tomado = mz["z"], mz["d"], mz["tomado"]

    # alineación: fuera de la zona, la silueta de lo que regresó Gemini es la de la base (sin contar la orilla de
    # ORILLA px, que el JPEG mueve siempre) y su caja es la misma
    sb, sg = (np.linalg.norm(X - K, axis=2) > OPT.TOL_FONDO for X in (A, G))
    orilla = ndi.binary_dilation(sb, iterations=ORILLA) & ~ndi.binary_erosion(sb, iterations=ORILLA)
    v["silueta"] = float(((sb != sg) & ~z & ~orilla).sum() / max(1, (sb & ~z).sum()))
    cajas = [(xs.min(), ys.min(), xs.max(), ys.max()) for ys, xs in (np.where(s & ~z) for s in (sb, sg))]
    v["corrimiento"] = int(max(abs(int(p) - int(q)) for p, q in zip(*cajas)))
    if v["silueta"] > SILUETA_MAX or v["corrimiento"] > ORILLA:
        fallas["alineacion"] = (f"fuera de la zona, la silueta no coincide con la base ({v['silueta']:.2%}, caja corrida "
                                f"{v['corrimiento']} px): movió o escaló al personaje")

    # costura: alrededor de lo que se toma, Gemini y la base casi no difieren; y nada fuerte cruza el borde de la zona
    anillo = ndi.binary_dilation(tomado, iterations=3) & ~tomado
    v["costura"] = float((d[anillo & z] > COSTURA_DIF).mean()) if (anillo & z).any() else 0.0
    v["corte"] = int((d[anillo & ~z] > UMBRAL).sum())
    if v["costura"] > COSTURA_MAX:
        fallas["costura"] = f"alrededor del cambio el color no coincide con la base ({v['costura']:.0%} del contorno)"
    elif v["corte"] > CORTE_MAX:
        fallas["costura"] = f"algo cambiado cruza el borde de la zona ({v['corte']} px): quedaría cortado"

    # cambio: sí cambió algo en la zona, y en la cara no de más
    v["cambio"] = int(mz["cambio"].sum())
    v["cambio_zona"] = float(v["cambio"] / z.sum())
    if v["cambio"] < MIN_CAMBIO:
        fallas["sin_cambio"] = f"casi nada cambió en la zona ({v['cambio']} px)"
    elif nombre_zona == "cara" and v["cambio_zona"] > CARA_MAX:
        fallas["de_mas"] = f"cambió {v['cambio_zona']:.0%} de la cara: más de lo pedido"

    # fondo: con el chroma key del juego, ni colores cercanos al fondo (se volverían agujeros), ni restos teñidos del
    # fondo, ni manchas sueltas nuevas
    if "rgba_base" not in cache:
        cache["rgba_base"], cache["restos_base"] = sin_fondo(base)
        cache["manchas_base"] = ndi.label(np.asarray(cache["rgba_base"])[..., 3] > 0)[1]
        cache["cercanos_base"] = ndi.binary_dilation(cercanos_al_fondo(base), iterations=2)
    rgba, restos = sin_fondo(cand)
    v["cercanos"] = int((cercanos_al_fondo(cand) & ~cache["cercanos_base"] & z).sum())
    v["restos"] = int((restos & ~ndi.binary_dilation(cache["restos_base"], iterations=2)).sum())
    v["manchas_nuevas"] = int(ndi.label(np.asarray(rgba)[..., 3] > 0)[1] - cache["manchas_base"])
    if v["cercanos"] > CERCANOS_MAX:
        fallas["fondo"] = f"{v['cercanos']} px de un color cercano al del fondo: el chroma key los volvería agujeros"
    elif v["restos"]:
        fallas["fondo"] = f"quedan {v['restos']} px teñidos del color del fondo sobre el personaje"
    elif v["manchas_nuevas"] > 0:
        fallas["fondo"] = f"aparecieron {v['manchas_nuevas']} manchas sueltas en el fondo"

    # caja: lo visible no se sale de la caja de recorte del juego
    _, box, _ = OPT.preparar(med["pid"], med["angulo"], {"espera": cache["rgba_base"].copy(), "cuadro": rgba.copy()})
    v["caja"] = list(box)
    mb = med["box"]
    if box[0] < mb[0] or box[1] < mb[1] or box[2] > mb[2] or box[3] > mb[3]:
        fallas["caja"] = f"lo visible se sale de la caja de recorte {mb} (queda {box}): cambiarían el recorte y las medidas"

    # texto: nada que el OCR lea y que no estuviera ya en la base
    clave = ("textos", zona)
    if clave not in cache:
        cache[clave] = textos(base, zona)
    leidos = textos(cand, zona)
    if leidos is None or cache[clave] is None:
        v["texto"] = "sin OCR (no hay swiftc): revísalo a ojo"
    else:
        nuevos = sorted(leidos - cache[clave])
        v["texto"] = nuevos
        if nuevos:
            fallas["texto"] = f"el OCR lee texto: {', '.join(nuevos)}"
    return fallas, v


# ---------- API ----------

def cliente():
    key = os.environ.get("GEMINI_API_KEY")
    env = os.path.join(ROOT, ".env")
    if os.path.exists(env):
        with open(env) as f:
            for linea in f:
                k, _, v = linea.strip().partition("=")
                if k.strip() == "GEMINI_API_KEY" and v.strip():
                    key = v.strip().strip("\"'")
    if not key:
        sys.exit("Falta la API key: pon GEMINI_API_KEY=... en poker-for-the-players/.env")
    from google import genai
    client = genai.Client(api_key=key)
    # El SDK reintenta solo, sin avisar, los 429, los 5xx y los tiempos agotados (hasta 4 peticiones). Con imágenes
    # eso puede cobrar dos veces: las peticiones las cuenta generar_cuadro, con su tope de MAX_LLAMADAS.
    client.interactions.sdk_configuration.retry_config = None
    return client


def a_cuadrado(img, K):
    """La base completada a cuadrado con el color del fondo (blob y turista miden 1024x559). Siempre se pide 1:1:
    es la única proporción cuya salida mide justo lo que se pide (1K = 1024x1024); la de 16:9, por ejemplo, sale
    de unos 1376x768, y al reescalarla el personaje se correría. Regresa (imagen, dónde quedó la base adentro)."""
    w, h = img.size
    n = max(w, h)
    lienzo = Image.new("RGB", (n, n), tuple(int(c) for c in K))
    x, y = (n - w) // 2, (n - h) // 2
    lienzo.paste(img, (x, y))
    return lienzo, (x, y, x + w, y + h)


def pedir(client, cfg, prompt, entrada_png, extras=()):
    """UNA petición, sin reintentos (los decide generar_cuadro). extras: más imágenes (PNG en base64) después de la
    que se edita, como referencia."""
    listo = threading.Event()
    inicio = time.time()

    def avisar():
        while not listo.wait(30):
            print(f"      ... {time.time() - inicio:.0f} s", flush=True)

    threading.Thread(target=avisar, daemon=True).start()
    try:
        return client.interactions.create(
            model=cfg["modelo"],
            input=[{"type": "text", "text": prompt}] + [{"type": "image", "data": d, "mime_type": "image/png"}
                                                        for d in (entrada_png, *extras)],
            response_format={"type": "image", "aspect_ratio": "1:1", "image_size": cfg["image_size"]},
            timeout=600,
        )
    finally:
        listo.set()


def costo(modelo, usage):
    """USD con los tokens que reporta la respuesta, y el desglose de tokens."""
    p = PRECIOS.get(modelo)
    if not p or usage is None:
        return None, None
    entrada, salida = usage.total_input_tokens or 0, usage.total_output_tokens or 0
    thinking, total = usage.total_thought_tokens or 0, usage.total_tokens or 0
    imagen = sum(m.tokens or 0 for m in (usage.output_tokens_by_modality or []) if "image" in str(m.modality).lower())
    texto = (salida - imagen) + (0 if total == entrada + salida else thinking)   # el thinking puede venir aparte
    usd = entrada * p["entrada"] / 1e6 + imagen * p["imagen_token"] / 1e6 + texto * p["texto"] / 1e6
    return usd, {"entrada": entrada, "imagen": imagen, "texto_y_thinking": texto}


def costo_estimado(modelo, tamano, prompt, imagenes=1):
    p = PRECIOS.get(modelo)
    if not p:
        return None
    return (p["imagen"][tamano] + (TOKENS_POR_IMAGEN_ENTRADA * imagenes + len(prompt) // 4) * p["entrada"] / 1e6
            + TOKENS_TEXTO_ESTIMADOS * p["texto"] / 1e6)


# ---------- salidas para revisar ----------

def fuente(tam):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", tam)
    except OSError:
        return ImageFont.load_default()


def hoja_comparacion(base, crudos, final, zonas, destino):
    """La base, lo que regresó Gemini en cada llamada, el cuadro final y qué cambió; abajo, la zona de cerca."""
    A, F = np.asarray(base).astype(np.int16), np.asarray(final).astype(np.int16)
    mapa = Image.fromarray(np.clip(np.abs(A - F).max(axis=2) * 3, 0, 255).astype(np.uint8)).convert("RGB")
    cols = ([(base, "base aprobada")] + [(g, f"Gemini ({n})") for n, g in crudos]
            + [(final, "cuadro final"), (mapa, "qué cambió (final contra base)")])
    x0, y0 = max(0, min(z[0] for z in zonas) - 12), max(0, min(z[1] for z in zonas) - 12)
    x1, y1 = min(base.size[0], max(z[2] for z in zonas) + 12), min(base.size[1], max(z[3] for z in zonas) + 12)
    W = 360
    alto = round(base.size[1] * W / base.size[0])
    zh = round((y1 - y0) * W / (x1 - x0))
    hoja = Image.new("RGB", (len(cols) * (W + 16), 32 + alto + 24 + zh + 8), "white")
    t = ImageDraw.Draw(hoja)
    for i, (im, rotulo) in enumerate(cols):
        x = i * (W + 16)
        hoja.paste(im.resize((W, alto), Image.LANCZOS), (x, 30))
        hoja.paste(im.crop((x0, y0, x1, y1)).resize((W, zh), Image.NEAREST), (x, 30 + alto + 24))
        t.text((x + 2, 6), rotulo, fill="black", font=fuente(16))
    hoja.save(destino, quality=90)


def gif_revision(pid, angulo, base, final, pose, med, destino):
    """El GIF del cuadro contra la base, recortado como en el juego (sin tocar public/assets/)."""
    imgs = {"espera": sin_fondo(base)[0], pose: sin_fondo(final)[0]}
    imgs, box, tam = OPT.preparar(pid, angulo, imgs)
    imgs = {c: OPT.escalar(i.crop(box), *tam) for c, i in imgs.items()}
    orden = ["espera", pose]
    reg = med["reg"]
    OPT.dibujar_gif(imgs, orden, destino, reg.get("waist"), reg.get("face"), PARPADEO_MS if pose == "parpadeo" else 600)


# ---------- comandos ----------

def pedidas_de(args, pid, P):
    """Las poses a generar, como (ángulo, cuadro)."""
    if not args.pose:
        return [("frente", p) for p in DE_SIEMPRE if not os.path.exists(aprobado(pid, "frente", p))]
    out = []
    for clave in args.pose:
        angulo, _, pose = clave.partition("-")
        if angulo == "lado":
            sys.exit("lado: todavía no. Primero hace falta su base, la única excepción a \"nunca desde cero\": se "
                     "generará a partir de la base de frente (y para la robot, también de robot-hoja.png), y la "
                     "apruebas antes de generar sus cuadros.")
        if angulo not in ANGULOS or pose not in POSES or pose not in P["cuadros"]:
            sys.exit(f"Pose desconocida: {clave}. Opciones: {', '.join(f'frente-{p}' for p in POSES)} "
                     "(espera es la base: nunca se genera).")
        out.append((angulo, pose))
    return out


def cmd_generar(args):
    P = cargar_toml(PROMPTS)
    cfg = dict(P["config"])
    if args.modelo:
        cfg["modelo"] = args.modelo
    if args.tamano:
        cfg["image_size"] = args.tamano
    pid = args.personaje
    ficha = cargar_ficha(pid)
    pedidas = pedidas_de(args, pid, P)
    if not pedidas:
        print(f"Ya están aprobados los cuadros de siempre de {pid}. Para espia, gana o rehacer uno: --pose frente-<cuadro>")
        return
    base_path = aprobado(pid, "frente", "espera")
    if not os.path.exists(base_path):
        sys.exit(f"Falta la base aprobada {rel(base_path)}: los cuadros siempre se hacen editándola.")
    base = Image.open(base_path).convert("RGB")
    K, tipo, _ = OPT.fondo_de(np.asarray(base).astype(np.float32), os.path.basename(base_path))
    if tipo != ficha["fondo"]:
        sys.exit(f"La ficha de {pid} dice fondo {ficha['fondo']}, pero su base tiene fondo {tipo}.")
    med = medidas(pid, "frente", base)
    os.makedirs(carpeta(pid), exist_ok=True)

    print(f"Modelo {cfg['modelo']} a {cfg['image_size']}. Base {rel(base_path)} ({base.size[0]}x{base.size[1]}, "
          f"fondo {tipo}). Máximo {MAX_LLAMADAS} llamadas por cambio.")
    minimo = maximo = 0
    for angulo, pose in pedidas:
        cambios = P["cuadros"][pose]
        for i, cambio in enumerate(cambios, 1):
            prompt = prompt_de(P, ficha, cambio)
            c = costo_estimado(cfg["modelo"], cfg["image_size"], prompt) or 0
            minimo, maximo = minimo + c, maximo + c * MAX_LLAMADAS
            print(f"  {pid}-{angulo}-{pose}, cambio {i} de {len(cambios)}: zona {cambio['zona']} "
                  f"{med[cambio['zona']]}, ~${c:.3f} por llamada")
            if args.simular:
                destino = os.path.join(carpeta(pid), f"zona-{pid}-{angulo}-{pose}-{cambio['zona']}.png")
                vista_zona(base, med[cambio["zona"]], cambio["zona"], destino)
                print(f"    zona marcada en {rel(destino)}\n    prompt: {prompt}\n")
    print(f"Costo estimado: ~${minimo:.2f} USD (hasta ${maximo:.2f} si todo se reintenta)")
    if args.simular:
        return
    if "pendiente" in ficha:
        sys.exit(f"La ficha de {pid} está pendiente ({ficha['pendiente']}): revísala antes de gastar.")
    if not args.si and input("¿Generar? [s/N] ").strip().lower() not in ("s", "si", "sí"):
        print("Cancelado.")
        return

    client = cliente()
    for angulo, pose in pedidas:
        generar_cuadro(client, cfg, P, ficha, pid, angulo, pose, base, K, med)
    print(f"Gastado en total según los registros de arte/generadas/: ${gastado_en_total():.4f} USD")


def generar_cuadro(client, cfg, P, ficha, pid, angulo, pose, base, K, med):
    """Un cuadro: cada cambio edita la base (como mucho MAX_LLAMADAS peticiones) y aporta solo su zona."""
    nombre = f"{pid}-{angulo}-{pose}"
    prefijo = os.path.join(carpeta(pid), con_version(nombre, siguiente_version(pid, nombre)))
    lienzo, dentro = a_cuadrado(base, K)
    buf = io.BytesIO()
    lienzo.save(buf, "PNG")
    entrada = base64.b64encode(buf.getvalue()).decode("ascii")
    final, crudos, zonas, gastado, llamadas, cache = base, [], [], 0, 0, {}
    print(f"{os.path.basename(prefijo)}:", flush=True)
    for i, cambio in enumerate(P["cuadros"][pose], 1):
        zona, correcciones, cand, fallas = med[cambio["zona"]], [], None, {}
        for intento in range(1, MAX_LLAMADAS + 1):
            prompt = prompt_de(P, ficha, cambio, correcciones)
            print(f"  cambio {i} ({cambio['zona']}), llamada {intento} de {MAX_LLAMADAS}...", flush=True)
            t0, r, error, gen, crudo = time.time(), None, None, None, None
            llamadas += 1
            try:
                r = pedir(client, cfg, prompt, entrada)
            except Exception as e:   # también cuenta como llamada: un tiempo agotado pudo cobrarse
                error = f"{type(e).__name__} (código {getattr(e, 'status_code', None)}): {str(e)[:300]}"
                if "Free Tier" in str(e):
                    sys.exit("    El proyecto de la API key está en el nivel gratuito, que no genera imágenes.")
                if getattr(e, "status_code", None) == 402:
                    sys.exit("    La cuenta se quedó sin crédito (402): recarga en AI Studio.")
            if r is not None and r.output_image and r.output_image.data:
                crudo = f"{prefijo}-{cambio['zona']}-crudo{intento}.png"
                gen = Image.open(io.BytesIO(base64.b64decode(r.output_image.data))).convert("RGB")
                gen.save(crudo)   # tal cual llegó, antes de cualquier otra cosa: ya está pagada
                if gen.size != lienzo.size:
                    gen = gen.resize(lienzo.size, Image.LANCZOS)
                gen = gen.crop(dentro)
            usd, tokens = costo(cfg["modelo"], r.usage) if r is not None else (None, None)
            gastado += usd or 0
            if gen is None:
                fallas, v = {"sin_imagen": f"no regresó imagen ({error or r.status})"}, {}
            else:
                cand, mz = componer(base, gen, zona, final)
                fallas, v = revisar(base, gen, cand, cambio["zona"], zona, mz, med, cache)
                crudos.append((f"{cambio['zona']}, llamada {intento}", gen))
            with open(os.path.join(carpeta(pid), "registro.jsonl"), "a") as f:
                f.write(json.dumps({
                    "fecha": datetime.now().isoformat(timespec="seconds"), "cuadro": os.path.basename(prefijo),
                    "cambio": i, "zona": cambio["zona"], "llamada": intento,
                    "archivo": os.path.basename(crudo) if crudo else None, "modelo": cfg["modelo"],
                    "tamano": cfg["image_size"], "base": rel(aprobado(pid, angulo, "espera")), "prompt": prompt,
                    "costo_usd": round(usd, 5) if usd is not None else None, "tokens": tokens, "error": error,
                    "revisiones": fallas, "medidas": v,
                }, ensure_ascii=False, default=str) + "\n")
            print(f"    {time.time() - t0:.0f} s" + (f", ${usd:.4f}" if usd is not None else ", sin costo reportado")
                  + (f" -> {rel(crudo)}" if crudo else ""), flush=True)
            if not fallas:
                print("    revisiones: todas bien  " + ", ".join(f"{k} {x:.3g}" if isinstance(x, float) else f"{k} {x}"
                                                         for k, x in v.items() if k != "caja"), flush=True)
                final = cand
                zonas.append(zona)
                break
            print("    FALLÓ: " + "; ".join(fallas.values()), flush=True)
            correcciones = [k for k in fallas if k in P["correcciones"]]
        if fallas:   # se acabaron las llamadas de este cambio
            if cand is not None:
                cand.save(f"{prefijo}-FALLA.png")
            print(f"  {os.path.basename(prefijo)}: no pasó las revisiones en {MAX_LLAMADAS} llamadas. "
                  + (f"Lo último quedó en {rel(prefijo)}-FALLA.png. " if cand is not None else "")
                  + f"Costo: ${gastado:.4f} USD en {llamadas} llamada(s).")
            return
    final.save(f"{prefijo}.png")
    hoja_comparacion(base, crudos, final, zonas, f"{prefijo}-comparacion.jpg")
    gif_revision(pid, angulo, base, final, pose, med, f"{prefijo}.gif")
    print(f"  Listo, por revisar: {rel(prefijo)}.png\n"
          f"    GIF como en el juego: {rel(prefijo)}.gif\n    comparación: {rel(prefijo)}-comparacion.jpg\n"
          f"    costo: ${gastado:.4f} USD en {llamadas} llamada(s)")


def cmd_aprobar(args):
    pid = args.personaje
    if args.version and len(args.pose) > 1:
        sys.exit("--version es para un solo cuadro.")
    for clave in args.pose:
        angulo, _, pose = clave.partition("-")
        if angulo not in ANGULOS or pose not in POSES:
            sys.exit(f"Pose desconocida: {clave}. Opciones: {', '.join(f'frente-{p}' for p in POSES)}")
        nombre = f"{pid}-{clave}"
        vs = versiones(pid, nombre)
        if not vs:
            sys.exit(f"No hay versiones de {nombre} que hayan pasado las revisiones en {rel(carpeta(pid))}/.")
        n = args.version or max(vs)
        if n not in vs:
            sys.exit(f"No existe la versión {n} de {nombre} (hay: {sorted(vs)}).")
        destino = aprobado(pid, angulo, pose)
        if os.path.exists(destino):
            respaldo = os.path.join(ARTE, "respaldos", f"{nombre}-{datetime.now():%Y%m%d-%H%M%S}.png")
            os.makedirs(os.path.dirname(respaldo), exist_ok=True)
            shutil.copy2(destino, respaldo)
            print(f"  el que estaba quedó respaldado en {rel(respaldo)}")
        shutil.copy2(vs[n], destino)
        print(f"  {rel(vs[n])} -> {rel(destino)}")
    print(f"Sigue, para que el juego lo use:\n"
          f"  .venv-rembg/bin/python scripts/optimizar-arte.py personajes {pid}\n"
          f"  .venv-rembg/bin/python scripts/optimizar-arte.py registrar {pid}")


# ---------- cartas: el reverso de la baraja, del mismo tamaño en la mesa para todos ----------

def _marco(a):
    """Las líneas del marco del reverso nuevo tal como las dibuja Gemini a este tamaño: delgadas, de rojo ladrillo a
    café rojizo claro (en el blob, mediana (164, 128, 116)). Lo rojizo oscuro y apagado no cuenta: es la orilla del
    contorno de tinta, que si contara uniría las dos cartas."""
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    lum = a @ LUMA
    return (R > G + 20) & (R > B + 25) & (lum < 200) & ((lum >= 90) | (R - G > 60))


def _caras_nuevas(a, z):
    """Las caras de las cartas con el reverso nuevo: el papel crema y el marco que lo toca (4-conexos, con los huecos
    rellenos), hasta la tinta del contorno, así que no se le suma margen. Cuenta si tiene marco y al menos una cuarta
    parte de papel: la ropa crema no tiene marco y la piel (que se parece al marco claro) casi no tiene papel. Sirve
    con marco delgado y claro (como lo dibujó Gemini en el blob: solo, se parte en pedazos) y con marco grueso (parte
    al papel en dos)."""
    papel = (a @ LUMA > 170) & (a.max(axis=2) - a.min(axis=2) < 60) & (a[..., 0] >= a[..., 2]) & z
    marco = _marco(a) & z
    # la apertura corta los puentes de un píxel por donde el marco cruza el contorno delgado entre las dos cartas
    lab, n = ndi.label(ndi.binary_opening(papel | marco))
    caras = np.zeros(papel.shape, bool)
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() >= 150 and (m & marco).sum() >= 30 and (m & papel).sum() >= 0.25 * m.sum():
            caras |= ndi.binary_fill_holes(m)
    return caras


def _azul(a):
    """El azul marino del reverso viejo."""
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    return (B > R + 25) & (B > G + 15) & (R < 80) & (a @ LUMA < 90)


def _papel(a):
    return (a @ LUMA > 160) & (a.max(axis=2) - a.min(axis=2) < 50)


def medir_cartas(img, zona, diseno):
    """Las cartas de la zona, de la más ancha a la más angosta (la primera es la de enfrente: la de atrás queda tapada
    de un lado). Cada carta sale de su núcleo: el azul marino del reverso viejo ("azul", más su borde blanco) o la cara
    de papel del nuevo ("rojo", ver _caras_nuevas). Su orilla de arriba da la inclinación y el ancho se mide en una
    franja cerca de arriba (las manos tapan la parte de abajo): es el ancho de la cara, sin el contorno. Probado con
    las cartas de las seis bases, con las dos respuestas reales del blob (el contorno, en los mismos píxeles que la
    base) y con cartas sintéticas del reverso pegadas en las seis bases: ±2 %."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    x0, y0, x1, y1 = zona
    z = np.zeros(a.shape[:2], bool)
    z[y0:y1, x0:x1] = True
    papel = _papel(a)
    h, w = papel.shape
    if diseno == "azul":   # entre el azul y el borde blanco hay una línea oscura: se salta, y se suma el borde
        nucleo, salto = _azul(a) & z, 6
    else:                  # el papel ya llega hasta el contorno: nada que sumar
        nucleo, salto = _caras_nuevas(a, z), 0
    # las caras nuevas, 4-conexas como salieron (así dos cartas que se tocan en diagonal no se juntan)
    lab, n = ndi.label(nucleo, structure=np.ones((3, 3)) if diseno == "azul" else None)
    cartas = []
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() < 40:
            continue
        ys, xs = np.where(m)
        # inclinación: la pendiente mediana (Theil-Sen) de la orilla de arriba, en la mitad de en medio
        cols = np.arange(xs.min(), xs.max() + 1)
        tope = np.array([ys[xs == c].min() if (xs == c).any() else np.nan for c in cols])
        cx, cy = cols[len(cols) // 4:len(cols) * 3 // 4].astype(float), tope[len(cols) // 4:len(cols) * 3 // 4]
        cx, cy = cx[~np.isnan(cy)], cy[~np.isnan(cy)]
        if len(cx) < 4:
            continue
        t = float(np.arctan(np.median([(cy[j] - cy[q]) / (cx[j] - cx[q])
                                       for q in range(len(cx)) for j in range(q + 1, len(cx))])))
        if abs(np.degrees(t)) > 35:   # las cartas van paradas: más inclinado es otra cosa
            continue
        c_, s_ = np.cos(t), np.sin(t)
        u, v = xs * c_ + ys * s_, -xs * s_ + ys * c_   # u a lo ancho de la carta; v hacia abajo
        ext, v0 = u.max() - u.min(), v.min()
        franja = (v >= v0 + 0.10 * ext) & (v <= v0 + 0.40 * ext)

        def es_papel(uu, vv):
            x, y = round(uu * c_ - vv * s_), round(uu * s_ + vv * c_)
            return 0 <= x < w and 0 <= y < h and papel[y, x]

        def margen(desde, paso, f):   # hasta `salto` px que no son papel, y el papel hasta la tinta del contorno
            k = 1
            while k <= salto and not es_papel(desde + paso * k, f):
                k += 1
            if k > salto:
                return 0
            while k < 40 and es_papel(desde + paso * k, f):
                k += 1
            return k - 1

        filas = []
        for f in np.unique(np.round(v[franja]).astype(int)):
            sel = franja & (np.round(v).astype(int) == f)
            ua, ub = u[sel].min(), u[sel].max()
            ml, mr = margen(ua, -1, f), margen(ub, 1, f)
            filas.append((ub - ua + 1 + ml + mr, ua - ml, ub + mr, f, (ml + mr) / 2))
        if len(filas) < 3:
            continue
        izq, der, f, mg = filas[len(filas) // 2][1:]
        # linea: la medida del renglón de en medio (u izquierda, u derecha, v), para dibujarla; arriba: la orilla de
        # arriba de la cara (v), aproximada con el margen de los lados
        cartas.append({"ancho": float(np.median([fl[0] for fl in filas])), "angulo": float(np.degrees(t)), "t": t,
                       "linea": (float(izq), float(der), float(f)), "arriba": float(v0 - mg)})
    return sorted(cartas, key=lambda c: -c["ancho"])


# ---------- cartas dibujadas por código: la entrada que recibe Gemini ----------

TINTA = (29, 22, 17)   # #1d1611, la tinta de las ilustraciones y de las cartas del juego
ANCLAS = ["arriba", "centro", "abajo"]   # qué orilla de la carta vieja se queda en su lugar al cambiar de tamaño
DEDOS_MIN = 0.08       # de la mitad de abajo de la carta de enfrente (sin sus orillas), lo que tapan los dedos que van
                       # encima: en las seis bases de hoy, 14 a 45 %; con las cartas pintadas encima de los dedos, 3 %
FRANJA_MIN = 0.97      # de cada franja visible, lo que debe seguir siendo del rojo de la etiqueta (nada encima)
_etiqueta = None


def etiqueta_del_juego():
    """La etiqueta del reverso tal como la define el juego: ETIQUETA y largoEtiqueta de client/stage/cards.js, leídos
    con Node. De ahí salen el color, el largo y el grueso de la franja que se dibuja vacía en las cartas de la mano (las
    letras las pone el juego con la misma función), así que si cambia el logo, cambian juntas."""
    global _etiqueta
    if _etiqueta is None:
        js = ("const m = await import('./client/stage/cards.js'); const e = m.ETIQUETA;"
              "console.log(JSON.stringify({texto: e.texto, color: e.color, angulo: e.reverso.angulo,"
              " largo: m.largoEtiqueta(e.reverso), grueso: e.reverso.grueso, carta: m.CARD_PX}))")
        r = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True, text=True)
        if r.returncode:
            sys.exit("No pude leer la etiqueta de client/stage/cards.js con Node:\n" + r.stderr[-400:])
        _etiqueta = json.loads(r.stdout)
    return _etiqueta


def _hex(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def _a_xy(t, u, v):
    """De las coordenadas de una carta (u a lo ancho, v hacia abajo, giradas t) a px de la imagen."""
    return u * np.cos(t) - v * np.sin(t), u * np.sin(t) + v * np.cos(t)


def _mascara_poligono(puntos, tam):
    m = Image.new("L", tam, 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in puntos], fill=255)
    return np.asarray(m) > 0


def cartas_viejas(base, ficha):
    """Las cartas de la base, la de enfrente primero: su inclinación t, la orilla izquierda u0 y la de arriba v0 de su
    cara (en sus coordenadas) y su ancho y alto. Las dos miden lo que la de enfrente (la de atrás se ve cortada); de la
    de atrás se toma la orilla que se ve, la del lado contrario a la de enfrente."""
    x0, y0, x1, y1 = ficha["caja_cartas"]
    medidas = medir_cartas(base, (x0 - 8, y0 - 8, x1 + 8, y1 + 8), "azul") or \
        medir_cartas(base, (x0 - 8, y0 - 8, x1 + 8, y1 + 8), "rojo")
    if not medidas:
        sys.exit(f"No encuentro las cartas en caja_cartas {ficha['caja_cartas']}.")
    cw, ch = etiqueta_del_juego()["carta"]
    W = medidas[0]["ancho"]
    centro_x = lambda c: _a_xy(c["t"], (c["linea"][0] + c["linea"][1]) / 2, c["linea"][2])[0]
    # las de las ilustraciones son más largas que las de la baraja: el largo es hasta lo último de su azul o su borde
    # blanco (dentro de caja_cartas), y como mínimo el de la baraja
    a = np.asarray(base).astype(np.float32)
    caja = np.zeros(a.shape[:2], bool)
    caja[y0:y1, x0:x1] = True
    de_carta = (_azul(a) | ((a @ LUMA > 160) & (a.max(axis=2) - a.min(axis=2) < 50))) & caja
    ys, xs = np.where(de_carta)
    out = []
    for j, c in enumerate(medidas[:2]):
        izq, der, _ = c["linea"]
        u0 = izq if j == 0 or centro_x(c) < centro_x(medidas[0]) else der - W
        u, v = xs * np.cos(c["t"]) + ys * np.sin(c["t"]), -xs * np.sin(c["t"]) + ys * np.cos(c["t"])
        suya = (u >= u0) & (u <= u0 + W) & (v >= c["arriba"])
        H = max(W * ch / cw, float(v[suya].max() - c["arriba"]) + 1 if suya.any() else 0)
        out.append({"t": c["t"], "u0": u0, "v0": c["arriba"], "W": W, "H": H})
    return out


def poligono_carta(c):
    return [_a_xy(c["t"], u, v) for u, v in ((c["u0"], c["v0"]), (c["u0"] + c["W"], c["v0"]),
                                             (c["u0"] + c["W"], c["v0"] + c["H"]), (c["u0"], c["v0"] + c["H"]))]


def dibujo_carta(W, etq, s=4):
    """Una carta con el reverso aprobado (arte/baraja/reverso-carta.png) y la franja de la etiqueta vacía (las letras las
    pone el juego), de W px de cara, con el contorno de tinta (CONTORNO) y las esquinas redondas de cards.js. Se dibuja
    a s veces el tamaño y se reduce, para que las orillas salgan suaves."""
    cw, ch = etq["carta"]
    Ws, Hs, b = round(W * s), round(W * ch / cw * s), round(CONTORNO * s)
    cara = Image.open(REVERSO).convert("RGB").resize((Ws, Hs), Image.LANCZOS)
    L, G, a = etq["largo"] * W * s / 2, etq["grueso"] * W * s / 2, np.radians(-etq["angulo"])
    ImageDraw.Draw(cara).polygon([(Ws / 2 + x * np.cos(a) - y * np.sin(a), Hs / 2 + x * np.sin(a) + y * np.cos(a))
                                  for x, y in ((-L, -G), (L, -G), (L, G), (-L, G))], fill=_hex(etq["color"]))
    radio = 26 / 256 * Ws   # R de cards.js con la carta de 256 px
    carta = Image.new("RGBA", (Ws + 2 * b, Hs + 2 * b), (0, 0, 0, 0))
    ImageDraw.Draw(carta).rounded_rectangle((0, 0, Ws + 2 * b - 1, Hs + 2 * b - 1), radius=radio + b, fill=TINTA + (255,))
    m = Image.new("L", (Ws, Hs), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, Ws - 1, Hs - 1), radius=radio, fill=255)
    carta.paste(cara, (b, b), m)
    return carta.resize((round(carta.size[0] / s), round(carta.size[1] / s)), Image.LANCZOS)


def _rellenar(a, mascara, vueltas=12):
    """Tapa la máscara con el color de alrededor: el del píxel más cercano del cuerpo (ni tinta ni sombra oscura, ni
    restos de carta), suavizado por difusión. Es un borrador: Gemini redibuja esa parte."""
    lum, sat = a @ LUMA, a.max(axis=2) - a.min(axis=2)
    cerca = ndi.binary_dilation(mascara, iterations=12) & ~ndi.binary_dilation(mascara, iterations=2)
    fuente = cerca & (lum > 110) & ~_azul(a) & ~((lum > 160) & (sat < 50) & ~(a[..., 2] > a[..., 0] + 40))
    if not fuente.any():
        fuente = ~mascara & (lum > 90)
    _, (iy, ix) = ndi.distance_transform_edt(~fuente, return_indices=True)
    # la difusión se hace también sobre la orilla de junto (sin tocarla en el resultado): si no, la tinta de alrededor
    # se cuela como mancha oscura
    junto = ndi.binary_dilation(mascara, iterations=3) & ~fuente
    trabajo = a.copy()
    trabajo[junto] = a[iy[junto], ix[junto]]
    for _ in range(vueltas):
        prom = (np.roll(trabajo, 1, 0) + np.roll(trabajo, -1, 0) + np.roll(trabajo, 1, 1) + np.roll(trabajo, -1, 1)) / 4
        trabajo[junto] = prom[junto]
    out = a.copy()
    out[mascara] = trabajo[mascara]
    return out


def _no_carta(a):
    """Lo que no es carta nueva (ni papel, ni marco, ni la franja, ni tinta): los dedos que van encima."""
    lum, sat = a @ LUMA, a.max(axis=2) - a.min(axis=2)
    franja = np.linalg.norm(a - np.array(_hex(etiqueta_del_juego()["color"]), np.float32), axis=2) < 70
    papel = (lum > 170) & (sat < 60) & (a[..., 0] >= a[..., 2])
    return ~(papel | _marco(a) | franja | ((lum < 90) & (sat < 45)))


def _recortar(poli, a, b):
    """Sutherland-Hodgman con un semiplano: lo del polígono que queda del lado izquierdo de la recta a->b."""
    lado = lambda p: (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    out = []
    for p, q in zip(poli, poli[1:] + poli[:1]):
        sp, sq = lado(p), lado(q)
        if sp >= 0:
            out.append(p)
        if sp * sq < 0:
            k = sp / (sp - sq)
            out.append((p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])))
    return out


def _area(poli):
    return abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poli, poli[1:] + poli[:1]))) / 2 if len(poli) > 2 else 0


def geometria_nuevas(viejas, W, ancla="arriba", mover=0.0):
    """Las cartas nuevas (W px de cara, el alto de la baraja) y sus franjas: misma inclinación y mismo centro a lo ancho
    que las viejas; `ancla` dice qué orilla de la vieja se queda en su lugar y `mover` las corre a lo largo (px, + hacia
    abajo). Cada franja: centro, largo, grueso y ángulo (el de etiqueta() en cards.js), su rectángulo y lo que se ve de
    ella (la de atrás, sin lo que tapa la de enfrente). La de enfrente, primero."""
    etq = etiqueta_del_juego()
    cw, ch = etq["carta"]
    nuevas, franjas = [], []
    for c in viejas:
        H = W * ch / cw
        v0 = {"arriba": c["v0"], "centro": c["v0"] + (c["H"] - H) / 2, "abajo": c["v0"] + c["H"] - H}[ancla] + mover
        n = {"t": c["t"], "u0": c["u0"] + (c["W"] - W) / 2, "v0": v0, "W": W, "H": H}
        cx, cy = _a_xy(n["t"], n["u0"] + W / 2, v0 + H / 2)
        L, G, ang = etq["largo"] * W, etq["grueso"] * W, etq["angulo"] - np.degrees(n["t"])
        r = np.radians(-ang)
        rect = [(cx + x * np.cos(r) - y * np.sin(r), cy + x * np.sin(r) + y * np.cos(r))
                for x, y in ((-L / 2, -G / 2), (L / 2, -G / 2), (L / 2, G / 2), (-L / 2, G / 2))]
        nuevas.append(n)
        franjas.append({"c": [cx, cy], "largo": L, "grueso": G, "angulo": ang, "rect": rect, "recorte": rect})
    n = nuevas[0]   # la de enfrente con su contorno de tinta, que también tapa
    enfrente = poligono_carta({**n, "u0": n["u0"] - CONTORNO, "v0": n["v0"] - CONTORNO,
                               "W": n["W"] + 2 * CONTORNO, "H": n["H"] + 2 * CONTORNO})
    orillas = list(zip(enfrente, enfrente[1:] + enfrente[:1]))
    firmada = sum(p[0] * q[1] - q[0] * p[1] for p, q in orillas)   # > 0: el interior queda a la izquierda de p->q
    for f in franjas[1:]:
        if _area(f["rect"]) - max(_area(_recortar(f["rect"], q, p) if firmada > 0 else _recortar(f["rect"], p, q))
                                  for p, q in orillas) > 0.5:   # la tapa la de enfrente: se queda lo de afuera
            f["recorte"] = max((_recortar(f["rect"], q, p) if firmada > 0 else _recortar(f["rect"], p, q)
                                for p, q in orillas), key=_area)
    return nuevas, franjas


def dedos_y_relleno(base, viejas):
    """Lo que hay sobre las cartas viejas: los dedos (lo que no es carta: ni su azul, ni su borde blanco, ni tinta, con
    su propio contorno), que van encima de las nuevas; y lo demás de las viejas, que se rellena."""
    a = np.asarray(base).astype(np.float32)
    lum, sat = a @ LUMA, a.max(axis=2) - a.min(axis=2)
    en_viejas = np.zeros(lum.shape, bool)
    for c in viejas:
        en_viejas |= _mascara_poligono(poligono_carta(c), base.size)
    en_viejas = ndi.binary_dilation(en_viejas, iterations=CONTORNO + 3)   # con todo su contorno
    de_carta = _azul(a) | ((lum > 160) & (sat < 50)) | ((lum < 90) & (sat < 45))
    piel = ndi.binary_opening(en_viejas & ~de_carta)   # sin el antialias suelto de las orillas
    dedos = piel | (en_viejas & (lum < 90) & ndi.binary_dilation(piel, iterations=2))
    return dedos, en_viejas & ~dedos


def tapado_por_dedos(franjas, dedos, tam):
    """Lo que tapan los dedos de lo que se ve de cada franja (0 a 1)."""
    return [float(dedos[m].mean()) if (m := _mascara_poligono(f["recorte"], tam)).any() else 0.0 for f in franjas]


def entrada_dibujada(base, ficha, info, ancla="arriba", mover=None):
    """La entrada para Gemini: la base con las cartas viejas tapadas, las nuevas dibujadas por código al ancho objetivo
    y, encima, los dedos que estaban sobre las viejas (los dedos van encima de las cartas). Sin `mover`, busca el
    corrimiento más chico (a lo largo de las cartas, hasta 14 px) con el que los dedos no tapan ninguna franja.
    Regresa (imagen, datos): las cartas nuevas, sus franjas en px de la base, los dedos, lo rellenado y el corrimiento."""
    etq = etiqueta_del_juego()
    viejas = cartas_viejas(base, ficha)
    dedos, relleno = dedos_y_relleno(base, viejas)
    if mover is None:
        opciones = [0] + [s * k for k in range(2, 15, 2) for s in (-1, 1)]
        mover = min(opciones, key=lambda m: (max(tapado_por_dedos(geometria_nuevas(viejas, info["objetivo"], ancla, m)[1],
                                                                  dedos, base.size)) > 0, abs(m)))
    nuevas, franjas = geometria_nuevas(viejas, info["objetivo"], ancla, mover)
    a = np.asarray(base).astype(np.float32)
    img = Image.fromarray(np.clip(_rellenar(a, relleno), 0, 255).astype(np.uint8)).convert("RGBA")
    for n in reversed(nuevas):   # la de atrás primero, la de enfrente encima
        cx, cy = _a_xy(n["t"], n["u0"] + n["W"] / 2, n["v0"] + n["H"] / 2)
        dib = dibujo_carta(n["W"], etq).rotate(-np.degrees(n["t"]), resample=Image.BICUBIC, expand=True)
        img.alpha_composite(dib, (round(cx - dib.size[0] / 2), round(cy - dib.size[1] / 2)))
    salida = np.asarray(img.convert("RGB")).copy()
    salida[dedos] = np.asarray(base)[dedos]   # los dedos, encima de las cartas nuevas
    return Image.fromarray(salida), {"nuevas": nuevas, "franjas": franjas, "relleno": relleno, "dedos": dedos,
                                     "ancla": ancla, "mover": mover,
                                     "tapado": tapado_por_dedos(franjas, dedos, base.size)}


def revisar_dibujo(img, datos, info):
    """Lo que se puede revisar en la entrada o en el resultado: la franja visible y del rojo de la etiqueta, los dedos
    encima de la mitad de abajo de la carta de enfrente y el ancho medido. Regresa ({revisión: motivo}, {medida: valor})."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    rojo = np.linalg.norm(a - np.array(_hex(etiqueta_del_juego()["color"]), np.float32), axis=2) < 70
    fallas, v = {}, {}
    v["franjas"] = []
    for j, f in enumerate(datos["franjas"]):
        m = ndi.binary_erosion(_mascara_poligono(f["recorte"], img.size))   # sin la orilla de un píxel
        v["franjas"].append(round(float(rojo[m].mean()), 3) if m.any() else None)
        if m.any() and rojo[m].mean() < FRANJA_MIN:
            fallas["franja"] = f"la franja de la carta {j + 1} quedó tapada o cambió ({rojo[m].mean():.0%} visible)"
    n = datos["nuevas"][0]
    abajo = ndi.binary_erosion(_mascara_poligono([_a_xy(n["t"], u, v_) for u, v_ in (
        (n["u0"], n["v0"] + n["H"] / 2), (n["u0"] + n["W"], n["v0"] + n["H"] / 2), (n["u0"] + n["W"], n["v0"] + n["H"]),
        (n["u0"], n["v0"] + n["H"]))], img.size), iterations=2)   # sin las orillas ni las esquinas redondas
    v["dedos"] = round(float(_no_carta(a)[abajo].mean()), 3)
    if v["dedos"] < DEDOS_MIN:
        fallas["dedos"] = f"los dedos no quedan encima de la carta de enfrente ({v['dedos']:.0%} de su mitad de abajo)"
    medidas = medir_cartas(img, info["zona"], "rojo")
    v["ancho"] = round(medidas[0]["ancho"], 1) if medidas else None
    if not medidas:
        fallas["sin_cartas"] = "no encuentro las cartas con el reverso nuevo para medirlas"
    elif abs(medidas[0]["ancho"] / info["objetivo"] - 1) > TOL_TAMANO:
        fallas["tamano"] = (f"la carta de enfrente mide {medidas[0]['ancho']:.0f} px y el objetivo es "
                            f"{info['objetivo']:.0f} ({medidas[0]['ancho'] / info['objetivo'] - 1:+.0%})")
    return fallas, v


def plan_cartas(pid, base, ficha, med):
    """El ancho de hoy de las cartas (la de enfrente, en px de la base), el objetivo (CARTA_MESA en la mesa, pasado a px
    con la escala del personaje en el juego) y la zona que se edita."""
    for clave in ("caja_cartas", "caja_manos"):
        if clave not in ficha:
            sys.exit(f"A la ficha de {pid} le falta {clave} (ver las de scripts/fichas/).")
    x0, y0, x1, y1 = ficha["caja_cartas"]
    W, H = base.size
    caja = (max(0, x0 - 8), max(0, y0 - 8), min(W, x1 + 8), min(H, y1 + 8))
    hoy = medir_cartas(base, caja, "azul") or medir_cartas(base, caja, "rojo")
    if not hoy:
        sys.exit(f"{pid}: no encuentro sus cartas en caja_cartas {ficha['caja_cartas']} (ni azules ni con el reverso nuevo).")
    # en el juego (seatPlace en client/stage/index.js) la imagen recortada mide height × RIVALES unidades de alto, y en
    # la base esa caja de recorte mide bh px: así se pasa de px de la base a unidades de la mesa
    por_px = med["reg"]["height"] * RIVALES / (med["box"][3] - med["box"][1])
    actual, objetivo = hoy[0]["ancho"], CARTA_MESA / por_px
    f = objetivo / actual
    cx, cy, k = (x0 + x1) / 2, (y0 + y1) / 2, max(1.0, f)   # si crecen, la caja crece igual desde su centro
    zona = [cx - (cx - x0) * k - MARGEN_CARTAS, cy - (cy - y0) * k - MARGEN_CARTAS,
            cx + (x1 - cx) * k + MARGEN_CARTAS, cy + (y1 - cy) * k + MARGEN_CARTAS]
    m = ficha["caja_manos"]   # Gemini redibuja las manos alrededor de las cartas nuevas: siempre entran a la zona
    zona = [min(zona[0], m[0]), min(zona[1], m[1]), max(zona[2], m[2]), max(zona[3], m[3])]
    zona = (max(0, round(zona[0])), max(0, round(zona[1])), min(W, round(zona[2])), min(H, round(zona[3])))
    return {"actual": actual, "objetivo": objetivo, "factor": f, "por_px": por_px, "manos": True, "zona": zona,
            "carta": hoy[0]}


def prompt_cartas(P, ficha, correcciones=()):
    """El prompt de cartas ([cartas] de prompts-personaje.toml): las cartas ya vienen dibujadas en la entrada, con su
    tamaño, su reverso y la franja vacía; Gemini solo redibuja las manos y los antebrazos alrededor. correcciones:
    frases para el reintento (correcciones_cartas)."""
    C = P["cartas"]
    valores = dict(ficha, rasgos="".join(f", {r}" for r in ficha.get("rasgos", [])),
                   fondo={"verde": "green"}.get(ficha["fondo"], ficha["fondo"]))
    opacas = ficha.get("opacas", [])
    valores["opacas"] = P["edicion"]["opacas"].format(lista=", ".join(opacas)) if opacas else ""
    valores["agarre"] = C["agarre"]
    valores["se_queda"] = C["se_queda"].format_map(valores)
    return " ".join([limpiar(C["texto"]).format_map(valores)] + list(correcciones))


def correcciones_cartas(P, fallas):
    """Las frases para el reintento: las de las revisiones de siempre y las de cartas."""
    C = P["cartas"]["correcciones"]
    return [P["correcciones"][k] for k in fallas if k in P["correcciones"] and k not in C] + [C[k] for k in fallas if k in C]


def franjas_en_fracciones(franjas, box):
    """Las franjas como van en client/stage/personajes.json: el centro y los puntos de lo que se ve, en fracciones de la
    imagen recortada del juego (x del ancho, y del alto, como face y waist); el largo y el grueso, en fracciones del
    ancho; el ángulo, el de etiqueta() en cards.js. El juego dibuja ahí la etiqueta con letras (la imagen trae la franja
    vacía), y en espejo la pone derecha."""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    p = lambda x, y: [round((x - x0) / bw, 5), round((y - y0) / bh, 5)]
    return [{"c": p(*f["c"]), "largo": round(f["largo"] / bw, 5), "grueso": round(f["grueso"] / bw, 5),
             "angulo": round(f["angulo"], 2), "recorte": [p(*q) for q in f["recorte"]]} for f in franjas]


def pegar_ojos(espera, parpadeo, nueva):
    """El parpadeo sobre una espera nueva, sin gastar: donde el parpadeo aprobado difiere de su espera (los ojos
    cerrados) va el parpadeo; todo lo demás es la espera nueva. Falla si lo que cambió en la espera toca esos píxeles."""
    E, Pp, N = (np.asarray(i.convert("RGB")) for i in (espera, parpadeo, nueva))
    ojos = (E != Pp).any(axis=2)
    if (ojos & (E != N).any(axis=2)).any():
        raise ValueError("lo que cambió en la espera toca los ojos del parpadeo")
    return Image.fromarray(np.where(ojos[..., None], Pp, N))


def revisar_cartas(base, cand, info, med, parpadeo, ficha, datos):
    """Las revisiones propias de cartas, además de las de siempre (revisar): las del dibujo (revisar_dibujo: ancho,
    franjas visibles y dedos encima), sin restos del azul viejo, el rojo entero con el chroma key y la misma caja de
    recorte. Regresa ({revisión: motivo}, {medida: valor})."""
    fallas, v = revisar_dibujo(cand, datos, info)
    A, C = (np.asarray(i).astype(np.float32) for i in (base, cand))
    x0, y0, x1, y1 = info["zona"]
    z = np.zeros(A.shape[:2], bool)
    z[y0:y1, x0:x1] = True
    # azul: no quedan pedazos del reverso viejo (manchas, no las orillas delgadas que se ven azules junto a la tinta),
    # sin contar el azul que la base ya tenía fuera de sus cartas (el blob es azul)
    cx0, cy0, cx1, cy1 = ficha["caja_cartas"]
    viejas = np.zeros_like(z)
    viejas[cy0:cy1, cx0:cx1] = True
    v["azul"] = int((ndi.binary_opening(_azul(C) & z) & ~(_azul(A) & ~viejas)).sum())
    if v["azul"] > AZUL_MAX:
        fallas["azul"] = f"quedan {v['azul']} px del azul marino del reverso viejo"
    # rojo: el chroma key del juego no vuelve transparente el marco (lejos de la orilla del fondo, donde es normal)
    rgba = sin_fondo(cand)[0]
    alfa = np.asarray(rgba)[..., 3]
    v["rojo_comido"] = int((_marco(C) & z & ~ndi.binary_dilation(alfa == 0, iterations=2) & (alfa < 250)).sum())
    if v["rojo_comido"] > ROJO_MAX:
        fallas["rojo"] = f"el chroma key se come {v['rojo_comido']} px del rojo de las cartas"
    # caja: con la espera y el parpadeo nuevos, la caja de recorte del juego es la misma (si cambia, cambian las medidas)
    cuadros = {"espera": rgba}
    if parpadeo is not None:
        try:
            cuadros["parpadeo"] = sin_fondo(pegar_ojos(base, parpadeo, cand))[0]
        except ValueError as e:
            fallas["ojos"] = str(e)
    _, box, _ = OPT.preparar(med["pid"], med["angulo"], cuadros)
    if tuple(box) != tuple(med["box"]):
        fallas["caja"] = f"la caja de recorte cambia de {tuple(med['box'])} a {tuple(box)}: cambiarían las medidas del juego"
    return fallas, v


def _poligono_carta(carta, ancho, aspecto):
    """Las esquinas (x, y) de una carta de `ancho` px con la inclinación y la orilla de arriba de `carta`, centrada en
    su medida: para dibujar su tamaño o el objetivo."""
    c_, s_ = np.cos(carta["t"]), np.sin(carta["t"])
    izq, der, _ = carta["linea"]
    uc, a, v0 = (izq + der) / 2, ancho / 2, carta["arriba"]
    return [(u * c_ - v * s_, u * s_ + v * c_)
            for u, v in ((uc - a, v0), (uc + a, v0), (uc + a, v0 + ancho * aspecto), (uc - a, v0 + ancho * aspecto))]


def _punteada(d, puntos, color, ancho=3, paso=7):
    for (xa, ya), (xb, yb) in zip(puntos, puntos[1:] + puntos[:1]):
        n = max(2, int(np.hypot(xb - xa, yb - ya) // paso))
        for i in range(0, n, 2):
            p, q = i / n, (i + 1) / n
            d.line([(xa + (xb - xa) * p, ya + (yb - ya) * p), (xa + (xb - xa) * q, ya + (yb - ya) * q)], fill=color, width=ancho)


def _zoom_cartas(img, info, carta, E=3):
    """La zona al triple con la carta de enfrente: su medida (línea celeste) y el objetivo (punteado amarillo); con el
    tamaño de hoy en rojo si es la carta vieja."""
    with Image.open(REVERSO) as r:
        aspecto = r.size[1] / r.size[0]
    x0, y0, x1, y1 = info["zona"]
    zoom = img.convert("RGB").crop(info["zona"]).resize(((x1 - x0) * E, (y1 - y0) * E), Image.LANCZOS)
    if carta is None:
        return zoom
    d = ImageDraw.Draw(zoom)
    a_px = lambda pts: [((x - x0) * E, (y - y0) * E) for x, y in pts]
    if carta is info["carta"]:
        d.polygon(a_px(_poligono_carta(carta, carta["ancho"], aspecto)), outline=(230, 40, 40), width=2)
    _punteada(d, a_px(_poligono_carta(carta, info["objetivo"], aspecto)), (255, 225, 0))
    c_, s_ = np.cos(carta["t"]), np.sin(carta["t"])
    izq, der, f = carta["linea"]
    d.line(a_px([(u * c_ - f * s_, u * s_ + f * c_) for u in (izq, der + 1)]), fill=(0, 200, 255), width=3)
    return zoom


def _hoja(paneles, rotulo, destino):
    """Paneles lado a lado con un rótulo arriba."""
    alto = max(p.size[1] for p in paneles)
    hoja = Image.new("RGB", (sum(p.size[0] for p in paneles) + 16 * (len(paneles) - 1), alto + 30), "white")
    x = 0
    for p in paneles:
        hoja.paste(p, (x, 30))
        x += p.size[0] + 16
    ImageDraw.Draw(hoja).text((4, 6), rotulo, fill="black", font=fuente(16))
    hoja.save(destino)


def _rotulo(pid, info, medido=None):
    hoy = f"hoy {info['actual']:.0f} px" if medido is None else f"antes {info['actual']:.0f} px, ahora {medido:.0f} px"
    return f"{pid}: {hoy}, objetivo {info['objetivo']:.0f} px ({info['factor'] - 1:+.0%})"


def detalle_cartas(final, info, destino, pid):
    """Para revisar: las cartas nuevas al triple, con su medida y el objetivo, y sin fondo (el chroma key del juego)
    sobre gris oscuro a cuadros, para ver que el rojo quedó entero."""
    nuevas = medir_cartas(final, info["zona"], "rojo")
    con_medida = _zoom_cartas(final, info, nuevas[0] if nuevas else None)
    x0, y0, x1, y1 = info["zona"]
    recorte = sin_fondo(final)[0].crop(info["zona"]).resize(con_medida.size, Image.NEAREST)
    cuadros = Image.new("RGBA", con_medida.size, (45, 45, 45, 255))
    d = ImageDraw.Draw(cuadros)
    for y in range(0, con_medida.size[1], 12):
        for x in range((y // 12) % 2 * 12, con_medida.size[0], 24):
            d.rectangle((x, y, x + 11, y + 11), fill=(70, 70, 70, 255))
    cuadros.alpha_composite(recorte)
    _hoja([con_medida, cuadros.convert("RGB")], _rotulo(pid, info, nuevas[0]["ancho"] if nuevas else None), destino)


def gif_antes_ahora(pid, base, final, med, destino):
    """La espera de antes y la nueva, recortadas como en el juego."""
    imgs, box, tam = OPT.preparar(pid, "frente", {"antes": sin_fondo(base)[0], "ahora": sin_fondo(final)[0]})
    imgs = {c: OPT.escalar(i.crop(box), *tam) for c, i in imgs.items()}
    OPT.dibujar_gif(imgs, ["antes", "ahora"], destino, med["reg"].get("waist"), med["reg"].get("face"), 900)


def png64(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def preparar_cartas(pid, ficha):
    """Lo que necesitan el plan y la generación de cartas de un personaje: su base, el color de su fondo, sus medidas
    del juego, el plan (tamaño y zona) y su parpadeo aprobado (o None)."""
    base_path = aprobado(pid, "frente", "espera")
    base = Image.open(base_path).convert("RGB")
    K, tipo, _ = OPT.fondo_de(np.asarray(base).astype(np.float32), os.path.basename(base_path))
    if tipo != ficha["fondo"]:
        sys.exit(f"La ficha de {pid} dice fondo {ficha['fondo']}, pero su base tiene fondo {tipo}.")
    med = medidas(pid, "frente", base)
    info = plan_cartas(pid, base, ficha, med)
    parp_path = aprobado(pid, "frente", "parpadeo")
    parpadeo = Image.open(parp_path).convert("RGB") if os.path.exists(parp_path) else None
    if parpadeo is not None:   # sus ojos cerrados se pegan sobre la espera nueva: no pueden caer en la zona
        x0, y0, x1, y1 = info["zona"]
        if (np.asarray(base)[y0:y1, x0:x1] != np.asarray(parpadeo)[y0:y1, x0:x1]).any():
            sys.exit(f"{pid}: la zona {info['zona']} toca los ojos de su parpadeo; ajusta caja_cartas o caja_manos.")
    return base, K, med, info, parpadeo


def vista_entrada(base, entrada, info, datos, destino, pid):
    """Para --simular: la base y el dibujo que recibiría Gemini, al triple en la zona; en el dibujo, lo que se ve de
    cada franja (amarillo) y el tamaño objetivo de la carta de enfrente."""
    x0, y0, x1, y1 = info["zona"]
    E = 3
    paneles = []
    for img, marcar in ((base, False), (entrada, True)):
        z = img.convert("RGB").crop(info["zona"]).resize(((x1 - x0) * E, (y1 - y0) * E), Image.LANCZOS)
        if marcar:
            d = ImageDraw.Draw(z)
            for f in datos["franjas"]:
                d.polygon([((x - x0) * E, (y - y0) * E) for x, y in f["recorte"]], outline=(255, 225, 0), width=2)
        paneles.append(z)
    tap = ", ".join(f"{t:.0%}" for t in datos["tapado"])
    _hoja(paneles, f"{pid}: hoy {info['actual']:.0f} px -> {info['objetivo']:.0f} px ({info['factor'] - 1:+.0%}); "
                   f"corridas {datos['mover']:+.0f} px; dedos sobre las franjas: {tap}", destino)


def cmd_cartas(args):
    P = cargar_toml(PROMPTS)
    cfg = dict(P["config"])
    if args.modelo:
        cfg["modelo"] = args.modelo
    if args.tamano:
        cfg["image_size"] = args.tamano
    ids = args.personajes or sorted(os.path.splitext(f)[0] for f in os.listdir(FICHAS) if f.endswith(".toml"))
    if not args.simular and len(ids) != 1:
        sys.exit("Se genera un personaje a la vez: cartas <personaje>. Para ver todos sin gastar: cartas --simular")
    filas = []
    for pid in ids:
        ficha = cargar_ficha(pid)
        base, K, med, info, parpadeo = preparar_cartas(pid, ficha)
        entrada, datos = entrada_dibujada(base, ficha, info)
        f_dib, v_dib = revisar_dibujo(entrada, datos, info)
        prompt = prompt_cartas(P, ficha)
        filas.append((pid, info, datos, f_dib, v_dib, costo_estimado(cfg["modelo"], cfg["image_size"], prompt) or 0))
        if args.simular:
            os.makedirs(carpeta(pid), exist_ok=True)
            destino = os.path.join(carpeta(pid), f"entrada-{pid}-frente-espera-cartas.png")
            vista_entrada(base, entrada, info, datos, destino, pid)
            print(f"  {pid}: zona {info['zona']}; el dibujo que recibiría Gemini, en {rel(destino)}\n    prompt: {prompt}\n")
    print(f"Cartas de {CARTA_MESA} unidades de la mesa de ancho (la baraja de la mesa mide 0.1); en px de la base.")
    print(f"  {'personaje':10}{'hoy':>7}{'en mesa':>9}{'objetivo':>10}{'cambio':>8}{'corridas':>10}  dibujo")
    for pid, info, datos, f_dib, v_dib, _ in filas:
        print(f"  {pid:10}{info['actual']:7.1f}{info['actual'] * info['por_px']:9.3f}{info['objetivo']:10.1f}"
              f"{info['factor'] - 1:+8.0%}{datos['mover']:+9.0f}px  "
              + ("bien" if not f_dib else "NO: " + "; ".join(f_dib.values()))
              + f"  (franjas visibles {v_dib['franjas']}, dedos {v_dib['dedos']:.0%}, ancho {v_dib['ancho']})")
    total = sum(f[-1] for f in filas)
    print(f"Costo estimado: ~${total:.2f} USD (hasta ${total * MAX_LLAMADAS:.2f} si todo se reintenta), "
          f"con {cfg['modelo']} a {cfg['image_size']}")
    if args.simular:
        return
    pid, info, datos, f_dib, _, _ = filas[0]
    if f_dib:   # si el dibujo mismo no pasa, Gemini (que respeta lo que recibe) tampoco: no se gasta
        sys.exit(f"{pid}: el dibujo no pasa sus propias revisiones ({'; '.join(f_dib.values())}). Ajústalo antes de gastar.")
    if "pendiente" in ficha:
        sys.exit(f"La ficha de {pid} está pendiente ({ficha['pendiente']}): revísala antes de gastar.")
    if not args.si and input("¿Generar? [s/N] ").strip().lower() not in ("s", "si", "sí"):
        print("Cancelado.")
        return
    generar_cartas(cliente(), cfg, P, ficha, pid, base, K, med, info, parpadeo, entrada, datos)
    print(f"Gastado en total según los registros de arte/generadas/: ${gastado_en_total():.4f} USD")


def generar_cartas(client, cfg, P, ficha, pid, base, K, med, info, parpadeo, entrada, datos):
    """La espera con las cartas nuevas: Gemini recibe el dibujo y redibuja las manos (como mucho MAX_LLAMADAS
    peticiones). De su respuesta solo se toma la zona y, dentro de ella, solo lo que cambió contra el dibujo: donde no
    tocó las cartas, siguen siendo las de código. Luego el parpadeo, con los ojos cerrados de antes, sin gastar."""
    nombre = f"{pid}-frente-espera-cartas"
    os.makedirs(carpeta(pid), exist_ok=True)   # antes de pagar: lo crudo se guarda en cuanto llega
    n = siguiente_version(pid, nombre)
    prefijo = os.path.join(carpeta(pid), con_version(nombre, n))
    entrada.save(f"{prefijo}-entrada.png")   # lo que se manda, para revisarlo junto con lo que regresó
    with open(f"{prefijo}-franjas.json", "w") as f:
        json.dump({"box": list(med["box"]), "mover": datos["mover"],
                   "franjas": franjas_en_fracciones(datos["franjas"], med["box"]),
                   "franjas_px": [{k: v for k, v in fr.items()} for fr in datos["franjas"]]}, f, indent=1, default=float)
    lienzo, dentro = a_cuadrado(entrada, K)
    entrada64 = png64(lienzo)
    zona, crudos, gastado, correcciones, cand, cache = info["zona"], [("dibujo enviado", entrada)], 0, [], None, {}
    print(f"{os.path.basename(prefijo)}: zona {zona}, cartas de {info['objetivo']:.0f} px dibujadas por código", flush=True)
    for intento in range(1, MAX_LLAMADAS + 1):
        prompt = prompt_cartas(P, ficha, correcciones)
        print(f"  llamada {intento} de {MAX_LLAMADAS}...", flush=True)
        t0, r, error, gen, crudo = time.time(), None, None, None, None
        try:
            r = pedir(client, cfg, prompt, entrada64)
        except Exception as e:   # también cuenta como llamada: un tiempo agotado pudo cobrarse
            error = f"{type(e).__name__} (código {getattr(e, 'status_code', None)}): {str(e)[:300]}"
            if "Free Tier" in str(e):
                sys.exit("    El proyecto de la API key está en el nivel gratuito, que no genera imágenes.")
            if getattr(e, "status_code", None) == 402:
                sys.exit("    La cuenta se quedó sin crédito (402): recarga en AI Studio.")
        if r is not None and r.output_image and r.output_image.data:
            crudo = f"{prefijo}-crudo{intento}.png"
            gen = Image.open(io.BytesIO(base64.b64decode(r.output_image.data))).convert("RGB")
            gen.save(crudo)   # tal cual llegó, antes de cualquier otra cosa: ya está pagada
            if gen.size != lienzo.size:
                gen = gen.resize(lienzo.size, Image.LANCZOS)
            gen = gen.crop(dentro)
        usd, tokens = costo(cfg["modelo"], r.usage) if r is not None else (None, None)
        gastado += usd or 0
        if gen is None:
            fallas, v = {"sin_imagen": f"no regresó imagen ({error or r.status})"}, {}
        else:
            cand, mz = componer_cartas(base, entrada, gen, zona, datos)
            fallas, v = revisar(base, gen, cand, "cartas", zona, mz, med, cache)
            f2, v2 = revisar_cartas(base, cand, info, med, parpadeo, ficha, datos)
            fallas.update(f2)
            v.update(v2)
            crudos.append((f"Gemini, llamada {intento}", gen))
        with open(os.path.join(carpeta(pid), "registro.jsonl"), "a") as f:
            f.write(json.dumps({
                "fecha": datetime.now().isoformat(timespec="seconds"), "cuadro": os.path.basename(prefijo),
                "cambio": 1, "zona": "cartas", "llamada": intento, "archivo": os.path.basename(crudo) if crudo else None,
                "modelo": cfg["modelo"], "tamano": cfg["image_size"], "base": rel(aprobado(pid, "frente", "espera")),
                "entrada": rel(f"{prefijo}-entrada.png"), "prompt": prompt,
                "costo_usd": round(usd, 5) if usd is not None else None,
                "tokens": tokens, "error": error, "revisiones": fallas, "medidas": v,
            }, ensure_ascii=False, default=str) + "\n")
        print(f"    {time.time() - t0:.0f} s" + (f", ${usd:.4f}" if usd is not None else ", sin costo reportado")
              + (f" -> {rel(crudo)}" if crudo else ""), flush=True)
        if not fallas:
            print("    revisiones: todas bien  " + ", ".join(f"{k} {x:.3g}" if isinstance(x, float) else f"{k} {x}"
                                                     for k, x in v.items() if k != "caja"), flush=True)
            break
        print("    FALLÓ: " + "; ".join(fallas.values()), flush=True)
        correcciones = correcciones_cartas(P, fallas)
    if fallas:   # se acabaron las llamadas
        if cand is not None:
            guardar_cartas(pid, prefijo, n, base, crudos, cand, info, med, parpadeo, falla=True)
        print(f"  {os.path.basename(prefijo)}: no pasó las revisiones en {MAX_LLAMADAS} llamadas. "
              + (f"Lo último quedó en {rel(prefijo)}-FALLA.png (y su -comparacion, -detalle y GIF). " if cand is not None else "")
              + f"Costo: ${gastado:.4f} USD.")
        return
    guardar_cartas(pid, prefijo, n, base, crudos, cand, info, med, parpadeo)
    print(f"    costo: ${gastado:.4f} USD")


def guardar_cartas(pid, prefijo, n, base, crudos, cand, info, med, parpadeo, falla=False):
    """Lo que se deja para revisar: el cuadro (o -FALLA), la hoja de comparación contra la base, las cartas de cerca,
    el GIF antes/ahora y, si pasó, el parpadeo con los ojos cerrados de antes y su GIF."""
    p = f"{prefijo}-FALLA" if falla else prefijo
    cand.save(f"{p}.png")
    hoja_comparacion(base, crudos, cand, [info["zona"]], f"{p}-comparacion.jpg")
    detalle_cartas(cand, info, f"{p}-detalle.png", pid)
    gif_antes_ahora(pid, base, cand, med, f"{p}.gif")
    if falla:
        return
    print(f"  Listo, por revisar: {rel(p)}.png\n    antes y ahora, como en el juego: {rel(p)}.gif\n"
          f"    las cartas de cerca (medida y sin fondo): {rel(p)}-detalle.png\n"
          f"    comparación (base, dibujo, Gemini, final): {rel(p)}-comparacion.jpg")
    if parpadeo is not None:
        nombre_p = os.path.join(carpeta(pid), con_version(f"{pid}-frente-parpadeo-cartas", n))
        pegar_ojos(base, parpadeo, cand).save(f"{nombre_p}.png")
        gif_revision(pid, "frente", cand, Image.open(f"{nombre_p}.png").convert("RGB"), "parpadeo", med, f"{nombre_p}.gif")
        print(f"    parpadeo (los ojos cerrados de antes, sin gastar): {rel(nombre_p)}.png y su GIF {rel(nombre_p)}.gif")


def cmd_recomponer_cartas(args):
    """Vuelve a armar el cuadro de una versión con las respuestas de Gemini ya pagadas (sus -crudoN.png), sin llamar a
    la API: la combinada y las revisiones de hoy. Si una pasa, deja esa versión como si hubiera salido así (para
    aprobar-cartas); si no, rehace sus -FALLA."""
    pid = args.personaje
    ficha = cargar_ficha(pid)
    base, K, med, info, parpadeo = preparar_cartas(pid, ficha)
    entrada, datos = entrada_dibujada(base, ficha, info)
    prefijo = os.path.join(carpeta(pid), con_version(f"{pid}-frente-espera-cartas", args.version))
    if not os.path.exists(f"{prefijo}-entrada.png"):
        sys.exit(f"No encuentro {rel(prefijo)}-entrada.png: esa versión no es del método de cartas dibujadas.")
    if (np.asarray(Image.open(f"{prefijo}-entrada.png").convert("RGB")) != np.asarray(entrada)).any():
        sys.exit("El dibujo de hoy no es el que se mandó en esa versión: no se puede recomponer con él.")
    lienzo, dentro = a_cuadrado(entrada, K)
    crudos, pasa, ultima = [("dibujo enviado", entrada)], None, None
    patron = re.compile(re.escape(os.path.basename(prefijo)) + r"-crudo(\d+)\.png")
    for k in sorted(int(m.group(1)) for f in os.listdir(carpeta(pid)) if (m := patron.fullmatch(f))):
        gen = Image.open(f"{prefijo}-crudo{k}.png").convert("RGB")
        if gen.size != lienzo.size:
            gen = gen.resize(lienzo.size, Image.LANCZOS)
        gen = gen.crop(dentro)
        crudos.append((f"Gemini, llamada {k}", gen))
        cand, mz = componer_cartas(base, entrada, gen, info["zona"], datos)
        fallas, v = revisar(base, gen, cand, "cartas", info["zona"], mz, med, {})
        f2, v2 = revisar_cartas(base, cand, info, med, parpadeo, ficha, datos)
        fallas.update(f2)
        v.update(v2)
        print(f"  llamada {k}: " + ("revisiones: todas bien  " + ", ".join(
            f"{a} {x:.3g}" if isinstance(x, float) else f"{a} {x}" for a, x in v.items() if a != "caja")
            if not fallas else "FALLA: " + "; ".join(fallas.values())), flush=True)
        if not fallas and (pasa is None or args.llamada == k):
            pasa = (k, cand)
        ultima = cand
    if ultima is None:
        sys.exit(f"No hay respuestas guardadas ({os.path.basename(prefijo)}-crudoN.png).")
    if args.llamada and (pasa is None or pasa[0] != args.llamada):
        sys.exit(f"La llamada {args.llamada} no pasa las revisiones.")
    if pasa is None:
        guardar_cartas(pid, prefijo, args.version, base, crudos, ultima, info, med, parpadeo, falla=True)
        print(f"  Ninguna pasa: rehice {rel(prefijo)}-FALLA.png y sus hojas.")
        return
    print(f"  Uso la llamada {pasa[0]}.")
    guardar_cartas(pid, prefijo, args.version, base, crudos, pasa[1], info, med, parpadeo)


def cmd_aprobar_cartas(args):
    """Pasa la espera con las cartas nuevas y su parpadeo a arte/personajes/ (respalda los que reemplazan) y anota sus
    franjas en client/stage/personajes.json."""
    pid = args.personaje
    vs = versiones(pid, f"{pid}-frente-espera-cartas")
    if not vs:
        sys.exit(f"No hay versiones de {pid}-frente-espera-cartas que hayan pasado las revisiones en {rel(carpeta(pid))}/.")
    n = args.version or max(vs)
    if n not in vs:
        sys.exit(f"No existe la versión {n} (hay: {sorted(vs)}).")
    nuevos = {"espera": vs[n]}
    parp = os.path.join(carpeta(pid), con_version(f"{pid}-frente-parpadeo-cartas", n) + ".png")
    if os.path.exists(aprobado(pid, "frente", "parpadeo")):
        if not os.path.exists(parp):
            sys.exit(f"Falta {rel(parp)}, el parpadeo de esa versión.")
        nuevos["parpadeo"] = parp
    hora = f"{datetime.now():%Y%m%d-%H%M%S}"
    for cuadro, origen in nuevos.items():
        destino = aprobado(pid, "frente", cuadro)
        if os.path.exists(destino):
            respaldo = os.path.join(ARTE, "respaldos", f"{pid}-frente-{cuadro}-{hora}.png")
            os.makedirs(os.path.dirname(respaldo), exist_ok=True)
            shutil.copy2(destino, respaldo)
            print(f"  el que estaba quedó respaldado en {rel(respaldo)}")
        shutil.copy2(origen, destino)
        print(f"  {rel(origen)} -> {rel(destino)}")
    # las franjas de las cartas, para que el juego les escriba la etiqueta (igual en espera y en parpadeo)
    datos = json.load(open(os.path.join(carpeta(pid), con_version(f"{pid}-frente-espera-cartas", n) + "-franjas.json")))
    reg = OPT.leer_registro()
    reg[pid]["angles"]["frente"]["franjas"] = {cuadro: datos["franjas"] for cuadro in nuevos}
    OPT.escribir_registro(reg)
    print(f"  franjas de {', '.join(nuevos)} en {rel(OPT.REGISTRO)}")
    print(f"Sigue, para que el juego lo use:\n"
          f"  .venv-rembg/bin/python scripts/optimizar-arte.py personajes {pid}\n"
          f"  .venv-rembg/bin/python scripts/optimizar-arte.py registrar {pid}\n"
          f"  .venv-rembg/bin/python scripts/optimizar-arte.py gif {pid}")


def main():
    ap = argparse.ArgumentParser(description="Genera los cuadros de un personaje editando su base aprobada con Gemini.")
    sub = ap.add_subparsers(dest="comando", required=True)
    g = sub.add_parser("generar", help="genera los cuadros de siempre que falten (o los de --pose)")
    g.add_argument("personaje")
    g.add_argument("--pose", action="append", help="frente-parpadeo, frente-espia, frente-gana... (se puede repetir)")
    g.add_argument("--simular", action="store_true", help="muestra prompts, zonas y costo sin llamar a la API")
    g.add_argument("--si", action="store_true", help="no pedir confirmación")
    g.add_argument("--modelo", help="otro modelo en vez del de prompts-personaje.toml")
    g.add_argument("--tamano", choices=["1K", "2K", "4K"], help="otro tamaño en vez del de prompts-personaje.toml")
    a = sub.add_parser("aprobar", help="pasa un cuadro revisado a arte/personajes/ (respalda el que reemplace)")
    a.add_argument("personaje")
    a.add_argument("--pose", action="append", required=True, help="por ejemplo frente-parpadeo (se puede repetir)")
    a.add_argument("--version", type=int, help="otra versión en vez de la más reciente, por ejemplo 2")
    c = sub.add_parser("cartas", help="el reverso de la baraja en las cartas de la mano, del mismo tamaño en la mesa")
    c.add_argument("personajes", nargs="*", help="uno para generar; sin nombres (con --simular), todos los de scripts/fichas/")
    c.add_argument("--simular", action="store_true", help="la tabla de tamaños, las zonas y el prompt, sin llamar a la API")
    c.add_argument("--si", action="store_true", help="no pedir confirmación")
    c.add_argument("--modelo", help="otro modelo en vez del de prompts-personaje.toml")
    c.add_argument("--tamano", choices=["1K", "2K", "4K"], help="otro tamaño en vez del de prompts-personaje.toml")
    rc = sub.add_parser("recomponer-cartas", help="rearma una versión con sus respuestas ya pagadas, sin llamar a la API")
    rc.add_argument("personaje")
    rc.add_argument("--version", type=int, required=True, help="la versión de <id>-frente-espera-cartas, por ejemplo 2")
    rc.add_argument("--llamada", type=int, help="usar la respuesta de esta llamada (sin esto, la primera que pase)")
    ac = sub.add_parser("aprobar-cartas", help="pasa la espera con el reverso nuevo y su parpadeo a arte/personajes/")
    ac.add_argument("personaje")
    ac.add_argument("--version", type=int, help="otra versión en vez de la más reciente, por ejemplo 2")
    args = ap.parse_args()
    {"generar": cmd_generar, "aprobar": cmd_aprobar, "cartas": cmd_cartas, "recomponer-cartas": cmd_recomponer_cartas,
     "aprobar-cartas": cmd_aprobar_cartas}[args.comando](args)


if __name__ == "__main__":
    main()
