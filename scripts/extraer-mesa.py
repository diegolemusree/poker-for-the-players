"""Extrae la mesa de referencia/composicion.png por zonas, sin que Gemini la vuelva a dibujar.

Pedirle a Gemini que quite todo menos la mesa de una sola vez no sirve: cuando hay que quitar más de la mitad de la
imagen, dibuja otra mesa (otra perspectiva, otro lugar). Por eso, como con los personajes, la mesa sale de la referencia
píxel por píxel y Gemini solo repinta zonas chicas, una por llamada:

  0. calibrar la cámara del juego y la forma de la mesa que explican la orilla del fieltro y la pista dorada de la
             referencia (gratis)
  1. subir   la referencia a 4K sin cambiar nada (una llamada); se revisa contra la original reducida
  2. zonas   cada zona (lo del centro, la mano, la izquierda y la derecha con lo del fondo) es una llamada con un
             recorte de 2048 px alrededor de ella, a 2K; de lo que regresa solo se toma lo que cambió dentro de la zona
             (con las sombras de lo quitado), corregido de color con la diferencia de alrededor para que el sombreado
             siga al de la referencia y no queden siluetas de lo quitado. Revisiones: nada se corrió afuera de la zona
             (en ningún cuarto del recorte), sí cambió algo, la pista dorada y la orilla del fieltro siguen donde dice
             la calibración y no quedan restos (fichas, cartas, piel ni texto) en la mesa. Antes de pagar una zona se
             prueba con lo que ya regresó Gemini en llamadas anteriores (gratis)
  3. recortar el garaje se quita sin IA: fuera de la silueta de la mesa (el riel y su canto, sin patas: los
             octágonos calibrados, ajustados a su línea de tinta) todo se vuelve magenta (gratis)
  4. hoja    la referencia y la mesa extraída lado a lado y cada zona de cerca, para aprobarla
  5. aprobar la pasa a arte/mesa/mesa-horizontal.png (con su silueta); luego scripts/calcar-mesa.py saca la cámara y
             la orilla del juego y scripts/optimizar-arte.py mesa la exporta

USO (desde poker-for-the-players/, con el entorno de recortar.py)
    .venv-rembg/bin/python scripts/extraer-mesa.py calibrar         # gratis; antes de las zonas (las revisa)
    .venv-rembg/bin/python scripts/extraer-mesa.py todo --simular   # prompts, zonas y costo, sin gastar
    .venv-rembg/bin/python scripts/extraer-mesa.py todo             # subir y todas las zonas que falten (con tope)
    .venv-rembg/bin/python scripts/extraer-mesa.py aceptar izquierda 1   # gratis: un intento que el usuario aprobó
    .venv-rembg/bin/python scripts/extraer-mesa.py recortar         # gratis
    .venv-rembg/bin/python scripts/extraer-mesa.py hoja             # gratis
    .venv-rembg/bin/python scripts/extraer-mesa.py aprobar          # con el OK del usuario
Todo queda en arte/generadas/mesa/zonas/: base-4k.png, una base por zona ya aplicada, lo crudo de cada llamada y el
registro en arte/generadas/mesa/registro.jsonl (entra al total gastado).
"""
import argparse, base64, importlib.util, io, json, os, subprocess, sys, tempfile, threading, time
from datetime import datetime

sys.dont_write_bytecode = True
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
from skimage.color import rgb2hsv
from skimage.filters import apply_hysteresis_threshold

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("generar_personaje", os.path.join(ROOT, "scripts", "generar-personaje.py"))
GP = importlib.util.module_from_spec(_spec)   # el cliente de Gemini, los costos y el OCR
_spec.loader.exec_module(GP)
OPT = GP.OPT
REFERENCIA = os.path.join(ROOT, "referencia", "composicion.png")
CFG = {"modelo": "gemini-nano-banana-2.1"}   # ver precios en ai.google.dev/gemini-api/docs/pricing
DIR = os.path.join(ROOT, "arte", "generadas", "mesa", "zonas")
PID = "mesa"   # el registro va con el de la mesa: arte/generadas/mesa/registro.jsonl

K = 4                 # la referencia (1024 x 559) a 4K: 4096 x 2236
LADO = 4096           # el cuadrado que se manda para subir (la referencia centrada con magenta arriba y abajo)
RECORTE = 2048        # lado del recorte que se manda por zona (y lo que regresa a 2K)
TOPE = 8              # llamadas en total para toda la extracción, cuenten o no
UMBRAL = 40           # diferencia por canal (0 a 255) para contar un píxel como cambiado
UMBRAL_DEBIL = 12     # lo pegado a un cambio fuerte que también se toma (las sombras de lo quitado)
SOMBRA = 60           # px (a 4K) alrededor de lo que cambió mucho que no cuentan para el sombreado de fondo: ahí
                      # caen las sombras de lo quitado (las del vaso y la mano miden ~150 px)
CORRIDO_MAX = 0.5     # px (a 4K) que puede correrse lo de afuera de la zona, en cualquier cuarto del recorte
FUERA_MAX = 0.08      # fracción de lo de afuera de la zona que puede cambiar: Gemini redibuja las líneas un poco
                      # (~2%); si es otra imagen, cambia mucho más
PISTA_MIN = 0.85      # de la pista calibrada que cae en lo repintado, cuánto debe tener dorado a PISTA_TOL px
PISTA_TOL = 10
PISTA_ANCHO = 28      # px (a 4K) del centro de la pista: mide ~32 de ancho y Gemini la pone hasta ~6 más allá
ORO_MAX = 1500        # px dorados que pueden sobrar en el fieltro repintado (lejos de la pista)
ORILLA_MIN = 0.7      # de la orilla del fieltro calibrada que cae en lo repintado, cuánto debe tener tinta a 10 px
                      # (en la referencia, 0.86: al fondo la orilla casi no lleva línea)
SUBIR_DIF = 12        # mediana de la diferencia (0 a 255) de la referencia a 4K reducida contra la original
SUBIR_CORRIDO = 0.6   # px (de la original) que puede correrse la referencia a 4K

# Zonas en px de composicion.png: la caja donde se toma lo que cambió y qué se le pide quitar y pintar debajo. Van en
# este orden: cada recorte ya trae lo de las anteriores. (Al principio eran 6; el brazo del blob y los tentáculos se
# juntaron con lo del fondo de su lado para que alcanzaran las llamadas.)
RIEL = "the thick wooden rail with its wood grain and ink outline, the green felt with its soft shading and the golden line where it passes"
ZONAS = [
    ("centro", (335, 325, 770, 540),
     "the pile of chips, the five cards lying in a row, the two card decks and the word printed on the felt",
     "the green felt with its soft shading and the thin golden racetrack line where it passes"),
    ("mano", (0, 325, 405, 559),
     "the hand and arm holding two cards, the two cards it holds, the glass and the chips next to it", RIEL),
    ("izquierda", (140, 250, 550, 380),
     "everything lying on the left and far side of the table: the blue arm, the hands and arms resting on the table, "
     "all the chip stacks, the cards and the dice", RIEL),
    ("derecha", (545, 250, 1024, 425),
     "everything lying on the right and far side of the table: the purple tentacles, the hands and arms resting on the "
     "table, all the chip stacks, the cards, the glass and the dice", RIEL),
]

PROMPT_SUBIR = """Return this exact same picture at a higher resolution. Change nothing: keep every character, object, \
line, color, shape and position exactly as it is, and keep the flat magenta bars above and below exactly as they are. \
Do not add, remove or redraw anything."""
# La frase "Remove all of it" va desde la primera llamada: sin ella, Gemini solo quitó el letrero (centro, intento 1).
PROMPT_ZONA = """Edit the attached picture. Change only one thing: remove {cosas} from the poker table and paint the \
table underneath exactly the way the rest of the table is drawn: {debajo}. Remove all of it: no remains of chips, \
cards, hands, arms or tentacles on the table; only the table. Everything else stays exactly identical, pixel for \
pixel: the rest of each character, the rest of the table, the garage, the line work, the colors, the framing and the \
size. Do not add text, letters, numbers or logos anywhere. Do not move, resize or redraw anything else."""
CORRECCIONES = {
    "alineacion": "Keep everything in exactly the same position and size as in the attached picture.",
    "sin_cambio": "Make sure those objects are completely removed.",
    "restos": "Look again: remove every chip, card, die, glass, hand, arm and tentacle from the table.",
    "pista": "Continue the golden racetrack line exactly where it runs, with the same width and color.",
    "orilla": "Keep the edge of the green felt and the ink line along the inside of the wooden rail exactly where they are.",
    "texto": "Do not draw any text, letters, numbers or symbols.",
    "sin_imagen": "Return the edited image.",
}


def rel(p):
    return os.path.relpath(p, ROOT)


# ---------- utilidades ----------

def verde_puro(hsv):
    """El verde del fieltro (y cualquier verde), de una imagen en HSV."""
    h, sat, val = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    return (h > 60) & (h < 170) & (sat > 0.15) & (val > 0.12)


def dist_a_poligono(P, S):
    """Distancia exacta de cada punto a la orilla del polígono cerrado S."""
    AB = np.roll(S, -1, axis=0) - S
    AP = P[:, None, :] - S[None]
    t = np.clip((AP * AB[None]).sum(-1) / np.maximum((AB ** 2).sum(-1), 1e-12)[None], 0, 1)
    return np.linalg.norm(AP - t[..., None] * AB[None], axis=2).min(axis=1)


