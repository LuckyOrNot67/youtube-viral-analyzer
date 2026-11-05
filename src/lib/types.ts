// Types partagés entre le serveur et les écrans.

export type Channel = {
  id: string;
  title: string;
  handle: string | null;
  avatar: string;
  description: string;
  /** null si la chaîne masque son nombre d'abonnés. L'API l'arrondit à 3 chiffres. */
  subs: number | null;
  videoCount: number;
  uploads: string;
  /** Pays déclaré par la chaîne (FR, BE, IN…), souvent absent. */
  country: string | null;
};

export type Video = {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  thumb: string;
  publishedAt: string;
  duration: number;
  views: number;
  /** null si les likes ou commentaires sont masqués ou désactivés. */
  likes: number | null;
  comments: number | null;
  /** Langue déclarée de la vidéo (« fr », « en-US », « hi »…), souvent absente. */
  lang: string | null;
  /** Mots-clés déclarés par la chaîne (15 au plus), pour vérifier qu'une vidéo parle du sujet cherché. */
  tags?: string[];
  /** Relevé (ms) : sert à dater la fraîcheur des chiffres. */
  fetchedAt: number;
};

export type Confiance = "haute" | "moyenne" | "basse";

export type Score = {
  /** Sur 10, une décimale. */
  score: number;
  label: string;
  confiance: Confiance;
  /** Pourquoi la confiance n'est pas haute. */
  confianceRaison: string | null;
  raisons: string[];
  /** Détail des 4 critères (0 à 1) pour l'écran de détail. */
  parts: { surperformance: number; vitesse: number; engagement: number; recence: number };
  base: { median: number | null; n: number; ratio: number | null };
  vuesParJour: number;
  /** Vitesse mesurée entre deux relevés (sinon moyenne depuis la publication). */
  vitesseMesuree: boolean;
  engagement: number | null;
  ageJours: number;
  isShort: boolean;
};

export type ScoredVideo = Video & { s: Score; rang: number; subs: number | null };

export type SearchResult = {
  type: "chaine" | "sujet" | "video";
  query: string;
  channel: Channel | null;
  videos: ScoredVideo[];
  /** Ce qui a vraiment été analysé, pour ne jamais faire croire qu'on a tout vu. */
  portee: string;
  cache: boolean;
  fetchedAt: number;
};

export type Extrait = {
  start: number;
  end: number;
  type: string;
  titre: string;
  hook: string;
  resume: string;
  justification: string;
  scoreShorts: number;
  /** Nombre de commentaires qui citent ce moment. */
  citations: number;
};

/** Un moment de la vidéo cité dans les commentaires (« 12:30 »), avec quelques exemples. */
export type MomentCite = { t: number; n: number; likes: number; exemples: string[] };
