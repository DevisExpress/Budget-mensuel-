# Budget Mensuel+ V5 — refonte premium

Cette version conserve les clés de stockage historiques (`bgt4`, `budgetV3`, `budgetV2`) et la sauvegarde de sécurité existante.

## Ajouts principaux
- Direction visuelle claire et vert doux validée.
- Dépenses enrichies avec identification visuelle de services connus (Netflix, ChatGPT/OpenAI, Spotify, Amazon) et fallback par catégorie.
- Fréquences : ponctuelle, mensuelle, trimestrielle, semestrielle, annuelle, échéancier et intervalle personnalisé en mois.
- Calcul annuel corrigé selon la fréquence réelle.
- Calendrier : chaque journée devient interactive et ouvre ses événements.
- Nouvel espace **Ma stratégie** : capital actuel, versement mensuel, rendement annuel, rendement produit, point de bascule, progression et projections 5/10/20 ans.
- Paramètres de stratégie modifiables directement depuis l'écran.
- Accès à Ma stratégie depuis Plus.
- Les anciennes fonctions restent en place : validation des prélèvements, objectifs, épargne mensuelle, anniversaires, paiements fractionnés, analyse, import/export et changement de période.

## Données
Aucune migration destructive n'est effectuée. Les nouvelles données de stratégie sont stockées dans `orion_plus_v4` à côté des données existantes.
