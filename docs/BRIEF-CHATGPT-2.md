# Brief n°2 pour ChatGPT : relire la proposition de refonte de Claude

Je suis le fondateur. Tu m'as envoyé un brief de refonte UX/UI (« REFONTE UX/UI — YOUTUBE VIRAL ANALYZER »). Claude Code a suivi ta méthode : audit, proposition UX, maquettes. Il attend mon accord avant de toucher au code.

**Avant que je dise oui, je veux ton regard critique.** Réponds en français simple et va droit au but.

## Les liens

- **La proposition de Claude (page avec les maquettes) :** https://htmlpreview.github.io/?https://github.com/LuckyOrNot67/youtube-viral-analyzer/blob/main/docs/refonte-proposition.html
- **Le code source de cette page,** si l'aperçu ne s'affiche pas : https://github.com/LuckyOrNot67/youtube-viral-analyzer/blob/main/docs/refonte-proposition.html
- **Le code de l'app** (inchangé depuis ton premier passage) : https://github.com/LuckyOrNot67/youtube-viral-analyzer
- **L'app en ligne** (temporaire, marche tant que mon ordinateur est allumé) : https://travel-name-organisms-hollywood.trycloudflare.com
- **Mon premier brief** (le produit, mes attentes) : https://github.com/LuckyOrNot67/youtube-viral-analyzer/blob/main/docs/BRIEF-CHATGPT.md

## Ce que Claude a fait

Rien n'est codé : tout ce qui suit est une proposition visible dans la page.

### 1. Audit

Ce qui fait « prototype », selon Claude :

- **Partout**
  - Une seule police, en gras 800 partout : rien ne ressort.
  - Tous les blocs ont la même forme (fond gris, arrondi de 22 px).
  - Les scores sont des petites pastilles qui ressemblent à des étiquettes.
  - Aucune transition.
- **Accueil**
  - Le bouton de recherche est gris quand le champ est vide : il a l'air cassé.
  - Rien ne dit ce qu'on obtient.
  - Les exemples sont coupés au bord de l'écran.
- **Résultats**
  - On ne voit pas combien de vidéos ont été analysées.
  - La n°1 affiche « Dans la moyenne de la chaîne » en rose avec une flamme : on présente une info neutre comme un exploit.
  - Chaque ligne cumule trois badges : rang, miniature minuscule et pastille de score.
- **Fiche vidéo**
  - L'action principale est sous la ligne de flottaison sur téléphone.
  - Deux phrases se contredisent : « Au-dessus de la normale » et « Dans la moyenne ».
  - Les extraits en deux colonnes coupent l'accroche.

### 2. Direction visuelle : la « jauge de chaleur »

- **Le score devient la signature de l'app.** Un grand chiffre en Bricolage Grotesque est posé sur une jauge de 10 barres qui se remplit en rose quand l'écran s'ouvre. La jauge revient à chaque score.
- **Bricolage Grotesque** sert pour les titres, les scores et les accroches. Le reste du texte est en police système.
- **Arrondis** : trois tailles seulement (12, 18 et 26 px). Les ombres sont réservées à ce qui flotte.
- **Couleurs** : les deux thèmes actuels, inchangés. Le rose est réservé au score, à l'action principale et à ce qui est sélectionné. Une seule carte colorée par écran.
- **Animations** :
  - la jauge qui se remplit ;
  - les résultats qui apparaissent l'un après l'autre ;
  - le panneau d'export qui monte du bas ;
  - une coche à la fin.

  Elles sont toutes coupées si le téléphone demande moins d'animations.

### 3. Nouvelle structure des écrans

Les maquettes existent en Fun clair et en Fun sombre, sur téléphone et sur ordinateur, avec de vraies données de l'app.

