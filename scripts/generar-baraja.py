"""Genera con Gemini el arte de la baraja nueva: una imagen por corrida, con revisiones automáticas y tope de llamadas.

Gemini nunca dibuja letras, números ni palos. Los índices, los palos, la etiqueta del reverso con su texto, la mitad de
abajo de las figuras (la de arriba girada 180°) y el recorte en forma de pica del as los pone el código
(client/stage/baraja.js). Piezas: el reverso (solo el marco) y el rey; la reina, la jota y el as de picas se agregan
cuando toque, cada uno con sus revisiones.

USO (desde poker-for-the-players/, con el entorno de recortar.py)
    .venv-rembg/bin/python scripts/generar-baraja.py probar                  # las revisiones contra imágenes de prueba
    .venv-rembg/bin/python scripts/generar-baraja.py generar rey --simular   # prompt, referencia y costo, sin gastar
    .venv-rembg/bin/python scripts/generar-baraja.py generar rey             # UNA imagen: máximo 2 llamadas
    .venv-rembg/bin/python scripts/generar-baraja.py revisar arte/generadas/baraja/rey-1-crudo.png   # gratis
    .venv-rembg/bin/python scripts/generar-baraja.py limpiar reverso --intento 2   # gratis: deja solo el marco
    .venv-rembg/bin/python scripts/generar-baraja.py aprobar reverso --intento 2
Todo queda en arte/generadas/baraja/: lo crudo de cada llamada (<pieza>-<n>-crudo.png), sus medidas (<pieza>-<n>.json),
la hoja para revisar (<pieza>-<n>-hoja.jpg) y el registro (registro.jsonl, entra al total gastado). Del reverso, además,
el marco solo (-limpio.png) y la carta lista para el código (-carta.png y -carta.json, con la zona libre donde el código
pone la etiqueta sin tocar el marco). Lo aprobado va a arte/baraja/.

Si una revisión falla, reintenta una vez con una frase sobre lo que falló; máximo MAX_LLAMADAS llamadas por imagen,
cuenten o no (también las que se pasan de tiempo).

REVISIONES DEL REVERSO (solo el marco; el centro va en blanco)
    marco      la orilla de afuera es blanca (sin sombra ni fondo) y el marco rojo corre por los cuatro lados
    centro     adentro del marco no hay nada: ni dibujos ni etiqueta
    palos      ninguna forma de corazón, diamante, pica o trébol (se compara con las formas de client/ui/palos.js)
    texto      el OCR de macOS no lee letras ni números (con 3 reintentos por vista: falla en rachas)
    colores    sin neón ni rosa, morado o verde limón brillantes, y el marco en rojo ladrillo profundo
    plano      el blanco es liso: sin textura, sombreado ni viñeta

REVISIONES DE LAS FIGURAS (la mitad de arriba: de la corona a la cintura, cortada por la orilla de abajo)
    fondo      blanco liso, sin piso, sombra, viñeta ni marco
    encuadre   la corona completa y con aire arriba, el cuerpo cortado limpio por la orilla de abajo de lado a lado (para
               que empate con la mitad girada), centrado y un solo personaje
    tunica     buena parte de la ropa es del rojo ladrillo de la base (el código la cambia por palo)
    palos, texto, colores    como en el reverso
    plano      colores planos: sin degradados ni texturas (calibrado con los personajes del juego)
"""
import argparse, base64, glob, importlib.util, io, json, math, os, re, subprocess, sys, tempfile, threading, time, tomllib
from datetime import datetime

sys.dont_write_bytecode = True   # generar-personaje.py se carga como módulo: que no deje __pycache__ en scripts/
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi
from skimage.color import rgb2hsv, rgb2lab
from skimage.morphology import convex_hull_image, disk

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("generar_personaje", os.path.join(ROOT, "scripts", "generar-personaje.py"))
GP = importlib.util.module_from_spec(_spec)   # el cliente de Gemini, los costos, el OCR y el total gastado
_spec.loader.exec_module(GP)
PROMPTS = os.path.join(ROOT, "scripts", "prompts-baraja.toml")
PALOS_JS = os.path.join(ROOT, "client", "ui", "palos.js")
FONDO = os.path.join(ROOT, "arte", "fondo-garaje.png")
PID = "baraja"
DIR = GP.carpeta(PID)                                   # arte/generadas/baraja
APROBADAS = os.path.join(ROOT, "arte", "baraja")
FIGURAS = ["rey", "reina", "jota"]
PIEZAS = ["reverso"] + FIGURAS
MAX_LLAMADAS = 2       # por imagen, cuenten o no

# La carta del juego: CARD_PX de client/stage/baraja.js al doble, y su papel (PAPEL de baraja.js).
CARTA = (512, 736)
PAPEL = (248, 242, 228)
MARGEN_CARTA = 0.05    # de la orilla de la carta al marco dibujado, en fracción del ancho de la carta
LIBRE_MARGEN = 0.025   # lo que la etiqueta del código se queda lejos del marco, en fracción del ancho de la carta
LIBRE_CELDA = 8        # px (de CARTA) de cada celda de la zona libre

# Límites de las revisiones (calibrados con `probar`). Las medidas en px van como fracción del lado corto.
ORILLA = 0.008         # ancho de la orilla de afuera que debe ser blanca...
ORILLA_BLANCO = 0.90   # ...en esta fracción
BANDA = 0.17           # hasta dónde se busca el marco desde cada orilla
MARCO_COBERTURA = 0.60 # de cada lado (su 60 % de en medio), qué fracción debe tener rojo en la banda
MARCO_DENSIDAD = 0.05  # rojo en toda la banda del marco
CENTRO_ZONA = 0.15     # el centro que debe quedar vacío: el adentro del marco sin este margen (las esquinas del marco
                       # se meten un poco)
CENTRO_LLENO = 0.005   # fracción del centro que puede no ser blanca
CENTRO_COLOR = 0.003   # fracción de adentro del marco que puede ser de un color que no es del marco (dibujitos)
ETIQUETA_GRUESO = 0.012  # para buscar la etiqueta que dibujó Gemini (al limpiar): radio que la separa de las volutas
ETIQUETA_CERCA = 0.08    # ...y debe pasar a esta distancia del centro
PALO_AREA = (350, 0.03)  # tamaño de lo que se compara con los palos: px mínimos y fracción máxima de la imagen
# Parecido (intersección / unión, girándola) a partir del cual una forma se ve como un palo. Los palos dibujados dan
# 0.93 o más; un rectángulo cualquiera llega a 0.89 contra el diamante y un remolino de las volutas, a 0.89 contra el
# corazón.
PALO_IOU = {"s": 0.91, "h": 0.91, "d": 0.915, "c": 0.91}
NEON_MAX = 0.002
PROHIBIDO_MAX = 0.001
PLANO_P99 = 20           # desviación del blanco (0 a 255) que tolera el 99 % del blanco
VINETA_MAX = 0.035       # diferencia de brillo entre el blanco de las esquinas y el del centro
FIG_ORILLA_BLANCA = 0.40 # figuras: de arriba y los lados (sus 3/4 de arriba), cuánto debe ser fondo blanco (menos es
                         # un fondo de color o un marco; lo demás puede ser la corona o la ropa que llega a la orilla)
FIG_AIRE = 0.02          # las filas de hasta arriba que deben ser fondo (la corona completa, con aire)
FIG_CORTE = 0.45         # en la fila de hasta abajo, qué fracción del ancho debe ser figura (cortada en la cintura)
FIG_CENTRO = 0.06        # qué tanto puede estar corrida la figura (fracción del ancho)
FIG_UNO = 0.95           # el pedazo más grande de la figura, de todo lo que no es fondo
TUNICA = (168, 53, 42)   # el rojo ladrillo de la ropa en la base (#A8352A; el código lo cambia por palo)
TUNICA_TOL = 24          # distancia (Lab) a ese rojo para contar como túnica...
TUNICA_MIN = 0.10        # ...y fracción mínima de la figura que debe serlo
TEXTURA_MAX = 0.10       # fracción de la figura (sin las líneas) con textura (los personajes del juego dan hasta 0.006)
DEGRADADO_MAX = 0.25     # fracción de la túnica fuera de sus dos tonos


# ---------- archivos ----------

def rel(path):
    return os.path.relpath(path, ROOT)


def cargar_toml():
    with open(PROMPTS, "rb") as f:
        return tomllib.load(f)


def limpiar(texto):
    return " ".join(texto.split())


def siguiente(pieza):
    """El número de la imagen nueva de una pieza: después de todo lo que ya hay (también lo que falló)."""
    patron = re.compile(rf"^{re.escape(pieza)}-(\d+)-")
    ns = [int(m.group(1)) for f in (os.listdir(DIR) if os.path.isdir(DIR) else []) if (m := patron.match(f))]
    return max(ns) + 1 if ns else 1


def llamadas_de(pieza):
    p = os.path.join(DIR, "registro.jsonl")
    if not os.path.exists(p):
        return 0
    with open(p) as f:
        return sum(1 for l in f if l.strip() and json.loads(l).get("pieza") == pieza)


# ---------- formas de los palos ----------

