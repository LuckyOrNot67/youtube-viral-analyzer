import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { cached } from "../db";
import type { MotST } from "../captions";
import { claude, CLAUDE_MODEL, hasClaude } from "./models";
import LIMITES from "@/config/limites.json";

// Sous-titres traduits en français, pour une vidéo dans une autre langue. Claude Haiku traduit phrase par phrase (pas
// mot par mot : la traduction serait mauvaise) ; chaque phrase traduite garde le moment et la durée de la phrase
// d'origine, et ses mots se partagent cette durée selon leur longueur. Gardé 7 jours, pour tout le monde.

const Traduction = z.object({ phrases: z.array(z.string()) });

/** Les phrases d'un passage : coupées sur une fin de phrase ou une pause. */
function phrasesDe(mots: MotST[]): MotST[][] {
  const out: MotST[][] = [];
  let cur: MotST[] = [];
  for (const m of mots) {
    const prev = cur.at(-1);
    if (prev && (/[.!?…]$/.test(prev.mot) || m.t - prev.fin > 0.6 || cur.length >= 14)) { out.push(cur); cur = []; }
    cur.push(m);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** `mots` : ceux du passage, minutés depuis son début. `cle` : identifie le passage, pour le garder en cache. */
export async function enFrancais(mots: MotST[], cle: string): Promise<MotST[]> {
  if (!hasClaude() || !mots.length) return mots;
  const phrases = phrasesDe(mots);
  const { value } = await cached(`trad:fr:${cle}`, LIMITES.cache.extraitsHeures, async () => {
    const res = await claude(cle).messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: "Tu traduis des sous-titres de vidéo en français parlé, naturel et court, comme on l'écrirait sur TikTok. Une phrase traduite par phrase d'origine, dans le même ordre, sans en fusionner ni en ajouter. Garde les noms propres. Pas de guillemets.",
      messages: [{ role: "user", content: `Traduis ces ${phrases.length} phrases :\n${phrases.map((p, i) => `${i + 1}. ${p.map((m) => m.mot).join(" ")}`).join("\n")}` }],
      output_config: { format: zodOutputFormat(Traduction) },
    });
    return res.parsed_output?.phrases ?? [];
  });
  // Une traduction qui n'a pas le bon nombre de phrases ne se recale pas : on garde la langue d'origine.
  if (value.length !== phrases.length) { console.warn(`[traduction] ${cle} : ${value.length} phrases au lieu de ${phrases.length}`); return mots; }
  return phrases.flatMap((p, i) => {
    const debut = p[0].t, fin = p.at(-1)!.fin;
    const nouveaux = value[i].split(/\s+/).filter(Boolean);
    const total = nouveaux.reduce((n, m) => n + m.length + 1, 0);
    let t = debut;
    return nouveaux.map((mot) => { const d = (fin - debut) * (mot.length + 1) / total; const m = { t, fin: t + d, mot }; t += d; return m; });
  });
}
