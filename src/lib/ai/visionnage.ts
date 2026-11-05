import "server-only";
import { cacheGet, cacheSet } from "../db";
import { lireAvecFormat, QUESTION_FORMAT } from "../format";
import { fmtTime } from "../parse";
import { enLignes, sousTitres } from "../sous-titres";
import type { Video } from "../types";
import { commentsOf } from "./comments";
import { citedMoments } from "./moments";
import { geminiWatchYouTube, jsonIn } from "./models";
import LIMITES from "@/config/limites.json";

// Un seul visionnage de la vidéo par Gemini sert à tout : les passages pour les Shorts, les coupures des histoires
// (pour les 3 durées) et le conseil de cadrage. Le premier qui en a besoin (Shorts ou histoires) le lance ; l'autre
// le retrouve tout fait, sans repayer Gemini. Gardé 7 jours, pour tout le monde. Les compteurs des abonnés, eux,
// restent séparés : trouver les Shorts compte une vidéo, découper en histoires compte une histoire.

export const DUREE_MAX_VIDEO = 3 * 3600;
const H = LIMITES.histoires;
/** Un grand choix pour que chaque groupe de personnes reçoive des passages différents : environ un toutes les 2 min. */
export const nbPassages = (duree: number) => Math.max(8, Math.min(LIMITES.analyse.passagesMax, Math.round(duree / 120)));
/** Les durées de partie possibles pour une vidéo : il faut de quoi faire au moins `partiesMin` parties. */
export const dureesPour = (dureeVideo: number) => H.durees.filter((d) => dureeVideo >= d * H.partiesMin);

/** Ce que Gemini a noté, brut : chaque partie de l'app le vérifie à sa façon. */
export type Visionnage = { passages: unknown; serie: unknown; creeLe: number };

const g = globalThis as unknown as { __yvaVision?: Map<string, Promise<Visionnage>> };
const enCours = (g.__yvaVision ??= new Map());

export async function regarder(v: Video): Promise<Visionnage> {
  if (v.duration > DUREE_MAX_VIDEO) throw new Error(`Vidéo trop longue (plus de ${DUREE_MAX_VIDEO / 3600} h).`);
  const key = `vision:${v.id}`;
  const deja = cacheGet<Visionnage>(key);
  if (deja) return deja;
  // Shorts et histoires demandés en même temps : un seul appel à Gemini.
  const encore = enCours.get(v.id);
  if (encore) return encore;
  const p = (async () => {
    const moments = citedMoments(await commentsOf(v.id).catch(() => []), v.duration);
    const phrases = await sousTitres(v);
    const raw = jsonIn(await geminiWatchYouTube(v.id, v.duration, prompt(v, moments.map((m) => m.t), enLignes(phrases)), v.id)) as Record<string, unknown>;
    lireAvecFormat(v.id, raw, "passages");
    const value: Visionnage = { passages: raw.passages ?? [], serie: raw.serie ?? null, creeLe: Date.now() };
    cacheSet(key, value, LIMITES.cache.extraitsHeures);
    return value;
  })();
  enCours.set(v.id, p);
  try { return await p; } finally { enCours.delete(v.id); }
}

function prompt(v: Video, cites: number[], sousTitresEnLignes: string): string {
  const n = nbPassages(v.duration), durees = dureesPour(v.duration);
  return `Regarde cette vidéo YouTube en entier (« ${v.title} », ${fmtTime(v.duration)}). À partir de ce seul visionnage, tu prépares deux choses pour TikTok. Tu ne coupes rien toi-même : tu notes seulement les minutages, on coupera ensuite.

A. "passages" : ${n} passages différents, qui ne se chevauchent pas, pour en faire des vidéos courtes (Shorts, Reels, TikTok), répartis sur toute la vidéo : les plus forts d'abord, puis les bons passages qui restent (ils seront notés ensuite). Un bon passage :
- se comprend sans avoir vu le reste de la vidéo ;
- commence fort (pas au milieu d'une phrase) et se termine sur une chute ou une conclusion claire ;
- dure entre 20 et 60 secondes (90 au maximum) ;
- contient une révélation, une réaction forte, une histoire courte, une info surprenante, une réponse claire, un débat, un moment drôle, une démonstration, une transformation, un conseil concret ou une phrase marquante.
${cites.length ? `Des spectateurs citent ces moments dans les commentaires (à vérifier dans la vidéo) : ${cites.map(fmtTime).join(", ")}.\n` : ""}
${durees.length ? `B. "serie" : toute la vidéo en parties qui se suivent (« Partie 1 », « Partie 2 »…), du premier moment intéressant jusqu'à la fin. Le créateur choisira la durée des parties : donne une découpe complète pour chacune de ces durées : ${durees.map((d) => `${d} s`).join(", ")}.
- "debut" : la seconde où la vidéo devient intéressante, après le générique, l'intro, les annonces ou la pub (0 si elle commence tout de suite). "fin" : la seconde où le contenu se termine, avant la conclusion, les remerciements et l'écran de fin.
- "decoupes" : pour chaque durée, la liste complète des parties de "debut" à "fin". ${durees.map((d) => `Pour ${d} s, chaque partie dure entre ${Math.round(d * 0.75)} et ${Math.min(H.partieMax, Math.round(d * 1.25))} secondes`).join(" ; ")}. La durée change d'une partie à l'autre pour couper au bon moment : chaque partie (sauf la dernière) se termine sur un moment qui frustre le spectateur et lui donne envie de voir la suite, juste avant une révélation, une réponse, une chute, ou sur une question laissée en suspens. Jamais au milieu d'une phrase. Respecte ces durées.
- Chaque partie après la première commence ${H.recul - 1} à ${H.recul} secondes avant la fin de la précédente, au début d'une phrase, pour que le spectateur retrouve le fil.
- "titre" : le titre de la série, 6 mots maximum, en français. "resume" : de quoi parle la vidéo, une phrase, en français.
` : `B. "serie" : null (vidéo trop courte pour être postée en parties).
`}
C. Le cadrage pour TikTok (voir "format" ci-dessous).

Règles : les minutages doivent correspondre à ce qu'on voit et entend réellement. N'invente rien.
${sousTitresEnLignes ? `\nSous-titres de la vidéo, avec leurs minutages, pour commencer et couper pile en début et fin de phrase :\n${sousTitresEnLignes}\n` : ""}
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{${QUESTION_FORMAT},
"passages": [{"start": secondes depuis le début (nombre), "end": secondes (nombre), "type": "révélation|réaction|histoire|info|réponse|débat|drôle|démo|transformation|conseil|phrase", "premiere_phrase": "la première phrase prononcée dans le passage, mot pour mot", "resume": "ce qui se passe, en une phrase"}],
"serie": ${durees.length ? `{"debut": secondes, "fin": secondes, "titre": "…", "resume": "…", "decoupes": {${durees.map((d) => `"${d}": [{"start": secondes, "end": secondes}, …]`).join(", ")}}}` : "null"}}`;
}