def palos_js():
    """Las formas de client/ui/palos.js (el mismo archivo que usa el juego), leídas con Node."""
    r = subprocess.run(["node", "--input-type=module", "-e",
                        f"import({json.dumps('file://' + PALOS_JS)}).then(m => console.log(JSON.stringify(m.PALOS)))"],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def poligonos(d, pasos=16):
    """Un path SVG con M, L, C y Z (absolutos) como lista de polígonos."""
    tokens = re.findall(r"[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?", d)
    polys, actual, i, cmd, pos = [], [], 0, None, (0.0, 0.0)
    while i < len(tokens):
        t = tokens[i]
        if t in "MLCZ":
            cmd = t
            i += 1
            if cmd == "Z":
                if actual:
                    polys.append(actual)
                actual = []
            continue
        if cmd == "M":
            pos = (float(tokens[i]), float(tokens[i + 1]))
            actual = [pos]
            i += 2
            cmd = "L"
        elif cmd == "L":
            pos = (float(tokens[i]), float(tokens[i + 1]))
            actual.append(pos)
            i += 2
        elif cmd == "C":
            c1 = (float(tokens[i]), float(tokens[i + 1]))
            c2 = (float(tokens[i + 2]), float(tokens[i + 3]))
            fin = (float(tokens[i + 4]), float(tokens[i + 5]))
            for k in range(1, pasos + 1):
                s = k / pasos
                actual.append(tuple((1 - s) ** 3 * p0 + 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3 * p3
                                    for p0, p1, p2, p3 in zip(pos, c1, c2, fin)))
            pos = fin
            i += 6
        else:
            i += 1
    if actual:
        polys.append(actual)
    return polys


def mascara_palo(d, lado=200, angulo=0.0):
    """La forma de un palo como máscara de lado×lado (la caja de 100 a escala), girada `angulo` grados."""
    img = Image.new("L", (lado, lado), 0)
    t = ImageDraw.Draw(img)
    k = lado / 100
    for poly in poligonos(d):
        t.polygon([(x * k, y * k) for x, y in poly], fill=255)
    if angulo:
        img = img.rotate(angulo, resample=Image.BILINEAR, expand=True, fillcolor=0)
    return np.asarray(img) > 127


LADO_CANON = 64


def canonica(mask, angulo=0.0):
    """La forma centrada en su centro de masa, a un área fija y girada `angulo` grados, en LADO_CANON²."""
    ys, xs = np.nonzero(mask)
    cy, cx = ys.mean(), xs.mean()
    s = math.sqrt(0.28 * LADO_CANON ** 2 / len(ys))
    c = (LADO_CANON - 1) / 2
    v, u = np.mgrid[0:LADO_CANON, 0:LADO_CANON].astype(np.float32)
    a = math.radians(angulo)
    du, dv = (u - c) / s, (v - c) / s
    sx = cx + du * math.cos(a) - dv * math.sin(a)
    sy = cy + du * math.sin(a) + dv * math.cos(a)
    return ndi.map_coordinates(mask.astype(np.float32), [sy, sx], order=1, cval=0) > 0.5


_PLANTILLAS = None


def plantillas():
    global _PLANTILLAS
    if _PLANTILLAS is None:
        _PLANTILLAS = {p: canonica(mascara_palo(d)) for p, d in palos_js().items()}
    return _PLANTILLAS


def parecido_a_palo(comp):
    """(palo, intersección/unión) del palo al que más se parece la forma (relativo a su límite), girándola cada 6°."""
    mejor = {p: 0.0 for p in plantillas()}
    for ang in range(0, 360, 6):
        c = canonica(comp, ang)
        for p, t in plantillas().items():
            mejor[p] = max(mejor[p], float((c & t).sum() / max(1, (c | t).sum())))
    p = max(mejor, key=lambda k: mejor[k] - PALO_IOU[k])
    return p, mejor[p]


# ---------- clases de color y utilidades ----------

def clases(img):
    a = np.asarray(img.convert("RGB")).astype(np.float32) / 255
    hsv = rgb2hsv(a)
    H, S, V = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    return {
        "a": a, "H": H, "S": S, "V": V,
        "blanco": (V > 0.82) & (S < 0.14),
        "tinta": V < 0.30,
        "rojo": ((H < 22) | (H > 340)) & (S > 0.38) & (V > 0.28) & (V < 0.93),
    }


def hexa(rgb):
    return "#" + "".join(f"{int(round(c * 255)):02x}" for c in rgb)


def buscar_etiqueta(C, W, H):
    """Una etiqueta roja que dibujó Gemini (para quitarla al limpiar): lo rojo grueso que pasa por el centro, con su eje
    (de la parte central, donde solo hay etiqueta) y su grueso. None si no hay."""
    m = min(W, H)
    r = max(2, round(ETIQUETA_GRUESO * W))
    grueso = ndi.binary_opening(C["rojo"], structure=disk(r))
    lab, n = ndi.label(grueso)
    if not n:
        return None
    yy, xx = np.mgrid[0:H, 0:W]
    dist = np.hypot(xx - W / 2, yy - H / 2)
    cercania = ndi.minimum(dist, lab, range(1, n + 1))
    areas = ndi.sum(grueso, lab, range(1, n + 1))
    cerca = [i for i in range(n) if cercania[i] <= ETIQUETA_CERCA * m]
    if not cerca:
        return None
    i = max(cerca, key=lambda k: areas[k]) + 1
    comp = ndi.binary_dilation(lab == i, structure=disk(r)) & C["rojo"]
    central = comp & (dist <= 0.25 * m)
    if central.sum() < 50:
        return None
    ys, xs = np.nonzero(central)
    mx, my = xs.mean(), ys.mean()
    w, vecs = np.linalg.eigh(np.cov(np.stack([xs - mx, ys - my])))
    vx, vy = vecs[:, 1]
    if w[1] < 4 * w[0]:   # no es una banda (algo redondo, como una ficha roja al centro)
        return None
    Q = -(xs - mx) * vy + (ys - my) * vx
    q0, q1 = np.percentile(Q, [0.5, 99.5])
    return {"cx": float(mx + (q0 + q1) / 2 * -vy), "cy": float(my + (q0 + q1) / 2 * vx), "vx": float(vx),
            "vy": float(vy), "ancho": float(q1 - q0), "angulo": float(math.degrees(math.atan2(-vy, vx)) % 180)}


def limite_marco(perfil, gap):
    """Dónde termina el marco: la última fila (desde la orilla) con rojo antes de un hueco de `gap` filas sin rojo."""
    ultimo, sin = None, 0
    for k, x in enumerate(perfil):
        if x > 0.02:
            ultimo, sin = k, 0
        elif ultimo is not None:
            sin += 1
            if sin >= gap:
                break
    return ultimo


def interior(C, W, H):
    """El rectángulo de adentro del marco."""
    m = min(W, H)
    lim, gap, extra, omision = round(0.32 * m), max(3, round(0.03 * m)), round(0.01 * m), round(0.15 * m)
    rojo = C["rojo"]
    xs, ys = slice(round(0.3 * W), round(0.7 * W)), slice(round(0.3 * H), round(0.7 * H))
    t = limite_marco(rojo[:lim, xs].mean(axis=1), gap)
    b = limite_marco(rojo[H - lim:, xs].mean(axis=1)[::-1], gap)
    l = limite_marco(rojo[ys, :lim].mean(axis=0), gap)
    r = limite_marco(rojo[ys, W - lim:].mean(axis=0)[::-1], gap)
    return ((l + 1 if l is not None else omision) + extra, (t + 1 if t is not None else omision) + extra,
            W - (r + 1 if r is not None else omision) - extra, H - (b + 1 if b is not None else omision) - extra)


def leer_texto(vistas):
    """Lo que el OCR de macOS lee en cada vista: una lista de [(texto, confianza)] por vista. None si no hay OCR o si
    tronó (cada vista se reintenta hasta 3 veces: falla en rachas)."""
    binario = GP.ocr_listo()
    if not binario:
        return None
    todas = []
    for vista in vistas:
        leidos = []
        todas.append(leidos)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
            vista.save(t.name)
        try:
            for _ in range(3):
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
            if any(c.isalnum() for c in texto):
                leidos.append((texto.strip(), float(conf)))
    return todas


# Letras que el OCR "lee" en volutas, tuercas y fichas (curvas y aros): una lectura hecha solo de ellas no cuenta. En
# las espirales de las volutas también lee p, q, b, d, a, 6 y 9 (CURVAS_MARCO, para la vista con el marco), y a veces
# en letras cirílicas o griegas que se ven igual (PARECIDAS).
CURVAS = set("CcOo0QqGgSsUuJje")
CURVAS_MARCO = CURVAS | set("pPqbdaB69")
PARECIDAS = str.maketrans("ОоСсЕеРрАаВКМНТХхуΟοΡρΑΕΚΜΝΤΧ", "OoCcEePpAaBKMHTXxyOoPpAEKMNTX")


def es_texto(texto, conf, minimo=2, confianza=0.3, curvas=CURVAS):
    """Una lectura cuenta como texto con `minimo` letras o números o más (o una sola con mucha confianza), salvo si
    todas son curvas."""
    letras = [c for c in texto.translate(PARECIDAS) if c.isalnum()]
    if not letras or all(c in curvas for c in letras):
        return False
    return (len(letras) >= minimo and conf >= confianza) or (minimo <= 2 and len(letras) == 1 and conf >= 0.6)


def revisar_texto(vistas, reglas, fallas, v):
    leidos = leer_texto(vistas)
    if leidos is None:
        v["texto"] = "sin OCR: revísalo a ojo"
        return
    v["texto"] = [l for vista in leidos for l in vista]
    malos = [t for vista, regla in zip(leidos, reglas) for t, c in vista if es_texto(t, c, **regla)]
    if malos:
        fallas["texto"] = "el OCR lee texto: " + ", ".join(malos)


def buscar_palos(C, W, H, zona=None):
    """Formas parecidas a un palo: manchas rellenas de rojo, de tinta o de color, y huecos blancos encerrados (un palo
    dibujado solo con contorno). Regresa [(palo, parecido, caja)]."""
    blanco = C["blanco"]
    lab, n = ndi.label(blanco)
    borde = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    tam = ndi.sum(blanco, lab, range(1, n + 1))
    huecos = np.isin(lab, [i + 1 for i in range(n) if i + 1 not in borde and tam[i] <= PALO_AREA[1] * W * H])
    color = ~blanco & ~C["tinta"] & ~C["rojo"] & (C["S"] > 0.25)
    # lo grueso del rojo y de la tinta, sin los trazos delgados: un palo relleno pegado a las volutas del marco
    grueso = disk(max(2, round(0.008 * min(W, H))))
    hallados = []
    for mk in (C["rojo"], C["tinta"], color, huecos, ndi.binary_opening(C["rojo"], structure=grueso),
               ndi.binary_opening(C["tinta"], structure=grueso)):
        if zona is not None:
            mk = mk & zona
        lab, n = ndi.label(ndi.binary_opening(mk))
        if not n:
            continue
        areas = ndi.sum(mk, lab, range(1, n + 1))
        cajas = ndi.find_objects(lab)
        orden = sorted((i for i in range(n) if PALO_AREA[0] <= areas[i] <= PALO_AREA[1] * W * H),
                       key=lambda i: -areas[i])[:300]
        for i in orden:
            sl = cajas[i]
            comp = ndi.binary_fill_holes(lab[sl] == i + 1)
            h, w = comp.shape
            if not 0.45 <= w / h <= 2.2:
                continue
            if comp.sum() / max(1, convex_hull_image(comp).sum()) < 0.72:
                continue
            palo, iou = parecido_a_palo(comp)
            caja = (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)
            if iou >= PALO_IOU[palo] and not any(abs(caja[0] - c[0]) + abs(caja[1] - c[1]) < 8 for _, _, c in hallados):
                hallados.append((palo, round(iou, 3), caja))
    return hallados


def revisar_palos(C, W, H, fallas, v, extra, zona=None, permitidos=()):
    """`permitidos`: palos que se anotan pero no fallan (los rombos que el usuario pidió en la ropa de las figuras)."""
    hallados = buscar_palos(C, W, H, zona)
    extra["palos"] = [h for h in hallados if h[0] not in permitidos]
    v["palos"] = [(p, iou) for p, iou, _ in hallados]
    if extra["palos"]:
        nombres = {"s": "pica", "h": "corazón", "d": "diamante", "c": "trébol"}
        fallas["palos"] = "hay formas de palo: " + ", ".join(f"{nombres[p]} ({iou:.2f})" for p, iou, _ in extra["palos"])


def revisar_colores(C, fallas, v):
    """Sin neón ni colores prohibidos (rosa, morado o verde limón brillantes)."""
    S, V, Hh = C["S"], C["V"], C["H"]
    v["neon"] = float(((S > 0.75) & (V > 0.92)).mean())
    prohibidos = {
        "rosa": ((Hh >= 285) & (Hh <= 345) & (S > 0.35) & (V > 0.5)).mean(),
        "morado": ((Hh >= 255) & (Hh < 285) & (S > 0.4) & (V > 0.45)).mean(),
        "verde limón": ((Hh >= 65) & (Hh <= 105) & (S > 0.5) & (V > 0.7)).mean(),
    }
    v["prohibidos"] = {k: round(float(x), 5) for k, x in prohibidos.items()}
    malos = [k for k, x in prohibidos.items() if x > PROHIBIDO_MAX]
    if v["neon"] > NEON_MAX:
        fallas["colores"] = f"colores de neón ({v['neon']:.2%})"
    elif malos:
        fallas["colores"] = "colores prohibidos: " + ", ".join(malos)


def blanco_liso(C, bl, W, H, v):
    """(desviación p99 del blanco, viñeta) del blanco `bl`."""
    m = min(W, H)
    ref = np.median(C["a"][bl], axis=0)
    v["blanco"] = hexa(ref)
    dev = np.abs(C["a"][bl] - ref).max(axis=1) * 255
    v["blanco_p99"] = float(np.percentile(dev, 99))
    esquinas = np.zeros((H, W), bool)
    k = round(0.25 * m)
    for ys, xs in ((slice(0, k), slice(0, k)), (slice(0, k), slice(W - k, W)),
                   (slice(H - k, H), slice(0, k)), (slice(H - k, H), slice(W - k, W))):
        esquinas[ys, xs] = True
    centro = np.zeros((H, W), bool)
    centro[H // 2 - k:H // 2 + k, W // 2 - k:W // 2 + k] = True
    v["vineta"] = (float(abs(C["V"][bl & esquinas].mean() - C["V"][bl & centro].mean()))
                   if (bl & esquinas).any() and (bl & centro).any() else 0.0)
    return v["blanco_p99"] > PLANO_P99 or v["vineta"] > VINETA_MAX


# ---------- reverso ----------

def revisar_reverso(img, con_ocr=True):
    """Las revisiones del reverso (solo el marco). Regresa ({revisión: motivo}, {medida: valor}, extras para la hoja)."""
    W, H = img.size
    m = min(W, H)
    C = clases(img)
    fallas, v, extra = {}, {"tamano": [W, H]}, {}

    # marco: blanco por fuera y rojo a lo largo de los cuatro lados
    o = max(2, round(ORILLA * m))
    anillo = np.ones((H, W), bool)
    anillo[o:H - o, o:W - o] = False
    v["orilla_blanca"] = float(C["blanco"][anillo].mean())
    b = round(BANDA * m)
    rojo = C["rojo"]
    x0, x1, y0, y1 = round(0.2 * W), round(0.8 * W), round(0.2 * H), round(0.8 * H)
    cob = {
        "arriba": rojo[o:o + b, x0:x1].any(axis=0).mean(), "abajo": rojo[H - o - b:H - o, x0:x1].any(axis=0).mean(),
        "izquierda": rojo[y0:y1, o:o + b].any(axis=1).mean(), "derecha": rojo[y0:y1, W - o - b:W - o].any(axis=1).mean(),
    }
    v["marco_cobertura"] = {k: round(float(x), 3) for k, x in cob.items()}
    banda = np.zeros((H, W), bool)
    banda[o:H - o, o:W - o] = True
    banda[o + b:H - o - b, o + b:W - o - b] = False
    v["marco_densidad"] = float(rojo[banda].mean())
    flojos = [k for k, x in cob.items() if x < MARCO_COBERTURA]
    if v["orilla_blanca"] < ORILLA_BLANCO:
        fallas["marco"] = (f"la orilla de afuera no es blanca ({v['orilla_blanca']:.0%}): sombra, fondo o el marco "
                           "llega hasta la orilla")
    elif flojos or v["marco_densidad"] < MARCO_DENSIDAD:
        fallas["marco"] = ("el marco no corre por " + ", ".join(flojos) if flojos else
                           f"casi no hay marco rojo ({v['marco_densidad']:.1%} de la banda)")
    rojos_marco = C["a"][banda & rojo]
    if len(rojos_marco):
        v["marco_color"] = hexa(np.median(rojos_marco, axis=0))

    # centro: adentro del marco no hay nada
    ix0, iy0, ix1, iy1 = interior(C, W, H)
    v["interior"] = [int(ix0), int(iy0), int(ix1), int(iy1)]
    mx, my = round(CENTRO_ZONA * (ix1 - ix0)), round(CENTRO_ZONA * (iy1 - iy0))
    centro = np.zeros((H, W), bool)
    centro[iy0 + my:iy1 - my, ix0 + mx:ix1 - mx] = True
    extra["centro"] = (ix0 + mx, iy0 + my, ix1 - mx, iy1 - my)
    dentro = np.zeros((H, W), bool)
    dentro[iy0:iy1, ix0:ix1] = True
    algo = ndi.binary_opening(~C["blanco"])
    v["centro_lleno"] = float(algo[centro].mean()) if centro.any() else 1.0
    color = algo & ~C["rojo"] & ~C["tinta"] & (C["S"] > 0.2)
    v["centro_color"] = float(color[dentro].mean()) if dentro.any() else 0.0
    if v["centro_lleno"] > CENTRO_LLENO or v["centro_color"] > CENTRO_COLOR:
        fallas["centro"] = (f"adentro del marco hay algo (centro {v['centro_lleno']:.1%} ocupado, "
                            f"{v['centro_color']:.2%} de colores que no son del marco)")

    revisar_palos(C, W, H, fallas, v, extra)
    revisar_colores(C, fallas, v)
    if "colores" not in fallas and len(rojos_marco):
        hsv = rgb2hsv(np.median(rojos_marco, axis=0)[None, None, :])[0, 0]
        if hsv[2] > 0.8 or hsv[1] < 0.45:
            fallas["colores"] = f"el marco no es rojo ladrillo profundo ({v['marco_color']})"

    bl = ndi.binary_erosion(C["blanco"], iterations=2)
    if bl.any() and blanco_liso(C, bl, W, H, v):
        fallas["plano"] = (f"el blanco no es liso (variación {v['blanco_p99']:.0f}/255, "
                           f"esquinas contra centro {v['vineta']:.2f})")

    # texto: adentro del marco (al doble) y en toda la imagen (con las volutas: solo palabras de 3 letras o más)
    if con_ocr:
        recorte = img.crop((ix0, iy0, ix1, iy1))
        revisar_texto([recorte.resize((recorte.size[0] * 2, recorte.size[1] * 2), Image.LANCZOS), img],
                      [{}, {"minimo": 3, "confianza": 0.5, "curvas": CURVAS_MARCO}], fallas, v)
    return fallas, v, extra


def limpiar_reverso(img):
    """Deja solo el marco, con el centro en blanco liso. El marco se reconoce porque es simétrico: sus trazos (rojos y de
    tinta) tienen pareja en espejo a lo ancho y a lo alto; los dibujitos y la etiqueta no. Si había una etiqueta que
    llegaba hasta el marco, lo que tapaba se repone con el lado espejo. Regresa (imagen limpia, máscara del marco)."""
    W, H = img.size
    C = clases(img)
    a = np.asarray(img.convert("RGB"))
    banda = np.zeros((H, W), bool)
    e = buscar_etiqueta(C, W, H)
    if e is not None:
        yy, xx = np.mgrid[0:H, 0:W]
        banda = np.abs(-(xx - e["cx"]) * e["vy"] + (yy - e["cy"]) * e["vx"]) <= e["ancho"] / 2 + 8
    trazo = (C["rojo"] | C["tinta"]) & ~banda
    td = ndi.binary_dilation(trazo, iterations=4)
    simetrico = trazo & td[:, ::-1] & td[::-1, :]
    lab, n = ndi.label(trazo, structure=np.ones((3, 3)))
    if n:
        sobre, area = ndi.sum(simetrico, lab, range(1, n + 1)), ndi.sum(trazo, lab, range(1, n + 1))
        sim = [i + 1 for i in range(n) if area[i] and sobre[i] / area[i] >= 0.5]
        # lo chico solo cuenta si está junto a lo grande del marco: un resto de un dibujito puede tener pareja en espejo
        # por casualidad
        grande = [i for i in sim if area[i - 1] >= 0.002 * W * H]
        cerca = ndi.binary_dilation(np.isin(lab, grande), iterations=max(2, round(0.06 * min(W, H))))
        junto = ndi.maximum(cerca, lab, range(1, n + 1))
        marco = np.isin(lab, [i for i in sim if i in grande or junto[i - 1]])
    else:
        marco = np.zeros((H, W), bool)
    md = ndi.binary_dilation(marco, iterations=2)   # con la orilla suave de los trazos
    out = np.full_like(a, 255)
    afuera = md & ~banda
    out[afuera] = a[afuera]
    # bajo la etiqueta: el espejo a lo ancho y, donde ese también cae en la etiqueta, el espejo a lo alto
    ancho = banda & md[:, ::-1] & ~banda[:, ::-1]
    out[ancho] = a[:, ::-1][ancho]
    alto = banda & ~ancho & md[::-1, :] & ~banda[::-1, :]
    out[alto] = a[::-1, :][alto]
    return Image.fromarray(out), (marco & ~banda) | (banda & marco[:, ::-1]) | (banda & marco[::-1, :])


def carta_reverso(limpio, marco, destino_png, destino_json):
    """El marco listo para el código: el blanco al papel de la baraja y lo dibujado acomodado en la carta con el mismo
    margen por los cuatro lados (CARTA px; se estira menos de un 6 %). Junto, la zona libre de adentro del marco donde el
    código pone la etiqueta sin tocarlo (celdas de LIBRE_CELDA px, filas de arriba abajo, "1" = libre)."""
    a = np.clip(np.asarray(limpio).astype(np.float32) * (np.array(PAPEL, np.float32) / 255), 0, 255)
    ys, xs = np.nonzero(marco)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    cw, ch = CARTA
    mg = round(MARGEN_CARTA * cw)
    fx, fy = (cw - 2 * mg) / (x1 - x0), (ch - 2 * mg) / (y1 - y0)
    dibujo = Image.fromarray(a.astype(np.uint8)).crop((x0, y0, x1, y1)).resize((cw - 2 * mg, ch - 2 * mg), Image.LANCZOS)
    carta = Image.new("RGB", CARTA, PAPEL)
    carta.paste(dibujo, (mg, mg))
    carta.save(destino_png)
    mk = Image.fromarray((marco * 255).astype(np.uint8)).crop((x0, y0, x1, y1)).resize((cw - 2 * mg, ch - 2 * mg),
                                                                                        Image.NEAREST)
    mc = np.zeros((ch, cw), bool)
    mc[mg:ch - mg, mg:cw - mg] = np.asarray(mk) > 127
    cerca = ndi.binary_dilation(mc, iterations=max(1, round(LIBRE_MARGEN * cw)))
    lab, _ = ndi.label(~cerca)
    libre = lab == lab[ch // 2, cw // 2]   # lo que se alcanza desde el centro sin cruzar el marco
    k = LIBRE_CELDA
    celdas = libre[:ch // k * k, :cw // k * k].reshape(ch // k, k, cw // k, k).all(axis=(1, 3))
    datos = {"estirado": round(max(fx, fy) / min(fx, fy) - 1, 4),
             "libre": {"columnas": int(celdas.shape[1]), "filas": int(celdas.shape[0]),
                       "celdas": ["".join("1" if c else "0" for c in fila) for fila in celdas]}}
    with open(destino_json, "w") as f:
        json.dump(datos, f, indent=1)
    return datos


# ---------- figuras ----------

def grupos_de_tres(C):
    """Grupitos de exactamente tres puntos claros y redondos, pegados entre sí y acomodados en triángulo (en la corona
    del rey se veían como un trébol sin tallo). Regresa sus cajas."""
    claro = (C["V"] > 0.78) & (C["S"] < 0.35)
    lab, n = ndi.label(claro)
    puntos = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        comp = lab[sl] == i + 1
        area, (h, w) = int(comp.sum()), comp.shape
        if 30 <= area <= 900 and 0.6 <= w / h <= 1.6 and 0.6 <= area / (w * h) <= 0.9:   # redondo (un cuadrado llena 1)
            cy, cx = ndi.center_of_mass(comp)
            puntos.append((sl[1].start + cx, sl[0].start + cy, 2 * math.sqrt(area / math.pi)))
    padre = list(range(len(puntos)))

    def raiz(i):
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i

    for i, (x1, y1, d1) in enumerate(puntos):
        for j in range(i + 1, len(puntos)):
            x2, y2, d2 = puntos[j]
            if math.hypot(x1 - x2, y1 - y2) <= 1.5 * max(d1, d2) and 0.6 <= d1 / d2 <= 1.6:
                padre[raiz(i)] = raiz(j)
    grupos = {}
    for i in range(len(puntos)):
        grupos.setdefault(raiz(i), []).append(puntos[i])
    def en_triangulo(g):   # no en fila: el área del triángulo contra su lado más largo
        (ax, ay, _), (bx, by, _), (cx, cy, _) = g
        lado = max(math.hypot(ax - bx, ay - by), math.hypot(bx - cx, by - cy), math.hypot(cx - ax, cy - ay))
        return abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2 / max(1e-6, lado ** 2) >= 0.2

    return [(round(min(p[0] for p in g) - 15), round(min(p[1] for p in g) - 15), round(max(p[0] for p in g) + 15),
             round(max(p[1] for p in g) + 15)) for g in grupos.values() if len(g) == 3 and en_triangulo(g)]


PATRONES_MIN = 0.60   # figuras ornamentadas: del rojo de la túnica, qué fracción va en pedacitos entre los patrones (el
                      # rey sencillo: 0.17; los ornamentados: 0.82 y 0.92)


def cobertura_patrones(C, figura):
    """Qué tan cubierta de patrones está la túnica: la fracción de su rojo ladrillo que va en pedacitos (cada uno de menos
    del 1 % de la figura). En una túnica lisa el rojo son unas cuantas manchas grandes."""
    base_t = rgb2lab(np.array(TUNICA, np.float32)[None, None, :] / 255)[0, 0]
    tun = (np.linalg.norm(rgb2lab(C["a"]) - base_t, axis=2) <= TUNICA_TOL) & figura
    lab, n = ndi.label(tun)
    if not n:
        return 0.0
    areas = ndi.sum(tun, lab, range(1, n + 1))
    return float(sum(x for x in areas if x < 0.01 * figura.sum()) / tun.sum())


def revisar_figura(img, con_ocr=True, rombos=False, ornamentada=False):
    """Las revisiones de una figura (la mitad de arriba). Regresa ({revisión: motivo}, {medida: valor}, extras).
    `rombos`: los rombos de la ropa (que el usuario pidió en las figuras ornamentadas) no cuentan como diamantes.
    `ornamentada`: la túnica debe venir cubierta de patrones, como la del rey ornamentado."""
    W, H = img.size
    m = min(W, H)
    C = clases(img)
    fallas, v, extra = {}, {"tamano": [W, H]}, {}
    # fondo: lo blanco que toca la orilla de arriba o los lados
    lab, n = ndi.label(C["blanco"])
    bordes = set(np.unique(np.concatenate([lab[0], lab[:, 0], lab[:, -1]]))) - {0}
    fondo = np.isin(lab, list(bordes))
    figura = ndi.binary_opening(~fondo, iterations=2)
    extra["figura"] = figura
    alto = round(0.75 * H)
    orillas = np.concatenate([fondo[:2].ravel(), fondo[:alto, :2].ravel(), fondo[:alto, -2:].ravel()])
    v["orillas_blancas"] = float(orillas.mean())
    bl = ndi.binary_erosion(fondo, iterations=3)
    if v["orillas_blancas"] < FIG_ORILLA_BLANCA:   # sin fondo blanco no se sabe qué es figura: solo lo demás
        fallas["fondo"] = (f"arriba y a los lados no es fondo blanco ({v['orillas_blancas']:.0%}): fondo de color o "
                           "un marco")
        revisar_palos(C, W, H, fallas, v, extra)
        revisar_colores(C, fallas, v)
        if con_ocr:
            revisar_texto([img.resize((W * 2, H * 2), Image.LANCZOS)], [{}], fallas, v)
        return fallas, v, extra
    if bl.any() and blanco_liso(C, bl, W, H, v):
        fallas["fondo"] = (f"el fondo no es blanco liso (variación {v['blanco_p99']:.0f}/255, "
                           f"esquinas contra centro {v['vineta']:.2f})")

    # encuadre
    ys, xs = np.nonzero(figura)
    if not len(ys):
        fallas["encuadre"] = "no hay figura"
        return fallas, v, extra
    v["caja"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    v["aire_arriba"] = float(ys.min() / H)
    # el corte de la cintura: una fila casi llena en el 8 % de abajo y nada debajo de ella (el código recorta ahí)
    abajo = round(0.92 * H)
    filas = figura[abajo:].mean(axis=1)
    llenas = np.nonzero(filas >= FIG_CORTE)[0]
    v["corte"] = float(filas.max()) if len(filas) else 0.0
    v["debajo_del_corte"] = float(figura[abajo + llenas.max() + 4:].mean()) if len(llenas) and abajo + llenas.max() + 4 < H else 0.0
    arriba = figura[:round(0.6 * H)]
    ya, xa = np.nonzero(arriba)
    v["corrida"] = float(abs(xa.mean() - W / 2) / W) if len(xa) else 1.0
    lab, n = ndi.label(figura)
    v["un_pedazo"] = float(ndi.sum(figura, lab, range(1, n + 1)).max() / figura.sum()) if n else 0.0
    problemas = []
    if v["aire_arriba"] < FIG_AIRE:
        problemas.append("la corona (o la cabeza) toca la orilla de arriba")
    if v["corte"] < FIG_CORTE:
        problemas.append(f"no está cortada recta en la cintura, abajo (solo {v['corte']:.0%} del ancho)")
    elif v["debajo_del_corte"] > 0.01:
        problemas.append("hay algo debajo del corte de la cintura")
    if v["corrida"] > FIG_CENTRO:
        problemas.append(f"no está centrada ({v['corrida']:.0%} del ancho)")
    if v["un_pedazo"] < FIG_UNO:
        problemas.append(f"hay más de una cosa ({v['un_pedazo']:.0%} en el pedazo más grande)")
    if problemas:
        fallas["encuadre"] = "; ".join(problemas)

    # túnica: buena parte de la figura es del rojo ladrillo de la base
    lab_img = rgb2lab(C["a"])
    base = rgb2lab(np.array(TUNICA, np.float32)[None, None, :] / 255)[0, 0]
    tunica = (np.linalg.norm(lab_img - base, axis=2) <= TUNICA_TOL) & figura
    v["tunica"] = float(tunica.sum() / figura.sum())
    if v["tunica"] < TUNICA_MIN:
        fallas["tunica"] = f"casi nada es del rojo ladrillo de la túnica ({v['tunica']:.0%} de la figura)"

    revisar_palos(C, W, H, fallas, v, extra, zona=ndi.binary_dilation(figura, iterations=3),
                  permitidos=("d",) if rombos else ())
    revisar_colores(C, fallas, v)

    # plano: sin texturas (fuera de las líneas, la variación local es casi cero o es una orilla) y la túnica, el color
    # más grande, sin degradado: a lo mucho dos tonos (su color y una sombra plana)
    v["textura"] = textura(C, figura)
    zona = ndi.binary_erosion((np.linalg.norm(lab_img - base, axis=2) <= TUNICA_TOL * 1.8) & figura, iterations=3)
    v["degradado"] = dos_tonos(lab_img[..., 0][zona]) if zona.sum() > 2000 else 0.0
    if v["textura"] > TEXTURA_MAX or v["degradado"] > DEGRADADO_MAX:
        fallas["plano"] = (f"los colores no son planos ({v['textura']:.0%} de la figura con textura, "
                           f"{v['degradado']:.0%} de la túnica fuera de sus dos tonos)")

    # sin grupitos de tres puntos (parecen un trébol sin tallo)
    extra["tres"] = grupos_de_tres(C)
    v["grupos_de_tres"] = len(extra["tres"])
    if extra["tres"]:
        fallas["tres_puntos"] = f"hay {len(extra['tres'])} grupito(s) de tres puntos, que parecen un trébol"
    if ornamentada:
        v["patrones"] = round(cobertura_patrones(C, figura), 3)
        if v["patrones"] < PATRONES_MIN:
            fallas["adornos"] = f"la túnica no está cubierta de patrones (solo {v['patrones']:.0%} de su rojo va entre patrones)"

    if con_ocr:
        revisar_texto([img.resize((W * 2, H * 2), Image.LANCZOS)], [{}], fallas, v)
    return fallas, v, extra


IGUAL_MAX = 18        # ediciones: diferencia media (0 a 255) que puede haber en la cara y las manos contra la base
SILUETA_MIN = 0.90    # ...y la silueta de la figura contra la de la base (intersección / unión)
ADORNO_MIN = 0.15     # ...y cuánto más de la túnica debe quedar cubierto de patrones


def silueta(C):
    """Lo que no es el fondo blanco que toca las orillas."""
    lab, n = ndi.label(C["blanco"])
    bordes = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return ndi.binary_opening(~np.isin(lab, list(bordes)), iterations=2)


def zonas_piel(C, W, H):
    """Las cajas de la cara y las manos: los cuatro pedazos de piel más grandes, con un margen."""
    piel = (C["H"] >= 8) & (C["H"] <= 40) & (C["S"] >= 0.12) & (C["S"] <= 0.6) & (C["V"] >= 0.65)
    piel = ndi.binary_opening(piel, iterations=2)
    lab, n = ndi.label(piel)
    if not n:
        return []
    areas, cajas, mg = ndi.sum(piel, lab, range(1, n + 1)), ndi.find_objects(lab), round(0.03 * W)
    return [(max(0, cajas[i][1].start - mg), max(0, cajas[i][0].start - mg), min(W, cajas[i][1].stop + mg),
             min(H, cajas[i][0].stop + mg)) for i in sorted(range(n), key=lambda k: -areas[k])[:4]
            if areas[i] >= 0.002 * W * H]


def revisar_edicion(base, gen, con_ocr=True):
    """Una edición de una figura aprobada (más ornamentada): las revisiones de una figura (con rombos permitidos) y además
    que la cara, las manos y la silueta sigan iguales (igual) y que la túnica tenga más patrones (adornos)."""
    fallas, v, extra = revisar_figura(gen, con_ocr=con_ocr, rombos=True)
    W, H = gen.size
    if base.size != gen.size:
        base = base.resize(gen.size, Image.LANCZOS)
    Cb, Cg = clases(base), clases(gen)
    sb, sg = silueta(Cb), silueta(Cg)
    # lo que Gemini se haya corrido (hasta 6 px): el corrimiento que mejor empata las siluetas
    mejor, dx, dy = -1.0, 0, 0
    for ddy in range(-6, 7, 2):
        for ddx in range(-6, 7, 2):
            r = np.roll(np.roll(sg, ddy, 0), ddx, 1)
            iou = (sb & r).sum() / max(1, (sb | r).sum())
            if iou > mejor:
                mejor, dx, dy = iou, ddx, ddy
    v["silueta"], v["corrimiento"] = round(float(mejor), 3), [dx, dy]
    A = np.asarray(base).astype(np.float32)
    G = np.roll(np.roll(np.asarray(gen).astype(np.float32), dy, 0), dx, 1)
    zonas = zonas_piel(Cb, W, H)
    extra["zonas"] = zonas
    v["cara_manos"] = [round(float(np.abs(A[y0:y1, x0:x1] - G[y0:y1, x0:x1]).mean()), 1) for x0, y0, x1, y1 in zonas]
    problemas = []
    if mejor < SILUETA_MIN:
        problemas.append(f"la silueta cambió (solo {mejor:.0%} igual)")
    if not zonas:
        problemas.append("no encontré la cara ni las manos")
    elif max(v["cara_manos"]) > IGUAL_MAX:
        problemas.append(f"la cara o las manos cambiaron (diferencia {max(v['cara_manos']):.0f}/255)")
    if problemas:
        fallas["igual"] = "; ".join(problemas)
    # más adornada: dentro de la túnica de la base (sin las manos), cuánto ya no es del rojo de la túnica
    base_t = rgb2lab(np.array(TUNICA, np.float32)[None, None, :] / 255)[0, 0]
    tun_b = np.linalg.norm(rgb2lab(Cb["a"]) - base_t, axis=2) <= TUNICA_TOL
    tun_g = np.linalg.norm(rgb2lab(np.clip(G / 255, 0, 1)) - base_t, axis=2) <= TUNICA_TOL
    region = ndi.binary_closing(tun_b, iterations=8) & sb
    for x0, y0, x1, y1 in zonas:
        region[y0:y1, x0:x1] = False
    f0 = float((~tun_b & region).sum() / max(1, region.sum()))
    f1 = float((~tun_g & region).sum() / max(1, region.sum()))
    v["patrones_antes"], v["patrones_ahora"] = round(f0, 3), round(f1, 3)
    if f1 - f0 < ADORNO_MIN:
        fallas["adornos"] = f"la túnica casi no tiene más patrones ({f0:.0%} → {f1:.0%} cubierta)"
    return fallas, v, extra


def zona_corona(base):
    """La caja de la corona: lo de la figura arriba de la cara (con un margen)."""
    C = clases(base)
    W, H = base.size
    fig = silueta(C)
    caras = zonas_piel(C, W, H)
    y1 = min(z[1] for z in caras) + round(0.02 * H) if caras else round(0.25 * H)
    filas, cols = np.nonzero(fig[:y1].any(axis=1))[0], np.nonzero(fig[:y1].any(axis=0))[0]
    m = round(0.015 * W)
    return (int(max(0, cols.min() - m)), int(max(0, filas.min() - m)), int(min(W, cols.max() + m)), int(y1))


def componer_zona(base, gen, caja):
    """La base con lo que cambió Gemini dentro de la caja (y nada de afuera), con la orilla suave."""
    A = np.asarray(base).astype(np.float32)
    G = np.asarray(gen.resize(base.size, Image.LANCZOS)).astype(np.float32)
    z = np.zeros(A.shape[:2], bool)
    z[caja[1]:caja[3], caja[0]:caja[2]] = True
    cambio = ndi.binary_opening((np.abs(A - G).max(axis=2) > 30) & z)
    peso = ndi.gaussian_filter((ndi.binary_dilation(cambio, iterations=3) & z).astype(np.float32), 1.5) * z
    return Image.fromarray((A * (1 - peso[..., None]) + G * peso[..., None]).round().astype(np.uint8)), int(cambio.sum())


def revisar_retoque(base, gen, caja):
    """Un retoque de una zona de una figura aprobada: se toma de Gemini solo lo que cambió en la zona y se revisa el
    resultado como figura; además, que afuera de la zona Gemini no haya movido nada (alineación) y que sí cambió algo."""
    cand, cambiados = componer_zona(base, gen, caja)
    fallas, v, extra = revisar_figura(cand, rombos=True)
    extra["compuesta"], extra["zona_retoque"] = cand, caja
    sb, sg = silueta(clases(base)), silueta(clases(gen.resize(base.size)))
    fuera = np.ones(sb.shape, bool)
    fuera[caja[1]:caja[3], caja[0]:caja[2]] = False
    v["silueta_fuera"] = round(float((sb & sg & fuera).sum() / max(1, ((sb | sg) & fuera).sum())), 4)
    v["cambiados"] = cambiados
    if v["silueta_fuera"] < 0.97:
        fallas["alineacion"] = f"afuera de la zona, Gemini movió la figura ({v['silueta_fuera']:.1%} igual)"
    if cambiados < 100:
        fallas["sin_cambio"] = f"casi nada cambió en la zona ({cambiados} px)"
    return fallas, v, extra


def dos_tonos(L):
    """Fracción de los valores de luz (L de Lab) que no caen cerca (±4) de los dos tonos más comunes: en un color plano
    con una sombra plana es casi nada; en un degradado, mucho."""
    h, _ = np.histogram(L, bins=100, range=(0, 100))
    p1 = int(np.argmax(h))
    h2 = h.copy()
    h2[max(0, p1 - 5):p1 + 6] = 0
    p2 = int(np.argmax(h2))
    return float(((np.abs(L - p1 - 0.5) > 4) & (np.abs(L - p2 - 0.5) > 4)).mean())


def textura(C, figura):
    """Fracción de la figura, lejos de las líneas y de las orillas entre colores, donde el color varía un poco (5 a 30
    de 255 en 5×5): eso es degradado o textura; un color plano varía casi nada (el ruido del JPEG queda abajo de 5)."""
    gris = C["a"].mean(axis=2) * 255
    media = ndi.uniform_filter(gris, 5)
    desv = np.sqrt(np.maximum(ndi.uniform_filter(gris ** 2, 5) - media ** 2, 0))
    borde = np.hypot(ndi.sobel(gris, 0), ndi.sobel(gris, 1)) > 60
    lejos = figura & ~ndi.binary_dilation(borde | C["tinta"], iterations=3)
    if not lejos.any():
        return 0.0
    return float(((desv[lejos] >= 5) & (desv[lejos] <= 30)).mean())


# ---------- hoja para revisar ----------

def hoja(img, fallas, v, extra, titulo, destino, claves):
    """Lo que regresó Gemini y, al lado, lo que vieron las revisiones: el centro que debe quedar vacío (amarillo), la
    figura (verde) y las formas de palo (magenta). Abajo, cada revisión."""
    alto = 900
    W, H = img.size
    k = alto / H
    a = img.convert("RGB").resize((round(W * k), alto), Image.LANCZOS)
    b = Image.blend(a, Image.new("RGB", a.size, "white"), 0.45)
    t = ImageDraw.Draw(b)
    if "centro" in extra:
        c = extra["centro"]
        t.rectangle([c[0] * k, c[1] * k, c[2] * k, c[3] * k], outline=(220, 170, 0), width=3)
    if "figura" in extra:
        contorno = extra["figura"] & ~ndi.binary_erosion(extra["figura"], iterations=3)
        cm = Image.fromarray((contorno * 255).astype(np.uint8)).resize(a.size, Image.NEAREST)
        b.paste(Image.new("RGB", a.size, (30, 150, 50)), (0, 0), cm)
    for _, _, c in extra.get("palos", []):
        t.rectangle([c[0] * k - 4, c[1] * k - 4, c[2] * k + 4, c[3] * k + 4], outline=(230, 0, 200), width=4)
    for c in extra.get("zonas", []):
        t.rectangle([c[0] * k, c[1] * k, c[2] * k, c[3] * k], outline=(0, 90, 220), width=3)
    for c in extra.get("tres", []):
        t.rectangle([c[0] * k, c[1] * k, c[2] * k, c[3] * k], outline=(255, 130, 0), width=4)
    if "zona_retoque" in extra:
        c = extra["zona_retoque"]
        t.rectangle([c[0] * k, c[1] * k, c[2] * k, c[3] * k], outline=(0, 170, 220), width=3)
    lineas = [titulo, ""] + [f"{'FALLA' if c in fallas else 'bien '}  {c}" + (f": {fallas[c]}" if c in fallas else "")
                             for c in claves]
    lineas += [""] + [f"{c}: {v[c]}" for c in ("marco_color", "blanco", "tunica", "textura", "corte", "aire_arriba",
                                                "corrida", "silueta", "silueta_fuera", "cambiados", "cara_manos", "patrones", "patrones_antes", "patrones_ahora",
                                                "palos", "texto") if c in v]
    texto_alto = 30 + 24 * len(lineas)
    out = Image.new("RGB", (a.size[0] * 2 + 48, alto + 32 + texto_alto), "white")
    out.paste(a, (16, 16))
    out.paste(b, (a.size[0] + 32, 16))
    t = ImageDraw.Draw(out)
    f = GP.fuente(18)
    for i, l in enumerate(lineas):
        t.text((16, alto + 32 + i * 24), str(l)[:150], fill=(180, 0, 0) if str(l).startswith("FALLA") else "black", font=f)
    out.save(destino, quality=90)


# ---------- referencia de estilo ----------

def referencia_garaje():
    """Recortes del garaje (la lámpara, la bobina con chispas y los frascos), sin personajes, sobre blanco."""
    destino = os.path.join(DIR, "referencia-garaje.png")
    if os.path.exists(destino):
        return Image.open(destino).convert("RGB"), destino
    fondo = Image.open(FONDO).convert("RGB")
    k = fondo.size[0] / 1920   # las cajas, medidas en fondo-garaje-1920.webp
    cajas = [(290, 268, 455, 410), (820, 82, 1100, 255), (1185, 175, 1552, 388)]
    alto = 360
    partes = []
    for x0, y0, x1, y1 in cajas:
        c = fondo.crop(tuple(round(z * k) for z in (x0, y0, x1, y1)))
        partes.append(c.resize((round(c.size[0] * alto / c.size[1]), alto), Image.LANCZOS))
    gap = 40
    lienzo = Image.new("RGB", (sum(p.size[0] for p in partes) + gap * (len(partes) + 1), alto + 2 * gap), "white")
    x = gap
    for p in partes:
        lienzo.paste(p, (x, gap))
        x += p.size[0] + gap
    os.makedirs(DIR, exist_ok=True)
    lienzo.save(destino)
    return lienzo, destino


# ---------- API ----------

def png64(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def peticion(client, cfg, prompt, imagenes, aspecto):
    """UNA petición a Gemini, sin reintentos (avisa cada 30 s que sigue esperando)."""
    listo, inicio = threading.Event(), time.time()

    def avisar():
        while not listo.wait(30):
            print(f"      ... {time.time() - inicio:.0f} s", flush=True)

    threading.Thread(target=avisar, daemon=True).start()
    try:
        return client.interactions.create(
            model=cfg["modelo"],
            input=[{"type": "text", "text": prompt}]
            + [{"type": "image", "data": png64(i), "mime_type": "image/png"} for i in imagenes],
            response_format={"type": "image", "aspect_ratio": aspecto, "image_size": cfg["image_size"]},
            timeout=1800,   # si se corta de nuestro lado, pudo cobrarse sin regresar nada
        )
    finally:
        listo.set()


def prompt_de(P, pieza, correcciones=()):
    pz = P["piezas"][pieza]
    partes = [limpiar(pz["texto"])] + [limpiar(P["referencias"][r]["texto"]) for r in pz.get("referencias", [])]
    partes += [P["correcciones"][c] for c in correcciones if c in P["correcciones"]]
    return " ".join(partes)


TOKENS_TEXTO = 1400   # thinking y texto por llamada medidos en las del reverso (~1,380; el generador estima 650)


def costo_estimado(cfg, prompt, n_imagenes):
    p = GP.PRECIOS[cfg["modelo"]]
    c = GP.costo_estimado(cfg["modelo"], cfg["image_size"], prompt) or 0   # ya cuenta una imagen de entrada
    return (c + (TOKENS_TEXTO - GP.TOKENS_TEXTO_ESTIMADOS) * p["texto"] / 1e6
            + max(0, n_imagenes - 1) * GP.TOKENS_POR_IMAGEN_ENTRADA * p["entrada"] / 1e6)


# ---------- comandos ----------

REVISAR = {"reverso": revisar_reverso, "rey": revisar_figura,
           **{f: lambda img: revisar_figura(img, rombos=True, ornamentada=True) for f in ("reina", "jota")}}
CLAVES = {"reverso": ["marco", "centro", "palos", "texto", "colores", "plano"],
          **{f: ["fondo", "encuadre", "tunica", "palos", "tres_puntos", "texto", "colores", "plano"] for f in FIGURAS}}
for _f in ("reina", "jota"):
    CLAVES[_f] = CLAVES[_f] + ["adornos"]


def entradas_de(P, pieza):
    imgs, rutas = [], []
    for r in P["piezas"][pieza].get("referencias", []):
        if r == "garaje":
            img, ruta = referencia_garaje()
        else:   # una figura aprobada (el rey), como referencia de estilo
            ruta = os.path.join(APROBADAS, f"{r}.png")
            img = Image.open(ruta).convert("RGB")
        imgs.append(img)
        rutas.append(ruta)
    return imgs, rutas


def correr(P, cfg, pieza, imgs, rutas, aspecto, armar_prompt, revisar_fn, claves, args, que):
    """La corrida de UNA imagen: hasta MAX_LLAMADAS llamadas (cuenten o no), cada una revisada y anotada en el registro;
    si una revisión falla, la llamada siguiente lleva la frase de corrección de lo que falló."""
    os.makedirs(DIR, exist_ok=True)
    prompt = armar_prompt([])
    c = costo_estimado(cfg, prompt, len(imgs))
    print(f"{que}: modelo {cfg['modelo']} a {cfg['image_size']}, proporción {aspecto}. Imágenes que se mandan: "
          + (", ".join(rel(r) for r in rutas) or "ninguna"))
    print(f"  ~${c:.3f} por llamada; máximo {MAX_LLAMADAS} llamadas (hasta ${c * MAX_LLAMADAS:.3f}). "
          f"Llamadas anteriores de esta pieza: {llamadas_de(pieza)}.")
    if args.simular:
        print(f"\n  prompt ({len(prompt)} caracteres):\n  {prompt}\n")
        return
    if not args.si and input("¿Generar? [s/N] ").strip().lower() not in ("s", "si", "sí"):
        print("Cancelado.")
        return
    client = GP.cliente()
    correcciones, gastado = [], 0.0
    for intento in range(1, MAX_LLAMADAS + 1):
        nombre = f"{pieza}-{siguiente(pieza)}"
        prompt = armar_prompt(correcciones)
        print(f"  {nombre}: llamada {intento} de {MAX_LLAMADAS}...", flush=True)
        t0, r, error, gen, crudo = time.time(), None, None, None, None
        try:
            r = peticion(client, cfg, prompt, imgs, aspecto)
        except Exception as ex:   # también cuenta: un tiempo agotado pudo cobrarse
            error = f"{type(ex).__name__} (código {getattr(ex, 'status_code', None)}): {str(ex)[:300]}"
            if "Free Tier" in str(ex) or getattr(ex, "status_code", None) == 402:
                sys.exit(f"    La API no genera: {error}")
        if r is not None and r.output_image and r.output_image.data:
            gen = Image.open(io.BytesIO(base64.b64decode(r.output_image.data))).convert("RGB")
            crudo = os.path.join(DIR, f"{nombre}-crudo.png")
            gen.save(crudo)   # tal cual llegó, antes de cualquier otra cosa: ya está pagada
        usd, tokens = GP.costo(cfg["modelo"], r.usage) if r is not None else (None, None)
        gastado += usd or 0
        if gen is None:
            fallas, v, extra = {"sin_imagen": f"no regresó imagen ({error or getattr(r, 'status', None)})"}, {}, {}
        else:
            fallas, v, extra = revisar_fn(gen)
        with open(os.path.join(DIR, "registro.jsonl"), "a") as f:
            f.write(json.dumps({
                "fecha": datetime.now().isoformat(timespec="seconds"), "pieza": pieza, "cuadro": nombre,
                "llamada": intento, "archivo": os.path.basename(crudo) if crudo else None, "modelo": cfg["modelo"],
                "tamano": cfg["image_size"], "aspecto": aspecto, "entradas": [rel(x) for x in rutas],
                "prompt": prompt, "costo_usd": round(usd, 5) if usd is not None else None, "tokens": tokens,
                "error": error, "revisiones": fallas, "medidas": v,
            }, ensure_ascii=False, default=str) + "\n")
        print(f"    {time.time() - t0:.0f} s" + (f", ${usd:.4f}" if usd is not None else ", sin costo reportado")
              + (f" -> {rel(crudo)} ({gen.size[0]}x{gen.size[1]})" if crudo else ""), flush=True)
        if gen is not None:
            salidas(pieza, gen, fallas, v, extra, nombre, f"llamada {intento}", claves)
        if not fallas:
            print("    revisiones: todas bien", flush=True)
            break
        print("    FALLÓ: " + "; ".join(fallas.values()), flush=True)
        correcciones = [k for k in fallas if k in P["correcciones"]]
    print(f"  Costo de esta corrida: ${gastado:.4f} USD. Gastado en total según los registros de arte/generadas/: "
          f"${GP.gastado_en_total():.4f} USD")


def cmd_generar(args):
    P = cargar_toml()
    pieza = args.pieza
    imgs, rutas = entradas_de(P, pieza)
    correr(P, dict(P["config"]), pieza, imgs, rutas, P["piezas"][pieza]["aspecto"], lambda c: prompt_de(P, pieza, c),
           REVISAR[pieza], CLAVES[pieza], args, pieza)


def cmd_editar(args):
    """Una edición de una figura ya aprobada (más ornamentada), sobre su imagen cruda: la misma figura, con lo que pide
    [ediciones.<pieza>] de prompts-baraja.toml."""
    P = cargar_toml()
    pieza = args.pieza
    ed = P["ediciones"][f"{pieza}-{args.cambio}" if args.cambio else pieza]
    ruta = imagen_de(f"{pieza}-{args.intento}")
    base = Image.open(ruta).convert("RGB")
    armar = lambda c: " ".join([limpiar(ed["texto"])] + [P["correcciones"][k] for k in c if k in P["correcciones"]])
    if ed.get("zona") == "corona":   # un retoque: de Gemini solo se toma la corona
        caja = zona_corona(base)
        print(f"  zona del retoque (la corona): {caja}")
        revisar, claves = (lambda g: revisar_retoque(base, g, caja)), CLAVES[pieza] + ["alineacion", "sin_cambio"]
    else:
        revisar, claves = (lambda g: revisar_edicion(base, g)), CLAVES[pieza] + ["igual", "adornos"]
    correr(P, dict(P["config"]), pieza, [base], [ruta], ed["aspecto"], armar, revisar, claves, args,
           f"{pieza} ({args.cambio or 'edición'} de {pieza}-{args.intento})")


def imagen_de(nombre):
    """La imagen de una figura: la compuesta de un retoque si la hay; si no, lo crudo de Gemini."""
    compuesta = os.path.join(DIR, f"{nombre}-compuesta.png")
    return compuesta if os.path.exists(compuesta) else os.path.join(DIR, f"{nombre}-crudo.png")


def salidas(pieza, img, fallas, v, extra, nombre, titulo, claves=None):
    """Las medidas, la hoja y, del reverso, el marco solo; de una figura, la mitad lista para el código (de un retoque,
    con la imagen compuesta)."""
    if "compuesta" in extra:
        img = extra["compuesta"]
        img.save(os.path.join(DIR, f"{nombre}-compuesta.png"))
    with open(os.path.join(DIR, f"{nombre}.json"), "w") as f:
        json.dump({"revisiones": fallas, "medidas": v}, f, ensure_ascii=False, indent=2, default=str)
    hoja(img, fallas, v, extra, f"{nombre} ({titulo})", os.path.join(DIR, f"{nombre}-hoja.jpg"), claves or CLAVES[pieza])
    print(f"    hoja: {rel(os.path.join(DIR, nombre + '-hoja.jpg'))}", flush=True)
    if pieza == "reverso":
        hacer_limpio(img, nombre)
    else:
        carta_figura(img, nombre)


def hacer_limpio(img, nombre):
    limpio, marco = limpiar_reverso(img)
    limpio.save(os.path.join(DIR, f"{nombre}-limpio.png"))
    datos = carta_reverso(limpio, marco, os.path.join(DIR, f"{nombre}-carta.png"), os.path.join(DIR, f"{nombre}-carta.json"))
    print(f"    marco solo: {rel(os.path.join(DIR, nombre + '-limpio.png'))}; carta: "
          f"{rel(os.path.join(DIR, nombre + '-carta.png'))} (estirada {datos['estirado']:.1%})", flush=True)
    return limpio


FIG_PANEL = (384, 486)   # el panel de media figura en la carta, a 3× (128 × 162 px de CARD_PX en baraja.js)
# La túnica por palo (corazones queda en el rojo ladrillo de la base): diamantes marino, tréboles oliva, picas gris
# pizarra oscuro (en tinta se perderían las líneas).
COLOR_TUNICA = {"d": (52, 80, 127), "c": (111, 122, 60), "s": (70, 80, 90)}


def carta_figura(img, nombre):
    """La mitad de arriba lista para el código: recortada en el corte de la cintura (la última fila donde la figura
    cubre casi todo el ancho), acomodada en el panel (FIG_PANEL, con la cintura en la orilla de abajo), el blanco al
    papel de la baraja y una versión por palo con el rojo ladrillo recoloreado (el de la túnica y la corona, aunque esté
    en pedacitos entre los patrones, con su sombra plana; la cara y las manos no se tocan). Regresa las rutas por palo."""
    W, H = img.size
    C = clases(img)
    lab, n = ndi.label(C["blanco"])
    bordes = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    figura = ndi.binary_opening(~np.isin(lab, list(bordes)), iterations=2)
    cob = figura.mean(axis=1)
    filas = np.nonzero(cob >= FIG_CORTE)[0]
    corte = int(filas.max()) + 1 if len(filas) else H
    pw, ph = FIG_PANEL
    k = ph / corte
    ancho = round(W * k)
    medio = img.crop((0, 0, W, corte)).resize((ancho, ph), Image.LANCZOS)
    x0 = (ancho - pw) // 2
    medio = medio.crop((x0, 0, x0 + pw, ph)) if ancho >= pw else medio
    a = np.asarray(medio).astype(np.float32) / 255
    blanco = np.array(clases(medio)["blanco"])
    a = np.clip(a * (np.array(PAPEL, np.float32) / 255), 0, 1)   # el blanco (y lo demás, parejo) al papel
    lab_img = rgb2lab(a)
    base = rgb2lab(np.clip(np.array(TUNICA, np.float32) / 255 * np.array(PAPEL) / 255, 0, 1)[None, None, :])[0, 0]
    d = np.linalg.norm(lab_img - base, axis=2)
    fuera = np.zeros(d.shape, bool)   # la cara y las manos (y lo que tengan cerca, como la boca) no se recolorean
    for zx0, zy0, zx1, zy1 in zonas_piel(clases(medio), *medio.size):
        fuera[zy0:zy1, zx0:zx1] = True
    w = np.clip((2 * TUNICA_TOL - d) / TUNICA_TOL, 0, 1) * ~fuera * ~blanco
    from skimage.color import lab2rgb
    rutas = {}
    for palo in "hdcs":
        out = a
        if palo in COLOR_TUNICA:
            t = rgb2lab(np.array(COLOR_TUNICA[palo], np.float32)[None, None, :] / 255)[0, 0]
            nuevo = np.stack([lab_img[..., 0] + (t[0] - base[0]), t[1] + (lab_img[..., 1] - base[1]) * 0.5,
                              t[2] + (lab_img[..., 2] - base[2]) * 0.5], axis=2)
            out = a * (1 - w[..., None]) + np.clip(lab2rgb(nuevo), 0, 1) * w[..., None]
        rutas[palo] = os.path.join(DIR, f"{nombre}-carta-{palo}.png")
        Image.fromarray((out * 255).round().astype(np.uint8)).save(rutas[palo])
    print(f"    carta: {rel(rutas['h'])} y las de los otros palos (recortada en la fila {corte} de {H}, "
          f"túnica recoloreada en {float((w > 0.5).mean()):.0%} del panel)", flush=True)
    return rutas


def pieza_rgba(a, caja):
    """Un recorte del reverso limpio (trazos sobre blanco) como pieza transparente: la transparencia sale de qué tan lejos
    del blanco está cada píxel, y el color, del trazo sin la mezcla con el blanco."""
    c = a[caja[1]:caja[3], caja[0]:caja[2]]
    alpha = np.clip(np.linalg.norm(c - 255, axis=2) / 110, 0, 1)
    col = np.where(alpha[..., None] > 0.02, 255 - (255 - c) / np.maximum(alpha[..., None], 0.02), 255)
    return Image.fromarray(np.dstack([np.clip(col, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")


def adornos_del_reverso():
    """Las piezas del reverso aprobado que adornan el marco de las figuras, para que el frente y el reverso combinen:
    la flor de tres hojas de su esquina de arriba a la izquierda y un tramo de la banda de volutas de su lado izquierdo
    (acostado, de hueco a hueco, para repetirlo a lo largo de la línea del centro)."""
    a = np.asarray(Image.open(os.path.join(APROBADAS, "reverso.png")).convert("RGB")).astype(np.float32)
    # la flor: las hojas que caen completas en la esquina (55, 55)-(145, 145) del reverso, sin pedazos de otras volutas
    trazo = np.linalg.norm(a - 255, axis=2) > 44
    lab, _ = ndi.label(trazo)
    hojas = [i + 1 for i, sl in enumerate(ndi.find_objects(lab))
             if sl[1].start >= 55 and sl[0].start >= 55 and sl[1].stop <= 145 and sl[0].stop <= 145]
    mk = ndi.binary_dilation(np.isin(lab, hojas), iterations=3)
    ys, xs = np.nonzero(mk)
    flor = pieza_rgba(np.where(mk[..., None], a, 255), (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    banda = pieza_rgba(a, (58, 236, 160, 1028)).rotate(90, expand=True)
    perfil = np.asarray(banda)[..., 3].astype(np.float32).sum(axis=0)   # cuánta tinta hay en cada columna
    n = len(perfil)
    hueco = lambda i0, i1: i0 + int(np.argmin(perfil[i0:i1]))
    x0, x1 = hueco(round(0.05 * n), round(0.3 * n)), hueco(round(0.7 * n), round(0.95 * n))
    banda = banda.crop((x0, 0, x1, banda.size[1]))
    rutas = {"flor": os.path.join(APROBADAS, "adorno-flor.png"), "banda": os.path.join(APROBADAS, "adorno-banda.png")}
    flor.save(rutas["flor"])
    banda.save(rutas["banda"])
    print(f"  adornos del reverso: {rel(rutas['flor'])} {flor.size}, {rel(rutas['banda'])} {banda.size}")
    return rutas


def cmd_adornos(args):
    adornos_del_reverso()


def cmd_carta(args):
    """De una figura: arma la mitad lista para el código, aunque alguna revisión haya fallado (para verla; gratis)."""
    nombre = f"{args.pieza}-{args.intento}"
    carta_figura(Image.open(imagen_de(nombre)).convert("RGB"), nombre)


def cmd_revisar(args):
    img = Image.open(args.imagen).convert("RGB")
    pieza = args.pieza or os.path.basename(args.imagen).split("-")[0]
    fallas, v, extra = REVISAR[pieza](img)
    print(json.dumps({"revisiones": fallas, "medidas": v}, ensure_ascii=False, indent=2, default=str))
    m = re.match(rf"^({re.escape(pieza)}-\d+)-crudo\.png$", os.path.basename(args.imagen))
    if m and os.path.dirname(os.path.abspath(args.imagen)) == DIR:
        with open(os.path.join(DIR, f"{m.group(1)}.json"), "w") as f:
            json.dump({"revisiones": fallas, "medidas": v}, f, ensure_ascii=False, indent=2, default=str)
        hoja(img, fallas, v, extra, f"{m.group(1)} (revisada otra vez, gratis)",
             os.path.join(DIR, f"{m.group(1)}-hoja.jpg"), CLAVES[pieza])
    print("revisiones: todas bien" if not fallas else "FALLÓ: " + "; ".join(fallas.values()))


def cmd_limpiar(args):
    """Del reverso: deja solo el marco (gratis) y revisa el resultado como si fuera nuevo."""
    nombre = f"reverso-{args.intento}"
    img = Image.open(os.path.join(DIR, f"{nombre}-crudo.png")).convert("RGB")
    limpio = hacer_limpio(img, nombre)
    fallas, v, extra = revisar_reverso(limpio)
    hoja(limpio, fallas, v, extra, f"{nombre}, solo el marco (limpiado por código)",
         os.path.join(DIR, f"{nombre}-limpio-hoja.jpg"), CLAVES["reverso"])
    print("  revisiones del marco solo: " + ("todas bien" if not fallas else "FALLÓ: " + "; ".join(fallas.values())))


def cmd_aprobar(args):
    nombre = f"{args.pieza}-{args.intento}"
    if not os.path.exists(os.path.join(DIR, f"{nombre}-crudo.png")):
        sys.exit(f"No existe {rel(os.path.join(DIR, nombre + '-crudo.png'))}.")
    os.makedirs(APROBADAS, exist_ok=True)
    sufijos = ([("-crudo.png", "-crudo.png"), ("-limpio.png", ".png"), ("-carta.png", "-carta.png"),
                ("-carta.json", "-carta.json")] if args.pieza == "reverso"
               else [(os.path.basename(imagen_de(nombre))[len(nombre):], ".png")]
               + [(f"-carta-{p}.png", f"-carta-{p}.png") for p in "hdcs"])
    for sufijo, dest in sufijos:
        src = os.path.join(DIR, nombre + sufijo)
        if not os.path.exists(src):
            sys.exit(f"Falta {rel(src)}" + (" (corre antes limpiar)" if "limpio" in sufijo or "carta" in sufijo else ""))
        with open(src, "rb") as fi, open(os.path.join(APROBADAS, args.pieza + dest), "wb") as fo:
            fo.write(fi.read())
        print(f"  {rel(src)} -> {rel(os.path.join(APROBADAS, args.pieza + dest))}")


# ---------- probar: las revisiones contra imágenes hechas a mano ----------

ROJO_M, TINTA_M, FONDO_M = (142, 47, 37), (29, 22, 17), (250, 249, 245)


def _marco_maqueta(t, W, H, m0, lados=("arriba", "abajo", "izquierda", "derecha")):
    """Un marco de prueba: dos líneas y volutas (espirales con hojas) por lado, y una espiral grande en cada esquina."""
    def espiral(cx, cy, r, giro, ancho=7):
        pts = [(cx + r * (1 - s / 3.2) * math.cos(giro + s * 2.4), cy + r * (1 - s / 3.2) * math.sin(giro + s * 2.4))
               for s in np.linspace(0, 2.6, 40)]
        t.line(pts, fill=ROJO_M, width=ancho, joint="curve")
        t.ellipse([cx + r * 1.1 - 7, cy - 5, cx + r * 1.1 + 7, cy + 5], fill=ROJO_M)

    for lado in lados:
        if lado in ("arriba", "abajo"):
            y = m0 + 40 if lado == "arriba" else H - m0 - 40
            t.line([(m0 + 60, y - 28), (W - m0 - 60, y - 28)], fill=ROJO_M, width=10)
            t.line([(m0 + 60, y + 28), (W - m0 - 60, y + 28)], fill=ROJO_M, width=6)
            xs = list(range(m0 + 100, W - m0 - 90, 64))
            for i, x in enumerate(xs):   # simétricas: el giro de la de la derecha es el espejo de la de la izquierda
                espiral(x, y, 17, (math.pi - i * 1.3) if x > W / 2 else i * 1.3)
        else:
            x = m0 + 40 if lado == "izquierda" else W - m0 - 40
            t.line([(x - 28, m0 + 60), (x - 28, H - m0 - 60)], fill=ROJO_M, width=10)
            t.line([(x + 28, m0 + 60), (x + 28, H - m0 - 60)], fill=ROJO_M, width=6)
            for i, y in enumerate(range(m0 + 100, H - m0 - 90, 64)):
                espiral(x, y, 17, 0.7 + i * 1.3)
    for cx, cy in ((m0 + 45, m0 + 45), (W - m0 - 45, m0 + 45), (m0 + 45, H - m0 - 45), (W - m0 - 45, H - m0 - 45)):
        espiral(cx, cy, 38, 0.4, 9)


def _maqueta_reverso(variante, W=848, H=1264):
    """Un reverso de prueba (solo el marco) dibujado con PIL, y variantes con un defecto cada una."""
    img = Image.new("RGB", (W, H), (120, 115, 110) if variante == "sombra" else FONDO_M)
    t = ImageDraw.Draw(img)
    if variante == "sombra":
        t.rectangle([40, 40, W - 20, H - 20], fill=(70, 66, 60))
        t.rectangle([20, 20, W - 40, H - 40], fill=FONDO_M)
    m0 = 60 if variante == "sombra" else 26
    _marco_maqueta(t, W, H, m0)
    a = np.asarray(img).copy()   # simétrico a lo ancho y a lo alto: el cuarto de arriba a la izquierda, reflejado
    cuarto = a[:H // 2, :W // 2]
    a[:H // 2, W - W // 2:] = cuarto[:, ::-1][:, :W // 2]
    a[H - H // 2:, :] = a[:H // 2][::-1][:H // 2]
    img = Image.fromarray(a)
    t = ImageDraw.Draw(img)
    if variante == "sin_marco":
        t.rectangle([W - m0 - 100, m0 + 160, W - 1, H - m0 - 160], fill=FONDO_M)
    if variante in ("dibujitos", "con_todo"):
        for i, (x, y) in enumerate([(260, 330), (600, 300), (230, 560), (650, 520), (250, 820), (620, 800), (380, 990),
                                    (560, 1020), (330, 410), (520, 360)]):
            if i % 2:
                t.rounded_rectangle([x - 24, y - 36, x + 24, y + 36], 10, fill=(111, 122, 60), outline=TINTA_M, width=4)
            else:
                t.ellipse([x - 32, y - 32, x + 32, y + 32], fill=(201, 154, 53), outline=TINTA_M, width=4)
    if variante in ("etiqueta", "con_todo"):
        a = math.radians(33)
        ux, uy, nx, ny = math.cos(a), -math.sin(a), math.sin(a), math.cos(a)
        L, A, cx, cy = 440, 66, W / 2, H / 2   # llega hasta el marco, como la que dibujó Gemini
        pts = [(cx + sx * L * ux + sy * A * nx, cy + sx * L * uy + sy * A * ny) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        t.polygon(pts, fill=(159, 54, 38), outline=TINTA_M, width=5)
    if variante == "neon":
        t.line([(m0 + 60, m0 + 12), (W - m0 - 60, m0 + 12)], fill=(255, 30, 200), width=12)
    if variante == "texto":
        f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 40)
        t.text((330, 600), "ACE 52", fill=TINTA_M, font=f)
    if variante == "palos":
        P = palos_js()
        for p, (x, y), col in (("h", (150, 60), ROJO_M), ("d", (700, 640), ROJO_M), ("c", (424, 1200), ROJO_M)):
            mk = Image.fromarray((mascara_palo(P[p], 64) * 255).astype(np.uint8))
            img.paste(Image.new("RGB", mk.size, col), (x - mk.size[0] // 2, y - mk.size[1] // 2), mk)
    if variante == "vineta":
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.hypot((xx - W / 2) / W, (yy - H / 2) / H)
        img = Image.fromarray((np.asarray(img).astype(np.float32) * (1 - 0.25 * np.clip(d - 0.15, 0, 1)[..., None])).astype(np.uint8))
    if variante == "jpeg":
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=82)
        img = Image.open(buf).convert("RGB")
    return img


def _maqueta_figura(variante, W=928, H=1152):
    """Una figura de prueba (la mitad de arriba de un rey) dibujada con PIL, y variantes con un defecto cada una."""
    img = Image.new("RGB", (W, H), (205, 200, 190) if variante == "fondo_gris" else (252, 251, 248))
    t = ImageDraw.Draw(img)
    dx = 140 if variante == "corrida" else 0
    dy = -150 if variante == "corona_cortada" else 0
    fin = H - 120 if variante == "flotando" else H + 10
    cx = W / 2 + dx
    tunica = (47, 76, 128) if variante == "tunica_azul" else (255, 40, 210) if variante == "neon" else TUNICA
    piel, mostaza, crema = (232, 190, 160), (201, 154, 53), (239, 228, 200)
    # túnica (cortada por la orilla de abajo) con franjas y un borde de cuadritos
    t.polygon([(cx - 200, 560 + dy), (cx + 200, 560 + dy), (cx + 330, fin), (cx - 330, fin)], fill=tunica, outline=TINTA_M, width=4)
    for k in range(3):
        y = 700 + dy + k * 120
        t.rectangle([cx - 240 - k * 25, y, cx + 240 + k * 25, y + 26], fill=mostaza, outline=TINTA_M, width=3)
        for j in range(-8, 9):
            t.rectangle([cx + j * 26 - 9, y + 4, cx + j * 26 + 9, y + 22], fill=crema)
    # cuello de armiño con motitas
    t.ellipse([cx - 230, 480 + dy, cx + 230, 640 + dy], fill=(250, 248, 242), outline=TINTA_M, width=4)
    for j in range(-6, 7):
        t.ellipse([cx + j * 32 - 5, 555 + dy - 5, cx + j * 32 + 5, 555 + dy + 5], fill=TINTA_M)
    # cabeza ancha con bigote y corona
    t.ellipse([cx - 170, 250 + dy, cx + 170, 520 + dy], fill=piel, outline=TINTA_M, width=4)
    t.polygon([(cx - 120, 450 + dy), (cx, 420 + dy), (cx + 120, 450 + dy), (cx + 60, 470 + dy), (cx - 60, 470 + dy)], fill=(120, 90, 60), outline=TINTA_M)
    t.polygon([(cx - 150, 270 + dy), (cx - 160, 110 + dy), (cx - 80, 190 + dy), (cx, 90 + dy), (cx + 80, 190 + dy), (cx + 160, 110 + dy),
               (cx + 150, 270 + dy)], fill=mostaza, outline=TINTA_M, width=4)
    # cetro en diagonal y la otra mano al pecho
    t.line([(cx - 260, 1000 + dy), (cx + 120, 520 + dy)], fill=mostaza, width=22)
    t.ellipse([cx + 40, 760 + dy, cx + 130, 850 + dy], fill=piel, outline=TINTA_M, width=4)
    if variante == "texto":
        t.text((cx - 90, 738 + dy), "REX", fill=crema, font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 70))
    if variante == "tres_puntos":   # tres puntos crema en triángulo, como en la corona del rey ornamentado
        for ddx, ddy in ((0, -10), (-9, 6), (9, 6)):   # pegados entre sí, como en la corona
            t.ellipse([cx + 150 + ddx - 10, 880 + dy + ddy - 10, cx + 150 + ddx + 10, 880 + dy + ddy + 10], fill=crema, outline=TINTA_M, width=3)
    if variante == "palos":
        mk = Image.fromarray((mascara_palo(palos_js()["d"], 70) * 255).astype(np.uint8))
        img.paste(Image.new("RGB", mk.size, mostaza), (round(cx) - 150, 858 + dy), mk)
    if variante == "degradado":
        a = np.asarray(img).astype(np.float32)
        yy = np.clip(0.65 + 0.6 * (np.arange(H) - 560) / (H - 560), 0.65, 1.25)[:, None, None]   # visible: ~20 de luz
        tun = np.linalg.norm(a - np.array(TUNICA, np.float32), axis=2) < 30
        a[tun] = np.clip(a * yy, 0, 255)[tun]
        img = Image.fromarray(a.astype(np.uint8))
    if variante != "fondo_gris":   # el JPEG de la API
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        img = Image.open(buf).convert("RGB")
    return img


def cmd_probar(args):
    destino = os.path.join(DIR, "pruebas")
    os.makedirs(destino, exist_ok=True)
    bien = True

    def correr(nombre, img, revisar, quiero, claves):
        nonlocal bien
        img.save(os.path.join(destino, f"{nombre}.png"))
        fallas, v, extra = revisar(img)
        hoja(img, fallas, v, extra, f"prueba: {nombre}", os.path.join(destino, f"{nombre}-hoja.jpg"), claves)
        ok = set(fallas) == quiero
        bien &= ok
        print(f"  {'bien ' if ok else 'MAL  '} {nombre:24s} esperaba {sorted(quiero) or '-'}, salió {sorted(fallas) or '-'}"
              + ("" if ok else "  " + "; ".join(fallas.values())))

    print("Reverso (solo el marco):")
    for variante, quiero in {"bueno": set(), "jpeg": set(), "dibujitos": {"centro"}, "etiqueta": {"centro"},
                             "texto": {"centro", "texto"}, "palos": {"palos"}, "vineta": {"plano"}, "neon": {"colores"},
                             "sin_marco": {"marco"}, "sombra": {"marco"}}.items():
        correr(f"reverso-{variante}", _maqueta_reverso(variante), revisar_reverso, quiero, CLAVES["reverso"])
    # limpiar: con dibujitos y una etiqueta que llega hasta el marco, debe quedar como el bueno
    con_todo = _maqueta_reverso("con_todo")
    limpio, _ = limpiar_reverso(con_todo)
    correr("reverso-limpiado", limpio, revisar_reverso, set(), CLAVES["reverso"])
    dif = np.abs(np.asarray(limpio).astype(int) - np.asarray(_maqueta_reverso("bueno")).astype(int)).max(axis=2)
    print(f"  {'bien ' if (dif > 60).mean() < 0.002 else 'MAL  '} limpiar: {(dif > 60).mean():.3%} distinto del marco solo")
    bien &= (dif > 60).mean() < 0.002

    print("Figuras:")
    for variante, quiero in {"buena": set(), "fondo_gris": {"fondo"}, "corona_cortada": {"encuadre"},
                             "flotando": {"encuadre"}, "corrida": {"encuadre"}, "texto": {"texto"}, "palos": {"palos"},
                             "neon": {"colores", "tunica"}, "tunica_azul": {"tunica"}, "degradado": {"plano"},
                             "tres_puntos": {"tres_puntos"}}.items():
        correr(f"figura-{variante}", _maqueta_figura(variante), revisar_figura, quiero, CLAVES["rey"])
    # plano, con los personajes del juego (sobre verde o magenta: la figura es lo que no es fondo)
    texturas = []
    for p in sorted(glob.glob(os.path.join(ROOT, "arte", "personajes", "*", "*-frente-espera.png"))):
        if "blorp" in p:
            continue
        im = Image.open(p).convert("RGB")
        a = np.asarray(im).astype(np.float32)
        esquina = np.median(np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3)]), axis=0)
        fig = np.linalg.norm(a - esquina, axis=2) > 80
        texturas.append((os.path.basename(p).split("-")[0], round(textura(clases(im), ndi.binary_erosion(fig, iterations=4)), 3)))
    print(f"  textura de los personajes del juego (límite {TEXTURA_MAX}): {texturas}")
    bien &= all(x <= TEXTURA_MAX for _, x in texturas)

    # que las formas de palo no se vean en dibujos de verdad: recortes del garaje
    fondo = Image.open(FONDO).convert("RGB").resize((1920, 1072), Image.LANCZOS)
    falsos = []
    for caja in ((40, 80, 520, 640), (500, 80, 1100, 600), (1100, 0, 1900, 700), (0, 500, 960, 1072), (960, 500, 1920, 1072)):
        falsos += buscar_palos(clases(fondo.crop(caja)), caja[2] - caja[0], caja[3] - caja[1])
    print(f"  {'bien ' if not falsos else 'MAL  '} palos en el garaje: {falsos or 'ninguno'}")
    bien &= not falsos
    print("Todas las pruebas salieron como se esperaba." if bien else "Hay pruebas que no salieron bien.")


def main():
    ap = argparse.ArgumentParser(description="Genera con Gemini el arte de la baraja nueva, una imagen por corrida.")
    sub = ap.add_subparsers(dest="comando", required=True)
    g = sub.add_parser("generar", help="genera UNA imagen de una pieza (máximo MAX_LLAMADAS llamadas)")
    g.add_argument("pieza", choices=PIEZAS)
    g.add_argument("--simular", action="store_true", help="muestra prompt, referencias y costo sin llamar a la API")
    g.add_argument("--si", action="store_true", help="no pedir confirmación")
    r = sub.add_parser("revisar", help="vuelve a correr las revisiones de una imagen (gratis)")
    r.add_argument("imagen")
    r.add_argument("--pieza", choices=PIEZAS)
    lm = sub.add_parser("limpiar", help="del reverso: deja solo el marco, con el centro en blanco (gratis)")
    lm.add_argument("pieza", choices=["reverso"])
    lm.add_argument("--intento", type=int, required=True, help="el número de la imagen (reverso-<n>-crudo.png)")
    a = sub.add_parser("aprobar", help="pasa una imagen revisada a arte/baraja/")
    a.add_argument("pieza", choices=PIEZAS)
    a.add_argument("--intento", type=int, required=True, help="el número de la imagen (<pieza>-<n>-crudo.png)")
    ed = sub.add_parser("editar", help="edita con Gemini una figura ya aprobada (máximo MAX_LLAMADAS llamadas)")
    ed.add_argument("pieza", choices=FIGURAS)
    ed.add_argument("--intento", type=int, required=True, help="la imagen que se edita (<pieza>-<n>)")
    ed.add_argument("--cambio", help="un retoque de [ediciones.<pieza>-<cambio>] (por ejemplo corona)")
    ed.add_argument("--simular", action="store_true", help="muestra el prompt y el costo sin llamar a la API")
    ed.add_argument("--si", action="store_true", help="no pedir confirmación")
    cf = sub.add_parser("carta", help="de una figura: la mitad lista para el código, en sus cuatro palos (gratis)")
    cf.add_argument("pieza", choices=FIGURAS)
    cf.add_argument("--intento", type=int, required=True, help="el número de la imagen (<pieza>-<n>-crudo.png)")
    sub.add_parser("adornos", help="saca del reverso aprobado la flor y la banda de volutas de las figuras (gratis)")
    sub.add_parser("probar", help="las revisiones contra imágenes de prueba (gratis)")
    args = ap.parse_args()
    {"generar": cmd_generar, "editar": cmd_editar, "revisar": cmd_revisar, "limpiar": cmd_limpiar,
     "aprobar": cmd_aprobar, "carta": cmd_carta, "adornos": cmd_adornos, "probar": cmd_probar}[args.comando](args)


if __name__ == "__main__":
    main()
