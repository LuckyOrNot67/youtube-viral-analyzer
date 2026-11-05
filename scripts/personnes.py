# Montage auto : ce qui se passe à l'image, 5 fois par seconde. Gratuit, tourne sur le serveur (OpenCV). Appelé par
# src/lib/visages.ts.
# - les corps (personnes et animaux), avec le détecteur YOLOX (licence Apache 2.0) ;
# - les visages, avec le détecteur YuNet, et pour chacun le mouvement de la bouche (comparé à celui des yeux, pour ne
#   pas compter les mouvements de tête) : avec la voix, c'est ce qui dit qui parle ;
# - le mouvement de chaque corps (les gestes) ;
# - le volume de la voix.
# Usage : python personnes.py <video> <yunet.onnx> <yolox.onnx> <ffmpeg> <debut> <duree>
# Sortie (JSON) : [{"t": secondes depuis <debut>, "voix": 0..1,
#   "c": [[centre_x, centre_y, largeur, hauteur, confiance, classe, geste], ...],
#   "f": [[centre_x, centre_y, largeur, hauteur, confiance, bouche], ...]}, ...] ; positions et tailles entre 0 et 1.
import json
import subprocess
import sys

import cv2
import numpy as np

video, yunet, yolox, ffmpeg, debut, duree = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5]), float(sys.argv[6])
FPS = 5
# Personne, puis les animaux du jeu COCO (oiseau, chat, chien, cheval, mouton, vache, éléphant, ours, zèbre, girafe).
CLASSES = {0, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}

