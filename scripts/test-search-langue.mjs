// Compare la part de vidéos en français selon l'ordre de recherche YouTube (coûte 1 recherche par ligne).
// Usage : node --env-file=.env.local scripts/test-search-langue.mjs "business motivation" "#minecraft"
const key = process.env.YOUTUBE_API_KEY;
const after = new Date(Date.now() - 7 * 86400_000).toISOString();
const get = async (ep, p) => (await fetch(`https://www.googleapis.com/youtube/v3/${ep}?${new URLSearchParams({ ...p, key })}`)).json();

for (const q of process.argv.slice(2)) {
  for (const order of ["viewCount", "relevance"]) {
    const s = await get("search", { part: "id", type: "video", q, maxResults: 50, order, publishedAfter: after, relevanceLanguage: "fr", regionCode: "FR" });
    const ids = (s.items ?? []).map((i) => i.id.videoId).filter(Boolean);
    const v = await get("videos", { part: "snippet,statistics", id: ids.join(","), maxResults: 50 });
    const items = v.items ?? [];
    const fr = items.filter((x) => (x.snippet.defaultAudioLanguage ?? x.snippet.defaultLanguage ?? "").startsWith("fr"));
    const views = fr.map((x) => Number(x.statistics.viewCount)).sort((a, b) => b - a);
    console.log(`${q} | ${order} : ${fr.length}/${items.length} en français déclaré, vues max ${views[0] ?? 0}, médiane ${views[views.length >> 1] ?? 0}`);
    for (const x of fr.slice(0, 3)) console.log("   ", x.snippet.channelTitle, "|", x.snippet.title.slice(0, 60));
  }
}
