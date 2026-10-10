"""Quita el fondo gris liso de las ilustraciones de personajes y las guarda como PNG transparentes.

USO
---
1. Una sola vez, crear el entorno de Python (desde la carpeta poker-for-the-players/):

       brew install python@3.12
       /opt/homebrew/bin/python3.12 -m venv .venv-rembg
       .venv-rembg/bin/pip install "rembg[cpu]" scipy

   La primera corrida descarga los modelos isnet-anime y birefnet-general (~1.15 GB en ~/.rembg/models).

2. Poner las poses del personaje en arte/ con el nombre <personaje>-<pose>.png
   (por ejemplo arte/blorp-espera.png, arte/blorp-apuesta-parpadeo.png), sobre fondo gris liso.

3. Recortar todas las poses de un personaje:

       .venv-rembg/bin/python scripts/recortar.py arte/blorp-*.png

   Los recortes quedan en arte/recortes/ con el mismo nombre. Los originales no se tocan, y los
   fondos (fondo-*.png) se saltan aunque se pasen por error. arte/ está fuera de git: son los
   originales pesados; las versiones optimizadas para el juego van en public/assets/.

4. Revisar el resultado sobre el fondo del garaje antes de usarlo (contornos, aretes, cartas,
   huecos de la silla). La silla es parte del personaje y se queda.

CÓMO RECORTA
------------
rembg (isnet-anime + birefnet-general) decide qué es personaje y qué es fondo; el color decide el
borde exacto. Se quita todo el gris conectado al borde de la imagen, y los huecos grises interiores
(dentro de los aretes, entre las patas de la silla) solo si alguno de los dos modelos los ve como
fondo; así las cartas y otros grises del dibujo se respetan. En la orilla del contorno negro el
alfa se calcula por mezcla con el gris y se le quita ese gris al color, para que no quede halo.

REGLA PARA OPTIMIZAR PARA EL JUEGO
---------------------------------
Las poses de un mismo personaje pueden venir en tamaños distintos (11008, 5504 o 2752 px de ancho),
pero son el mismo cuadro a distinta escala. Al optimizarlas para public/assets/, TODAS las poses de
un personaje deben quedar exactamente del mismo tamaño y alineadas, para que al cambiar de pose el
personaje no se mueva ni cambie de tamaño:

  - Primero escalar todas las poses al mismo lienzo (mismo ancho y alto), nunca cada una a "lo que
    quepa". Las poses deben tener la misma proporción (este script avisa si no).
  - Después recortar el área transparente con UNA sola caja común a todas las poses (la unión de sus
    áreas visibles), nunca con un recorte automático por pose.
  - Exportar todas con las mismas dimensiones finales y el mismo punto de anclaje.
"""
import sys, os, time
from collections import defaultdict
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from rembg import remove, new_session

Image.MAX_IMAGE_PIXELS = None
T = 14          # diferencia máx. por canal para considerar un píxel "gris de fondo"
OUTLINE = 30    # luminancia aprox. del contorno negro


