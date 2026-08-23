# Budget Orion V5 — refonte

Cette version conserve les clés de stockage historiques `bgt4`, `budgetV3`, `budgetV2` et `orion_v21_goals`.

## Sécurité des données
- lecture des anciennes structures ;
- snapshot local `orion_backup_before_v5` avant la première migration ;
- snapshot `orion_backup_v5_latest` avant les sauvegardes ;
- import/export JSON ;
- restauration depuis l’écran Plus.

## Nouveautés principales
- design clair vert doux validé ;
- dépenses directement modifiables et cochables ;
- reconnaissance visuelle de services connus (Netflix, ChatGPT, Spotify, Amazon, Disney+, YouTube, Apple, Free, Orange, Carrefour, Uber) avec fallback générique ;
- récurrences : ponctuelle, mensuelle, trimestrielle, semestrielle, annuelle, échéancier, tous les X mois ;
- planification 30 jours / 90 jours / 6 mois / 12 mois ;
- calendrier interactif ;
- analyse par catégorie et historique 6 mois ;
- poches d’épargne ;
- objectifs avec date cible et effort mensuel nécessaire ;
- onglet Ma stratégie avec versement mensuel, capital actuel, rendement, point de bascule, point d’accélération, scénarios 5/7/10 %, simulation « Et si ? » ;
- réglages et sauvegardes regroupés dans Plus.

## Important
Toujours conserver une copie du dépôt précédent avant remplacement sur GitHub Pages. Une sauvegarde JSON depuis l’ancienne application reste recommandée avant mise en production.
