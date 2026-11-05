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
  f: ps.filter((p) => p.tete !== false).map((p) => [p.x, 0.6 - (p.h ?? 0.8) / 2 + 0.08, 0.05, 0.1, 0.9, p.parle ? 0.02 : 0]),
}));
const gauche = 0.25, droite = 0.78;

test("morceaux : celle qui parle prend le cadre (plan tête), puis l'autre quand elle répond", () => {
  const visages = [...vus(0, 4, [{ x: gauche, parle: true }, { x: droite }]), ...vus(4, 8, [{ x: gauche }, { x: droite, parle: true }])];
  const ms = morceaux([], 8, [], [], visages);
  assert.deepEqual(ms.map((m) => [m.a, m.mode, Math.round(m.cles[0].x * 100) / 100]), [[0, "tete", gauche], [4, "tete", droite]]);
});

test("morceaux : un grand geste passe en plan corps ; le public du fond ne prend jamais le cadre", () => {
  const publicFond = [0.4, 0.5, 0.6].map((x) => ({ x, h: 0.25, geste: 0.05 }));
  const ms = morceaux([], 4, [], [], vus(0, 4, [{ x: 0.15, geste: 0.06 }, ...publicFond]));
  assert.deepEqual(ms.map((m) => [m.mode, m.cles[0].x]), [["corps", 0.15]]);
});

test("morceaux : sans personne détectée, Gemini ou le flou ; changements sur les vrais plans", () => {
  const visages = [...vus(0, 3, [{ x: gauche }]), ...vus(3, 6, [])];
  const ms = morceaux(lirePlans([[0, "un", 0.5], [3, "un", 0.7]]), 6, [3], [], visages);
  assert.deepEqual(ms.map((m) => [m.a, m.b, m.mode, m.cles[0].x]), [[0, 3, "tete", gauche], [3, 6, "corps", 0.7]]);
  assert.equal(morceaux([], 2, [], [], vus(0, 2, []))[0].mode, "flou");
});

test("morceaux : pas de ping-pong, il faut 1,5 s d'avance pour changer de personne", () => {
  const visages = [...vus(0, 3, [{ x: gauche, parle: true }, { x: droite }]), ...vus(3, 3.6, [{ x: gauche }, { x: droite, parle: true }]), ...vus(3.6, 6, [{ x: gauche, parle: true }, { x: droite }])];
  assert.equal(morceaux([], 6, [], [], visages).length, 1);
});

test("coupesVisages : tous les visages changent d'un coup", () => {
  assert.deepEqual(coupesVisages([...vus(0, 1, [{ x: gauche }]), ...vus(1, 2, [{ x: droite }])], []).map((t) => Math.round(t * 10) / 10), [0.9]);
});

test("filtreMontage : une seule sortie, plan tête et plan corps, des formules à plat qui changent dans le temps", () => {
  const f = filtreMontage([{ a: 0, b: 3, mode: "tete", cles: [{ t: 0, x: 0.3, y: 0.3, x2: 0.3, y2: 0.3 }] }, { a: 3, b: 8, mode: "corps", cles: [{ t: 3, x: 0.2, y: 0.5, x2: 0.2, y2: 0.5 }] }]);
  assert.match(f, /\[vout\]$/);
  assert.match(f, /gte\(t\\,-1000000\)\*lt\(t\\,3\)\*\(0\.300\)\+gte\(t\\,3\)\*lt\(t\\,1000000\)\*\(0\.200\)/);
  assert.match(f, /\[t1\]\[tete\]overlay=enable=between\(t\\,0\\,2\.999\)/);
});
