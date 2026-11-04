// Découpe d'une histoire en parties (Partie 1, 2, 3…) : on coupe sur un moment de suspense proche de la durée
// choisie, sinon pile à cette durée. Pur, pour être testé.

export type Partie = { n: number; start: number; end: number };

/** `coupures` : secondes où couper laisse du suspense (fin de phrase, juste avant une révélation). */
export function decouper(start: number, end: number, coupures: number[], cible: number, max = 180): Partie[] {
  const min = Math.max(20, Math.round(cible * 0.5));
  const points = [...new Set(coupures.map(Math.round))].sort((a, b) => a - b);
  const parties: Partie[] = [];
  let a = Math.round(start);
  const fin = Math.round(end);
  // On continue tant que le reste est trop long pour une seule partie.
  while (fin - a > max || fin - a > cible * 1.4) {
    // Un moment de suspense compte s'il reste proche de la durée choisie (entre 0,6 et 1,5 fois), jamais au-delà de 3 min.
    const ok = points.filter((t) => t >= a + Math.max(min, cible * 0.6) && t <= a + Math.min(max, cible * 1.5) && fin - t >= min);
    // Sans suspense proche : pile à la durée choisie, ou en deux moitiés si la fin serait un bout trop court.
    const sans = fin - (a + cible) < min ? a + Math.round((fin - a) / 2) : a + cible;
    const b = ok.length ? ok.reduce((best, t) => (Math.abs(t - a - cible) < Math.abs(best - a - cible) ? t : best)) : sans;
    parties.push({ n: parties.length + 1, start: a, end: b });
    a = b;
  }
  parties.push({ n: parties.length + 1, start: a, end: fin });
  return parties;
}
