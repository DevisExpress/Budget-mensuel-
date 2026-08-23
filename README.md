# Budget Orion (Budget-mensuel-)

Application de gestion budgétaire personnelle : dépenses récurrentes, planification, analyse, épargne par poches, objectifs et stratégie d'investissement. 100% locale (`localStorage`), aucun serveur, déployée sur GitHub Pages.

**URL en ligne :** https://devisexpress.github.io/Budget-mensuel-/

## Structure du dépôt
- `index.html` — point d'entrée, charge `css/app.css` puis `js/brands.js` et `js/app.js` en chemins relatifs (compatibles GitHub Pages en sous-dossier de projet).
- `css/app.css` — feuille de style unique (thème clair, vert doux, sans mode sombre).
- `js/brands.js` — registre extensible de reconnaissance de marques (nom → icône → catégorie suggérée).
- `js/app.js` — application (rendu, moteur de récurrence, stratégie, poches d'épargne, sauvegardes...).
- `404.html` — page de redirection pour les anciennes URLs (`/orion_v2/`, `/orion_v21/`) vers la racine.

Voir `V6-CHANGELOG.md` pour le détail de la dernière refonte (migration de données, nouvelles fonctionnalités, tests effectués).

## V4.1 — statuts restaurés
- Le bouton de coche des revenus/dépenses est de nouveau directement accessible dans les listes.
- Le solde actuel = revenus réellement reçus - dépenses réellement prélevées.
- La fin de mois estimée = revenus reçus - toutes les dépenses prévues.
- L'onglet Analyses exploite désormais les anciennes données mensuelles et les statuts `paid` réels.
- Aucun effacement du localStorage `bgt4`.


## V4.2
- Suppression des dépenses récurrentes corrigée : le modèle de récurrence est supprimé avec ses occurrences générées pour éviter qu'il réapparaisse.
- Bouton Ajouter déplacé en bouton flottant au-dessus de la navigation.
- Épargne mensuelle désormais modifiable directement depuis l'onglet Épargne.
- Objectif d'épargne de l'accueil rendu explicite et modifiable au toucher.
