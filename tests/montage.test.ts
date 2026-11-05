import { test } from "node:test";
import assert from "node:assert/strict";
import { coupesVisages, filtreMontage, lirePlans, morceaux } from "../src/lib/montage.ts";

test("lirePlans : tableaux ou objets, le reste ignoré, duo sans x2 devient un", () => {
  const p = lirePlans([[4, "duo", 0.2], [0, "un", 0.3], { t: 2, mode: "rien" }, ["x", "un"], [6, "duo", 0.1, 1.4]]);
  assert.deepEqual(p.map((x) => [x.t, x.mode]), [[0, "un"], [2, "rien"], [4, "un"], [6, "duo"]]);
  assert.equal(p[3].x2, 1);
});

// Des visages, 5 fois par seconde : [centre x, centre y, largeur, hauteur, confiance].
const vus = (de: number, a: number, f: number[][]) => Array.from({ length: Math.round((a - de) * 5) }, (_, i) => ({ t: de + i * 0.2, f }));
const gauche = [0.25, 0.3, 0.08, 0.2, 0.9], droite = [0.78, 0.3, 0.08, 0.2, 0.9];

test("morceaux : le cadre va sur le visage détecté le plus proche de la personne indiquée par Gemini", () => {
  const visages = [...vus(0, 4, [gauche, droite]), ...vus(4, 8, [[0.5, 0.3, 0.2, 0.4, 0.9]])];
  // Gemini dit « à droite » mais se trompe un peu (0,65) ; il ne voit pas le changement de plan à 4 s, le détecteur si.
  const ms = morceaux(lirePlans([[0, "un", 0.65]]), 8, [], [], visages);
  assert.deepEqual(ms.map((m) => [m.a, m.b, m.mode, m.cles[0].x]), [[0, 3.9, "un", 0.78], [3.9, 8, "un", 0.5]]);
});

test("morceaux : changement de personne dans le plan recalé sur le début de phrase, duo, plan sans visage flouté", () => {
  const visages = [...vus(0, 10, [gauche, droite]), ...vus(10, 12, [])];
  const ms = morceaux(lirePlans([[0, "un", 0.2], [4.6, "un", 0.8], [7, "duo", 0.2, 0.8]]), 12, [10], [4, 7.2], visages);
  assert.deepEqual(ms.map((m) => [m.a, m.b, m.mode]), [[0, 4, "un"], [4, 7.2, "un"], [7.2, 10, "duo"], [10, 12, "flou"]]);
  assert.equal(ms[2].cles[0].x2, 0.78);
});

test("morceaux : plan large de groupe en flou, pas de flash de moins de 0,8 s dans un même plan", () => {
  const petits = [[0.2, 0.3, 0.03, 0.06, 0.9], [0.5, 0.3, 0.03, 0.06, 0.9], [0.8, 0.3, 0.03, 0.06, 0.9]];
  assert.equal(morceaux([], 5, [], [], vus(0, 5, petits))[0].mode, "flou");
  const ms = morceaux(lirePlans([[0, "un", 0.2], [5, "un", 0.8], [5.5, "un", 0.2]]), 10, [], [], vus(0, 10, [gauche, droite]));
  assert.deepEqual(ms.map((m) => [m.a, m.b, m.cles[0].x]), [[0, 10, 0.25]]);
});

test("coupesVisages : tous les visages changent d'un coup", () => {
  assert.deepEqual(coupesVisages([...vus(0, 1, [gauche]), ...vus(1, 2, [droite])], []).map((t) => Math.round(t * 10) / 10), [0.9]);
});

test("filtreMontage : une seule sortie, le visage au centre du cadre, des expressions qui changent dans le temps", () => {
  const f = filtreMontage([{ a: 0, b: 3, mode: "un", cles: [{ t: 0, x: 0.3, y: 0.3, x2: 0.3, y2: 0.3 }] }, { a: 3, b: 8, mode: "duo", cles: [{ t: 3, x: 0.2, y: 0.3, x2: 0.8, y2: 0.3 }] }]);
  assert.match(f, /\[vout\]$/);
  assert.match(f, /if\(lt\(t\\,3\)\\,0\.300\\,0\.200\)\)\*iw-ow\/2/);
  assert.match(f, /enable=between\(t\\,3\\,7\.999\)/);
});
