# Paiement et relances par email

Décisions de Lucas du 5 novembre 2026. Les chiffres viennent de la propale (marge de 80 % au minimum avec Gemini).

## Formules

| Offre | Prix TTC | Recherches / jour | Vidéos analysées | Vidéos en histoires | Shorts / vidéo |
|---|---|---|---|---|---|
| Créateur | 19,90 €/mois | 10 | 25 / mois | 10 / mois | 5 |
| Expert | 39,90 €/mois | 25 | 55 / mois | 20 / mois | 10 |
| Pro | 79,90 €/mois | 50 | 100 / mois | 60 / mois | 20 |
| À l'année | 2 mois offerts | | | | |
| Essai 7 jours | 6,99 € | 5 | 6 / semaine | 2 / semaine | 5 |
| Pass à vie | 249 €, 300 places | comme Créateur | | | |

- Chaque heure de vidéo commencée compte pour 1 (1 h 30 compte pour 2).
- Les réglages sont dans `src/config/limites.json` (`formules` et `offresSpeciales`).

## Paiement : Whop

- Frais officiels : 2,7 % + 0,30 $ par paiement, plus 1,5 % pour une carte non américaine et 1 % de conversion. Pour un client français, compter environ 5,2 % + 0,26 €.
- Certains sites parlent d'une commission de 3 % en plus. Il faut la faire confirmer par Whop avant de signer.

## Parcours d'un nouveau visiteur (à brancher avec les comptes)

1. Il se connecte, donc on a son email.
2. Il a droit à un aperçu gratuit, comme sur Remakeit.
3. On lui demande de payer une formule : Créateur, Expert ou Pro, au mois ou à l'année.
4. S'il n'a pas payé au bout de 24 h (`offresSpeciales.semaine.relanceApresHeures`), il reçoit **un seul email**. Le message ressemble à : « On voit que tu n'as pas encore choisi. Pour te convaincre, essaie une semaine pour 6,99 € », avec le lien de paiement Whop de l'essai.
5. **On ne propose rien sur la page de paiement elle-même** : pas de fenêtre « attends, essaie à 6,99 € » quand il la ferme. Lucas a écarté cette idée parce qu'elle risque de créer des bugs. Tout passe par l'email.
6. L'essai 7 jours n'apparaît jamais sur la page des tarifs.
7. Le pass à vie n'existe que pendant le lancement, sur une page à part avec le compteur des 300 places.

## Gemini surchargé (déjà en place)

- L'app réessaie d'abord Gemini Flash-Lite après 5, 15 et 30 s.
- Si Gemini reste saturé, l'écran affiche « Gemini est surchargé, ça se débloque en général en 2 à 3 minutes ». La page vérifie seule toutes les 30 s et affiche le résultat dès qu'il est prêt.
- Le serveur réessaie toutes les 2 minutes. Après 6 minutes de saturation, il passe au modèle de secours, plus cher (`gemini.modeleSecours`), pour que personne n'attende trop. Il abandonne après 30 minutes. Ces réglages sont dans `src/config/limites.json`.
- Rien n'est décompté de la formule tant que la personne n'a pas reçu son résultat.
- Emails « c'est prêt » : le code est prêt, mais il reste à brancher. Il faut `RESEND_API_KEY` et `EMAIL_FROM` dans `.env.local`. Tant qu'ils manquent, le champ email ne s'affiche pas.
