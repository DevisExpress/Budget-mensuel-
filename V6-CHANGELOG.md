# Budget Orion V6 — refonte fonctionnelle & correction du déploiement

## 1. Déploiement GitHub Pages
- **Cause du 404 sur `/orion_v2/`** : ce dossier n'a jamais existé dans le dépôt (seul `orion_v21/` existait, avec en plus une copie imbriquée `orion_v21/orion_v21/`, elle-même dupliquée). L'ancienne URL était donc erronée ou obsolète, indépendamment de toute configuration.
- L'application principale (`index.html`, `css/app.css`, `js/*.js`) était déjà à la racine et utilisait des chemins **relatifs** (`css/app.css`, `js/app.js`) : c'est la bonne pratique pour un GitHub Pages de type projet (`user.github.io/repo/`). Ils ont été explicités en `./css/app.css`, `./js/app.js` pour lever toute ambiguïté.
- **Suppression** du dossier `orion_v21/` (et sa copie imbriquée) ainsi que de `css/orion-v23.css` et `js/orion-v23-planner.js` : ces deux derniers fichiers n'étaient **référencés nulle part** dans `index.html` et s'appuyaient sur un objet global `window.ORION` qui n'existe dans aucun fichier du dépôt — code mort et non fonctionnel, sans lien avec l'application réellement servie.
- Ajout d'une page **`404.html`** : toute ancienne URL cassée (`/orion_v2/…`, `/orion_v21/…`) affiche désormais un message clair et redirige automatiquement vers la racine au lieu d'un 404 brut de GitHub.

## 2. Sécurité et migration des données
- Toutes les clés historiques restent lues en priorité : `bgt4` → `budgetV3` → `budgetV2` pour le budget, `orion_plus_v4`/`orion_plus_v3` pour les données complémentaires, `orion_v21_goals` pour les objectifs. **Rien n'est supprimé.**
- Nouveau système de **migration versionnée** (`SCHEMA_VERSION = 6`) : une sauvegarde complète et horodatée est créée automatiquement (`orion_backups_v1`) avant toute migration de schéma, avant chaque restauration et avant chaque import — jamais d'écrasement silencieux.
- Nouvel écran **Plus → Sauvegardes automatiques** : historique des sauvegardes (manuelles et automatiques), bouton « Sauvegarder maintenant », restauration en un clic (avec sauvegarde de l'état courant avant restauration).
- L'import JSON valide la structure du fichier **avant** toute écriture : un fichier invalide affiche une alerte et n'écrase rien.

## 3. Corrections de bugs découverts pendant les tests
- Un bug JavaScript classique (`name="id"` sur un champ de formulaire, qui masque la propriété native `form.id`) empêchait la sauvegarde des poches d'épargne et des objectifs de fonctionner. Corrigé (`itemId`).
- Un attribut mal formé (`data-add-pocket">`) empêchait le bouton « Nouvelle poche » de répondre au clic. Corrigé.
- La migration de données rejouait une sauvegarde à **chaque** chargement de page tant qu'aucune action n'avait déclenché une sauvegarde réelle. Corrigé : la sauvegarde `bgt4` est désormais écrite immédiatement après une migration.

## 4. Nouvelles fonctionnalités
- **Moteur de récurrence enrichi** : lors de la modification ou suppression d'une dépense récurrente, un choix explicite « seulement cette occurrence / cette occurrence et les suivantes / toute la série » est proposé, comme demandé.
- **Poches d'épargne** (Sécurité, Projets, Vacances, Disponible + poches personnalisées) : création, renommage, solde, contribution mensuelle, transfert entre poches, suppression avec réaffectation du solde.
- **Couverture financière** : épargne de sécurité ÷ dépenses essentielles mensuelles, avec objectif configurable (3/6/12 mois).
- **Objectifs** enrichis d'une date cible, avec calcul automatique de l'effort mensuel nécessaire pour l'atteindre à temps.
- **Ma stratégie** : point de bascule et **point d'accélération** (rendement ≥ 2× les versements annuels) calculés par simulation mensuelle réelle (et non plus une simple formule statique), taux de liberté financière, argent généré en €/an, €/mois et €/jour, scénarios rapides Prudent 5 % / Central 7 % / Dynamique 10 % (aperçu, sans écraser le réglage personnel), et simulateur « Et si j'investissais plus ? ».
- **Simulateur « Et si ? » réutilisable** : depuis une dépense (« Et si je supprimais ceci ? »), depuis l'épargne (« Et si j'épargnais plus ? ») et depuis Ma stratégie.
- **Planification** : filtres 30 / 90 / 180 / 365 jours, détection des mois chargés (comparaison à la moyenne), rappel du montant mensuel à provisionner pour les dépenses annuelles.
- **Analyse** : section « Ce qui a changé ce mois-ci » (variations par catégorie, épargne, fin d'échéancier = montant libéré), catégories du donut cliquables pour voir le détail.
- **Accueil** : bloc « Argent déjà engagé » (compte / prélèvements restant à venir / disponible réel), raccourcis rapides vers Objectifs et Ma stratégie.
- **Intelligence locale** (règles, sans IA externe) : grosse dépense imminente, mois chargé, dépense récurrente en hausse, abonnement coûteux à l'année, fin d'échéancier, objectif en avance/retard, épargne anormalement faible, charges fixes trop élevées, anniversaire proche, dépense annuelle à provisionner — n'apparaît que si pertinent.
- **Reconnaissance de marques étendue** (`js/brands.js`, registre extensible) : Netflix, ChatGPT/OpenAI, Spotify, Amazon/Prime, Disney+, YouTube, Apple, Orange, Free, SFR, Bouygues Telecom, + fallback générique par catégorie qui ne bloque jamais la saisie.

## 5. Tests réellement effectués (voir aussi la section de livraison)
Testés en navigateur headless (Playwright), servis sous `http://localhost/Budget-mensuel-/` pour reproduire la structure GitHub Pages :
- Chargement de la page, tous les onglets, absence d'erreur console.
- Ajout, modification (avec les 3 portées), suppression d'une dépense.
- Chaque fréquence : ponctuelle, mensuelle, trimestrielle, semestrielle, annuelle, échéancier (4 fois), personnalisée (tous les X mois).
- Changement de mois/année, y compris un aller-retour de 12 mois (franchissement d'année) : les récurrences se régénèrent correctement, une dépense ponctuelle ne se reproduit pas.
- Planification (filtres de période), Analyse, Épargne (poches, transfert, suppression), Objectifs (création, suppression), Ma stratégie (réglage, scénarios, simulateur).
- Export puis import du fichier exporté sur un profil vierge : les données sont bien restaurées.
- Import d'un fichier JSON invalide : refusé proprement, aucune donnée existante modifiée.
- Migration automatique depuis une ancienne structure `budgetV2` : aucune erreur, sauvegarde créée une seule fois (pas de doublon à chaque rechargement).
- Rechargement de page après chaque action : les données persistent.
- Vérification visuelle (captures d'écran) sur mobile (390px) et desktop (1280px, conteneur centré ~480px).

## Ce qu'il reste raisonnable de vérifier en conditions réelles
- Test sur les navigateurs mentionnés (Edge, Safari iPhone, Chrome Android) directement sur l'URL GitHub Pages une fois la PR mergée.
- Relecture des données réelles de production après migration (recommandé : exporter une sauvegarde JSON manuelle avant la première ouverture de cette version, en plus des sauvegardes automatiques créées par l'application elle-même).
