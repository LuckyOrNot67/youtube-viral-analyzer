import { test } from "node:test";
import assert from "node:assert/strict";
import { comparables, rank, scoreVideo, velocity, VUES_MIN } from "../src/lib/score.ts";
import { fmtTime, isoDuration, parseInput, timestampsIn } from "../src/lib/parse.ts";
import { couvre, motsDe, parleDe } from "../src/lib/sujet.ts";
import type { Video } from "../src/lib/types.ts";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86400_000).toISOString();
let n = 0;
const vid = (o: Partial<Video> & { views: number; age: number }): Video => ({
  id: `v${n++}`, channelId: "c1", channelTitle: "C", title: "t", description: "", thumb: "",
  publishedAt: daysAgo(o.age), duration: 600, likes: Math.round(o.views * 0.04), comments: Math.round(o.views * 0.002), fetchedAt: NOW, ...o,
});
/** Une chaîne régulière : 30 vidéos longues autour de 50 000 vues, âgées de 3 à 61 jours. */
const channel = (views = 50_000) => Array.from({ length: 30 }, (_, i) => vid({ views: views * (0.8 + (i % 5) * 0.1), age: 3 + i * 2 }));

test("une vidéo à 8× la normale de sa chaîne a un gros score, confiance haute", () => {
  const pool = channel();
  const hit = vid({ views: 400_000, age: 10 });
  const s = scoreVideo(hit, [...pool, hit], { now: NOW });
  assert.ok(s.score >= 9, `score ${s.score}`);
  assert.equal(s.confiance, "haute");
  assert.match(s.raisons[0], /les vues habituelles/);
});

test("chaîne sans aucun like ni commentaire : le score reste un nombre", () => {
  const pool = Array.from({ length: 8 }, (_, i) => vid({ views: 4, age: 3 + i, likes: 0, comments: 0 }));
  const s = scoreVideo(pool[0], pool, { now: NOW });
  assert.ok(Number.isFinite(s.score), `score ${s.score}`);
});

test("une vidéo dans la normale reste moyenne", () => {
  const pool = channel();
  const v = vid({ views: 50_000, age: 20 });
  const s = scoreVideo(v, [...pool, v], { now: NOW });
  assert.ok(s.score < 8, `score ${s.score}`);
  assert.notEqual(s.label, "Explose");
});

test("même rapport à la chaîne, mêmes points « d'habitude », mais la grosse chaîne part plus haut", () => {
  const small = channel(5_000).map((v) => ({ ...v, channelId: "petite" }));
  const big = channel(5_000_000).map((v) => ({ ...v, channelId: "grande" }));
  const a = vid({ channelId: "petite", views: 40_000, age: 10 });
  const b = vid({ channelId: "grande", views: 40_000_000, age: 10 });
  const sa = scoreVideo(a, [...small, a], { now: NOW }), sb = scoreVideo(b, [...big, b], { now: NOW });
  const habitude = (s: typeof sa) => s.points.find((p) => p.critere === "Par rapport à d'habitude")!.points;
  assert.equal(habitude(sa), habitude(sb));
  assert.ok(sb.score > sa.score);
});

test("le temps compte : 17,8 M en 2 mois passe devant 22,5 M en 2 ans et 17,2 M en 1 an", () => {
  const pool = Array.from({ length: 30 }, (_, i) => vid({ channelId: "squeezie", views: 15_000_000 * (0.8 + (i % 5) * 0.1), age: 20 + i * 25 }));
  const deuxMois = vid({ channelId: "squeezie", views: 17_800_000, age: 62 });
  const unAn = vid({ channelId: "squeezie", views: 17_200_000, age: 365 });
  const deuxAns = vid({ channelId: "squeezie", views: 22_500_000, age: 730 });
  const all = [...pool, deuxMois, unAn, deuxAns];
  const [a, b, c] = [deuxMois, unAn, deuxAns].map((v) => scoreVideo(v, all, { now: NOW }).score);
  assert.ok(a > b && a > c, `2 mois ${a}, 1 an ${b}, 2 ans ${c}`);
  assert.ok(a >= 8, `2 mois ${a}`);
});

