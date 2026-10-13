"""Convierte el arte original (arte/) en WebP optimizado para el juego (public/assets/arte/).

USO (desde la carpeta poker-for-the-players/, con el entorno de recortar.py)
--------------------------------------------------------------------------
    .venv-rembg/bin/python scripts/optimizar-arte.py                     # fondos y todos los personajes
    .venv-rembg/bin/python scripts/optimizar-arte.py fondos
    .venv-rembg/bin/python scripts/optimizar-arte.py personajes alien    # uno o varios (o todos sin nombre)
    .venv-rembg/bin/python scripts/optimizar-arte.py personajes alien --angulo lado
    .venv-rembg/bin/python scripts/optimizar-arte.py gif alien           # GIF de revisión por ángulo
    .venv-rembg/bin/python scripts/optimizar-arte.py registrar alien --nombre "El Alien"

Para un personaje nuevo, los tres pasos en orden: personajes -> gif (revisar) -> registrar.
La especificación del arte está en docs/ESPEC-PERSONAJES.md.

QUÉ HACE
--------
- fondos: arte/fondo-*.png -> public/assets/arte/fondo-*-3840.webp y fondo-*-1920.webp

- personajes: arte/personajes/<id>/<id>-<ángulo>-<cuadro>.png -> public/assets/arte/<id>-<ángulo>-<cuadro>.webp
  (grande) y <id>-<ángulo>-<cuadro>-chico.webp (mitad, para calidad baja). Ángulos: frente y lado.
  Cuadros: espera, parpadeo, espia, apuesta, retirarse. Cada personaje y ángulo es un grupo aparte:
    1. quita el fondo magenta (#FF00FF) con chroma key; si la imagen ya es transparente, se usa tal cual;
    2. escala todos los cuadros del grupo al mismo lienzo (deben tener la misma proporción);
    3. los recorta con UNA sola caja común (la unión de lo visible de todos los cuadros);
    4. los reduce con un solo factor: frente a 700 px de alto como máximo, lado a 1200 px.
  Así todos los cuadros de un grupo salen del mismo tamaño y al cambiar de pose nada brinca.

- gif: arte/revision/<id>-<ángulo>.gif alterna espera con cada uno de los demás cuadros, sobre un fondo
  liso, con el marco de la imagen y la línea de la cintura (si ya está registrada). Si algo brinca, se ve.

- registrar: agrega o actualiza el personaje en client/stage/personajes.json (lo lee characters.js).
  Solo escribe el tamaño y la lista de cuadros; la cintura, la cabeza y el alto se miden a mano y nunca
  se sobrescriben. Un personaje nuevo entra con valores provisionales y la marca "pendiente".

CHROMA KEY
----------
El fondo es el magenta conectado a la orilla de la imagen (así el morado dentro del personaje se respeta,
porque la línea de tinta lo separa del fondo), más los huecos encerrados de magenta casi puro (entre
el brazo y el cuerpo). En la orilla del contorno el alfa sale de cuánto magenta tiene cada píxel, y ese
magenta se le quita al color, para que no quede halo rosa. Las manchitas sueltas se borran.
"""
import argparse, glob, json, os, re, sys
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
CUADROS = ["espera", "parpadeo", "espia", "apuesta", "retirarse"]   # la misma lista que client/stage/characters.js
OBLIGATORIOS = ["espera", "parpadeo", "apuesta", "retirarse"]       # espia es opcional (si falta, se usa espera)
ALTO_MAX = {"frente": 700, "lado": 1200}
NOMBRE = re.compile(rf"^(?P<id>[a-z0-9]+(?:-[a-z0-9]+)*?)-(?P<angulo>{'|'.join(ANGULOS)})-(?P<cuadro>{'|'.join(CUADROS)})$")

MAGENTA = np.array([255, 0, 255], np.float32)
TOL_FONDO = 70      # distancia de color al magenta del fondo para contar como fondo (conectado a la orilla)
TOL_HUECO = 40      # más estricta para los huecos encerrados
BANDA = 3           # px alrededor del fondo donde se calcula el alfa suave y se quita el magenta
MIN_MANCHA = 0.0005 # pedazos visibles más chicos que esto (fracción de la imagen) se borran

# Valores provisionales al registrar un ángulo nuevo (hay que medirlos sobre la imagen; ver CLAUDE.md).
PROVISIONAL = {
    "frente": {"waist": [0.5, 0.85], "face": [0.2, 0, 0.8, 0.4], "height": 0.54},
    "lado": {"waist": [0.5, 0.85], "face": [0.2, 0, 0.8, 0.4], "height": 0.54},
}
PENDIENTE = "medir waist, face y height y luego borrar esta línea"


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


# ---------- chroma key ----------

def orillas(a, b=4):
    c = a.shape[-1]
    return np.concatenate([a[:b].reshape(-1, c), a[-b:].reshape(-1, c), a[:, :b].reshape(-1, c), a[:, -b:].reshape(-1, c)])


