// Réglages d'animation communs (voir la planche, onglet « Animations ») :
// courts, qui démarrent vite et finissent en douceur ; un léger ressort pour ce qui se déplace.
export const EASE = [0.23, 1, 0.32, 1] as const;
/** Pastilles qui glissent (barre du bas, onglets). */
export const SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;
/** Panneaux qui montent du bas. */
export const SHEET = { type: "spring", stiffness: 380, damping: 36 } as const;
