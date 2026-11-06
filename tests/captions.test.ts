import { test } from "node:test";
import assert from "node:assert/strict";
import { fichierAss, lignes, lireMots } from "../src/lib/captions.ts";

const m = (mot: string, t: number, fin = t + 0.3) => ({ mot, t, fin });

test("lireMots : minutage mot par mot des sous-titres automatiques, partage de la durée sinon", () => {
  const auto = lireMots({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "bonjour" }, { utf8: " à", tOffsetMs: 500 }, { utf8: " tous", tOffsetMs: 800 }] }] });
  assert.deepEqual(auto.map((x) => [x.mot, x.t, x.fin]), [["bonjour", 1, 1.5], ["à", 1.5, 1.8], ["tous", 1.8, 3]]);
  const chaine = lireMots({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "ab cd" }] }] });
  assert.deepEqual(chaine.map((x) => [x.mot, x.t, x.fin]), [["ab", 0, 0.5], ["cd", 0.5, 1]]);
});

test("lignes : coupées quand la ligne est pleine, sur une pause ou une fin de phrase", () => {
  const mots = [m("un", 0), m("deux", 0.3), m("trois", 0.6), m("quatre", 0.9), m("cinq.", 1.2), m("six", 1.5), m("sept", 3)];
  assert.deepEqual(lignes(mots, 3, 30).map((l) => l.map((x) => x.mot).join(" ")), ["un deux trois", "quatre cinq.", "six", "sept"]);
});

test("fichierAss : sans les annotations, mot dit en couleur, au milieu pendant l'écran coupé", () => {
  const ass = fichierAss([m("[Musique]", 0), m("salut", 0.5), m("toi", 0.8)], "classique", { largeur: 1080, hauteur: 1920, milieu: (t) => t >= 0.8 });
  assert.doesNotMatch(ass, /Musique/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /\\an2\\pos\(540,1344\)\}\{\\c&H2EE6FF&\\fscx108\\fscy108\}SALUT \{\\c&HFFFFFF&\\fscx100\\fscy100\}TOI/);
  assert.match(ass, /\\an5\\pos\(540,960\)\}\{\\c&HFFFFFF&\\fscx100\\fscy100\}SALUT \{\\c&H2EE6FF&/);
  assert.equal(fichierAss([m("salut", 0)], "pop", { largeur: 1080, hauteur: 1920 }).match(/^Dialogue/gm)?.length, 1);
});
