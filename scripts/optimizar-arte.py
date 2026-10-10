"""Convierte el arte original (arte/) en WebP optimizado para el juego (public/assets/arte/).

USO (desde la carpeta poker-for-the-players/, con el entorno de recortar.py):

    .venv-rembg/bin/python scripts/optimizar-arte.py

QUÉ HACE
--------
- Fondos: arte/fondo-*.png  ->  public/assets/arte/fondo-*-3840.webp y fondo-*-1920.webp
- Personajes: arte/recortes/<personaje>-<pose>.png  ->  public/assets/arte/<personaje>-<pose>.webp (grande)
  y <personaje>-<pose>-chico.webp (mitad), siguiendo la regla de alineación de recortar.py:
    1. todas las poses de un personaje se escalan al mismo lienzo (el ancho de la pose más chica);
    2. se recortan con UNA sola caja común (la unión de lo visible de todas las poses);
    3. todas salen exactamente del mismo tamaño, así que al cambiar de pose nada brinca.
- Escribe public/assets/arte/personajes.json con el tamaño final de cada personaje y la caja usada,
  para revisar. Las anclas (cintura, cabeza) se miden a ojo y van en client/stage/characters.js.
"""
import glob, json, os, sys
from collections import defaultdict
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "arte")
OUT = os.path.join(ROOT, "public", "assets", "arte")
Q_FONDO, Q_PERSONAJE = 80, 86


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
    print(f"  {os.path.relpath(path, ROOT)}  {img.size[0]}x{img.size[1]}  {os.path.getsize(path) // 1024} KB", flush=True)


def fondos():
    for path in sorted(glob.glob(os.path.join(SRC, "fondo-*.png"))):
        name = os.path.splitext(os.path.basename(path))[0]
        img = Image.open(path).convert("RGB")
        for w in (3840, 1920):
            h = round(img.size[1] * w / img.size[0])
            guardar(escalar(img, w, h), os.path.join(OUT, f"{name}-{w}.webp"), Q_FONDO)


def personajes():
    grupos = defaultdict(list)
    for path in sorted(glob.glob(os.path.join(SRC, "recortes", "*.png"))):
        grupos[os.path.basename(path).split("-")[0]].append(path)
    info = {}
    for personaje, paths in grupos.items():
        imgs = {os.path.splitext(os.path.basename(p))[0]: Image.open(p).convert("RGBA") for p in paths}
        proporciones = {round(i.size[0] / i.size[1], 3) for i in imgs.values()}
        if len(proporciones) > 1:
            sys.exit(f"Las poses de '{personaje}' tienen proporciones distintas: no se pueden alinear.")
        W = min(i.size[0] for i in imgs.values())
        H = round(W / proporciones.pop())
        imgs = {k: escalar(i, W, H) for k, i in imgs.items()}
        # caja común: unión de lo visible de todas las poses, con un margen chico
        vis = np.zeros((H, W), bool)
        for i in imgs.values():
            vis |= np.asarray(i.getchannel("A")) > 8
        ys, xs = np.where(vis)
        m = 6
        box = (max(0, int(xs.min()) - m), max(0, int(ys.min()) - m), min(W, int(xs.max()) + 1 + m), min(H, int(ys.max()) + 1))
        print(f"{personaje}: lienzo {W}x{H}, caja común {box}")
        for k, i in sorted(imgs.items()):
            c = i.crop(box)
            guardar(c, os.path.join(OUT, f"{k}.webp"), Q_PERSONAJE)
            guardar(escalar(c, c.size[0] // 2, c.size[1] // 2), os.path.join(OUT, f"{k}-chico.webp"), Q_PERSONAJE)
        info[personaje] = {"poses": sorted(k.split("-", 1)[1] for k in imgs), "lienzo": [W, H],
                           "caja": [int(v) for v in box], "tamano": [box[2] - box[0], box[3] - box[1]]}
    with open(os.path.join(OUT, "personajes.json"), "w") as f:
        json.dump(info, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    fondos()
    personajes()
