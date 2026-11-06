import { test } from "node:test";
import assert from "node:assert/strict";
import { coupesVisages, filtreMontage, lirePlans, morceaux } from "../src/lib/montage.ts";

test("lirePlans : tableaux ou objets, le reste ignoré, duo sans x2 devient un", () => {
  const p = lirePlans([[4, "duo", 0.2], [0, "un", 0.3], { t: 2, mode: "rien" }, ["x", "un"], [6, "duo", 0.1, 1.4]]);
  assert.deepEqual(p.map((x) => [x.t, x.mode]), [[0, "un"], [2, "rien"], [4, "un"], [6, "duo"]]);
  assert.equal(p[3].x2, 1);
});

// Ce que voit le détecteur, 5 fois par seconde. Un corps : [x, y, largeur, hauteur, confiance, classe, geste] ;
// un visage : [x, y, largeur, hauteur, confiance, bouche].
type P = { x: number; h?: number; geste?: number; parle?: boolean; tete?: boolean };
const vus = (de: number, a: number, ps: P[], voix = 0.1) => Array.from({ length: Math.round((a - de) * 5) }, (_, i) => ({
  t: de + i * 0.2, voix,
  c: ps.map((p) => [p.x, 0.6, 0.2, p.h ?? 0.8, 0.9, 0, p.geste ?? 0.002]),
  f: ps.filter((p) => p.tete !== false).map((p) => [p.x, 0.6 - (p.h ?? 0.8) / 2 + 0.08, 0.05, 0.1 * (p.h ?? 0.8) / 0.8, 0.9, p.parle ? 0.02 : 0]),
}));
const gauche = 0.25, droite = 0.78;

test("morceaux : la zone de celle qui parle (gauche, droite), et on bascule quand l'autre répond", () => {
  const visages = [...vus(0, 4, [{ x: gauche, parle: true }, { x: droite }]), ...vus(4, 8, [{ x: gauche }, { x: droite, parle: true }])];
  assert.deepEqual(morceaux([], 8, [], [], visages).map((m) => [m.a, m.mode]), [[0, "gauche"], [3.983, "droite"]]);
});

test("morceaux : les deux côtés parlent en même temps : haut et bas ; personne ne parle : là où sont les gens", () => {
  assert.deepEqual(morceaux([], 4, [], [], vus(0, 4, [{ x: gauche, parle: true }, { x: droite, parle: true }])).map((m) => m.mode), ["duo"]);
  assert.deepEqual(morceaux([], 4, [], [], vus(0, 4, [{ x: 0.5 }])).map((m) => m.mode), ["centre"]);
  assert.deepEqual(morceaux([], 4, [], [], vus(0, 4, [])).map((m) => m.mode), ["centre"]);
});

test("morceaux : le public du fond ne compte pas ; sans parole, la zone suit une personne seule qui se déplace", () => {
  const publicFond = [0.8, 0.9].map((x) => ({ x, h: 0.2, parle: true }));
  assert.deepEqual(morceaux([], 4, [], [], vus(0, 4, [{ x: 0.5, parle: true }, ...publicFond])).map((m) => m.mode), ["centre"]);
  const marche = [...vus(0, 3, [{ x: 0.2 }], 0), ...vus(3, 6, [{ x: 0.8 }], 0)];
  assert.deepEqual(morceaux([], 6, [], [], marche).map((m) => [m.a, m.mode]), [[0, "gauche"], [2.883, "droite"]]);
});

test("morceaux : pas de ping-pong, il faut 1,5 s pour changer de zone", () => {
  const visages = [...vus(0, 3, [{ x: gauche, parle: true }, { x: droite }]), ...vus(3, 3.6, [{ x: gauche }, { x: droite, parle: true }]), ...vus(3.6, 6, [{ x: gauche, parle: true }, { x: droite }])];
  assert.equal(morceaux([], 6, [], [], visages).length, 1);
});

test("coupesVisages : tous les visages changent d'un coup", () => {
  assert.deepEqual(coupesVisages([...vus(0, 1, [{ x: gauche }]), ...vus(1, 2, [{ x: droite }])], []).map((t) => Math.round(t * 10) / 10), [0.9]);
});

test("filtreMontage : une seule sortie, la zone plein écran en formule à plat, le haut/bas pendant le duo", () => {
  const f = filtreMontage([{ a: 0, b: 3, mode: "gauche" }, { a: 3, b: 5, mode: "duo" }, { a: 5, b: 8, mode: "droite" }]);
  assert.match(f, /\[vout\]$/);
  assert.match(f, /gte\(t\\,-1000000\)\*lt\(t\\,3\)\*0\.25\+gte\(t\\,5\)\*lt\(t\\,1000000\)\*0\.75/);
  assert.match(f, /\[plein\]\[duo\]overlay=enable=between\(t\\,3\\,4\.999\)/);
});
