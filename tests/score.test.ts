import { test } from "node:test";
import assert from "node:assert/strict";
import { comparables, rank, scoreVideo, velocity, VUES_MIN } from "../src/lib/score.ts";
import { fmtTime, isoDuration, parseInput, timestampsIn } from "../src/lib/parse.ts";
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
  assert.ok(s.score >= 7, `score ${s.score}`);
  assert.equal(s.confiance, "haute");
  assert.match(s.raisons[0], /les vues habituelles/);
});

test("une vidéo dans la normale reste moyenne", () => {
  const pool = channel();
  const v = vid({ views: 50_000, age: 20 });
  const s = scoreVideo(v, [...pool, v], { now: NOW });
  assert.ok(s.score < 5, `score ${s.score}`);
  assert.equal(s.label, "Normale");
});

test("la taille de la chaîne ne fait pas le score : même rapport, même surperformance", () => {
  const small = channel(5_000).map((v) => ({ ...v, channelId: "petite" }));
  const big = channel(5_000_000).map((v) => ({ ...v, channelId: "grande" }));
  const a = vid({ channelId: "petite", views: 40_000, age: 10 });
  const b = vid({ channelId: "grande", views: 40_000_000, age: 10 });
  const sa = scoreVideo(a, [...small, a], { now: NOW }), sb = scoreVideo(b, [...big, b], { now: NOW });
  assert.equal(sa.parts.surperformance, sb.parts.surperformance);
  assert.ok(sb.score - sa.score < 2.6, "la vitesse absolue ne pèse que 25 %");
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
