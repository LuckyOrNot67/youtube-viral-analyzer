// Vérifie que Gemini lit bien une vidéo YouTube publique par son lien, et mesure le temps.
// Usage : node --env-file=.env.local scripts/test-gemini-youtube.mjs <idVideo>
import { GoogleGenAI } from "@google/genai";

const id = process.argv[2] ?? "aqz-KE-bpKQ";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const t0 = Date.now();
const res = await ai.interactions.create({
  model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  input: [
    { type: "video", uri: `https://www.youtube.com/watch?v=${id}` },
    { type: "text", text: "Donne 3 passages marquants de cette vidéo. Réponds uniquement en JSON : [{\"start\": secondes, \"end\": secondes, \"resume\": \"une phrase\"}]" },
  ],
  generation_config: { thinking_level: "low" },
}, { timeout_ms: 240_000 });
console.log(`${Date.now() - t0} ms`);
console.log(res.output_text);
console.log(JSON.stringify(res.usage ?? null));
