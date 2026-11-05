import { test } from "node:test";
import assert from "node:assert/strict";
import { filtreMontage, lirePlans, morceaux } from "../src/lib/montage.ts";

test("lirePlans : tableaux ou objets, le reste ignoré, duo sans x2 devient un", () => {
  const p = lirePlans([[4, "duo", 0.2], [0, "un", 0.3], { t: 2, mode: "rien" }, ["x", "un"], [6, "duo", 0.1, 1.4]]);
  assert.deepEqual(p.map((x) => [x.t, x.mode]), [[0, "un"], [2, "rien"], [4, "un"], [6, "duo"]]);
  assert.equal(p[3].x2, 1);
});

test("morceaux : changements recalés sur les changements de plan, puis sur les phrases", () => {
  const plans = lirePlans([[100, "un", 0.3], [104.5, "un", 0.7], [110, "duo", 0.2, 0.8]]);
  // Passage 102 → 120 : le plan coupe en vrai à 2,1 s ; la réponse commence à 7,8 s (pas de coupe de plan près de 8 s).
  const ms = morceaux(plans, 102, 120, [2.1, 15], [109.8]);
  assert.deepEqual(ms.map((m) => [m.a, m.b, m.mode]), [[0, 2.1, "un"], [2.1, 7.8, "un"], [7.8, 18, "duo"]]);
  assert.equal(ms[0].x, 0.3);
});

test("morceaux : pas de flash de moins de 0,8 s, et sans rien de noté, les bandes", () => {
  const ms = morceaux(lirePlans([[0, "un", 0.3], [5, "un", 0.7], [5.4, "un", 0.3]]), 0, 10, [], []);
  assert.equal(ms.length, 1);
  assert.deepEqual(morceaux([], 0, 10, [], [], 0.4).map((m) => [m.mode, m.x]), [["rien", 0.4]]);
});

test("filtreMontage : une seule sortie, des expressions qui changent dans le temps", () => {
  const f = filtreMontage([{ a: 0, b: 3, mode: "un", x: 0.3, x2: 0.3 }, { a: 3, b: 8, mode: "duo", x: 0.2, x2: 0.8 }]);
  assert.match(f, /\[vout\]$/);
  assert.match(f, /if\(lt\(t\\,3\)\\,0\.30\\,0\.20\)/);
  assert.match(f, /enable=between\(t\\,3\\,7\.999\)/);
});