# Le son : volume de la voix autour de chaque instant.
pcm = subprocess.run([ffmpeg, "-v", "quiet", "-ss", str(debut), "-t", str(duree), "-i", video, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
son = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768 if pcm else np.zeros(1, np.float32)
def voix(t):
    a, b = int(max(0, t - 0.15) * 16000), int((t + 0.15) * 16000)
    w = son[a:b]
    return float(np.sqrt(np.mean(w * w))) if len(w) else 0.0

# YOLOX : image remise en 640×640 sans déformer, puis décodage de la grille (pas de 8, 16 et 32 pixels).
net = cv2.dnn.readNet(yolox)
grilles, pas_g = [], []
for s in (8, 16, 32):
    n = 640 // s
    xs, ys = np.meshgrid(np.arange(n), np.arange(n))
    grilles.append(np.stack((xs, ys), 2).reshape(-1, 2))
    pas_g.append(np.full((n * n, 1), s))
grilles, pas_g = np.concatenate(grilles), np.concatenate(pas_g)

def corps(img):
    h, w = img.shape[:2]
    r = min(640 / h, 640 / w)
    toile = np.full((640, 640, 3), 114, np.uint8)
    toile[: int(h * r), : int(w * r)] = cv2.resize(img, (int(w * r), int(h * r)))
    net.setInput(cv2.dnn.blobFromImage(toile, 1.0, (640, 640), swapRB=False))
    o = net.forward()[0]
    xy = (o[:, :2] + grilles) * pas_g
    wh = np.exp(o[:, 2:4]) * pas_g
    cls = o[:, 5:].argmax(1)
    sc = o[:, 4] * o[:, 5:].max(1)
    garde = (sc > 0.35) & np.isin(cls, list(CLASSES))
    xy, wh, cls, sc = xy[garde] / r, wh[garde] / r, cls[garde], sc[garde]
    boites = [[float(x - bw / 2), float(y - bh / 2), float(bw), float(bh)] for (x, y), (bw, bh) in zip(xy, wh)]
    out = []
    for i in cv2.dnn.NMSBoxes(boites, sc.tolist(), 0.35, 0.5) if boites else []:
        x, y, bw, bh = boites[int(i)]
        x0, y0, x1, y1 = max(0, x), max(0, y), min(w, x + bw), min(h, y + bh)
        out.append([(x0 + x1) / 2 / w, (y0 + y1) / 2 / h, (x1 - x0) / w, (y1 - y0) / h, float(sc[int(i)]), int(cls[int(i)])])
    return out

def zone(gris, x0, y0, x1, y1, taille):
    h, w = gris.shape
    x0, y0, x1, y1 = int(max(0, x0)), int(max(0, y0)), int(min(w, x1)), int(min(h, y1))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    return cv2.resize(gris[y0:y1, x0:x1], taille).astype(np.float32)

def diff(a, b):
    return float(np.mean(np.abs(a - b))) / 255 if a is not None and b is not None else 0.0

cap = cv2.VideoCapture(video)
src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
i = round(debut * src_fps)
cap.set(cv2.CAP_PROP_POS_FRAMES, i)
fin = round((debut + duree) * src_fps)
pas = max(1, round(src_fps / FPS))
ECART = 2  # la bouche et les gestes : comparés à l'image 2 images plus loin (~70 ms)
W = 640
det = None
out, attente = [], None
while i <= fin:
    if not cap.grab():
        break
    k = (i - round(debut * src_fps)) % pas
    if k == 0:
        ok, img = cap.retrieve()
        if ok:
            h0, w0 = img.shape[:2]
            H = round(h0 * W / w0)
            petit = cv2.resize(img, (W, H))
            gris = cv2.cvtColor(petit, cv2.COLOR_BGR2GRAY)
            if det is None:
                det = cv2.FaceDetectorYN.create(yunet, "", (W, H), 0.5, 0.3, 50)
            _, faces = det.detect(petit)
            f, zones = [], []
            for x in faces if faces is not None else []:
                fx, fy, fw, fh = (float(v) for v in x[:4])
                nez_y, bouche_y = float(x[9]), (float(x[11]) + float(x[13])) / 2
                bx0, bx1 = min(x[10], x[12]), max(x[10], x[12])
                mw = max(4.0, float(bx1 - bx0))
                bouche = (bx0 - mw * 0.3, nez_y, bx1 + mw * 0.3, bouche_y + (bouche_y - nez_y) * 0.8)
                yeux = (min(x[4], x[6]) - mw * 0.2, min(x[5], x[7]) - fh * 0.08, max(x[4], x[6]) + mw * 0.2, max(x[5], x[7]) + fh * 0.08)
                zones.append((bouche, yeux, zone(gris, *bouche, (32, 16)), zone(gris, *yeux, (32, 12))))
                f.append([(fx + fw / 2) / W, (fy + fh / 2) / H, fw / W, fh / H, float(x[14]), 0.0])
            c = [b + [0.0] for b in corps(img)]
            out.append({"t": round(i / src_fps - debut, 2), "voix": round(voix(i / src_fps - debut), 4), "c": c, "f": f})
            attente = (gris, zones)
    elif k == ECART and attente is not None:
        ok, img = cap.retrieve()
        if ok:
            gris = cv2.cvtColor(cv2.resize(img, (W, round(img.shape[0] * W / img.shape[1]))), cv2.COLOR_BGR2GRAY)
            avant, zones = attente
            e = out[-1]
            for j, (bouche, yeux, b0, y0) in enumerate(zones):
                # La bouche bouge plus que le reste du visage : la personne parle (ou rit, ou chante).
                e["f"][j][5] = round(max(0.0, diff(zone(gris, *bouche, (32, 16)), b0) - diff(zone(gris, *yeux, (32, 12)), y0)), 4)
            Hh, Ww = gris.shape
            for b in e["c"]:
                x0, x1 = (b[0] - b[2] / 2) * Ww, (b[0] + b[2] / 2) * Ww
                y0_, y1 = (b[1] - b[3] / 2) * Hh, (b[1] + b[3] / 2) * Hh
                b[6] = round(diff(zone(gris, x0, y0_, x1, y1, (32, 64)), zone(avant, x0, y0_, x1, y1, (32, 64))), 4)
            for b in e["c"]:
                b[:4] = [round(v, 3) for v in b[:4]]
                b[4] = round(b[4], 2)
            for g in e["f"]:
                g[:4] = [round(v, 3) for v in g[:4]]
                g[4] = round(g[4], 2)
            attente = None
    i += 1
json.dump(out, sys.stdout)
