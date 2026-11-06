# Montage des streams : repère la webcam incrustée dans l'image (le rectangle où l'on voit le streamer, par-dessus le
# jeu), pour la mettre entière en haut du Short. Gratuit, tourne sur le serveur (OpenCV).
# Indices : un visage petit qui ne bouge pas d'une image à l'autre, et autour de lui un cadre dont les bords restent
# fixes pendant tout le passage (le jeu bouge, le cadre de la webcam jamais). Les visages du jeu (personnages, portraits)
# n'ont pas ce cadre : on garde le visage entouré du cadre le plus net.
# Usage : python webcam.py <video> <yunet.onnx> <debut> <duree> [debug]
# Sortie (JSON) : {"box": [x, y, largeur, hauteur] entre 0 et 1, ou null}
import json
import sys

import cv2
import numpy as np

video, modele, debut, duree = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
DEBUG = len(sys.argv) > 5
N = 24
W = 960


def sortie(box):
    json.dump({"box": box}, sys.stdout)
    sys.exit(0)


cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
det, bords, visages, lus, images = None, None, [], 0, []
for k in range(N):
    cap.set(cv2.CAP_PROP_POS_FRAMES, round((debut + duree * (k + 0.5) / N) * fps))
    ok, img = cap.read()
    if not ok:
        continue
    Hi = round(img.shape[0] * W / img.shape[1])
    img = cv2.resize(img, (W, Hi))
    if det is None:
        det = cv2.FaceDetectorYN.create(modele, "", (W, Hi), 0.6, 0.3, 50)
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    images.append(gris.astype(np.float32))
    e = (cv2.Canny(gris, 60, 160) > 0).astype(np.float32)
    bords = e if bords is None else bords + e
    lus += 1
    _, faces = det.detect(img)
    for f in faces if faces is not None else []:
        visages.append((k, float(f[0]), float(f[1]), float(f[2]), float(f[3])))

if not lus or not visages:
    sortie(None)
P = bords / lus  # 1 : un bord présent sur toutes les images
H = P.shape[0]

# Les visages qui ne bougent pas : regroupés par position, présents sur au moins un tiers des images, petits.
groupes = []
for v in visages:
    for g in groupes:
        if abs(g[0][1] - v[1]) < W * 0.03 and abs(g[0][2] - v[2]) < H * 0.04:
            g.append(v)
            break
    else:
        groupes.append([v])
candidats = []
for g in groupes:
    n = len(set(v[0] for v in g))
    fx, fy, fw, fh = (float(np.median([v[i] for v in g])) for i in range(1, 5))
    if n >= lus / 3 and fw < W * 0.16 and np.std([v[1] for v in g]) < W * 0.02:
        candidats.append((n, fx, fy, fw, fh))


def ligne(axe, de, a_, lo, hi):
    """La ligne fixe la plus nette entre de et a_ (colonnes si axe = 0, lignes sinon), mesurée sur [lo, hi] :
    (position, netteté de 0 à 1), ou (None, 0)."""
    pas = 1 if a_ >= de else -1
    meilleur, pos = 0.0, None
    lim = W if axe == 0 else H
    for p in range(int(de), int(a_), pas):
        if p < 1 or p >= lim - 1:
            continue
        s = float(P[int(lo):int(hi), p - 1:p + 2].max(axis=1).mean()) if axe == 0 else float(P[p - 1:p + 2, int(lo):int(hi)].max(axis=0).mean())
        if s > meilleur:
            meilleur, pos = s, p
    return (pos, meilleur) if meilleur >= 0.55 else (None, 0.0)


def vivant(fx, fy, fw, fh):
    """À quel point le visage bouge d'une image à l'autre : un streamer bouge toujours un peu, un portrait du jeu
    jamais (écart moyen des pixels du visage dans le temps, de 0 à 1)."""
    pile = np.stack([im[int(fy):int(fy + fh), int(fx):int(fx + fw)] for im in images])
    return float(pile.std(axis=0).mean()) / 255 if pile.size else 0.0


def boite(fx, fy, fw, fh):
    """Le rectangle autour d'un visage : une ligne fixe de chaque côté, sinon le bord de l'image s'il est tout près.
    Rend (preuves, rectangle) : plus les côtés sont nets, plus c'est sûrement une webcam."""
    y0, y1 = max(0, fy - fh * 0.5), min(H, fy + fh * 2)
    x0, x1 = max(0, fx - fw * 0.5), min(W, fx + fw * 1.5)
    g, sg = ligne(0, fx - fw * 0.15, max(0, fx - fw * 3.5), y0, y1)
    d, sd = ligne(0, fx + fw * 1.15, min(W, fx + fw * 4.5), y0, y1)
    h, sh = ligne(1, fy - fh * 0.2, max(0, fy - fh * 3), x0, x1)
    b, sb = ligne(1, fy + fh * 1.2, min(H, fy + fh * 4.5), x0, x1)
    if g is None and fx < fw * 0.8:
        g = 0
    if d is None and W - (fx + fw) < fw * 0.8:
        d = W
    if h is None and fy < fh * 0.8:
        h = 0
    if b is None and H - (fy + fh) < fh * 0.8:
        b = H
    if DEBUG:
        print("visage", [round(fx), round(fy), round(fw), round(fh)], "gauche", g, round(sg, 2), "droite", d, round(sd, 2), "haut", h, round(sh, 2), "bas", b, round(sb, 2), file=sys.stderr)
    # Un seul côté peu contrasté (fond clair contre jeu clair) : déduit des trois autres, au format 16:9 des webcams.
    if [g, d, h, b].count(None) == 1:
        if g is None:
            g = max(0, d - (b - h) * 16 / 9)
        elif d is None:
            d = min(W, g + (b - h) * 16 / 9)
        elif h is None:
            h = max(0, b - (d - g) * 9 / 16)
        else:
            b = min(H, h + (d - g) * 9 / 16)
    if None in (g, d, h, b):
        return 0.0, None
    larg, haut = d - g, b - h
    # Une webcam : plus grande que le visage, de format raisonnable (du presque carré au 21:9), et qui ne couvre pas
    # la moitié de l'image.
    if haut <= fh * 1.5 or larg <= fw * 1.5 or not (0.8 <= larg / haut <= 2.4) or larg * haut > W * H * 0.4:
        return 0.0, None
    return sg + sd + sh + sb, [round(g / W, 4), round(h / H, 4), round(larg / W, 4), round(haut / H, 4)]


# Un visage figé (portrait, image fixe du jeu) n'est pas une webcam.
essais = sorted(((*boite(fx, fy, fw, fh), n, round(vivant(fx, fy, fw, fh), 3)) for n, fx, fy, fw, fh in candidats), key=lambda e: (e[3] >= 0.02, e[0], e[2]), reverse=True)
if DEBUG:
    print("essais", [(round(e[0], 2), e[1], e[2], e[3]) for e in essais], file=sys.stderr)
# Au moins deux côtés vraiment nets : sinon ce n'est pas sûrement un cadre de webcam.
sortie(essais[0][1] if essais and essais[0][0] >= 1.1 and essais[0][3] >= 0.02 else None)