test("une vidéo toute jeune n'est pas punie de ne pas encore avoir fait ses vues", () => {
  const pool = Array.from({ length: 30 }, (_, i) => vid({ channelId: "squeezie", views: 20_000_000, age: 30 + i * 20 }));
  const v = vid({ channelId: "squeezie", views: 3_000_000, age: 1 });
  const s = scoreVideo(v, [...pool, v], { now: NOW });
  assert.ok(s.points.every((p) => p.points >= 0), JSON.stringify(s.points));
  assert.ok(s.score >= 7, `score ${s.score}`);
});

test("peu de vues : score plafonné même avec un énorme engagement", () => {
  const pool = channel(200).map((v) => ({ ...v, views: Math.round(v.views) }));
  const v = vid({ views: VUES_MIN - 1, age: 1, likes: 3000, comments: 800 });
  const s = scoreVideo(v, [...pool, v], { now: NOW });
  assert.ok(s.score <= 5);
});

test("chaîne sans historique : confiance basse, pas de comparaison inventée", () => {
  const v = vid({ views: 100_000, age: 5, channelId: "seule" });
  const s = scoreVideo(v, [v], { now: NOW });
  assert.equal(s.confiance, "basse");
  assert.equal(s.base.median, null);
  assert.match(s.raisons[0], /Pas assez/);
});

test("on compare un Short aux Shorts, pas aux vidéos longues", () => {
  const longs = channel();
  const shorts = Array.from({ length: 6 }, (_, i) => vid({ views: 900_000, age: 5 + i, duration: 40 }));
  const s = vid({ views: 1_000_000, age: 8, duration: 30 });
  assert.ok(comparables(s, [...longs, ...shorts, s], NOW).every((p) => p.duration <= 180));
});

test("vitesse mesurée entre deux relevés", () => {
  const v = vid({ views: 120_000, age: 30 });
  const r = velocity(v, [{ at: NOW - 86400_000, views: 100_000 }, { at: NOW, views: 120_000 }], NOW);
  assert.equal(r.mesuree, true);
  assert.equal(Math.round(r.vpd), 20_000);
});

test("le classement est reproductible", () => {
  const pool = channel();
  const scored = pool.map((v) => ({ ...v, s: scoreVideo(v, pool, { now: NOW }) }));
  assert.deepEqual(rank(scored).map((x) => x.id), rank(scored).map((x) => x.id));
  assert.equal(rank(scored)[0].rang, 1);
});