def recortar(path, sessions):
    img = Image.open(path).convert("RGB")
    W, H = img.size
    rgb = np.asarray(img)

    # color del fondo: mediana del borde de la imagen
    border = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
                             rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    bg = np.median(border, axis=0).astype(np.int16)
    bgL = float(bg.mean())
    rgb16 = rgb.astype(np.int16)
    chroma = rgb16.max(axis=2) - rgb16.min(axis=2)
    dark = bgL - rgb16.mean(axis=2, dtype=np.float32)          # >0 = más oscuro que el fondo
    del rgb16
    # "parecido al fondo": gris neutro cercano al gris del fondo (tolera ruido y brillos claros)
    near_bg = (chroma <= T) & (dark <= 2 * T) & (dark >= -3 * T)
    # cuánto "personaje" hay en un píxel: oscuridad (contorno negro) o color, respecto al gris
    d = np.maximum(dark, 3 * chroma.astype(np.float32))
    del chroma, dark

    # máscaras de rembg a resolución reducida, escaladas a tamaño completo
    small = img.resize((2048, round(2048 * H / W)), Image.LANCZOS)
    masks = [np.asarray(remove(small, session=s, only_mask=True).resize((W, H), Image.BILINEAR)) for s in sessions]
    model_fg_any = (masks[0] >= 128) | (masks[1] >= 128)        # alguno lo ve como personaje
    model_bg_any = (masks[0] < 128) | (masks[1] < 128)          # alguno lo ve como fondo
    del masks

    # regiones grises conectadas: quitar las que tocan el borde y los huecos interiores que algún modelo marca como fondo
    lab, n = ndi.label(near_bg)
    edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    sizes = ndi.sum_labels(np.ones_like(lab, dtype=np.uint8), lab, index=np.arange(n + 1))
    bg_frac = ndi.mean(model_bg_any, lab, index=np.arange(n + 1))
    min_hole = (W / 2752) ** 2 * 30
    kill = (bg_frac > 0.5) & (sizes >= min_hole)
    kill[edge_labels] = True
    kill[0] = False
    removed = kill[lab]
    del lab, near_bg

    # motas sueltas que no son gris pero ningún modelo considera personaje
    lab, n = ndi.label(~removed)
    keep = ndi.mean(model_fg_any, lab, index=np.arange(n + 1)) > 0.5
    keep[0] = False
    removed |= ~keep[lab]
    del lab

    # alfa: opaco salvo en una franja junto al fondo quitado, donde se estima por mezcla con el gris
    band_px = max(2, round(3 * W / 2752))
    band = ndi.binary_dilation(removed, iterations=band_px) & ~removed
    alpha = np.where(removed, 0.0, 1.0).astype(np.float32)
    a_band = np.clip((d[band] - T) / (bgL - OUTLINE - T), 0, 1).astype(np.float32)
    a_band[a_band < 0.12] = 0
    a_band[a_band > 0.92] = 1
    alpha[band] = a_band
    del d

    # quitar el gris mezclado en los píxeles semitransparentes (sin halo)
    out = rgb.copy()
    m = band & (alpha > 0) & (alpha < 1)
    a = alpha[m][:, None]
    out[m] = np.clip((rgb[m].astype(np.float32) - (1 - a) * bg) / a, 0, 255).astype(np.uint8)

    rgba = np.dstack([out, (alpha * 255 + 0.5).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA"), bg


def main(paths):
    paths = [p for p in paths if not os.path.basename(p).startswith("fondo")]
    if not paths:
        sys.exit("Uso: .venv-rembg/bin/python scripts/recortar.py arte/<personaje>-*.png")

    sessions = [new_session("isnet-anime"), new_session("birefnet-general")]
    tamanos = defaultdict(list)
    for path in paths:
        t0 = time.time()
        name = os.path.basename(path)
        out_dir = os.path.join(os.path.dirname(path), "recortes")
        os.makedirs(out_dir, exist_ok=True)
        rgba, bg = recortar(path, sessions)
        rgba.save(os.path.join(out_dir, name))
        tamanos[name.split("-")[0]].append((name, rgba.size))
        print(f"{name}: {rgba.size[0]}x{rgba.size[1]} fondo={bg.tolist()} {time.time() - t0:.0f}s", flush=True)

    # regla de alineación: las poses de un personaje deben tener la misma proporción
    for personaje, poses in tamanos.items():
        proporciones = {round(w / h, 3) for _, (w, h) in poses}
        if len(proporciones) > 1:
            print(f"AVISO: las poses de '{personaje}' tienen proporciones distintas y no se alinearán al "
                  f"escalarlas al mismo tamaño: " + ", ".join(f"{n} {w}x{h}" for n, (w, h) in poses))


if __name__ == "__main__":
    main(sys.argv[1:])
