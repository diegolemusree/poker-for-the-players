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


def pedir(client, cfg, prompt, entrada_png):
    """UNA petición, sin reintentos (los decide generar_cuadro)."""
    listo = threading.Event()
    inicio = time.time()

    def avisar():
        while not listo.wait(30):
            print(f"      ... {time.time() - inicio:.0f} s", flush=True)

    threading.Thread(target=avisar, daemon=True).start()
    try:
        return client.interactions.create(
            model=cfg["modelo"],
            input=[{"type": "text", "text": prompt}, {"type": "image", "data": entrada_png, "mime_type": "image/png"}],
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


def costo_estimado(modelo, tamano, prompt):
    p = PRECIOS.get(modelo)
    if not p:
        return None
    return (p["imagen"][tamano] + (TOKENS_POR_IMAGEN_ENTRADA + len(prompt) // 4) * p["entrada"] / 1e6
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
    args = ap.parse_args()
    cmd_generar(args) if args.comando == "generar" else cmd_aprobar(args)


if __name__ == "__main__":
    main()
