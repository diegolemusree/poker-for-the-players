"""Genera con Gemini las poses de un personaje a partir de una ilustración de referencia.

USO (desde la carpeta poker-for-the-players/, con el entorno de recortar.py)
----------------------------------------------------------------------------
Una sola vez:

    .venv-rembg/bin/pip install google-genai
    # y poner la API key en .env:  GEMINI_API_KEY=...

1. Ver qué se va a generar, con los prompts completos y el costo estimado, sin gastar nada:

       .venv-rembg/bin/python scripts/generar-personaje.py generar blorp arte/blorp-frente-espera.png --simular

2. Generar todas las poses que faltan (pide confirmación antes de gastar):

       .venv-rembg/bin/python scripts/generar-personaje.py generar blorp arte/blorp-frente-espera.png

   Si ya tienes un dibujo del personaje en ángulo de lado, agrégalo para que lado-espera lo copie:
   --ref-lado arte/blorp-espera.png

   O solo una o varias poses, por ejemplo para rehacer una que no te gustó (se guarda como versión nueva):

       .venv-rembg/bin/python scripts/generar-personaje.py generar blorp arte/blorp-frente-espera.png --pose lado-espia

3. Revisar arte/generadas/<personaje>/ (y la hoja revision.jpg con todas las poses juntas).

4. Cuando todas estén bien, recortarlas e igualarlas de tamaño:

       .venv-rembg/bin/python scripts/generar-personaje.py aprobar blorp

   Si de una pose prefieres una versión anterior a la más reciente:  --elegir lado-espia=1

QUÉ GENERA
----------
Dos ángulos (frente y lado) y cinco poses por ángulo, en arte/generadas/<personaje>/:
    <personaje>-<ángulo>-espera.png, -espera-parpadeo, -espia, -apuesta, -apuesta-parpadeo
Una pose cuenta como hecha si ya existe en arte/ (por ejemplo la propia referencia) o en arte/generadas/.
Nada se sobrescribe: si se rehace una pose, sale como <nombre>-v2.png, -v3.png, etc.

Orden, para que las poses de un ángulo queden alineadas entre sí:
  - <ángulo>-espera se genera desde la referencia;
  - espia y apuesta usan la referencia y además la <ángulo>-espera (mismo ángulo, tamaño y silla);
  - cada parpadeo es una edición de su pose base (solo cierra los ojos), así no brinca al parpadear.
Los prompts están en scripts/prompts-personaje.toml.

APROBAR
-------
Toma la versión más reciente de cada pose (o la que digas con --elegir), las lleva todas al mismo
lienzo (el tamaño de la mayoría; escala a esa altura y completa o recorta los lados con el gris del
fondo), las guarda en arte/generadas/<personaje>/aprobadas/ y las pasa por scripts/recortar.py, que
deja los PNG transparentes en arte/generadas/<personaje>/aprobadas/recortes/, todos del mismo tamaño.
"""
import argparse, base64, io, json, os, re, subprocess, sys, threading, time, tomllib
from collections import Counter
from datetime import datetime
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTE = os.path.join(ROOT, "arte")
PROMPTS = os.path.join(ROOT, "scripts", "prompts-personaje.toml")
ANGULOS = ["frente", "lado"]
POSES = ["espera", "espera-parpadeo", "espia", "apuesta", "apuesta-parpadeo"]
MAX_LADO_ENTRADA = 2048   # las referencias se reducen a esto antes de mandarlas (hay originales de 11008 px)
T = 14                    # mismo umbral de gris que recortar.py

# USD, de ai.google.dev/gemini-api/docs/pricing (octubre 2026). imagen: por imagen de salida;
# entrada y texto (incluye "thinking"): por millón de tokens.
PRECIOS = {
    "gemini-nano-banana-2.1": {"imagen": {"1K": 0.0336, "2K": 0.0504, "4K": 0.113}, "entrada": 1.50, "texto": 7.50},
    "gemini-3.1-flash-image": {"imagen": {"1K": 0.067, "2K": 0.101, "4K": 0.151}, "entrada": 0.50, "texto": 3.00},
    "gemini-3-pro-image": {"imagen": {"1K": 0.134, "2K": 0.134, "4K": 0.24}, "entrada": 2.00, "texto": 12.00},
}
TOKENS_POR_IMAGEN_ENTRADA = 1120   # estimado, para el cálculo previo
TOKENS_THINKING_ESTIMADOS = 1000   # estimado; el costo real se calcula con lo que reporta la API