- **Accueil**
  - Titre : « Trouve ce qui cartonne. »
  - Une phrase de bénéfice.
  - Le champ.
  - Un vrai bouton « Trouver les pépites », toujours visible.
  - Exemples : Minecraft, Podcast, Fitness et @Squeezie (Claude a ajouté une chaîne pour montrer qu'on peut en coller une).
- **Résultats**
  - En haut, un rappel compact de la recherche.
  - Le titre « Les vidéos qui explosent », avec en dessous « 25 vidéos en français · 7 derniers jours ».
  - Le sélecteur Tout / Vidéos longues / Shorts.
  - Une vidéo vedette : grande miniature, score avec jauge, raison (« 6,9× ses vues habituelles »), titre, chaîne, vues et date. Le bouton dit « Voir les meilleurs moments », ou « Voir la vidéo » si c'est un Short.
  - Les autres vidéos en lignes : miniature plus grande, titre, chaîne et vues, puis le score et la raison sur une ligne.
  - Ce qui disparaît : numéros de rang, pastilles, barre de recherche pleine taille.
- **Fiche vidéo**
  - Le lecteur, le titre, et sur une ligne la chaîne, les vues et la date.
  - Le bloc « Pourquoi elle cartonne » : score, jauge, « Elle a fait 24× les vues habituelles de la chaîne » et un lien « Comprendre le score ». Ce titre n'apparaît que si le score atteint 6,5. En dessous, le bloc s'appelle « Son score » et dit les choses telles qu'elles sont.
  - Le bouton « Trouver les meilleurs extraits » reste collé en bas de l'écran jusqu'au lancement de l'analyse.
  - Après l'analyse, la section « Tes meilleurs extraits » : une colonne de cartes avec « Extrait 1 », l'accroche entière, le minutage (« 0:35 → 0:51 · 16 s »), le potentiel et, quand c'est vrai, « Cité 3× en commentaires ». Deux boutons : « Voir l'extrait » et « Créer mon Short ».
  - « Ce que les gens ont remarqué » et « Aussi sur la chaîne » deviennent des lignes repliables en bas de page.
- **Création du Short** : un panneau qui monte du bas, en 3 étapes.
  1. **Prêt à créer** : l'accroche, deux aperçus de cadrage (« Image entière » ou « Plein écran ») et le bouton « Générer mon Short ». Rien ne démarre avant ce clic.
  2. **Génération** : « On prépare ton Short… », avec la vraie progression du serveur (récupération, puis mise au format vertical).
  3. **Terminé** : un aperçu vertical, « Ton Short est prêt ! », « Télécharger le MP4 » et « Changer le cadrage » (qui revient à l'étape 1 sans rien relancer).
- **Ordinateur** : deux colonnes.
  - Résultats : la vedette à gauche, la liste à droite.
  - Fiche vidéo : le lecteur et le score à gauche, les extraits à droite.

### 4. Les risques du code

| Gravité | Problème | Où |
|---|---|---|
| Haute | L'export démarre dès qu'on ouvre la tuile, et changer de cadrage relance un export. | `src/app/video/[id]/page.tsx` (ExportShort) |
| Haute | Le MP4 est servi sans gestion des requêtes « Range » : sur iPhone, l'aperçu peut ne pas se lire. | `src/app/api/short/[job]/route.ts` |
| Moyenne | Aucune limite d'exports simultanés. Claude propose une file de 2 exports à la fois. | `src/lib/short.ts` |
| Moyenne | Pour un sujet, le filtre Shorts ne s'applique qu'aux 20 à 25 vidéos déjà chargées. | `src/app/resultats/page.tsx` |
| Moyenne | Les exports sont suivis en mémoire. Claude propose de les garder dans SQLite. | `src/lib/short.ts` |
| Faible | Une réponse peut arriver après qu'on a quitté la fiche vidéo. | `src/app/video/[id]/page.tsx` |
| Faible | Les limites par cookie anonyme se contournent facilement. | `src/lib/http.ts` |
| Faible | Quotas « vérifier puis dépenser » : sans risque avec un seul serveur. | `src/lib/quota.ts` |

### 5. Là où Claude s'écarte de ton brief

- « Extrait 1 » plutôt que « Extrait 01 » : le zéro devant est décoratif.
- Un exemple de chaîne (@Squeezie) en plus de Minecraft, Podcast et Fitness.
- « Pourquoi elle cartonne » seulement à partir de 6,5/10, pour ne jamais présenter une vidéo moyenne comme un succès.
- Police système pour le texte courant (rapide et native sur iPhone). Bricolage Grotesque seulement pour les titres et les chiffres.

## Ce que je te demande

1. **Ton verdict en 5 lignes maximum** : est-ce que cette proposition règle le côté « prototype IA » ? Oui, non ou à moitié, et pourquoi.
2. **Écran par écran** (accueil, résultats, fiche vidéo, panneau du Short, ordinateur) : ce qui est bien, ce qui ne va pas, ce que tu changerais. Sois précis : taille, place, mot, couleur.
3. **La jauge de chaleur** : bonne idée de signature ou gadget ? Si c'est un gadget, propose mieux.
4. **La typo** : Bricolage Grotesque, bon choix pour ce public ? Sinon, laquelle et pourquoi.
5. **Les textes** : corrige ceux qui sonnent faux ou trop « IA ».
6. **Ce qui manque** dans la proposition par rapport à ton premier brief.
7. **Le code** : les risques listés sont-ils les bons ? En manque-t-il ?
8. **Ta liste finale** : ce que Claude doit changer dans la proposition avant de coder, classé par importance.

Format : des titres courts, des listes et du concret sur **cette** app. Pas de théorie UX générale.
