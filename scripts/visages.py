# Montage auto : relève les visages d'une vidéo, quelques fois par seconde, avec le détecteur YuNet d'OpenCV (gratuit,
# tourne sur le serveur). Appelé par src/lib/visages.ts.
# Usage : python visages.py <video> <modele.onnx> <images par seconde> <debut> <duree>
# Sortie (JSON) : [{"t": secondes depuis <debut>, "f": [[centre_x, centre_y, largeur, hauteur, confiance], ...]}, ...], tout entre 0 et 1.
import json
import sys

import cv2

video, modele, fps, debut, duree = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
cap = cv2.VideoCapture(video)
src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
i = round(debut * src_fps)
cap.set(cv2.CAP_PROP_POS_FRAMES, i)
fin = round((debut + duree) * src_fps)
pas = max(1, round(src_fps / fps))
W = 640
det = None
out = []
while i <= fin:
    ok = cap.grab()
    if not ok:
        break
    if i % pas == 0:
        ok, img = cap.retrieve()
        if ok:
            h, w = img.shape[:2]
            H = round(h * W / w)
            img = cv2.resize(img, (W, H))
            if det is None:
                det = cv2.FaceDetectorYN.create(modele, "", (W, H), 0.6, 0.3, 50)
            _, faces = det.detect(img)
            f = []
            for x in faces if faces is not None else []:
                fx, fy, fw, fh, score = float(x[0]), float(x[1]), float(x[2]), float(x[3]), float(x[14])
                f.append([round((fx + fw / 2) / W, 3), round((fy + fh / 2) / H, 3), round(fw / W, 3), round(fh / H, 3), round(score, 2)])
            out.append({"t": round(i / src_fps - debut, 2), "f": f})
    i += 1
json.dump(out, sys.stdout)