# ---------- archivos y versiones ----------

def carpeta(personaje):
    return os.path.join(ARTE, "generadas", personaje)


def versiones(personaje, nombre):
    """Versiones generadas de una pose: {1: ruta, 2: ruta, ...}."""
    d = carpeta(personaje)
    patron = re.compile(rf"^{re.escape(nombre)}(?:-v(\d+))?\.png$")
    out = {}
    if os.path.isdir(d):
        for f in os.listdir(d):
            m = patron.match(f)
            if m:
                out[int(m.group(1) or 1)] = os.path.join(d, f)
    return out


def actual(personaje, nombre, elegidas=None):
    """La imagen vigente de una pose: la versión elegida, la más reciente generada, o la que ya está en arte/."""
    vs = versiones(personaje, nombre)
    clave = nombre.split("-", 1)[1]
    if elegidas and clave in elegidas:
        v = elegidas[clave]
        if v not in vs:
            sys.exit(f"No existe la versión {v} de {nombre} (hay: {sorted(vs) or 'ninguna'}).")
        return vs[v]
    if vs:
        return vs[max(vs)]
    original = os.path.join(ARTE, nombre + ".png")
    return original if os.path.exists(original) else None


def ruta_nueva(personaje, nombre):
    vs = versiones(personaje, nombre)
    n = max(vs) + 1 if vs else 1
    return os.path.join(carpeta(personaje), nombre + (f"-v{n}" if n > 1 else "") + ".png")


def rel(path):
    return os.path.relpath(path, ROOT)


# ---------- imágenes ----------

