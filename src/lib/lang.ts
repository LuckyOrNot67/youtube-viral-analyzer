// Est-ce une vidéo en français ? Pur (sans réseau) pour être testé.
// YouTube ne filtre pas vraiment par langue (relevanceLanguage n'est qu'une indication) : on trie nous-mêmes,
// avec, dans l'ordre, la langue déclarée de la vidéo, l'écriture du titre, le pays de la chaîne et les mots du texte.

/** Pays où une chaîne a de bonnes chances de publier en français. */
const FRANCOPHONES = new Set(["FR", "BE", "CH", "CA", "LU", "MC", "SN", "CI", "CM", "MA", "DZ", "TN", "RE", "GP", "MQ", "HT", "CD", "BJ", "ML", "BF", "GA", "MG"]);
/** Écritures indiennes, arabe, cyrillique, asiatiques… : un titre qui en contient n'est pas en français. */
const OTHER_SCRIPTS = /[Ѐ-ӿ؀-ۿऀ-෿฀-๿぀-ヿ㐀-鿿가-힯]/;

const FR_WORDS = ["le", "la", "les", "des", "du", "un", "une", "est", "et", "pour", "pas", "que", "qui", "avec", "dans", "sur", "mon", "ma", "mes", "tu", "vous", "nous", "je", "ce", "cette", "il", "elle", "ont", "fait", "comment", "pourquoi", "quand", "tout", "jamais", "toujours", "trop", "très", "argent", "vie"];
const EN_WORDS = ["the", "and", "you", "your", "how", "what", "why", "this", "that", "with", "for", "is", "are", "to", "of", "my", "in", "it", "be", "money", "life", "best", "get"];
const FR_SET = new Set(FR_WORDS), EN_SET = new Set(EN_WORDS);

/** Différence mots français / mots anglais, plus un bonus pour les lettres accentuées et les élisions (c'est, j'ai). */
export function frenchness(text: string): number {
  const t = text.toLowerCase();
  const words = t.match(/[a-zàâäçéèêëîïôöùûüœ']+/g) ?? [];
  let fr = 0, en = 0;
  for (const w of words) {
    if (FR_SET.has(w)) fr++;
    else if (EN_SET.has(w)) en++;
    if (/^(c|j|l|d|qu|n|m|t|s)'[a-zàâéèêîôû]/.test(w)) fr++;
  }
  fr += Math.min(3, (t.match(/[àâçéèêëîïôùûœ]/g) ?? []).length);
  return fr - en;
}

export type LangInput = { lang: string | null; title: string; description: string; channelCountry: string | null };

export function isFrench(v: LangInput): boolean {
  if (v.lang && v.lang !== "zxx" && v.lang !== "und") return v.lang.startsWith("fr");
  if (OTHER_SCRIPTS.test(v.title)) return false;
  const score = frenchness(`${v.title} ${v.description.slice(0, 400)}`);
  if (v.channelCountry && FRANCOPHONES.has(v.channelCountry)) return score >= 0;
  if (v.channelCountry === "IN" || v.channelCountry === "PK" || v.channelCountry === "BD") return false;
  return score >= 2;
}
