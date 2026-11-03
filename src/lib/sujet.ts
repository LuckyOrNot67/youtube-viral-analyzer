// Recherche par sujet : quels mots compte-t-on, et une vidéo en parle-t-elle vraiment ? Pur, pour être testé.
// YouTube renvoie parfois des vidéos sans rapport (« #ofm » → un clip d'Orelsan) : on écarte celles dont le titre,
// la description et les tags ne contiennent jamais les mots cherchés.

/** Petits mots qui ne disent rien du sujet. */
const VIDES = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "au", "aux", "pour", "sur", "avec", "dans", "the", "of", "and", "to", "in", "a"]);

const plat = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Mots qui comptent dans une recherche, sans # ni accents, sans doublon. */
export function motsDe(q: string): string[] {
  const mots = plat(q).split(/[^a-z0-9]+/).filter(Boolean);
  const utiles = mots.filter((m) => m.length > 1 && !VIDES.has(m));
  return [...new Set(utiles.length ? utiles : mots)];
}

export type TexteVideo = { title: string; description: string; tags?: string[] };

/** Chaque mot apparaît au début d'un mot du titre, de la description ou des tags (« ofm » trouve aussi « #ofmlife »). */
export function parleDe(v: TexteVideo, mots: string[]): boolean {
  const t = plat(`${v.title} ${v.description} ${(v.tags ?? []).join(" ")}`);
  return mots.every((m) => new RegExp(`(^|[^a-z0-9])${m}`).test(t));
}

/** Une recherche déjà faite couvre la nouvelle si tous ses mots en font partie (« ofm » couvre « ofm life »). */
export const couvre = (ancienne: string[], nouvelle: string[]) => ancienne.length > 0 && ancienne.every((m) => nouvelle.includes(m));
