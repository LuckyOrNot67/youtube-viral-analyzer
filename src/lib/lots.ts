// Qui reçoit quels passages : l'IA propose un grand choix pour une vidéo, et chaque groupe de personnes (un « lot »)
// en reçoit sa propre sélection. Les 10 premières personnes ont le lot 0, les 10 suivantes le lot 1, etc.
// Pur, pour être testé.

/** Lot 0 : les meilleurs passages. Lots suivants : un tirage qui favorise les mieux notés, toujours le même pour un
 *  lot donné. Une formule plus haute voit la suite du même ordre : passer de 5 à 10 garde les 5 premiers. */
export function ordreDuLot<T extends { scoreShorts: number }>(pool: T[], lot: number, graine: string): T[] {
  const tries = [...pool].sort((a, b) => b.scoreShorts - a.scoreShorts);
  if (lot === 0) return tries;
  const rnd = hasard(`${graine}:${lot}`);
  // Tirage pondéré sans remise : clé = u^(1/poids), on garde les plus grandes clés.
  return tries
    .map((x) => ({ x, k: Math.pow(rnd(), 1 / Math.pow(Math.max(0.5, x.scoreShorts), 2)) }))
    .sort((a, b) => b.k - a.k)
    .map((o) => o.x);
}

/** Les n passages de ce lot, rangés du mieux noté au moins bien noté. */
export function propositions<T extends { scoreShorts: number }>(pool: T[], lot: number, graine: string, n: number): T[] {
  return ordreDuLot(pool, lot, graine).slice(0, n).sort((a, b) => b.scoreShorts - a.scoreShorts);
}

/** Numéro de lot de la personne suivante, d'après le nombre de personnes déjà servies. */
export const lotSuivant = (dejaServies: number, parLot: number) => Math.floor(dejaServies / Math.max(1, parLot));

/** Générateur pseudo-aléatoire reproductible (mulberry32 sur un hachage FNV-1a de la graine). */
function hasard(graine: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < graine.length; i++) h = Math.imul(h ^ graine.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
