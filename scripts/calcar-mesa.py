"""Calca la mesa ilustrada aprobada (arte/mesa/mesa-horizontal.png) para que el juego dibuje todo con su perspectiva.

La mesa del juego es un octágono simétrico (TABLE_EDGE, con la orilla de afuera a x = ±1) con el riel a RAIL_Y, el canto
de APRON y el fieltro hasta FELT_R, visto con la cámara de la computadora (CAMERAS.landscape: pitch y dist). Este script
busca los valores que mejor reproducen el dibujo: su silueta (la orilla del recorte del garaje,
mesa-horizontal-silueta.json), la orilla de su fieltro y su pista dorada (como la calibración de extraer-mesa.py), y la
proyección del dibujo (F, cx y cy en sus px: el juego lo pone a la escala view.F / F con (cx, cy) como ancla).

Con una sola imagen hay una ambigüedad: una mesa más honda vista desde más abajo se ve casi igual que una menos honda
vista desde más arriba (de 16° a 30° el error casi no cambia). El ángulo sale de las fichas dibujadas en
referencia/composicion.png: sus elipses dicen que la cámara se ve a unos 20° desde la mesa, lo que da un pitch de ~19°.
Por eso el pitch es un dato (--pitch) y lo demás se ajusta.

USO (desde poker-for-the-players/, con el entorno de recortar.py)
    .venv-rembg/bin/python scripts/calcar-mesa.py [--pitch 19]

Deja arte/mesa/mesa-horizontal.json (cámara, geometría, proyección, errores y la silueta simplificada) e imprime los
valores para config.js y projection.js. Después: .venv-rembg/bin/python scripts/optimizar-arte.py mesa
"""
import argparse, importlib.util, json, os, sys

sys.dont_write_bytecode = True
import numpy as np
from PIL import Image
from scipy.optimize import least_squares
from scipy.spatial import ConvexHull
from skimage.measure import approximate_polygon

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("extraer_mesa", os.path.join(ROOT, "scripts", "extraer-mesa.py"))
X = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(X)
MESA = os.path.join(ROOT, "arte", "mesa", "mesa-horizontal.png")
SILUETA = MESA.replace(".png", "-silueta.json")
SALIDA = MESA.replace(".png", ".json")
REF = (1024, 559)   # los umbrales de la orilla del fieltro y la pista son de la referencia a este tamaño


def octagono(W, A, B, C):
    return np.array([(W, A), (B, C), (-B, C), (-W, A), (-W, -A), (-B, -C), (B, -C), (W, -A)])


def modelo(p, pitch):
    """En px de la referencia: la silueta (el riel arriba y el canto abajo, como tableOutline() del juego), el fieltro
    que se ve (con la pared de adentro del riel) y la pista."""
    A, B, C, ry, ap, fr, Wt, At, Bt, Ct, dist, F, cx, cy = p
    cam = X.Cam(pitch, dist, F, cx, cy)
    E = octagono(1.0, A, B, C)
    pts = np.vstack([cam.proyectar(E[:, 0], ry, E[:, 1]), cam.proyectar(E[:, 0], ry - ap, E[:, 1])])
    Et = octagono(Wt, At, Bt, Ct)
    return pts[ConvexHull(pts).vertices], X.fieltro_visible(cam, E * fr, 1.0, ry), cam.proyectar(Et[:, 0], 0.0, Et[:, 1])


def residuos(p, pitch, O, T, S):
    sil, fel, pista = modelo(p, pitch)
    if len(fel) < 3:
        return np.full(len(O) + len(T) + len(S), 200.0)
    return np.concatenate([X.dist_a_poligono(O, fel), X.dist_a_poligono(T, pista), 0.7 * X.dist_a_poligono(S, sil)])


LO = np.array([0.05, 0.2, 0.3, 0.0, 0.0, 0.6, 0.3, 0.03, 0.15, 0.2, 0.6, 30, 300, -3000])
HI = np.array([0.6, 0.9, 1.6, 0.2, 0.3, 0.98, 0.85, 0.5, 0.8, 1.2, 5.0, 30000, 700, 4000])


