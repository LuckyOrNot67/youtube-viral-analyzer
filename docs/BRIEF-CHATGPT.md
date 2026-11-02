# Brief pour ChatGPT : relire Viral Analyzer et dire ce qui ne va pas

- **Code :** https://github.com/LuckyOrNot67/youtube-viral-analyzer
- **App en ligne (temporaire) :** https://travel-name-organisms-hollywood.trycloudflare.com (marche tant que mon ordinateur est allumé)

Je suis le fondateur. Je ne code pas : réponds en français simple et va droit au but.

## 1. Le produit en une phrase

Un créateur colle une chaîne YouTube, un lien de vidéo, un hashtag ou un sujet. L'app lui montre les vidéos qui **explosent** (score sur 10). Elle trouve ensuite dans une vidéo longue **les passages qui feraient de bons Shorts** et les exporte en MP4 vertical, prêts à poster sur TikTok, Reels ou Shorts.

**Pour qui :** des créateurs TikTok, Reels et Shorts francophones, sur téléphone surtout. Ils ne sont pas techniques, sont pressés et veulent qu'on leur dise quoi prendre.

## 2. Mon problème : l'interface

**L'app marche, mais l'interface ne me plaît pas du tout.** Trop de texte, trop d'onglets, trop de petits boutons. Ce n'est ni propre ni agréable. On a déjà fait deux passes de simplification, et le résultat reste moche et brouillon.

**Ce que je veux :**
- Ultra simple et ultra propre. On ouvre l'app et on comprend en 2 secondes quoi faire.
- Une seule chose importante par écran, bien visible. Pas de blabla.
- Ludique et visuel. Ma référence, c'est une app où l'on appuie chaque jour sur un bouton et où un compteur grimpe (par exemple les jours sans écrire à son ex). Une seule fonction, un gros élément visuel, et c'est satisfaisant.
- Face à une liste de vidéos, on doit se dire : « je prends celle-là, parce que… ».
- Un style fun et vivant, façon Partiful ou TikTok, avec un mode sombre. Surtout pas un look de dashboard ou d'outil SaaS.
- **Garder** les deux thèmes « Fun clair » et « Fun sombre » (couleurs dans `src/app/globals.css`) : le rose `#ff3d9a`, le noir et les cartes pastel.

## 3. Ce que je te demande

Regarde l'app en ligne si le lien marche, et lis le code. Puis donne-moi :

1. **Ton avis franc sur l'interface, écran par écran** : ce qui est moche, confus ou en trop, et pourquoi.
2. **Une nouvelle proposition d'interface**, écran par écran : ce qu'on voit, dans quel ordre, ce qu'on supprime. Décris-la assez précisément pour qu'un développeur puisse la refaire. Si tu peux, ajoute une maquette en HTML ou en description visuelle.
3. **Le parcours idéal en 3 ou 4 gestes maximum**, de « je colle un lien » à « j'ai mon Short ».
4. **Le texte à garder** : propose les mots exacts de chaque écran (titres, boutons, messages), aussi courts que possible.
5. **Un contrôle du code** :
   - bugs ;
   - code inutile ou trop compliqué ;
   - sécurité (clés API, fichiers servis, limites d'usage) ;
   - performance ;
   - ce qui casserait avec 1 000 utilisateurs.
6. **Les 5 changements prioritaires**, du plus important au moins important.

## 4. Les écrans aujourd'hui

1. **Accueil** (`src/app/page.tsx`) : un titre, une barre de recherche et quelques exemples.
2. **Résultats** (`src/app/resultats/page.tsx`) :
   - le nom de la chaîne ou du sujet ;
   - un sélecteur Tout / Longues / Shorts ;
   - la vidéo n°1 en grand, avec son score et une raison (« 7,5× plus de vues que d'habitude ») ;
   - les autres vidéos en liste numérotée.
3. **Fiche vidéo** (`src/app/video/[id]/page.tsx`) :
   - le lecteur YouTube ;
   - une carte score, avec le calcul replié ;
   - le bouton « Trouver les Shorts », puis des tuiles de passages avec un bouton « Créer » qui fabrique le MP4 ;
   - un bouton « Ce que disent les spectateurs » (analyse des commentaires) ;
   - les autres vidéos de la chaîne.

Les composants partagés sont dans `src/components/` : barre de recherche, badge de score, bouton de thème.

## 5. Comment ça marche (pour le contrôle du code)

- **Technique :** Next.js 15 (App Router) avec React 19 et TypeScript, et une base SQLite locale (`node:sqlite`) pour le cache, les quotas et les relevés de vues.
- **Données YouTube :** YouTube Data API v3, avec une clé seulement (`src/lib/youtube/`). Les quotas et le cache sont dans `src/lib/db.ts` et `src/lib/quota.ts`. Les limites par personne et par jour se règlent dans `src/config/limites.json`, avec un identifiant anonyme en cookie.
- **Le score d'explosion** (`src/lib/score.ts`, testé) compare chaque vidéo aux vidéos de sa chaîne de même format et d'âge proche :
  - surperformance : 50 % ;
  - vitesse : 25 % ;
  - engagement : 15 % ;
  - récence : 10 %.
- **Recherche par sujet :**
  - uniquement des vidéos en français des 7 derniers jours ;
  - la langue est détectée dans `src/lib/lang.ts` ;
  - jusqu'à 3 pages de résultats YouTube.
- **Extraits** (`src/lib/ai/`) : Gemini regarde la vidéo à partir de son lien YouTube, puis Claude note les passages. Les moments cités dans les commentaires (« 12:35 ») servent aussi.
- **Export Short** (`src/lib/short.ts`) : yt-dlp télécharge seulement le passage, puis FFmpeg le met en 1080×1920 avec le son égalisé. Les fichiers sont effacés au bout de 24 h.
- **Tests :** `tests/` (`npm test`).
- **Ce qui est assumé** (ne pas me le reprocher, juste me signaler les risques) :
  - le téléchargement de passages YouTube va contre les règles développeur de YouTube, et c'est ma décision ;
  - il n'y a pas encore de comptes ni de paiement.

## 6. Format de ta réponse

- **Commence par 5 lignes maximum** : ce qui ne va pas le plus.
- Ensuite les points 1 à 6 de la partie 3, avec des titres courts.
- Pour le code : cite le fichier et la ligne, et propose la correction.
- Pas de théorie générale sur l'UX. Du concret sur **cette** app.