def ya_transparente(img):
    if img.mode not in ("RGBA", "LA", "PA") and "transparency" not in img.info:
        return False
    alfa = np.asarray(img.convert("RGBA").getchannel("A"))[..., None]
    return (orillas(alfa) < 8).mean() > 0.9


def quitar_magenta(img, nombre):
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    K = np.median(orillas(a), axis=0)   # el magenta real de esta imagen (el generador no siempre da #FF00FF exacto)
    if np.abs(K - MAGENTA).max() > 60:
        print(f"  AVISO {nombre}: el fondo no parece magenta (RGB {K.astype(int).tolist()}); revisa el resultado")
    dist = np.linalg.norm(a - K, axis=2)

    # fondo: magenta conectado a la orilla, más huecos encerrados de magenta casi puro
    lab, _ = ndi.label(dist < TOL_FONDO)
    borde = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    fondo = np.isin(lab, borde[borde > 0])
    lab, n = ndi.label((dist < TOL_HUECO) & ~fondo)
    if n:
        areas = ndi.sum(np.ones_like(dist), lab, index=np.arange(1, n + 1))
        fondo |= np.isin(lab, np.arange(1, n + 1)[areas >= 0.0002 * h * w])

    # orilla: el alfa sale de cuánto magenta tiene el píxel (min(R, B) - G, comparado con el del fondo)
    spill = np.clip((np.minimum(a[..., 0], a[..., 2]) - a[..., 1]) / max(1.0, min(K[0], K[2]) - K[1]), 0, 1)
    banda = ndi.binary_dilation(fondo, iterations=BANDA) & ~fondo
    alfa = np.ones((h, w), np.float32)
    alfa[fondo] = 0
    alfa[banda] = 1 - spill[banda]
    alfa[alfa < 0.04] = 0
    # y se le quita el magenta al color: píxel = alfa * color + (1 - alfa) * K
    m = banda & (alfa > 0)
    color = a.copy()
    color[m] = (a[m] - (1 - alfa[m, None]) * K) / alfa[m, None]

    # manchitas sueltas (ruido del JPEG, chispas del generador)
    lab, n = ndi.label(alfa > 0)
    if n > 1:
        areas = ndi.sum(np.ones_like(alfa), lab, index=np.arange(1, n + 1))
        alfa[np.isin(lab, np.arange(1, n + 1)[areas < MIN_MANCHA * h * w])] = 0

    rgba = np.dstack([np.clip(color, 0, 255), alfa * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def cargar(path):
    img = Image.open(path)
    nombre = os.path.basename(path)
    if ya_transparente(img):
        return img.convert("RGBA")
    if path.lower().endswith((".jpg", ".jpeg")):
        print(f"  AVISO {nombre}: es JPEG; con PNG la orilla sale más limpia")
    return quitar_magenta(img, nombre)


# ---------- personajes ----------

def entradas(ids=None):
    """{(id, ángulo): {cuadro: ruta}} de arte/personajes/<id>/."""
    grupos = defaultdict(dict)
    for carpeta in sorted(glob.glob(os.path.join(SRC, "personajes", "*"))):
        pid = os.path.basename(carpeta)
        if not os.path.isdir(carpeta) or ids and pid not in ids:
            continue
        for path in sorted(glob.glob(os.path.join(carpeta, "*"))):
            base, ext = os.path.splitext(os.path.basename(path))
            if ext.lower() not in (".png", ".webp", ".jpg", ".jpeg"):
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
    faltan = [c for c in OBLIGATORIOS if c not in paths]
    if faltan:
        print(f"  AVISO {pid} {angulo}: faltan {', '.join(faltan)}")
    imgs = {c: cargar(paths[c]) for c in CUADROS if c in paths}
    proporciones = {round(i.size[0] / i.size[1], 3) for i in imgs.values()}
    if len(proporciones) > 1:
        sys.exit(f"Los cuadros de {pid} {angulo} tienen proporciones distintas: no se pueden alinear.")
    W = min(i.size[0] for i in imgs.values())
    H = round(W / proporciones.pop())
    imgs = {c: escalar(i, W, H) for c, i in imgs.items()}

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
    tam = (round(bw * f), round(bh * f))
    print(f"{pid} {angulo}: lienzo {W}x{H}, caja común {box}, final {tam[0]}x{tam[1]}")

    for viejo in glob.glob(os.path.join(OUT, f"{pid}-{angulo}-*.webp")):   # por si se quitó un cuadro
        os.remove(viejo)
    for c, i in imgs.items():
        img = escalar(i.crop(box), *tam)
        guardar(img, os.path.join(OUT, f"{pid}-{angulo}-{c}.webp"), Q_PERSONAJE)
        guardar(escalar(img, tam[0] // 2, tam[1] // 2), os.path.join(OUT, f"{pid}-{angulo}-{c}-chico.webp"), Q_PERSONAJE)


def personajes(ids=None, angulo=None):
    grupos = entradas(ids)
    if not grupos:
        print(f"No hay personajes en {rel(os.path.join(SRC, 'personajes'))}/")
    for (pid, ang), paths in sorted(grupos.items()):
        if not angulo or ang == angulo:
            grupo(pid, ang, paths)


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
        w, h = imgs["espera"].size
        if h > 800:   # el GIF de lado se ve a menos tamaño; la alineación se nota igual
            w, h = round(w * 800 / h), 800
            imgs = {c: escalar(i, w, h) for c, i in imgs.items()}
        pad = 24
        cintura = reg.get(ang, {}).get("waist")
        fotos = []
        for c in orden:
            lienzo = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (117, 97, 76, 255))   # pared del garaje
            lienzo.alpha_composite(imgs[c], (pad, pad))
            d = ImageDraw.Draw(lienzo)
            d.rectangle((pad - 1, pad - 1, pad + w, pad + h), outline=(239, 228, 200, 255))
            if cintura:
                y = pad + round(cintura[1] * h)
                d.line((0, y, w + 2 * pad, y), fill=(201, 160, 58, 255), width=1)
            d.text((6, 6), c, fill=(239, 228, 200, 255))
            fotos.append(lienzo.convert("RGB"))
        os.makedirs(REVISION, exist_ok=True)
        destino = os.path.join(REVISION, f"{pid}-{ang}.gif")
        fotos[0].save(destino, save_all=True, append_images=fotos[1:], duration=600, loop=0)
        print(f"  {rel(destino)}  ({', '.join(orden)})")
        hechos += 1
    if not hechos:
        sys.exit(f"No hay cuadros optimizados de '{pid}' en {rel(OUT)}/: corre antes  personajes {pid}")


# ---------- registro (client/stage/personajes.json) ----------

def leer_registro():
    if not os.path.exists(REGISTRO):
        return {}
    with open(REGISTRO) as f:
        return json.load(f)


def escribir_registro(datos):
    texto = json.dumps(datos, indent=2, ensure_ascii=False)
    # las listas en una sola línea, para que se lea como el resto del código
    texto = re.sub(r"\[\s+([^\[\]{}]*?)\s+\]", lambda m: "[" + re.sub(r",\s+", ", ", m[1]) + "]", texto)
    with open(REGISTRO, "w") as f:
        f.write(texto + "\n")


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
                            "frames": cuadros, **({"pendiente": previo["pendiente"]} if "pendiente" in previo else {})}
        faltan = [x for x in OBLIGATORIOS if x not in cuadros]
        print(f"  {pid} {ang}: {size[0]}x{size[1]}, cuadros {', '.join(cuadros)}"
              + (f"  (faltan {', '.join(faltan)})" if faltan else ""))
    if "frente" not in c["angles"]:
        sys.exit(f"{pid}: hace falta el ángulo frente (es el que se usa cuando no hay lado). No registré nada.")
    escribir_registro(datos)
    print(f"{'Agregado' if nuevo else 'Actualizado'} {pid} ({c['name']}) en {rel(REGISTRO)}")
    for ang, a in c["angles"].items():
        if "pendiente" in a:
            print(f"  PENDIENTE {ang}: waist, face y height son provisionales; mídelos y borra \"pendiente\".")
    print("  Para usarlo en la mesa, asígnalo en characterFor() de client/stage/characters.js.")


def main():
    ap = argparse.ArgumentParser(description="Optimiza el arte para el juego (sin comando: fondos y todos los personajes).")
    sub = ap.add_subparsers(dest="comando")
    sub.add_parser("fondos", help="fondos del cuarto")
    p = sub.add_parser("personajes", help="quita el fondo magenta, recorta, reduce y exporta en WebP")
    p.add_argument("ids", nargs="*", help="personajes a procesar (todos si no se pone ninguno)")
    p.add_argument("--angulo", choices=ANGULOS)
    g = sub.add_parser("gif", help="GIF de revisión por ángulo en arte/revision/")
    g.add_argument("id")
    g.add_argument("--angulo", choices=ANGULOS)
    r = sub.add_parser("registrar", help="agrega o actualiza el personaje en client/stage/personajes.json")
    r.add_argument("id")
    r.add_argument("--nombre", help='nombre para mostrar, por ejemplo "Madame Blorp"')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    if args.comando in (None, "fondos"):
        fondos()
    if args.comando in (None, "personajes"):
        personajes(getattr(args, "ids", None) or None, getattr(args, "angulo", None))
    if args.comando == "gif":
        gif(args.id, args.angulo)
    if args.comando == "registrar":
        registrar(args.id, args.nombre)


if __name__ == "__main__":
    main()