def recortar_convexo(P, Q):
    """La parte del polígono convexo P que queda adentro del polígono convexo Q (Sutherland-Hodgman)."""
    lado = lambda a, b, p: (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    sg = 1.0 if sum(lado(Q[i], Q[(i + 1) % len(Q)], Q[(i + 2) % len(Q)]) for i in range(len(Q))) > 0 else -1.0
    out = list(P)
    for i in range(len(Q)):
        a, b = Q[i], Q[(i + 1) % len(Q)]
        entra, out = out, []
        for j in range(len(entra)):
            p, q = entra[j], entra[(j + 1) % len(entra)]
            dp, dq = sg * lado(a, b, p), sg * lado(a, b, q)
            if dp >= 0:
                out.append(p)
            if (dp >= 0) != (dq >= 0):
                out.append(p + dp / (dp - dq) * (q - p))
        if not out:
            break
    return np.array(out)


def fieltro_visible(cam, E, k, rail_y):
    """El fieltro como lo dibuja table.js: el anillo k de la orilla a la altura 0, tapado de mi lado por el riel en su
    orilla de adentro (el mismo anillo a la altura del riel)."""
    return recortar_convexo(cam.proyectar(E[:, 0] * k, 0.0, E[:, 1] * k), cam.proyectar(E[:, 0] * k, rail_y, E[:, 1] * k))


def textos(img, caja):
    """Lo que el OCR lee en la imagen a la mitad y en la caja tal cual. None si no hay OCR o si tronó: el OCR de macOS
    a veces falla en rachas ("e5rt..."), así que cada vista se reintenta hasta 3 veces antes de rendirse."""
    binario = GP.ocr_listo()
    if not binario:
        return None
    leidos = set()
    for vista in (img.resize((img.size[0] // 2, img.size[1] // 2), Image.LANCZOS), img.crop(caja)):
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
            vista.save(t.name)
        try:
            for intento in range(3):
                r = subprocess.run([binario, t.name], capture_output=True, text=True, timeout=180)
                if r.returncode == 0:
                    break
                time.sleep(2)
            else:
                return None
        finally:
            os.remove(t.name)
        for linea in r.stdout.splitlines():
            conf, _, texto = linea.partition("\t")
            if any(c.isalnum() for c in texto) and float(conf) >= 0.3:
                leidos.add(texto.strip())
    return leidos


def png64(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def peticion(client, modelo, tamano, prompt, img):
    """UNA petición a Gemini con el texto y una imagen cuadrada, sin reintentos (avisa cada 30 s que sigue esperando)."""
    listo, inicio = threading.Event(), time.time()

    def avisar():
        while not listo.wait(30):
            print(f"      ... {time.time() - inicio:.0f} s", flush=True)

    threading.Thread(target=avisar, daemon=True).start()
    try:
        return client.interactions.create(
            model=modelo,
            input=[{"type": "text", "text": prompt}, {"type": "image", "data": png64(img), "mime_type": "image/png"}],
            response_format={"type": "image", "aspect_ratio": "1:1", "image_size": tamano},
            timeout=1800,   # las ediciones grandes tardan; si se corta de nuestro lado, pudo cobrarse sin regresar nada
        )
    finally:
        listo.set()


def ruta(nombre):
    return os.path.join(DIR, nombre)


def llamadas_hechas():
    """Llamadas de esta extracción en el registro (cuenten o no: también las que no regresaron imagen)."""
    p = os.path.join(GP.carpeta(PID), "registro.jsonl")
    if not os.path.exists(p):
        return 0
    with open(p) as f:
        return sum(1 for l in f if l.strip() and json.loads(l).get("cuadro", "").startswith("zonas-"))


def anotar(cuadro, intento, archivo, cfg, tamano, prompt, usd, tokens, error, fallas, v):
    with open(os.path.join(GP.carpeta(PID), "registro.jsonl"), "a") as f:
        f.write(json.dumps({
            "fecha": datetime.now().isoformat(timespec="seconds"), "cuadro": cuadro, "llamada": intento, "archivo": archivo,
            "modelo": cfg["modelo"], "tamano": tamano, "base": rel(REFERENCIA), "prompt": prompt,
            "costo_usd": round(usd, 5) if usd is not None else None, "tokens": tokens, "error": error,
            "revisiones": fallas, "medidas": v,
        }, ensure_ascii=False, default=str) + "\n")


def pedir(client, cfg, prompt, img, tamano):
    """UNA llamada (sin reintentos). Regresa (imagen o None, usd, tokens, error)."""
    r, error = None, None
    try:
        r = peticion(client, cfg["modelo"], tamano, prompt, img)
    except Exception as e:   # también cuenta: un tiempo agotado pudo cobrarse
        error = f"{type(e).__name__} (código {getattr(e, 'status_code', None)}): {str(e)[:300]}"
        if "Free Tier" in str(e) or getattr(e, "status_code", None) == 402:
            sys.exit(f"    La API no genera: {error}")
    gen = None
    if r is not None and r.output_image and r.output_image.data:
        gen = Image.open(io.BytesIO(base64.b64decode(r.output_image.data))).convert("RGB")
    usd, tokens = GP.costo(cfg["modelo"], r.usage) if r is not None else (None, None)
    return gen, usd, tokens, error or (None if gen else f"no regresó imagen ({getattr(r, 'status', None)})")


# ---------- 1. subir ----------

def cuadrado(ref):
    """La referencia centrada en un cuadrado con magenta arriba y abajo, y cuánto quedó arriba (px de la referencia)."""
    w, h = ref.size
    lienzo = Image.new("RGB", (w, w), (255, 0, 255))
    lienzo.paste(ref, (0, (w - h) // 2))
    return lienzo, (w - h) // 2


def revisar_subida(gen, ref, arriba):
    """La referencia a 4K reducida contra la original: casi igual y sin correrse."""
    w, h = ref.size
    banda = gen.crop((0, arriba * K, w * K, (arriba + h) * K))
    chica = np.asarray(banda.resize((w, h), Image.LANCZOS)).astype(np.float32)
    orig = np.asarray(ref).astype(np.float32)
    v = {"dif_mediana": float(np.median(np.abs(chica - orig).max(axis=2)))}
    # corrimiento por correlación de fase de los bordes
    a, b = [ndi.sobel(x.mean(axis=2), 0) ** 2 + ndi.sobel(x.mean(axis=2), 1) ** 2 for x in (orig, chica)]
    Fa, Fb = np.fft.fft2(a), np.fft.fft2(b)
    c = np.fft.ifft2(Fa * np.conj(Fb) / (np.abs(Fa * np.conj(Fb)) + 1e-9)).real
    dy, dx = np.unravel_index(np.argmax(c), c.shape)
    dy, dx = (dy - h if dy > h // 2 else dy), (dx - w if dx > w // 2 else dx)
    v["corrido_px"] = float(np.hypot(dx, dy))
    fallas = {}
    if v["dif_mediana"] > SUBIR_DIF:
        fallas["sin_cambio"] = f"la referencia a 4K no es la misma imagen (diferencia típica {v['dif_mediana']:.0f}/255)"
    elif v["corrido_px"] > SUBIR_CORRIDO:
        fallas["alineacion"] = f"la referencia a 4K se corrió {v['corrido_px']:.1f} px"
    return fallas, v, banda


# ---------- 2. zonas ----------

def caja_recorte(caja, alto_banda):
    """El recorte de RECORTE px (en la referencia a 4K, sin magenta) centrado en la zona, dentro de la imagen."""
    x0, y0, x1, y1 = (c * K for c in caja)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    rx = min(max(0, cx - RECORTE // 2), LADO - RECORTE)
    ry = min(max(0, cy - RECORTE // 2), max(0, alto_banda - RECORTE))
    return rx, ry


def con_relleno(img, alto):
    """Si la banda es más baja que el recorte, el recorte se completa con magenta abajo."""
    if img.size[1] >= alto:
        return img
    out = Image.new("RGB", (img.size[0], alto), (255, 0, 255))
    out.paste(img, (0, 0))
    return out


def suavizar_hacia_adentro(v, w, niveles=12):
    """v (alto, ancho, canales) rellenado donde el peso w (0 a 1) es bajo con el promedio suave de alrededor
    (pirámide: se promedia hacia abajo con los pesos y se rellena hacia arriba)."""
    if niveles == 0 or min(w.shape) < 4:
        return np.broadcast_to((v * w[..., None]).sum(axis=(0, 1)) / max(float(w.sum()), 1e-6), v.shape).copy()
    H, W = w.shape
    vw, ww = ndi.gaussian_filter(v * w[..., None], (1, 1, 0))[::2, ::2], ndi.gaussian_filter(w, 1)[::2, ::2]
    abajo = suavizar_hacia_adentro(vw / np.maximum(ww, 1e-6)[..., None], np.clip(ww * 4, 0, 1), niveles - 1)
    arriba = ndi.gaussian_filter(np.repeat(np.repeat(abajo, 2, axis=0), 2, axis=1)[:H, :W], (1, 1, 0))
    return v * w[..., None] + arriba * (1 - w[..., None])


def corrimientos(A, G, m):
    """Cuánto se corrió G contra A (px) en cada cuarto del recorte, por correlación de fase de los bordes, solo con lo
    de la máscara m. Un corrimiento en un cuarto o en direcciones opuestas (otra escala) se nota aunque el total no."""
    def bordes(x):
        g = x.mean(axis=2)
        return np.hypot(ndi.sobel(g, 0), ndi.sobel(g, 1))
    a, b = bordes(A), bordes(G)
    H, W = m.shape
    out = []
    for y0, x0 in ((0, 0), (0, W // 2), (H // 2, 0), (H // 2, W // 2)):
        q = np.zeros_like(m)
        q[y0:y0 + H // 2, x0:x0 + W // 2] = True
        q &= m
        if q.sum() < 20000:
            continue
        R = np.fft.fft2(a * q) * np.conj(np.fft.fft2(b * q))
        c = np.fft.ifft2(R / (np.abs(R) + 1e-9)).real
        i, j = np.unravel_index(np.argmax(c), c.shape)

        def sub(f0, f1, f2):
            den = f0 - 2 * f1 + f2
            return 0.0 if den == 0 else 0.5 * (f0 - f2) / den
        dy = (i - H if i > H // 2 else i) + sub(c[(i - 1) % H, j], c[i, j], c[(i + 1) % H, j])
        dx = (j - W if j > W // 2 else j) + sub(c[i, (j - 1) % W], c[i, j], c[i, (j + 1) % W])
        out.append(float(np.hypot(dx, dy)))
    return out


def tomar_zona(base, gen, zona):
    """Lo que Gemini repintó en la zona, pegado sin costura ni fantasmas. Regresa (resultado, huella, fallas, medidas).
    - Gemini suele re-sombrear todo el fieltro; primero se quita esa diferencia de fondo para que no esconda cambios
      (letras claras) ni los invente. Se estima donde nada cambió mucho: con una mediana a escala gruesa, un objeto
      grande (el brazo) se volvía "fondo" y dejaba una mancha de su color.
    - La huella: lo que cambió dentro de la zona, por histéresis (fuerte > UMBRAL y, pegado a eso, débil >
      UMBRAL_DEBIL: también las sombras de lo quitado), sin motas ni huecos y un poco crecida.
    - Dentro de la huella va lo de Gemini más una corrección de color suave: la diferencia original menos Gemini donde
      nada cambió (adentro o afuera de la zona), llevada hacia adentro. Así el sombreado sigue al de la referencia y no
      quedan siluetas de lo quitado.
    Revisiones: lo de afuera de la zona no se corrió en ningún cuarto del recorte (ni cambió de más) y sí cambió algo."""
    A, G = (np.asarray(x).astype(np.float32) for x in (base, gen))
    H, W = A.shape[:2]
    z = np.zeros((H, W), bool)
    x0, y0, x1, y1 = zona
    z[y0:y1, x0:x1] = True
    D = A - G
    Ds = ndi.gaussian_filter(D, (3, 3, 0))

    def sin_motas(m):
        lab, n = ndi.label(m)
        return np.isin(lab, np.arange(1, n + 1)[ndi.sum(m, lab, range(1, n + 1)) >= 200]) if n else m

    grande = ndi.binary_fill_holes(ndi.binary_closing(sin_motas(np.abs(D).max(axis=2) > UMBRAL), iterations=6))
    lejos = ndi.distance_transform_edt(~grande) > SOMBRA   # sin lo cambiado ni sus sombras
    fondo = ndi.gaussian_filter(suavizar_hacia_adentro(Ds, lejos.astype(np.float32)), (16, 16, 0))
    d = np.abs(D - fondo).max(axis=2)
    cambio = sin_motas(apply_hysteresis_threshold(d, UMBRAL_DEBIL, UMBRAL))
    huella = ndi.binary_dilation(ndi.binary_fill_holes(ndi.binary_closing(cambio & z, iterations=6)), iterations=6) & z
    w = (~ndi.binary_dilation(cambio | huella | grande, iterations=3)).astype(np.float32)
    h = suavizar_hacia_adentro(Ds, w)
    alfa = ndi.gaussian_filter(huella.astype(np.float32), 2.5)[..., None]
    out = (A * (1 - alfa) + (G + h) * alfa).round().clip(0, 255).astype(np.uint8)

    v, fallas = {}, {}
    fuera = ~ndi.binary_dilation(z, iterations=40)
    v["fuera"] = round(float((np.abs(D).max(axis=2)[fuera] > UMBRAL).mean()), 4)
    v["corrido_px"] = [round(c, 2) for c in corrimientos(A, G, fuera)]
    if v["corrido_px"] and max(v["corrido_px"]) > CORRIDO_MAX:
        fallas["alineacion"] = f"afuera de la zona algo se corrió {max(v['corrido_px']):.1f} px (tope {CORRIDO_MAX})"
    elif v["fuera"] > FUERA_MAX:
        fallas["alineacion"] = f"afuera de la zona cambió el {v['fuera']:.1%} (tope {FUERA_MAX:.0%}): se redibujó"
    v["cambio_px"] = int(huella.sum())
    if v["cambio_px"] < 2000:
        fallas["sin_cambio"] = f"casi nada cambió en la zona ({v['cambio_px']} px)"
    return Image.fromarray(out), huella, fallas, v


def poligono(P, size, dx=0, dy=0):
    m = Image.new("L", size)
    ImageDraw.Draw(m).polygon([(float(x) - dx, float(y) - dy) for x, y in P], fill=255)
    return np.asarray(m) > 0


def muestras(P, paso=2.0):
    """Puntos cada `paso` px sobre el polígono cerrado P."""
    out = []
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        n = max(1, int(np.linalg.norm(b - a) / paso))
        out += [a + (b - a) * k / n for k in range(n)]
    return np.array(out)


def geometria():
    """De la calibración, en px de la referencia a 4K: la pista dorada, la orilla del fieltro que se ve y la orilla de
    afuera del riel (el octágono que mejor se pega a una línea de tinta, sin ajustarlo punto por punto)."""
    p = np.array(json.load(open(CALIBRACION))["p"])
    A, B, C, Wt, At, Bt, Ct, ry, pitch, dist, F, cx, cy = p
    cam = Cam(pitch, dist, F * K, cx * K, cy * K)
    Et = octagono(Wt, At, Bt, Ct)
    return {"pista": cam.proyectar(Et[:, 0], 0.0, Et[:, 1]),
            "fieltro": fieltro_visible(cam, octagono(W_FIELTRO, A, B, C), 1.0, ry),
            "riel": orilla_del_riel(Image.open(REFERENCIA).convert("RGB"), p, 1, ajustar=False)[0] * K}


def lineas_en(img, huella, region, geo, dx, dy):
    """En lo repintado: la pista dorada sigue donde dice la calibración (y no sobra dorado en el fieltro) y la orilla
    del fieltro conserva su línea de tinta. Solo cuenta lo que cae en la huella y en la región de la zona (lo de las
    zonas que siguen, como las cartas de la mano junto al centro, todavía está)."""
    rgb = np.asarray(img)
    hsv = rgb2hsv(rgb)
    h, s, val = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    oro = (h > 25) & (h < 70) & (s > 0.3) & (val > 0.25) & (val < 0.95)
    tinta = rgb.max(axis=2) < 90
    H, W = huella.shape
    huella = huella & region
    v, fallas = {}, {}

    def cubierta(P, mascara, tol):
        M = muestras(P - [dx, dy])
        M = M[(M[:, 0] >= 0) & (M[:, 0] < W) & (M[:, 1] >= 0) & (M[:, 1] < H)].astype(int)
        M = M[huella[M[:, 1], M[:, 0]]]
        if len(M) < 100:
            return None
        return round(float((ndi.distance_transform_edt(~mascara)[M[:, 1], M[:, 0]] <= tol).mean()), 3)

    v["pista"] = cubierta(geo["pista"], oro, PISTA_TOL)
    linea = Image.new("L", (W, H))
    ImageDraw.Draw(linea).line([(float(x) - dx, float(y) - dy) for x, y in np.vstack([geo["pista"], geo["pista"][:1]])],
                               fill=255, width=3)
    fieltro = ndi.binary_erosion(poligono(geo["fieltro"], (W, H), dx, dy), iterations=12)
    v["oro_de_mas"] = int((oro & huella & fieltro & (ndi.distance_transform_edt(np.asarray(linea) == 0) > PISTA_ANCHO)).sum())
    if v["pista"] is not None and v["pista"] < PISTA_MIN:
        fallas["pista"] = f"la pista dorada no sigue donde va: cubre {v['pista']:.0%} (mínimo {PISTA_MIN:.0%})"
    elif v["oro_de_mas"] > ORO_MAX:
        fallas["pista"] = f"sobra dorado en el fieltro, lejos de la pista ({v['oro_de_mas']} px)"
    v["orilla"] = cubierta(geo["fieltro"], tinta, 10)
    if v["orilla"] is not None and v["orilla"] < ORILLA_MIN:
        fallas["orilla"] = f"la orilla del fieltro perdió su línea: {v['orilla']:.0%} (mínimo {ORILLA_MIN:.0%})"
    return fallas, v


def restos_en(img, region):
    """En la región (la mesa, dentro de la orilla del riel): nada que no sea mesa (fieltro verde, madera café, la
    pista, lo oscuro) en manchas grandes, ni piel, ni texto."""
    rgb = np.asarray(img)[::2, ::2]
    reg = region[::2, ::2]
    hsv = rgb2hsv(rgb)
    h, s, val = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    verde = verde_puro(hsv)
    cafe = ((h < 50) | (h > 340)) & (s > 0.25) & (val < 0.78)
    oscuro = val < 0.22
    dorado = (h > 25) & (h < 70) & (s > 0.3) & (val < 0.95)
    piel = (h > 10) & (h < 45) & (s > 0.15) & (s < 0.6) & (val > 0.78)
    raro = reg & (~(verde | cafe | oscuro | dorado) | piel)
    raro = ndi.binary_opening(raro, iterations=3)
    lab, n = ndi.label(raro)
    areas = ndi.sum(raro, lab, range(1, n + 1)) * 4 if n else np.array([])
    v = {"restos": int((areas >= 1500).sum())}
    fallas = {}
    if v["restos"]:
        grande = int(np.argmax(areas)) + 1
        yy, xx = np.nonzero(lab == grande)
        v["resto_mayor"] = {"px": int(areas.max()), "x": int(xx.mean() * 2), "y": int(yy.mean() * 2)}
        fallas["restos"] = f"quedan {v['restos']} manchas que no son mesa (la más grande, {int(areas.max())} px)"
    ys, xs = np.nonzero(region)
    if len(ys):
        caja = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        sub = Image.fromarray(np.where(region[..., None], np.asarray(img), 0).astype(np.uint8)).crop(caja)
        leidos = textos(sub, (0, 0) + sub.size)
        v["texto"] = sorted(leidos) if leidos is not None else "OCR falló: revísalo a ojo"
        if leidos:
            fallas["texto"] = f"el OCR lee texto: {', '.join(sorted(leidos))}"
    return fallas, v


# ---------- 3. calibrar y recortar el garaje (gratis) ----------
CALIBRACION = os.path.join(ROOT, "arte", "mesa", "calibracion.json")
W_FIELTRO = 0.85   # los lados del fieltro van a ±0.85 (la escala de la mesa: la orilla a ±1)


class Cam:
    """view.project de projection.js con pitch y dist (la cámara mira al centro de la mesa) y la proyección F, cx, cy."""
    def __init__(self, pitch, dist, F, cx, cy):
        t = np.radians(pitch)
        self.sp, self.cp = float(np.sin(t)), float(np.cos(t))
        self.Cy, self.Cz = dist * self.sp, dist * self.cp
        self.F, self.cx, self.cy = F, cx, cy
    def proyectar(self, x, y, z):
        dy, dz = np.asarray(y, float) - self.Cy, np.asarray(z, float) - self.Cz
        s = self.F / (-dy * self.sp - dz * self.cp)
        return np.column_stack([self.cx + np.asarray(x, float) * s, self.cy - (dy * self.cp - dz * self.sp) * s])


def octagono(W, A, B, C):
    return np.array([(W, A), (B, C), (-B, C), (-W, A), (-W, -A), (-B, -C), (B, -C), (W, -A)])


def datos_de_calibracion(ref):
    """De la referencia, en sus px: la orilla del fieltro donde topa con la madera del riel (no donde la tapa una mano o
    una ficha, que solo tienen tinta) y el eje de la pista dorada donde corre entre fieltro."""
    hsv = rgb2hsv(np.asarray(ref))
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    verde = verde_puro(hsv)
    verde[:292] = False   # arriba del riel lejano: el alien
    dorado = (h > 38) & (h < 66) & (s > 0.3) & (v > 0.25) & (v < 0.9)
    fel = ndi.binary_closing(verde | dorado, iterations=2)
    lab, n = ndi.label(fel)
    fel = ndi.binary_fill_holes(lab == int(np.argmax(ndi.sum(fel, lab, range(1, n + 1)))) + 1)
    cafe = ((h < 45) | (h > 340)) & (s > 0.3) & (v > 0.2) & (v < 0.62)
    riel = cafe | (v < 0.2)
    fuera = np.maximum(ndi.uniform_filter((~fel).astype(float), 13), 1e-6)
    f_riel = ndi.uniform_filter((riel & ~fel).astype(float), 13) / fuera
    f_cafe = ndi.uniform_filter((cafe & ~fel).astype(float), 13) / fuera
    ys, xs = np.nonzero((fel & ~ndi.binary_erosion(fel)) & (f_riel > 0.7) & (f_cafe > 0.35))
    O = np.column_stack([xs, ys]).astype(float)
    pis = dorado & ndi.binary_erosion(fel, iterations=3)
    lab, n = ndi.label(pis)
    quedan = []
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() >= 40:
            anillo = ndi.binary_dilation(m, iterations=4) & ~ndi.binary_dilation(m, iterations=1)
            if verde[anillo].mean() >= 0.8:
                quedan.append(i)
    from skimage.morphology import skeletonize
    ty, tx = np.nonzero(skeletonize(np.isin(lab, quedan)))
    return O, np.column_stack([tx, ty]).astype(float)


def calibrar(O, T):
    """La cámara del juego (pitch, dist), la proyección de la referencia (F, cx, cy), el fieltro (octágono simétrico) y la
    pista (su propio octágono) que mejor explican la orilla del fieltro y la pista, desde varios puntos de partida; se
    ajusta dos veces, la segunda sin lo que quedó a más de 8 px (partes tapadas). Ojo: con una sola imagen, una mesa
    más honda vista desde más abajo se confunde con una más ancha vista desde más arriba; para recortar da igual."""
    from scipy.optimize import least_squares

    def modelo(p):
        A, B, C, Wt, At, Bt, Ct, ry, pitch, dist, F, cx, cy = p
        cam = Cam(pitch, dist, F, cx, cy)
        Et = octagono(Wt, At, Bt, Ct)
        return cam, fieltro_visible(cam, octagono(W_FIELTRO, A, B, C), 1.0, ry), cam.proyectar(Et[:, 0], 0.0, Et[:, 1])

    def res(p, O):
        cam, Fm, Tm = modelo(p)
        if len(Fm) < 3:
            return np.full(len(O) + len(T), 200.0)
        return np.concatenate([dist_a_poligono(O, Fm), dist_a_poligono(T, Tm)])

    lo = [0.05, 0.2, 0.3, 0.3, 0.03, 0.15, 0.2, 0.0, 5, 0.6, 30, 300, -3000]
    hi = [0.5, 0.8, 1.0, 0.85, 0.5, 0.8, 1.0, 0.15, 80, 4.0, 30000, 700, 4000]

    def mejor(O):
        m = None
        for pitch in (15, 25, 35, 45):
            for dist in (1.0, 1.5, 2.2):
                cam0 = Cam(pitch, dist, 1, 0, 0)
                E = octagono(W_FIELTRO, .17, .49, .53)
                P = cam0.proyectar(E[:, 0], 0, E[:, 1])
                F = (O[:, 0].max() - O[:, 0].min()) / (P[:, 0].max() - P[:, 0].min())
                x0 = np.clip(np.array([.17, .49, .53, .6, .14, .38, .4, .03, pitch, dist, F, 512, O[:, 1].min() - F * P[:, 1].min()]),
                             np.array(lo) + 1e-6, np.array(hi) - 1e-6)
                try:
                    r = least_squares(lambda p: res(p, O), x0, bounds=(lo, hi), loss="soft_l1", f_scale=1.5, diff_step=1e-3,
                                      x_scale="jac", max_nfev=4000)
                except Exception:
                    continue
                c = float(np.abs(r.fun).mean())
                if m is None or c < m[0]:
                    m = (c, r.x)
        return m[1]

    p = mejor(O)
    Oi = O[np.abs(res(p, O))[: len(O)] <= 8]
    p = mejor(Oi)
    d = np.abs(res(p, Oi))
    return p, {"orilla_prom": float(d[: len(Oi)].mean()), "orilla_p95": float(np.percentile(d[: len(Oi)], 95)),
               "pista_prom": float(d[len(Oi):].mean()), "pista_p95": float(np.percentile(d[len(Oi):], 95)),
               "orilla_usada": len(Oi), "orilla_total": len(O)}


def orilla_del_riel(img, p, escala, ajustar=True):
    """La orilla de afuera del riel en la imagen (con `escala` px por px de la referencia): el octágono del fieltro
    agrandado y a la altura que más se pegan a una línea de tinta, y luego (si `ajustar`) cada punto ajustado a la
    línea más oscura a menos de 8 px (de la referencia) por su normal, sin brincos."""
    A, B, C, _, _, _, _, _, pitch, dist, F, cx, cy = p
    cam = Cam(pitch, dist, F * escala, cx * escala, cy * escala)
    Ef = octagono(W_FIELTRO, A, B, C)
    gris = ndi.gaussian_filter(np.asarray(img).astype(np.float32).mean(axis=2), escala)
    H, Wd = gris.shape

    def contorno(s, yr, paso):
        P = cam.proyectar(Ef[:, 0] * s, yr, Ef[:, 1] * s)
        area = sum(P[i, 0] * P[(i + 1) % 8, 1] - P[(i + 1) % 8, 0] * P[i, 1] for i in range(8))
        pts, nrm = [], []
        for i in range(8):
            a0, a1 = P[i], P[(i + 1) % 8]
            L = np.linalg.norm(a1 - a0)
            t = (a1 - a0) / L
            nn = np.array([t[1], -t[0]]) * (1 if area > 0 else -1)   # hacia afuera
            for k in range(max(1, int(L / paso))):
                pts.append(a0 + k / max(1, int(L / paso)) * (a1 - a0))
                nrm.append(nn)
        return np.array(pts), np.array(nrm)

    def muestra(P):
        x, y = P[:, 0], P[:, 1]
        ok = (x > 1) & (x < Wd - 2) & (y > 1) & (y < H - 2)
        v = np.full(len(P), np.nan)
        v[ok] = ndi.map_coordinates(gris, [y[ok], x[ok]], order=1)
        return v

    def puntaje(s, yr):
        P, N = contorno(s, yr, 2.0 * escala)
        return np.nanmean(muestra(P) - (muestra(P + N * 4 * escala) + muestra(P - N * 4 * escala)) / 2)

    _, s, yr = min(((puntaje(s, yr), s, yr) for s in np.arange(1.05, 1.40, 0.01) for yr in np.arange(0.0, 0.12, 0.01)),
                   key=lambda t: t[0])
    P, N = contorno(s, yr, 1.0 * escala)
    if not ajustar:
        return P, float(s), float(yr)
    desp = np.arange(-8, 8.5, 0.5) * escala
    perfiles = np.stack([muestra(P + N * dd) for dd in desp], axis=1)
    mejor_d = desp[np.nanargmin(np.where(np.isnan(perfiles), 1e9, perfiles), axis=1)]
    mejor_d = ndi.median_filter(mejor_d, size=int(15 * escala) | 1)
    return P + N * mejor_d[:, None], float(s), float(yr)


def _corridas(cl):
    """[(clase, inicio, fin)] de una tira de clases."""
    out, i = [], 0
    while i < len(cl):
        j = i
        while j + 1 < len(cl) and cl[j + 1] == cl[i]:
            j += 1
        out.append((cl[i], i, j))
        i = j + 1
    return out


def _orilla_por_estructura(cl, escala):
    """En una tira de clases por la normal de una cara del fondo (v fieltro, # tinta, c café, . otra cosa), dónde
    termina la orilla de afuera del riel: [fieltro][tinta][café angosto, el borde de adentro][tinta][café ancho, el
    riel][tinta: la orilla]. Índice o None si la tira no tiene esa forma (un brazo o una mano encima)."""
    rs = _corridas(cl)
    k = 0
    while k < len(rs) and not (rs[k][0] == "v" and rs[k][2] - rs[k][1] >= escala):
        k += 1
    while k + 1 < len(rs) and rs[k + 1][0] == "v":
        k += 1
    tintas, ancho = 0, False
    for c, a, b in rs[k + 1:]:
        if c == "#":
            tintas += 1
            if tintas == 3 and ancho:
                return b + 1
        elif c == "c":
            ancho = ancho or (tintas == 2 and b - a >= 2.5 * escala)
        elif c == "v" or (c == "." and b - a >= 0.75 * escala):
            return None
    return None


def orillas_del_fondo(img, cam, Ef, caras, escala):
    """La orilla de afuera del riel en cada cara del fondo, como recta de la imagen: por la normal de la cara, desde la
    orilla del fieltro, la estructura del riel (_orilla_por_estructura); con los puntos que la tienen, una recta casi
    paralela a la orilla del fieltro (RANSAC: los brazos y manos encima no cuadran). Regresa {cara: (punto, dirección,
    puntos en la recta)}; una cara con menos de 20 se queda fuera."""
    a_ = np.asarray(img)
    hsv = rgb2hsv(a_)
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    clases = np.full(h.shape, ".", dtype="<U1")
    clases[((h < 50) | (h > 340)) & (s > 0.25) & (v < 0.78)] = "c"
    clases[verde_puro(hsv)] = "v"
    clases[v < 0.22] = "#"
    H, W = h.shape
    centro = cam.proyectar(np.array([0.0]), 0.0, np.array([0.0]))[0]
    ds = np.arange(-15 * escala, 55 * escala)
    rng = np.random.default_rng(0)
    out = {}
    for i in caras:
        e0, e1 = Ef[i], Ef[(i + 1) % 8]
        P0, P1 = cam.proyectar(np.array([e0[0], e1[0]]), 0.0, np.array([e0[1], e1[1]]))
        t = (P1 - P0) / np.linalg.norm(P1 - P0)
        n = np.array([t[1], -t[0]])
        n = n if n @ ((P0 + P1) / 2 - centro) > 0 else -n
        pts = []
        for u in np.linspace(0.08, 0.92, int(np.linalg.norm(P1 - P0) / escala)):
            Q = np.round((P0 + (P1 - P0) * u)[None] + n[None] * ds[:, None]).astype(int)
            if not ((Q[:, 0] >= 0) & (Q[:, 0] < W) & (Q[:, 1] >= 0) & (Q[:, 1] < H)).all():
                continue
            d = _orilla_por_estructura("".join(clases[Q[:, 1], Q[:, 0]]), escala)
            if d is not None and d < len(ds):
                pts.append(P0 + (P1 - P0) * u + n * ds[d])
        if len(pts) < 20:
            continue
        pts = np.array(pts)
        mejor = None
        for _ in range(400):
            a, b = pts[rng.choice(len(pts), 2, replace=False)]
            dd = b - a
            if np.linalg.norm(dd) < 12 * escala:
                continue
            nn = np.array([-dd[1], dd[0]]) / np.linalg.norm(dd)
            if abs(nn @ t) > np.sin(np.radians(8)):   # casi paralela a la orilla del fieltro
                continue
            dentro = np.abs((pts - a) @ nn) < escala
            if mejor is None or dentro.sum() > mejor.sum():
                mejor = dentro
        if mejor is None or mejor.sum() < 20:
            continue
        q = pts[mejor]
        c = q.mean(axis=0)
        out[i] = (c, np.linalg.svd(q - c)[2][0], int(mejor.sum()))
    return out


def _cruce(p1, d1, p2, d2):
    """Donde se cruzan las rectas p1 + t·d1 y p2 + s·d2."""
    t = np.linalg.solve(np.column_stack([d1, -d2]), p2 - p1)[0]
    return p1 + t * d1


def silueta_de_la_mesa(img, p, escala):
    """La silueta de la mesa sin patas: la orilla de arriba del riel (orilla_del_riel) y, en las caras que miran a la
    cámara, el canto que baja de ella hasta su orilla de abajo (la altura cuya línea más se pega a una línea de tinta
    en esas caras). Es la envolvente de los dos octágonos, como tableOutline() del juego; luego cada punto se ajusta a
    la línea más oscura a menos de 8 px (de la referencia) por su normal, sin brincos. El riel sale de la referencia
    original (en la imagen a 4K, aun reducida, la búsqueda se va a sus límites); el canto, de la imagen reducida al
    tamaño de la referencia; el ajuste fino, a tamaño completo.
    Al fondo, la orilla de afuera del riel queda más alta que lo que da el octágono del frente (el riel tiene altura y
    al fondo se ve de canto): ahí sale de la estructura del riel dibujado (orillas_del_fondo) y el ajuste fino es de
    solo 3 px, porque a 8 px brincaba a la línea del fieltro y se comía el riel. Regresa (puntos, medidas)."""
    from scipy.spatial import ConvexHull
    A, B, C, _, _, _, _, _, pitch, dist, F, cx, cy = p
    chica = img.resize((round(img.size[0] / escala), round(img.size[1] / escala)), Image.LANCZOS) if escala != 1 else img
    _, s, yr = orilla_del_riel(Image.open(REFERENCIA).convert("RGB"), p, 1, ajustar=False)
    E = octagono(W_FIELTRO, A, B, C) * s
    cam1 = Cam(pitch, dist, F, cx, cy)
    gris1 = ndi.gaussian_filter(np.asarray(chica).astype(np.float32).mean(axis=2), 1)
    cam = Cam(pitch, dist, F * escala, cx * escala, cy * escala)
    gris = ndi.gaussian_filter(np.asarray(img).astype(np.float32).mean(axis=2), escala)
    H, Wd = gris.shape

    def muestra(P, g=None):
        g = gris if g is None else g
        H, Wd = g.shape
        x, y = P[:, 0], P[:, 1]
        ok = (x > 1) & (x < Wd - 2) & (y > 1) & (y < H - 2)
        v = np.full(len(P), np.nan)
        v[ok] = ndi.map_coordinates(g, [y[ok], x[ok]], order=1)
        return v

    def lados(P, paso):
        """Puntos cada `paso` px sobre el polígono cerrado P y la normal hacia afuera de cada uno."""
        area = sum(P[i, 0] * P[(i + 1) % len(P), 1] - P[(i + 1) % len(P), 0] * P[i, 1] for i in range(len(P)))
        pts, nrm = [], []
        for i in range(len(P)):
            a0, a1 = P[i], P[(i + 1) % len(P)]
            L = np.linalg.norm(a1 - a0)
            if L < 1e-6:
                continue
            t = (a1 - a0) / L
            n = max(1, int(L / paso))
            pts += [a0 + k / n * (a1 - a0) for k in range(n)]
            nrm += [np.array([t[1], -t[0]]) * (1 if area > 0 else -1)] * n
        return np.array(pts), np.array(nrm)

    # las caras que miran a la cámara (la cámara está en x = 0, z = dist·cos(pitch))
    zc = dist * np.cos(np.radians(pitch))
    caras = []
    for i in range(8):
        a, b = E[i], E[(i + 1) % 8]
        m = (a + b) / 2
        n = np.array([b[1] - a[1], -(b[0] - a[0])])
        n = n if n @ m > 0 else -n
        if n @ (np.array([0.0, zc]) - m) > 0:
            caras.append(i)

    def puntaje(yc):
        vals = []
        for i in caras:
            a, b = E[i], E[(i + 1) % 8]
            P = cam1.proyectar(np.array([a[0], b[0]]), yc, np.array([a[1], b[1]]))
            n_ = max(2, int(np.linalg.norm(P[1] - P[0]) / 2))
            Q = P[0] + (P[1] - P[0]) * np.linspace(0.05, 0.95, n_)[:, None]
            t = (P[1] - P[0]) / np.linalg.norm(P[1] - P[0])
            N = np.array([t[1], -t[0]])
            vals.append(muestra(Q, gris1) - (muestra(Q + N * 3, gris1) + muestra(Q - N * 3, gris1)) / 2)
        v = np.concatenate(vals)
        return np.nanmean(v) if np.isfinite(v).mean() > 0.2 else np.inf

    yc = min(yr - np.arange(0.03, 0.15, 0.005), key=puntaje)

    # el riel del fondo: el riel tiene altura y al fondo se ve de canto, así que su orilla de afuera no es la del
    # octágono del frente (ahí quedaba a media banda y se comía el riel): en las caras de atrás sale de las rectas de
    # orillas_del_fondo, y sus puntas, de cruzarlas entre sí y con los lados
    E0 = E / s
    Pa = cam.proyectar(E[:, 0], yr, E[:, 1])
    atras = [i for i in range(8) if E0[i, 1] < 0 and E0[(i + 1) % 8, 1] < 0]
    rectas = orillas_del_fondo(img, cam, E0, atras, escala)
    if len(rectas) == len(atras):
        L = {i: (Pa[i], Pa[(i + 1) % 8] - Pa[i]) for i in range(8)}
        L.update({i: (c, d) for i, (c, d, _) in rectas.items()})
        for i in range(8):
            if i in rectas or (i - 1) % 8 in rectas:
                Pa[i] = _cruce(*L[(i - 1) % 8], *L[i])
    Pt = np.vstack([Pa, cam.proyectar(E[:, 0], yc, E[:, 1])])
    P, N = lados(Pt[ConvexHull(Pt).vertices], 1.0 * escala)
    # ajuste fino: 8 px (de la referencia) de cada lado, salvo arriba de las puntas de los lados de atrás: 3 px
    y_atras = max(Pa[i, 1] for i in range(8) if E0[i, 1] < 0)
    tope = np.where(P[:, 1] <= y_atras, 3.0, 8.0) * escala
    desp = np.arange(-8, 8.5, 0.5) * escala
    perfiles = np.stack([muestra(P + N * dd) for dd in desp], axis=1)
    perfiles[np.abs(desp)[None, :] > tope[:, None]] = np.nan
    nada = np.isnan(perfiles).all(axis=1)   # fuera de la imagen (el frente): se queda donde está
    mejor_d = desp[np.nanargmin(np.where(np.isnan(perfiles), 1e9, perfiles), axis=1)]
    mejor_d[nada] = 0
    mejor_d = ndi.median_filter(mejor_d, size=int(15 * escala) | 1)
    return P + N * mejor_d[:, None], {"riel_veces_fieltro": float(s), "riel_alto": float(yr), "canto_abajo": float(yc),
                                      "caras_con_canto": caras,
                                      "rectas_del_fondo": {i: n for i, (_, _, n) in rectas.items()}}


# ---------- 3b. limpiar lo que Gemini dejó sobre la mesa (gratis) ----------
# Gemini no quitó las manos que los personajes recargan en el riel del fondo (la de la mujer, las del robot con sus
# cartas) y quedaron pedacitos en las orillas de las cajas. Se quitan sin IA, copiando la misma mesa: al fondo, la banda
# del riel de la cara espejo (columnas completas, para llevarse también la sombra del brazo) o de un tramo limpio de la
# misma cara; en las demás caras, un tramo limpio corrido a lo largo de la cara.

def clases_de_mesa(a_):
    """Por píxel: v fieltro, c madera, # tinta, . otra cosa."""
    hsv = rgb2hsv(a_)
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    cl = np.full(h.shape, ".", dtype="<U1")
    cl[((h < 50) | (h > 340)) & (s > 0.25) & (v < 0.78)] = "c"
    cl[verde_puro(hsv)] = "v"
    cl[v < 0.22] = "#"
    return cl


def mascara_de_restos(a_, mesa):
    """Dentro de la mesa: lo que no es fieltro, madera, tinta ni la pista, y la piel; más las cartas (su reverso café
    parece madera: lo blanco de su orilla, crecido y relleno, las cubre). Sin motas y un poco crecido."""
    hsv = rgb2hsv(a_)
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    de_mesa = verde_puro(hsv) | (((h < 50) | (h > 340)) & (s > 0.25) & (v < 0.78)) | (v < 0.22) | \
        ((h > 25) & (h < 70) & (s > 0.3) & (v < 0.95))
    piel = (h > 10) & (h < 45) & (s > 0.15) & (s < 0.6) & (v > 0.78)
    raro = ndi.binary_opening(mesa & (~de_mesa | piel), iterations=2)
    raro = ndi.binary_fill_holes(ndi.binary_closing(raro, iterations=14))
    lab, n = ndi.label(raro)
    if n:
        raro = np.isin(lab, np.arange(1, n + 1)[ndi.sum(raro, lab, range(1, n + 1)) >= 300])
    blanco = ndi.binary_opening(mesa & (v > 0.75) & (s < 0.3), iterations=1)
    cartas = ndi.binary_erosion(ndi.binary_fill_holes(ndi.binary_dilation(blanco, iterations=25)), iterations=12)
    return ndi.binary_dilation(raro | cartas, iterations=10) & mesa


def banda_de_cara(clases, cam, Ef, i, escala):
    """La banda del riel de una cara del fondo como dos rectas (en px por la normal, lineales en u a lo largo de la
    cara): la orilla del fieltro (la primera tinta después del fieltro) y la de afuera (_orilla_por_estructura).
    None si no hay suficientes columnas con la forma del riel."""
    H, W = clases.shape
    centro = cam.proyectar(np.array([0.0]), 0.0, np.array([0.0]))[0]
    e0, e1 = Ef[i], Ef[(i + 1) % 8]
    P0, P1 = cam.proyectar(np.array([e0[0], e1[0]]), 0.0, np.array([e0[1], e1[1]]))
    t = (P1 - P0) / np.linalg.norm(P1 - P0)
    n = np.array([t[1], -t[0]])
    n = n if n @ ((P0 + P1) / 2 - centro) > 0 else -n
    ds = np.arange(-15 * escala, 55 * escala)
    pin, pout = [], []
    for u in np.linspace(0.04, 0.96, int(np.linalg.norm(P1 - P0) / escala)):
        Q = np.round((P0 + (P1 - P0) * u)[None] + n[None] * ds[:, None]).astype(int)
        if not ((Q[:, 0] >= 0) & (Q[:, 0] < W) & (Q[:, 1] >= 0) & (Q[:, 1] < H)).all():
            continue
        cl = "".join(clases[Q[:, 1], Q[:, 0]])
        d = _orilla_por_estructura(cl, escala)
        if d is None or d >= len(ds):
            continue
        rs = _corridas(cl)
        k = 0
        while k < len(rs) and not (rs[k][0] == "v" and rs[k][2] - rs[k][1] >= escala):
            k += 1
        while k + 1 < len(rs) and rs[k + 1][0] == "v":
            k += 1
        if k + 1 < len(rs):
            pin.append((u, ds[rs[k + 1][1]]))
            pout.append((u, ds[d]))
    if len(pin) < 20:
        return None
    rng = np.random.default_rng(0)

    def recta(pts):
        pts = np.array(pts, float)
        mejor = None
        for _ in range(300):
            a, b = pts[rng.choice(len(pts), 2, replace=False)]
            if abs(b[0] - a[0]) < 0.1:
                continue
            m = (b[1] - a[1]) / (b[0] - a[0])
            dentro = np.abs(pts[:, 1] - (m * pts[:, 0] + a[1] - m * a[0])) < escala
            if mejor is None or dentro.sum() > mejor.sum():
                mejor = dentro
        return np.polyfit(pts[mejor, 0], pts[mejor, 1], 1)

    (mi, ci), (mo, co) = recta(pin), recta(pout)
    return {"P0": P0, "P1": P1, "n": n, "mi": mi, "ci": ci, "mo": mo, "co": co}


def uv_banda(f, q):
    L = f["P1"] - f["P0"]
    u = ((q - f["P0"]) @ L) / (L @ L)
    din, dout = f["mi"] * u + f["ci"], f["mo"] * u + f["co"]
    return u, ((q - f["P0"]) @ f["n"] - din) / (dout - din)


def punto_banda(f, u, t):
    din, dout = f["mi"] * u + f["ci"], f["mo"] * u + f["co"]
    return f["P0"][None] + (f["P1"] - f["P0"])[None] * u[:, None] + f["n"][None] * (din + (dout - din) * t)[:, None]


def limpiar_restos(img, mesa, p, escala):
    """Quita los restos de la mesa copiando mesa limpia (ver arriba). Regresa (imagen, lo que se cambió, informe)."""
    a_ = np.asarray(img).astype(np.float32)
    H, W = mesa.shape
    R = mascara_de_restos(np.asarray(img), mesa)
    cam = Cam(p[8], p[9], p[10] * escala, p[11] * escala, p[12] * escala)
    Ef = octagono(W_FIELTRO, p[0], p[1], p[2])
    P = cam.proyectar(Ef[:, 0], 0.0, Ef[:, 1])
    clases = clases_de_mesa(np.asarray(img))
    atras = [i for i in range(8) if Ef[i, 1] < 0 and Ef[(i + 1) % 8, 1] < 0]
    espejo = {i: 7 - i + 3 for i in atras}   # 4 <-> 6, 5 <-> 5 (u -> 1 - u)
    bandas = {i: banda_de_cara(clases, cam, Ef, i, escala) for i in atras}
    out, cambiado, informe = a_.copy(), np.zeros((H, W), bool), []
    lab, n = ndi.label(R)

    def limpia(xs2, ys2):
        if xs2.min() < 0 or ys2.min() < 0 or xs2.max() >= W or ys2.max() >= H:
            return False
        return not R[ys2, xs2].any() and (~mesa[ys2, xs2]).mean() <= 0.03

    def pegar(m, fuente):
        """fuente(ys, xs) -> colores; con orilla suave hacia afuera de m."""
        alfa = np.maximum(m.astype(np.float32), ndi.gaussian_filter(ndi.binary_dilation(m, iterations=3).astype(np.float32), 2)) * mesa
        ys, xs = np.nonzero(alfa > 0.01)
        al = alfa[ys, xs][:, None]
        out[ys, xs] = out[ys, xs] * (1 - al) + fuente(ys, xs) * al
        cambiado[ys, xs] = True

    def muestrear(px, py):
        return np.stack([ndi.map_coordinates(a_[..., c], [py, px], order=1) for c in range(3)], axis=-1)

    for k in range(1, n + 1):
        m = lab == k
        ys, xs = np.nonzero(m)
        c = np.array([xs.mean(), ys.mean()])
        caras = []
        for i in range(8):
            a, b = P[i], P[(i + 1) % 8]
            t = (b - a) / np.linalg.norm(b - a)
            caras.append((np.linalg.norm(c - (a + t * np.clip((c - a) @ t, 0, np.linalg.norm(b - a)))), i, t))
        caras.sort(key=lambda q: q[0])
        i = caras[0][1]
        hecho = False
        # 1. un tramo limpio corrido a lo largo de la cara (de la que sigue solo si es chico: en las esquinas); un tramo
        #    de otra cara grande no encaja (otra inclinación)
        for _, i2, t in caras[:2 if m.sum() < 6000 else 1]:
            ancho = abs(xs - c[0]).max() * abs(t[0]) + abs(ys - c[1]).max() * abs(t[1])
            for paso in np.arange(ancho * 2 + 20, ancho * 2 + 900, 10):
                for sg in (1, -1):
                    dx, dy = sg * paso * t
                    if limpia(np.round(xs + dx).astype(int), np.round(ys + dy).astype(int)):
                        pegar(m, lambda yy, xx, dx=dx, dy=dy: muestrear(xx + dx, yy + dy))
                        informe.append({"cara": i2, "px": int(m.sum()), "de": f"corrido ({dx:+.0f}, {dy:+.0f}) px"})
                        hecho = True
                        break
                if hecho:
                    break
            if hecho:
                break
        f, g = bandas.get(i), bandas.get(espejo.get(i))
        if not hecho and i in atras and i != espejo[i] and f is not None and g is not None:
            # 2. al fondo, de lado: la banda espejo, en columnas completas, del tramo más parecido a la banda típica
            u, _ = uv_banda(f, np.column_stack([xs, ys]).astype(float))
            u0, u1 = u.min() - 0.03, u.max() + 0.03
            nu = 300
            us = np.linspace(0, 1, nu)
            T = np.linspace(-0.35, 1.0, 48)
            Pg = punto_banda(g, np.repeat(us, len(T)), np.tile(T, nu)).reshape(nu, len(T), 2)
            tira = muestrear(Pg[..., 0].ravel(), Pg[..., 1].ravel()).reshape(nu, len(T), 3)
            dev = np.abs(tira - np.median(tira, axis=0)[None]).mean(axis=(1, 2))
            mejor = min((np.interp(1 - np.linspace(u0, u1, 40) + cc, us, dev).mean(), cc)
                        for cc in np.linspace(-0.35, 0.35, 71)
                        if 0.03 <= 1 - u1 + cc and 1 - u0 + cc <= 0.97)
            cc = mejor[1]
            col = np.vstack([punto_banda(f, np.array([u0, u1]), np.array([-0.35, -0.35])),
                             punto_banda(f, np.array([u1, u0]), np.array([1.0, 1.0]))])
            m2 = (poligono(col, (W, H)) & mesa) | m

            def fuente(yy, xx, f=f, g=g, cc=cc):
                uu, tt = uv_banda(f, np.column_stack([xx, yy]).astype(float))
                q = punto_banda(g, 1 - uu + cc, tt)
                return muestrear(q[:, 0], q[:, 1])
            pegar(m2, fuente)
            informe.append({"cara": i, "px": int(m.sum()), "de": f"espejo de la cara {espejo[i]} (corrido {cc:+.2f})"})
            hecho = True
        if not hecho:
            informe.append({"cara": i, "px": int(m.sum()), "de": None})
    return Image.fromarray(out.round().clip(0, 255).astype(np.uint8)), cambiado, informe


def recortar_garaje(img, Q, escala=K):
    """Fuera de la silueta de la mesa, magenta (se sale por abajo de la imagen: ahí la mesa llega hasta abajo). Lo que
    no es mesa pegado a la orilla por dentro (puntas de dedos o de brazos que cruzan la orilla del riel) también."""
    m = np.asarray(Image.fromarray(poligono(Q, img.size).astype(np.uint8) * 255)) > 0
    hsv = rgb2hsv(np.asarray(img))
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    de_mesa = verde_puro(hsv) | (((h < 50) | (h > 340)) & (s > 0.25) & (v < 0.78)) | (v < 0.22) | \
        ((h > 25) & (h < 70) & (s > 0.3) & (v < 0.95))
    piel = (h > 10) & (h < 45) & (s > 0.15) & (s < 0.6) & (v > 0.78)
    orilla = m & (ndi.distance_transform_edt(m) <= 4 * escala)
    raro = ndi.binary_opening(orilla & (~de_mesa | piel), iterations=1)
    # solo lo que toca la orilla: crece por lo raro desde afuera
    raro = ndi.binary_propagation(raro & ndi.binary_dilation(~m, iterations=2), mask=raro)
    m = m & ~ndi.binary_dilation(raro, iterations=2)
    alfa = ndi.gaussian_filter(m.astype(np.float32), 1.5)[..., None]
    out = (np.asarray(img) * alfa + np.array([255, 0, 255]) * (1 - alfa)).round().astype(np.uint8)
    return Image.fromarray(out), m


# ---------- comandos ----------

def cargar_estado():
    p = ruta("estado.json")
    return json.load(open(p)) if os.path.exists(p) else {"hechas": []}


def guardar_estado(e):
    json.dump(e, open(ruta("estado.json"), "w"), indent=2)


def revisar_zona(recorte, gen, zona, region, geo, dx, dy):
    """Pega lo de Gemini en la zona y lo revisa. Regresa (resultado, fallas, medidas)."""
    if gen.size != recorte.size:
        gen = gen.resize(recorte.size, Image.LANCZOS)
    nuevo, huella, fallas, v = tomar_zona(recorte, gen, zona)
    for f, m in (lineas_en(nuevo, huella, region, geo, dx, dy), restos_en(nuevo, region)):
        fallas.update(f)
        v.update(m)
    return nuevo, fallas, v


def region_de(nombre, caja, geo, rx, ry, size):
    """Dónde se buscan restos de una zona: su caja, dentro de la mesa (la orilla del riel, un poco hacia adentro) y sin
    las cajas de las zonas que siguen (lo que esas quitarán todavía está)."""
    W, H = size
    r = np.zeros((H, W), bool)
    x0, y0, x1, y1 = (c * K for c in caja)
    r[max(0, y0 - ry):max(0, y1 - ry), max(0, x0 - rx):max(0, x1 - rx)] = True
    r &= ndi.binary_erosion(poligono(geo["riel"], size, rx, ry), iterations=16)
    despues = False
    for otro, c, _, _ in ZONAS:
        if despues:
            x0, y0, x1, y1 = (v * K for v in c)
            r[max(0, y0 - ry):max(0, y1 - ry), max(0, x0 - rx):max(0, x1 - rx)] = False
        despues = despues or otro == nombre
    return r


def cmd_todo(args):
    cfg = dict(CFG)
    os.makedirs(DIR, exist_ok=True)
    if not os.path.exists(CALIBRACION):
        sys.exit("Falta la calibración: corre primero  extraer-mesa.py calibrar  (gratis).")
    ref = Image.open(REFERENCIA).convert("RGB")
    estado = cargar_estado()
    hechas = llamadas_hechas()
    c4, c2 = (GP.costo_estimado(cfg["modelo"], t, PROMPT_ZONA) or 0 for t in ("4K", "2K"))
    faltan = [z for z in ZONAS if z[0] not in estado["hechas"]]
    print(f"Tope {TOPE} llamadas para toda la extracción; ya van {hechas}. Subir a 4K ~${c4:.3f}; cada zona (recorte de "
          f"{RECORTE} px a 2K) ~${c2:.3f}. Faltan: {'subir, ' if not os.path.exists(ruta('base-4k.png')) else ''}"
          f"{', '.join(z[0] for z in faltan) or 'nada'}.")
    if args.simular:
        print(f"\nsubir: {GP.limpiar(PROMPT_SUBIR)}\n")
        for nombre, caja, cosas, debajo in ZONAS:
            print(f"{nombre} {caja}: {GP.limpiar(PROMPT_ZONA.format(cosas=cosas, debajo=debajo))}\n")
        return
    client = None

    # 1. subir
    if not os.path.exists(ruta("base-4k.png")):
        client = GP.cliente()
        lienzo, arriba = cuadrado(ref)
        for intento in (1, 2):
            if llamadas_hechas() >= TOPE:
                sys.exit("Se llegó al tope de llamadas.")
            print(f"subir a 4K (intento {intento})...", flush=True)
            t0 = time.time()
            gen, usd, tokens, error = pedir(client, cfg, GP.limpiar(PROMPT_SUBIR), lienzo, "4K")
            fallas, v, banda = ({"sin_imagen": error}, {}, None) if gen is None else revisar_subida(gen.resize((LADO, LADO), Image.LANCZOS) if gen.size != (LADO, LADO) else gen, ref, arriba)
            if gen is not None:
                gen.save(ruta(f"subir-{intento}-crudo.png"))
            anotar(f"zonas-subir", intento, f"subir-{intento}-crudo.png" if gen else None, cfg, "4K",
                   PROMPT_SUBIR, usd, tokens, error, fallas, v)
            print(f"    {time.time() - t0:.0f} s, ${usd or 0:.4f}; " + ("bien" if not fallas else "FALLÓ: " + "; ".join(fallas.values()))
                  + f"; {v}", flush=True)
            if not fallas:
                banda.save(ruta("base-4k.png"))
                break
        else:
            sys.exit("La referencia a 4K no pasó: me detengo.")

    # 2. zonas, sobre la base que va quedando
    geo = geometria()
    base = Image.open(ruta("base-4k.png")).convert("RGB")
    for nombre, caja, cosas, debajo in ZONAS:
        if nombre in estado["hechas"]:
            base = Image.open(ruta(f"base-{nombre}.png")).convert("RGB")
            continue
        rx, ry = caja_recorte(caja, base.size[1])
        recorte = con_relleno(base.crop((rx, ry, rx + RECORTE, min(base.size[1], ry + RECORTE))), RECORTE)
        zona = (caja[0] * K - rx, caja[1] * K - ry, caja[2] * K - rx, caja[3] * K - ry)
        region = region_de(nombre, caja, geo, rx, ry, recorte.size)

        def aplicar(nuevo):
            alto = min(base.size[1], ry + RECORTE) - ry
            base.paste(nuevo.crop((0, 0, RECORTE, alto)), (rx, ry))
            base.save(ruta(f"base-{nombre}.png"))
            estado["hechas"].append(nombre)
            guardar_estado(estado)

        # gratis: lo que ya regresó Gemini en llamadas anteriores para esta zona; de lo que pase, lo más limpio
        previos = sorted((int(f.split("-")[-2]), f) for f in os.listdir(DIR)
                         if f.startswith(f"{nombre}-") and f.endswith("-crudo.png") and f.split("-")[-2].isdigit())
        pasan = []
        for n_prev, f in previos:
            nuevo, fallas, v = revisar_zona(recorte, Image.open(ruta(f)).convert("RGB"), zona, region, geo, rx, ry)
            print(f"zona {nombre}: lo que ya regresó en el intento {n_prev} (gratis): "
                  + ("bien" if not fallas else "FALLÓ: " + "; ".join(fallas.values())) + f"; {v}", flush=True)
            if not fallas:
                pasan.append((v.get("restos", 0), v.get("oro_de_mas", 0), n_prev, nuevo))
        if pasan:
            _, _, n_prev, nuevo = min(pasan, key=lambda t: t[:3])
            print(f"    uso el intento {n_prev}", flush=True)
            aplicar(nuevo)
            continue

        quedan = 2 - len(previos)   # tope de 2 llamadas por zona, contando las de antes
        if quedan <= 0:
            sys.exit(f"La zona {nombre} ya gastó sus 2 llamadas y nada pasó: me detengo.")
        client = client or GP.cliente()
        correcciones, nuevo = [], None
        primero = (previos[-1][0] if previos else 0) + 1
        for intento in range(primero, primero + quedan):
            if llamadas_hechas() >= TOPE:
                sys.exit(f"Se llegó al tope de {TOPE} llamadas: falta {nombre} y las que siguen.")
            prompt = " ".join([GP.limpiar(PROMPT_ZONA.format(cosas=cosas, debajo=debajo))] + [CORRECCIONES[c] for c in correcciones])
            print(f"zona {nombre} (intento {intento})...", flush=True)
            t0 = time.time()
            gen, usd, tokens, error = pedir(client, cfg, prompt, recorte, "2K")
            v = {}
            if gen is None:
                fallas = {"sin_imagen": error}
            else:
                gen.save(ruta(f"{nombre}-{intento}-crudo.png"))
                nuevo, fallas, v = revisar_zona(recorte, gen, zona, region, geo, rx, ry)
            anotar(f"zonas-{nombre}", intento, f"{nombre}-{intento}-crudo.png" if gen else None, cfg, "2K",
                   prompt, usd, tokens, error, fallas, v)
            print(f"    {time.time() - t0:.0f} s, ${usd or 0:.4f}; " + ("bien" if not fallas else "FALLÓ: " + "; ".join(fallas.values()))
                  + f"; {v}", flush=True)
            if not fallas:
                aplicar(nuevo)
                break
            correcciones = [c for c in fallas if c in CORRECCIONES]
        else:
            if nuevo is not None:
                nuevo.save(ruta(f"{nombre}-FALLA.png"))
            sys.exit(f"La zona {nombre} no pasó en sus 2 llamadas: me detengo"
                     + (f" (lo último quedó en {nombre}-FALLA.png)." if nuevo is not None else "."))
    base.save(ruta("base-zonas.png"))

    # 3. toda la mesa de una vez: lo que quedó en las orillas de las cajas
    fallas, v = restos_en(base, ndi.binary_erosion(poligono(geo["riel"], base.size), iterations=16))
    print(f"Listas todas las zonas: {rel(ruta('base-zonas.png'))}. Toda la mesa: "
          + ("sin restos" if not fallas else "; ".join(fallas.values())) + f"; {v}")
    print(f"Gastado en total según los registros: ${GP.gastado_en_total():.4f} USD")


def cmd_aceptar(args):
    """Aplica lo que ya regresó Gemini en una zona aunque no pase alguna revisión, cuando el usuario lo aprueba (gratis).
    Las zonas de antes tienen que estar hechas; queda anotado en estado.json con lo que falló."""
    estado = cargar_estado()
    nombres = [z[0] for z in ZONAS]
    if args.zona not in nombres:
        sys.exit(f"No hay zona {args.zona}: son {', '.join(nombres)}.")
    i = nombres.index(args.zona)
    faltan = [n for n in nombres[:i] if n not in estado["hechas"]]
    if faltan:
        sys.exit(f"Primero tienen que estar hechas: {', '.join(faltan)}.")
    if args.zona in estado["hechas"]:
        sys.exit(f"La zona {args.zona} ya está hecha.")
    crudo = ruta(f"{args.zona}-{args.intento}-crudo.png")
    if not os.path.exists(crudo):
        sys.exit(f"No existe {rel(crudo)}.")
    base = Image.open(ruta(f"base-{nombres[i - 1]}.png" if i else "base-4k.png")).convert("RGB")
    _, caja, _, _ = ZONAS[i]
    rx, ry = caja_recorte(caja, base.size[1])
    recorte = con_relleno(base.crop((rx, ry, rx + RECORTE, min(base.size[1], ry + RECORTE))), RECORTE)
    zona = (caja[0] * K - rx, caja[1] * K - ry, caja[2] * K - rx, caja[3] * K - ry)
    geo = geometria()
    nuevo, fallas, v = revisar_zona(recorte, Image.open(crudo).convert("RGB"), zona,
                                    region_de(args.zona, caja, geo, rx, ry, recorte.size), geo, rx, ry)
    alto = min(base.size[1], ry + RECORTE) - ry
    base.paste(nuevo.crop((0, 0, RECORTE, alto)), (rx, ry))
    base.save(ruta(f"base-{args.zona}.png"))
    estado["hechas"].append(args.zona)
    estado.setdefault("aceptadas", {})[args.zona] = {"intento": args.intento, "fallas": fallas}
    guardar_estado(estado)
    print(f"zona {args.zona}: apliqué el intento {args.intento}"
          + (f" aunque falló: {'; '.join(fallas.values())}" if fallas else " (pasa las revisiones)") + f"; {v}")


def cmd_calibrar(args):
    ref = Image.open(REFERENCIA).convert("RGB")
    O, T = datos_de_calibracion(ref)
    p, v = calibrar(O, T)
    A, B, C, Wt, At, Bt, Ct, ry, pitch, dist, F, cx, cy = p
    os.makedirs(os.path.dirname(CALIBRACION), exist_ok=True)
    json.dump({"p": p.tolist(), "W": W_FIELTRO, "medidas": v,
               "nota": "px de composicion.png; pitch y dist son una de varias soluciones (mesa más honda o más ancha)"},
              open(CALIBRACION, "w"), indent=2)
    print(f"cámara {pitch:.1f}°, dist {dist:.2f}; error: orilla del fieltro {v['orilla_prom']:.2f} px (p95 {v['orilla_p95']:.1f}), "
          f"pista {v['pista_prom']:.2f} px (p95 {v['pista_p95']:.1f}); {rel(CALIBRACION)}")


def cmd_recortar(args):
    base = Image.open(ruta(args.base)).convert("RGB")
    p = np.array(json.load(open(CALIBRACION))["p"])
    Q, v = silueta_de_la_mesa(base, p, K)
    dentro = ndi.binary_erosion(poligono(Q, base.size), iterations=3)
    limpia, cambiado, informe = limpiar_restos(base, dentro, p, K)
    limpia.save(ruta("base-limpia.png"))
    mesa, mascara = recortar_garaje(limpia, Q)
    mesa.save(ruta("mesa-extraida.png"))
    json.dump(dict(v, silueta_4k=Q.round(1).tolist(), limpieza=informe), open(ruta("silueta.json"), "w"), default=str)
    print(f"{rel(ruta('mesa-extraida.png'))}: la mesa sobre magenta (de {args.base}); riel a {v['riel_veces_fieltro']:.2f} "
          f"veces el fieltro (al fondo, rectas por cara con {v['rectas_del_fondo']} puntos), canto hasta "
          f"{v['riel_alto'] - v['canto_abajo']:.3f} abajo del riel en las caras {v['caras_con_canto']}")
    for r in informe:
        print(f"    resto en la cara {r['cara']} ({r['px']} px): " + (f"copiado de {r['de']}" if r["de"] else "SIN FUENTE: revísalo"))
    fallas, vv = restos_en(limpia, ndi.binary_erosion(dentro, iterations=2))
    print("    toda la mesa: " + ("sin restos" if not fallas else "; ".join(fallas.values())) + f"; {vv}")


def sin_magenta(img, fondo=(58, 58, 62)):
    """La mesa extraída sobre un gris neutro en lugar del magenta (para verla como se verá, sin el color de recorte)."""
    a = np.asarray(img).astype(np.float32)
    mg = np.array([255.0, 0.0, 255.0])
    d = np.abs(a - mg).max(axis=2)
    alfa = np.clip((d - 20) / 60, 0, 1)[..., None]
    # en la orilla, el color sin la parte de magenta que trae del recorte (si no, queda un filo morado)
    limpio = np.clip((a - (1 - alfa) * mg) / np.maximum(alfa, 0.25), 0, 255)
    return Image.fromarray((limpio * alfa + np.array(fondo) * (1 - alfa)).round().astype(np.uint8))


MESA_APROBADA = os.path.join(ROOT, "arte", "mesa", "mesa-horizontal.png")


def cmd_aprobar(args):
    """La mesa extraída (y su silueta a 4K) pasa a arte/mesa/: de ahí la calca scripts/calcar-mesa.py y la exporta
    scripts/optimizar-arte.py mesa."""
    import shutil
    os.makedirs(os.path.dirname(MESA_APROBADA), exist_ok=True)
    shutil.copyfile(ruta("mesa-extraida.png"), MESA_APROBADA)
    sil = json.load(open(ruta("silueta.json")))
    json.dump({"lado": list(Image.open(MESA_APROBADA).size), "silueta": sil["silueta_4k"],
               "nota": "orilla de la mesa en px de mesa-horizontal.png (el recorte del garaje); el frente se sale por abajo"},
              open(MESA_APROBADA.replace(".png", "-silueta.json"), "w"))
    print(f"{rel(MESA_APROBADA)} y su silueta. Sigue: .venv-rembg/bin/python scripts/calcar-mesa.py")


def cmd_hoja(args):
    ref = Image.open(REFERENCIA).convert("RGB")
    mesa = sin_magenta(Image.open(ruta("mesa-extraida.png")).convert("RGB"))
    w, h = ref.size
    W = 1400
    alto = round(h * W / w)
    hoja = Image.new("RGB", (W, 50 + alto * 2 + 20 + len(ZONAS) * 330), "white")
    t = ImageDraw.Draw(hoja)
    t.text((8, 10), "Arriba, la referencia; abajo, la mesa extraída (sin el magenta), a la misma escala. Luego cada zona "
           "que repintó Gemini: referencia | extraída", fill="black", font=GP.fuente(22))
    hoja.paste(ref.resize((W, alto), Image.LANCZOS), (0, 50))
    hoja.paste(mesa.resize((W, alto), Image.LANCZOS), (0, 60 + alto))
    y = 80 + alto * 2
    for nombre, (x0, y0, x1, y1), _, _ in ZONAS:
        za = ref.crop((x0, y0, x1, y1))
        zb = mesa.crop((x0 * K, y0 * K, x1 * K, y1 * K))
        alto_z = 290
        ancho_z = min(round(za.size[0] * alto_z / za.size[1]), (W - 20) // 2)
        alto_z = round(za.size[1] * ancho_z / za.size[0])
        t.text((8, y), nombre, fill="black", font=GP.fuente(20))
        hoja.paste(za.resize((ancho_z, alto_z), Image.LANCZOS), (0, y + 30))
        hoja.paste(zb.resize((ancho_z, alto_z), Image.LANCZOS), (ancho_z + 20, y + 30))
        y += alto_z + 45
    hoja = hoja.crop((0, 0, W, y))
    hoja.save(ruta("hoja.jpg"), quality=90)
    print(rel(ruta("hoja.jpg")))


def main():
    ap = argparse.ArgumentParser(description="Extrae la mesa de composicion.png por zonas.")
    sub = ap.add_subparsers(dest="comando", required=True)
    t = sub.add_parser("todo", help="subir a 4K y repintar las zonas que falten (con tope de llamadas)")
    t.add_argument("--simular", action="store_true")
    a = sub.add_parser("aceptar", help="aplicar un intento ya pagado aunque falle alguna revisión (con OK del usuario)")
    a.add_argument("zona")
    a.add_argument("intento", type=int)
    sub.add_parser("calibrar", help="la cámara y la forma de la mesa de la referencia (gratis)")
    r = sub.add_parser("recortar", help="quitar el garaje por la silueta de la mesa (gratis; después de calibrar)")
    r.add_argument("--base", default="base-zonas.png", help="de qué imagen de zonas/ (para probar: base-4k.png)")
    sub.add_parser("hoja", help="la hoja para aprobar (gratis)")
    sub.add_parser("aprobar", help="pasa la mesa extraída a arte/mesa/ (después de que el usuario la aprueba)")
    args = ap.parse_args()
    {"todo": cmd_todo, "aceptar": cmd_aceptar, "calibrar": cmd_calibrar, "recortar": cmd_recortar,
     "hoja": cmd_hoja, "aprobar": cmd_aprobar}[args.comando](args)


if __name__ == "__main__":
    main()