def calcar(pitch, O, T, S):
    """Desde varios puntos de partida; luego otra vez sin la orilla del fieltro a más de 8 px (lo que no cuadra)."""
    def ajuste(x0, O):
        return least_squares(lambda p: residuos(p, pitch, O, T, S), x0, bounds=(LO, HI), loss="soft_l1", f_scale=1.5,
                             diff_step=1e-3, x_scale="jac", max_nfev=6000)
    mejor = None
    for d0 in (1.6, 2.0, 2.4, 2.8):
        for fr in (0.85, 0.9):
            x0 = np.clip([0.27, 0.47, 0.97, 0.03, 0.09, fr, 0.55, 0.3, 0.33, 0.6, d0, 900 * d0 / 2.3, 522, 360],
                         LO + 1e-6, HI - 1e-6)
            try:
                r = ajuste(x0, O)
            except Exception:
                continue
            c = float(np.abs(r.fun).mean())
            if mejor is None or c < mejor[0]:
                mejor = (c, r.x)
    p = mejor[1]
    O2 = O[np.abs(residuos(p, pitch, O, T, S))[:len(O)] <= 8]
    return ajuste(p, O2).x, O2


def main():
    ap = argparse.ArgumentParser(description="Calca la mesa ilustrada para el juego.")
    ap.add_argument("--pitch", type=float, default=19.0, help="grados hacia abajo de la cámara (sale de las fichas dibujadas)")
    args = ap.parse_args()
    img = Image.open(MESA).convert("RGB")
    k = img.size[0] / REF[0]
    O, T = X.datos_de_calibracion(img.resize(REF, Image.LANCZOS))
    S = np.array(json.load(open(SILUETA))["silueta"]) / k
    S = S[(S[:, 1] < REF[1] - 3) & (S[:, 0] > 2) & (S[:, 0] < REF[0] - 2)]   # sin lo que se sale por abajo
    p, O2 = calcar(args.pitch, O, T, S)
    A, B, C, ry, apron, fr, Wt, At, Bt, Ct, dist, F, cx, cy = p
    d = np.abs(residuos(p, args.pitch, O2, T, S))
    nO, nT = len(O2), len(T)
    sil_m, _, _ = modelo(p, args.pitch)
    dS = X.dist_a_poligono(S, sil_m)
    fondo = S[:, 1] < np.percentile(S[:, 1], 30)
    errores = {"fieltro_prom": round(float(d[:nO].mean()), 2), "fieltro_p95": round(float(np.percentile(d[:nO], 95)), 2),
               "pista_prom": round(float(d[nO:nO + nT].mean()), 2),
               "silueta_prom": round(float(dS.mean()), 2), "silueta_fondo_max": round(float(dS[fondo].max()), 2),
               "nota": "px de la referencia (1024 de ancho); en 1440 x 900 son ~1.7 px de pantalla"}
    r3 = lambda v: round(float(v), 3)
    edge = [{"x": r3(x), "z": r3(z)} for x, z in octagono(1.0, A, B, C)]
    # para la mesa de código (respaldo): la pista y el octágono central como copias encogidas de la orilla
    track_r = r3((Wt + Ct / C) / 2)
    sil = np.array(json.load(open(SILUETA))["silueta"])
    sil = approximate_polygon(sil, tolerance=1.5)
    out = {
        "lado": list(img.size),
        "camara": {"pitch": args.pitch, "dist": r3(dist)},
        "mesa": {"TABLE_EDGE": edge, "RAIL_Y": r3(ry), "APRON": r3(apron), "FELT_R": r3(fr), "TRACK_R": track_r},
        "pista": {"W": r3(Wt), "A": r3(At), "B": r3(Bt), "C": r3(Ct)},
        "proyeccion": {"F": round(F * k, 2), "cx": round(cx * k, 2), "cy": round(cy * k, 2)},
        "errores": errores,
        "silueta": sil.round(1).tolist(),
    }
    json.dump(out, open(SALIDA, "w"), indent=1)
    print(f"{os.path.relpath(SALIDA, ROOT)}: pitch {args.pitch}°, dist {dist:.3f} (ojos a {dist * np.sin(np.radians(args.pitch)):.3f}); "
          f"error: {errores}")
    print("\nconfig.js:")
    print("  export const TABLE_EDGE = [\n    " + ", ".join(f"{{ x: {e['x']}, z: {e['z']} }}" for e in edge[:4]) + ",\n    "
          + ", ".join(f"{{ x: {e['x']}, z: {e['z']} }}" for e in edge[4:]) + ",\n  ];")
    print(f"  CAMERAS.landscape: pitch: {args.pitch:g}, dist: {r3(dist)}")
    print(f"projection.js: RAIL_Y = {r3(ry)}, APRON = {r3(apron)}, FELT_R = {r3(fr)}, TRACK_R = {track_r}")


if __name__ == "__main__":
    main()