test("lecture de ce qu'on colle", () => {
  assert.deepEqual(parseInput("youtube.com/@MrBeast"), { kind: "handle", handle: "@MrBeast" });
  assert.deepEqual(parseInput("https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA"), { kind: "channelId", id: "UCX6OQ3DkcsbYNE6H8uQQuVA" });
  assert.deepEqual(parseInput("https://youtu.be/dQw4w9WgXcQ?si=x"), { kind: "video", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), { kind: "video", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseInput("youtube.com/shorts/dQw4w9WgXcQ"), { kind: "video", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseInput("#minecraft"), { kind: "topic", q: "#minecraft" });
  assert.deepEqual(parseInput("  podcast   business "), { kind: "topic", q: "podcast business" });
  assert.equal(parseInput("https://tiktok.com/@x").kind, "invalid");
  assert.equal(parseInput("youtube.com/watch?v=court").kind, "invalid");
  assert.equal(parseInput("").kind, "invalid");
});

test("durées et minutages", () => {
  assert.equal(isoDuration("PT1H2M3S"), 3723);
  assert.equal(isoDuration("PT45S"), 45);
  assert.deepEqual(timestampsIn("le moment à 12:35 et 1:02:10 😂, pas 2026"), [755, 3730]);
  assert.deepEqual(timestampsIn("score 3:75"), []);
  assert.equal(fmtTime(3730), "1:02:10");
  assert.equal(fmtTime(75), "1:15");
});

test("sujet : mots utiles, vidéos qui en parlent, recherche qui en couvre une autre", () => {
  assert.deepEqual(motsDe("#OFM life"), ["ofm", "life"]);
  assert.deepEqual(motsDe("la vie de l'été"), ["vie", "ete"]);
  assert.ok(parleDe({ title: "Ma journée", description: "#ofmlife #agence", tags: [] }, ["ofm"]));
  assert.ok(parleDe({ title: "Agence OFM : ma vie", description: "", tags: ["life"] }, ["ofm", "life"]));
  assert.ok(!parleDe({ title: "Orelsan - clip officiel", description: "", tags: ["rap"] }, ["ofm"]));
  assert.ok(!parleDe({ title: "Le soufm", description: "", tags: [] }, ["ofm"]));
  assert.ok(couvre(["ofm"], ["ofm", "life"]));
  assert.ok(!couvre(["ofm", "life"], ["ofm"]));
});

test("lots : chaque groupe a sa sélection, toujours la même, et une formule plus haute garde les premiers", async () => {
  const { lotSuivant, ordreDuLot, propositions } = await import("../src/lib/lots.ts");
  const pool = Array.from({ length: 30 }, (_, i) => ({ id: i, scoreShorts: 9.5 - i * 0.2 }));
  const ids = (l: { id: number }[]) => l.map((x) => x.id);
  assert.deepEqual(ids(propositions(pool, 0, "v", 5)), [0, 1, 2, 3, 4]);
  assert.deepEqual(ids(propositions(pool, 3, "v", 5)), ids(propositions(pool, 3, "v", 5)));
  const lots = Array.from({ length: 20 }, (_, l) => ids(propositions(pool, l, "v", 5)).join(","));
  assert.ok(new Set(lots).size >= 15, "les lots sont presque tous différents");
  assert.deepEqual(ids(ordreDuLot(pool, 4, "v").slice(0, 5)), ids(ordreDuLot(pool, 4, "v").slice(0, 10)).slice(0, 5));
  assert.equal(lotSuivant(0, 10), 0);
  assert.equal(lotSuivant(9, 10), 0);
  assert.equal(lotSuivant(10, 10), 1);
});

test("histoire : parties coupées sur le suspense le plus proche de la durée choisie, jamais plus de 3 min", async () => {
  const { decouper } = await import("../src/lib/decoupe.ts");
  const p = decouper(100, 700, [150, 170, 230, 290, 350, 420, 480, 560, 640], 120);
  assert.equal(p[0].start, 100);
  assert.equal(p.at(-1)!.end, 700);
  assert.deepEqual(p.map((x) => x.end).slice(0, -1), [230, 350, 480, 560]);
  for (let i = 1; i < p.length; i++) assert.equal(p[i].start, p[i - 1].end, "les parties se suivent sans trou");
  assert.ok(p.every((x) => x.end - x.start <= 180));
  const sans = decouper(0, 600, [], 180);
  assert.ok(sans.every((x) => x.end - x.start <= 180) && sans.at(-1)!.end === 600);
  assert.deepEqual(sans.map((x) => x.n), sans.map((_, i) => i + 1));
});

test("histoire : en 1 min, pas de partie de 2 min même si le suspense est loin", async () => {
  const { decouper } = await import("../src/lib/decoupe.ts");
  const p = decouper(51, 643, [179, 311, 458, 614], 60);
  assert.ok(p.every((x) => x.end - x.start <= 90), p.map((x) => x.end - x.start).join(","));
});

test("histoire : jamais de dernière partie minuscule", async () => {
  const { decouper } = await import("../src/lib/decoupe.ts");
  const p = decouper(51, 643, [179, 311, 458, 614], 180);
  assert.ok(p.every((x) => x.end - x.start >= 60 && x.end - x.start <= 180), p.map((x) => x.end - x.start).join(","));
});
