# Viral Analyzer

Trouve les vidéos YouTube qui explosent, repère leurs meilleurs passages et exporte-les en Shorts verticaux.

## Lancer

```bash
npm install
npm run setup        # installe yt-dlp dans .cache/ytdlp (export des Shorts)
cp .env.example .env.local   # puis remplis les 3 clés
npm run dev
npm test             # score, lecture des liens, moments cités
```

## Ce que fait l'app (MVP du 01/11/2026)

1. **Recherche** : on colle une chaîne (`youtube.com/@nom`, `/channel/UC…`, `@nom`), un lien de vidéo, un hashtag ou un sujet.
2. **Score d'explosion /10** (`src/lib/score.ts`, testé) : chaque vidéo est comparée aux vidéos de sa chaîne, du même format (Short ou longue) et d'un âge proche.
   - Surperformance 50 % (log2 du rapport à la médiane).
   - Vitesse 25 % (mesurée entre deux relevés si possible).
   - Engagement 15 % (lissé vers celui de la chaîne).
   - Récence 10 %.
   - Score plafonné à 5 sous 5 000 vues. Confiance haute, moyenne ou basse.
   - 3 raisons écrites à partir des chiffres.
3. **Fiche vidéo** : lecteur intégré, statistiques, détail du score, autres vidéos de la chaîne.
4. **Commentaires** (sur demande) : moments cités (« 12:35 »), sujets, questions, réactions, idées de Shorts (Claude).
5. **Extraits** (sur demande, vidéos longues) :
   - Gemini regarde la vidéo à partir de son lien, sans téléchargement (mesuré : 10 min de vidéo en 9,5 s, environ 96 jetons par seconde).
   - Claude note chaque passage (potentiel Shorts /10, titre, accroche).
   - Contrôles sans IA : durée de 10 à 90 s, minutages dans la vidéo, pas de doublon.
6. **Export Short** : yt-dlp télécharge seulement le passage, puis FFmpeg sort un MP4 1080×1920 (cadrage « image entière sur fond flou » ou « plein écran centré »), avec le son égalisé à −14 LUFS. Le fichier est effacé au bout de 24 h. Mesuré : 47 s de passage téléchargées en 23 s, rendu en 20 s.

## Mesures réelles (01/11/2026)

- Chaîne Squeezie, 200 vidéos : 2,8 s, 9 unités de quota.
- Sujet « minecraft », 50 vidéos et la base de 50 chaînes : 80 unités et 1 recherche ; 24 s avant de lire les chaînes en parallèle.
- Sujet « podcast business » (vidéos longues), avec les chaînes lues en parallèle : 2,9 s.
- Commentaires (284 lus) : 10,6 s.
- Extraits d'une vidéo de 19 min : 28 s.
- Short de 46 s : environ 45 s.

## Recherche par sujet

- Vidéos **en français** des **7 derniers jours**, sans réglage à l'écran (l'API accepte encore `langue` et `periode`).
- Le français est détecté avec la langue déclarée de la vidéo, l'écriture du titre (les écritures indiennes, arabes et asiatiques sont exclues), le pays de la chaîne et les mots du titre (`src/lib/lang.ts`, testé).
- YouTube trie par pertinence. Trier par vues ne renvoyait presque que des vidéos étrangères (mesuré : 0 sur 50 en français pour « #minecraft », contre 31 sur 50 par pertinence). Notre score fait ensuite le classement.
- Jusqu'à 3 pages de 50 vidéos tant qu'on n'a pas 20 vidéos qui passent les filtres. Chaque page compte pour 1 des 100 recherches du jour.

## Quotas

- **YouTube** : 10 000 unités et 100 recherches par sujet par jour pour toute l'app, remis à zéro à minuit heure du Pacifique. Les deux compteurs sont tenus dans la base, avec une réserve et des alertes à 70, 85 et 95 %.
- **Par personne** (identifiant anonyme en cookie) : chaînes, sujets, commentaires, extraits et Shorts par jour, réglables dans `src/config/limites.json`. Une recherche servie par le cache n'est pas décomptée.
- **Cache partagé** : chaînes 7 jours, sujets 3 jours, statistiques 6 h, extraits 7 jours. Les relevés sont effacés après 30 jours.

## Données

Base SQLite locale `.cache/data.db` (incluse dans Node 22, aucun compte à créer). Elle contient les tables `cache`, `quota`, `quota_log`, `usage` et `snapshots`. En production, on passera à PostgreSQL avec les mêmes tables.

## Décisions et risques

- **Thème** : DA Fun claire et Fun sombre, reprise de l'app créateurs. Elle suit le réglage du téléphone, ou le bouton en haut à droite.
- **Pas de sous-titres incrustés** dans les Shorts. On n'utilise pas non plus les sous-titres YouTube des vidéos.
- **Export depuis YouTube : décision du fondateur** (« Remake It le fait »). Ce téléchargement est contraire aux règles développeur de YouTube (III.E.1 : pas de téléchargement ni de stockage sans accord écrit). Deux risques :
  - la clé API peut être coupée ;
  - la demande d'augmentation du quota peut être refusée si Google voit cette fonction.

  Si YouTube demande une vérification anti-robot, l'export échoue avec un message clair. On ne la contourne pas.
- **Droits** : publier l'extrait de la vidéo d'un autre peut enfreindre son droit d'auteur. Les CGU devront le dire.

## Pas encore fait

- Comptes et paiement.
- Relevés automatiques quotidiens (aujourd'hui, un relevé est enregistré à chaque consultation).
- Suivi du visage pour le recadrage.
- Passage à PostgreSQL.
- Écran d'admin des quotas et des coûts (le journal est dans `.cache/events.jsonl`).