def color_fondo(img):
    """Mediana del gris de las orillas de arriba y de los lados (abajo suele estar la silla)."""
    a = np.asarray(img.convert("RGB"))
    h, w = a.shape[:2]
    b, alto = max(4, h // 40), int(h * 0.7)
    borde = np.concatenate([a[:b].reshape(-1, 3), a[:alto, :b].reshape(-1, 3), a[:alto, -b:].reshape(-1, 3)])
    return np.median(borde, axis=0).astype(int), borde


def revisar_fondo(img, gris_ref):
    """Avisos si el fondo no es el gris liso que necesita recortar.py."""
    avisos = []
    gris, borde = color_fondo(img)
    if gris.max() - gris.min() > 6:
        avisos.append(f"el fondo no es gris neutro (RGB {gris.tolist()})")
    if np.abs(gris - gris_ref).max() > 12:
        avisos.append(f"el gris del fondo {gris.tolist()} es distinto al de la referencia {gris_ref.tolist()}")
    parejo = (np.abs(borde.astype(int) - gris).max(axis=1) <= T).mean()
    if parejo < 0.97:
        avisos.append(f"el fondo no es liso en las orillas ({parejo:.0%} parejo): ¿degradado o viñeta?")
    return avisos


def a_png_base64(path, aspect_ratio):
    """La imagen ya en la proporción de salida (como la dejará aprobar), para que el modelo no reencuadre."""
    img = Image.open(path).convert("RGB")
    rw, rh = (int(v) for v in aspect_ratio.split(":"))
    img = igualar(img, round(img.size[1] * rw / rh), img.size[1])
    img.thumbnail((MAX_LADO_ENTRADA, MAX_LADO_ENTRADA), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def hoja_revision(personaje):
    """revision.jpg: la versión vigente de cada pose, frente arriba y lado abajo."""
    cw, ch, pie = 550, 307, 26
    hoja = Image.new("RGB", (cw * len(POSES), (ch + pie) * len(ANGULOS)), "white")
    dib = ImageDraw.Draw(hoja)
    for fila, angulo in enumerate(ANGULOS):
        for col, pose in enumerate(POSES):
            nombre = f"{personaje}-{angulo}-{pose}"
            path = actual(personaje, nombre)
            x, y = col * cw, fila * (ch + pie)
            if path:
                im = Image.open(path).convert("RGB")
                im.thumbnail((cw, ch), Image.LANCZOS)
                hoja.paste(im, (x + (cw - im.size[0]) // 2, y))
                etiqueta = os.path.basename(path)
            else:
                etiqueta = f"{nombre} (falta)"
            dib.text((x + 8, y + ch + 6), etiqueta, fill="black")
    path = os.path.join(carpeta(personaje), "revision.jpg")
    hoja.save(path, quality=85)
    return path


# ---------- prompts ----------

def cargar_prompts():
    with open(PROMPTS, "rb") as f:
        return tomllib.load(f)


def limpiar(texto):
    return " ".join(texto.split())


def plan_de_pose(personaje, referencia, angulo, pose, P, guias=None):
    """(prompt, [imágenes de entrada]) para una pose, o (None, motivo) si le falta su pose base.
    guias: {ángulo: imagen ya dibujada en ese ángulo} para guiar la pose espera de ese ángulo."""
    c = P["comun"]
    if pose.endswith("-parpadeo"):
        base = actual(personaje, f"{personaje}-{angulo}-{pose.removesuffix('-parpadeo')}")
        if not base:
            return None, f"primero hay que generar {angulo}-{pose.removesuffix('-parpadeo')}"
        return limpiar(P["ediciones"]["parpadeo"]), [base]

    partes = [c["referencia"]]
    entradas = [referencia]
    if pose == "espera":
        base = (guias or {}).get(angulo)
    else:
        base = actual(personaje, f"{personaje}-{angulo}-espera")
        if not base:
            return None, f"primero hay que generar {angulo}-espera"
    if base and os.path.abspath(base) != os.path.abspath(referencia):
            partes.append(c["segunda_imagen"])
            entradas.append(base)
    partes += [P["angulos"][angulo]["texto"], P["poses"][pose]["texto"], c["estilo"], c["encuadre"], c["fondo"]]
    return limpiar(" ".join(partes)), entradas


def costo_estimado(modelo, tamano, n_entradas, prompt):
    p = PRECIOS.get(modelo)
    if not p:
        return None
    tokens_entrada = n_entradas * TOKENS_POR_IMAGEN_ENTRADA + len(prompt) // 4
    return p["imagen"][tamano] + tokens_entrada * p["entrada"] / 1e6 + TOKENS_THINKING_ESTIMADOS * p["texto"] / 1e6


def costo_real(modelo, tamano, usage):
    """Costo aproximado con los tokens que reporta la API."""
    p = PRECIOS.get(modelo)
    if not p or usage is None:
        return None
    salida_imagen = sum(m.tokens or 0 for m in (usage.output_tokens_by_modality or [])
                        if "image" in str(m.modality).lower())
    entrada, salida, thinking = usage.total_input_tokens or 0, usage.total_output_tokens or 0, usage.total_thought_tokens or 0
    if usage.total_tokens == entrada + salida:   # el thinking ya viene contado dentro de la salida
        thinking = 0
    salida_texto = max(0, salida - salida_imagen) + thinking
    return p["imagen"][tamano] + entrada * p["entrada"] / 1e6 + salida_texto * p["texto"] / 1e6


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
    # El SDK reintenta solo, sin avisar, los timeouts y errores 5xx (hasta 4 intentos de varios minutos cada uno).
    # Con imágenes eso puede cobrar dos veces la misma; los reintentos los decide generar_imagen.
    client.interactions.sdk_configuration.retry_config = None
    return client


def generar_imagen(client, cfg, prompt, entradas):
    entrada = [{"type": "text", "text": prompt}]
    entrada += [{"type": "image", "data": a_png_base64(p, cfg["aspect_ratio"]), "mime_type": "image/png"} for p in entradas]
    # (background=True no sirve aquí: lo manda a una variante "-agent" que no acepta imágenes de entrada)
    listo = threading.Event()
    inicio = time.time()

    def avisar():
        while not listo.wait(30):
            print(f"    ... {time.time() - inicio:.0f} s", flush=True)

    threading.Thread(target=avisar, daemon=True).start()
    try:
        for intento in range(3):
            try:
                return client.interactions.create(
                    model=cfg["modelo"],
                    input=entrada,
                    response_format={"type": "image", "aspect_ratio": cfg["aspect_ratio"], "image_size": cfg["image_size"]},
                    timeout=600,
                )
            except Exception as e:
                # solo se reintenta cuando el servidor rechazó la petición (no se generó nada); un timeout no,
                # porque la imagen pudo haberse hecho y cobrado
                codigo = getattr(e, "status_code", None)
                if "Free Tier" in str(e):
                    sys.exit("    El proyecto de la API key sigue en el nivel gratuito, que no permite generar imágenes.\n"
                             "    Activa la facturación en aistudio.google.com/api-keys (botón \"Set up billing\") y vuelve a correr.")
                if intento == 2 or codigo not in (429, 503):
                    raise
                print(f"    error {codigo}, reintentando en {30 * (intento + 1)} s...", flush=True)
                time.sleep(30 * (intento + 1))
    finally:
        listo.set()


# ---------- comandos ----------

def cmd_generar(args):
    P = cargar_prompts()
    cfg = dict(P["config"])
    if args.modelo:
        cfg["modelo"] = args.modelo
    if args.tamano:
        cfg["image_size"] = args.tamano
    personaje, referencia = args.personaje, os.path.abspath(args.referencia)
    guias = {"lado": os.path.abspath(args.ref_lado)} if args.ref_lado else {}
    for p in [referencia, *guias.values()]:
        if not os.path.exists(p):
            sys.exit(f"No encuentro {rel(p)}")

    todas = [f"{a}-{p}" for a in ANGULOS for p in POSES]
    if args.pose:
        malas = [p for p in args.pose if p not in todas]
        if malas:
            sys.exit(f"Pose desconocida: {', '.join(malas)}. Opciones: {', '.join(todas)}")
        pendientes = [p for p in todas if p in args.pose]          # en orden de dependencias
    else:
        pendientes = [p for p in todas if not actual(personaje, f"{personaje}-{p}")]
    if not pendientes:
        print(f"No falta ninguna pose de {personaje}. Para rehacer una: --pose <ángulo>-<pose>")
        return

    # costo estimado (las que dependen de una pose que aún no existe se estiman con 2 imágenes de entrada)
    total = 0
    print(f"Modelo {cfg['modelo']}, {cfg['aspect_ratio']} {cfg['image_size']}. Por generar ({len(pendientes)}):")
    for clave in pendientes:
        angulo, pose = clave.split("-", 1)
        prompt, entradas = plan_de_pose(personaje, referencia, angulo, pose, P, guias)
        if prompt is None:
            prompt, entradas = "", [referencia, referencia]
        c = costo_estimado(cfg["modelo"], cfg["image_size"], len(entradas), prompt)
        total += c or 0
        print(f"  {personaje}-{clave}" + (f"  ~${c:.3f}" if c else ""))
        if args.simular and prompt:
            print("    entradas: " + ", ".join(rel(e) for e in entradas))
            print("    prompt: " + prompt + "\n")
    if cfg["modelo"] in PRECIOS:
        print(f"Costo estimado: ~${total:.2f} USD")
    else:
        print(f"(No tengo el precio de {cfg['modelo']}: revisa ai.google.dev/gemini-api/docs/pricing)")
    if args.simular:
        return
    if not args.si and input("¿Generar? [s/N] ").strip().lower() not in ("s", "si", "sí"):
        print("Cancelado.")
        return

    client = cliente()
    gris_ref = color_fondo(Image.open(referencia))[0]
    os.makedirs(carpeta(personaje), exist_ok=True)
    registro = os.path.join(carpeta(personaje), "registro.jsonl")
    gastado, hechas = 0, []
    for clave in pendientes:
        angulo, pose = clave.split("-", 1)
        prompt, entradas = plan_de_pose(personaje, referencia, angulo, pose, P, guias)
        if prompt is None:
            print(f"  {clave}: me la salto, {entradas}.")
            continue
        print(f"  {personaje}-{clave}: generando...", flush=True)
        t0 = time.time()
        try:
            r = generar_imagen(client, cfg, prompt, entradas)
        except Exception as e:
            print(f"    ERROR: {e}\nMe detengo aquí; lo ya generado se queda. Vuelve a correr para seguir.")
            break
        if not r.output_image or not r.output_image.data:
            print(f"    No regresó imagen (estado: {r.status}). Texto del modelo: {r.output_text or '(nada)'}")
            continue
        img = Image.open(io.BytesIO(base64.b64decode(r.output_image.data))).convert("RGB")
        destino = ruta_nueva(personaje, f"{personaje}-{clave}")
        img.save(destino)
        c = costo_real(cfg["modelo"], cfg["image_size"], r.usage)
        gastado += c or 0
        hechas.append(clave)
        print(f"    -> {rel(destino)}  {img.size[0]}x{img.size[1]}  {time.time() - t0:.0f}s"
              + (f"  ~${c:.3f}" if c is not None else ""))
        for aviso in revisar_fondo(img, gris_ref):
            print(f"    AVISO: {aviso}")
        if pose.endswith("-parpadeo"):
            base = Image.open(entradas[0])
            rw, rh = (int(v) for v in cfg["aspect_ratio"].split(":"))
            base = igualar(base, round(base.size[1] * rw / rh), base.size[1]).resize(img.size, Image.LANCZOS)
            a, b = caja_visible(img), caja_visible(base)
            if a and b and max(abs(x - y) for x, y in zip(a, b)) > 0.01 * img.size[1]:
                print(f"    AVISO: el parpadeo no queda alineado con su pose base (caja {a} vs {b}): "
                      "brincaría al parpadear")
        u = r.usage
        with open(registro, "a") as f:
            f.write(json.dumps({
                "fecha": datetime.now().isoformat(timespec="seconds"), "archivo": os.path.basename(destino),
                "modelo": cfg["modelo"], "tamano": cfg["image_size"], "entradas": [rel(e) for e in entradas],
                "prompt": prompt, "costo_usd": round(c, 4) if c is not None else None,
                "tokens": {"entrada": u.total_input_tokens, "salida": u.total_output_tokens,
                           "thinking": u.total_thought_tokens} if u else None,
            }, ensure_ascii=False) + "\n")

    # si se rehízo una pose base, su parpadeo ya no corresponde
    for clave in hechas:
        rehecha = max(versiones(personaje, f"{personaje}-{clave}")) > 1
        if clave.endswith(("-espera", "-apuesta")) and rehecha and f"{clave}-parpadeo" not in hechas:
            print(f"  OJO: rehiciste {clave}; su parpadeo se hizo sobre la versión anterior. "
                  f"Rehazlo con --pose {clave}-parpadeo")
    if hechas:
        print(f"Listo: {len(hechas)} imagen(es), ~${gastado:.2f} USD. Revisa {rel(carpeta(personaje))}/ "
              f"y la hoja {rel(hoja_revision(personaje))}")


def igualar(img, W, H):
    """Escala a la altura H y completa (o recorta) los lados con el gris del fondo hasta el ancho W."""
    img = img.convert("RGB")
    w = round(img.size[0] * H / img.size[1])
    if (w, H) != img.size:
        img = img.resize((w, H), Image.LANCZOS)
    gris = tuple(int(v) for v in color_fondo(img)[0])
    lienzo = Image.new("RGB", (W, H), gris)
    lienzo.paste(img, ((W - w) // 2, 0))   # si w > W, el offset negativo recorta los dos lados por igual
    return lienzo


def caja_visible(img):
    a = np.asarray(img).astype(int)
    gris = color_fondo(img)[0]
    ys, xs = np.where(np.abs(a - gris).max(axis=2) > 3 * T)
    return (xs.min(), ys.min(), xs.max(), ys.max()) if len(xs) else None


def cmd_aprobar(args):
    personaje = args.personaje
    elegidas = {}
    for e in args.elegir or []:
        pose, _, v = e.partition("=")
        if pose not in [f"{a}-{p}" for a in ANGULOS for p in POSES] or not v.isdigit():
            sys.exit(f"--elegir debe ser <ángulo>-<pose>=<versión>, por ejemplo lado-espia=1 (recibí {e})")
        elegidas[pose] = int(v)

    fuentes = {f"{personaje}-{a}-{p}": actual(personaje, f"{personaje}-{a}-{p}", elegidas) for a in ANGULOS for p in POSES}
    faltan = [n for n, f in fuentes.items() if not f]
    if faltan:
        sys.exit("Faltan poses: " + ", ".join(faltan))
    salida = os.path.join(carpeta(personaje), "aprobadas")
    if os.path.exists(salida) and not args.rehacer:
        sys.exit(f"{rel(salida)}/ ya existe. Para reemplazarla con la selección actual usa --rehacer.")
    os.makedirs(salida, exist_ok=True)

    imgs = {n: Image.open(f) for n, f in fuentes.items()}
    W, H = Counter(i.size for i in imgs.values()).most_common(1)[0][0]
    print(f"Lienzo común: {W}x{H}")
    cajas = {}
    for nombre, img in imgs.items():
        tam = img.size
        img = igualar(img, W, H)
        img.save(os.path.join(salida, nombre + ".png"))
        cajas[nombre] = caja_visible(img)
        print(f"  {os.path.basename(fuentes[nombre])} ({tam[0]}x{tam[1]}) -> aprobadas/{nombre}.png")

    # aviso si el modelo dibujó al personaje a otra escala en alguna pose del mismo ángulo
    for angulo in ANGULOS:
        base = cajas[f"{personaje}-{angulo}-espera"]
        for pose in POSES[1:]:
            c = cajas[f"{personaje}-{angulo}-{pose}"]
            if base and c and abs(c[1] - base[1]) > 0.03 * H:
                print(f"  AVISO: en {angulo}-{pose} la cabeza queda {c[1] - base[1]:+d} px respecto a {angulo}-espera "
                      "(el personaje se ve a otra escala o posición)")

    recortar = os.path.join(ROOT, "scripts", "recortar.py")
    pngs = sorted(os.path.join(salida, n + ".png") for n in fuentes)
    print("Quitando el fondo con recortar.py...", flush=True)
    subprocess.run([sys.executable, recortar, *pngs], check=True)
    print(f"Listo: {rel(os.path.join(salida, 'recortes'))}/ tiene las {len(pngs)} poses transparentes de {W}x{H}.")


def main():
    ap = argparse.ArgumentParser(description="Genera y aprueba las poses de un personaje con Gemini.")
    sub = ap.add_subparsers(dest="comando", required=True)
    g = sub.add_parser("generar", help="genera las poses que faltan (o las de --pose)")
    g.add_argument("personaje")
    g.add_argument("referencia", help="ilustración del personaje, por ejemplo arte/blorp-frente-espera.png")
    g.add_argument("--pose", action="append", help="solo esta pose, como lado-espia (se puede repetir)")
    g.add_argument("--ref-lado", help="dibujo del personaje ya en ángulo de lado, para guiar lado-espera")
    g.add_argument("--simular", action="store_true", help="muestra prompts y costo sin llamar a la API")
    g.add_argument("--si", action="store_true", help="no pedir confirmación")
    g.add_argument("--modelo", help="otro modelo en vez del de prompts-personaje.toml")
    g.add_argument("--tamano", choices=["1K", "2K", "4K"], help="otro tamaño en vez del de prompts-personaje.toml")
    a = sub.add_parser("aprobar", help="recorta e iguala de tamaño las poses revisadas")
    a.add_argument("personaje")
    a.add_argument("--elegir", action="append", help="usar otra versión de una pose, como lado-espia=1")
    a.add_argument("--rehacer", action="store_true", help="reemplazar una carpeta aprobadas/ anterior")
    args = ap.parse_args()
    cmd_generar(args) if args.comando == "generar" else cmd_aprobar(args)


if __name__ == "__main__":
    main()
