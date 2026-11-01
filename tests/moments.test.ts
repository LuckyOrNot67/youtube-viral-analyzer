import { test } from "node:test";
import assert from "node:assert/strict";
import { citationsIn, citedMoments } from "../src/lib/ai/moments.ts";

test("les minutages proches sont regroupés et classés par nombre de citations", () => {
  const m = citedMoments([
    { text: "12:35 mort de rire", likes: 400 },
    { text: "le 12:40 😂😂", likes: 50 },
    { text: "12:38 incroyable", likes: 10 },
    { text: "3:02 la révélation", likes: 900 },
    { text: "99:00 hors de la vidéo", likes: 5 },
    { text: "Sommaire : 0:50 intro, 6:44 parole, 10:13 marques, 13:35 cours", likes: 800 },
  ], 1800);
  assert.equal(m.length, 2);
  assert.equal(m[0].t, 755);
  assert.equal(m[0].n, 3);
  assert.equal(m[0].exemples[0], "12:35 mort de rire");
  assert.equal(m[1].t, 182);
  assert.equal(citationsIn(m, 750, 800), 3);
  assert.equal(citationsIn(m, 0, 100), 0);
});
