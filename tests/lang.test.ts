import { test } from "node:test";
import assert from "node:assert/strict";
import { isFrench } from "../src/lib/lang.ts";

const v = (title: string, o: { lang?: string | null; description?: string; country?: string | null } = {}) =>
  isFrench({ title, lang: o.lang ?? null, description: o.description ?? "", channelCountry: o.country ?? null });

test("la langue déclarée de la vidéo l'emporte", () => {
  assert.equal(v("Business motivation", { lang: "fr" }), true);
  assert.equal(v("C'est pour vous", { lang: "en-US" }), false);
  assert.equal(v("Motivation", { lang: "hi" }), false);
});

test("titres indiens exclus, même sans langue déclarée", () => {
  assert.equal(v("बिज़नेस मोटिवेशन | Sandeep Maheshwari"), false);
  assert.equal(v("Best business motivation video 2026 #shorts", { country: "IN" }), false);
  assert.equal(v("How to become rich in 30 days motivation"), false);
});

test("titres français reconnus", () => {
  assert.equal(v("J'ai lancé mon business à 19 ans, voilà ce que j'ai appris"), true);
  assert.equal(v("Pourquoi tu restes pauvre (la vérité)"), true);
  assert.equal(v("ENTREPRENEUR : le jour où tout a changé", { country: "FR" }), true);
  assert.equal(v("MOTIVATION 🔥 #shorts", { country: "FR" }), true);
});
