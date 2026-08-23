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

---

# V6.1 — Refonte complète de l'écran « Ma stratégie »

## 1. Moteur financier centralisé
Toute la logique de projection a été regroupée dans une seule fonction, **`financeEngine(capital0, monthly, ratePct, horizonYears)`**, qui est l'unique source de vérité utilisée par : le graphique « Évolution de ton capital », le graphique « Projection détaillée », le point de bascule, le point d'accélération, les 3 scénarios (Prudent/Central/Dynamique), le simulateur « Et si ? » et le tableau des repères clés. Aucun autre calcul de capital n'existe ailleurs sur cet écran — impossible d'avoir deux composants qui se contredisent.

- **Taux mensuel dérivé du taux annuel** : `tauxMensuel = (1 + tauxAnnuel)^(1/12) - 1` (conversion exacte, pas une division par 12).
- **Capitalisation mensuelle** : chaque mois, `capital = capital × (1 + tauxMensuel) + versementMensuel` — le versement est ajouté **après** application des intérêts du mois (convention « versement en fin de mois »), documentée en commentaire dans le code.
- **Point de bascule** : premier mois où `capital × tauxAnnuel ≥ versementMensuel × 12`, détecté par une vraie simulation mois par mois (jusqu'à 100 ans si besoin), pas par une simple division. La division simple (`versementAnnuel / taux`) est conservée uniquement comme repère théorique secondaire, clairement étiqueté « Capital nécessaire (théorique) ».
- **Point d'accélération** : premier mois où `capital × tauxAnnuel ≥ 2 × versementMensuel × 12`, même méthode de simulation réelle.
- Calculs vérifiés indépendamment (script Python reproduisant la même formule) : pour capital initial 0 €, versement 300 €/mois, rendement 7 %, horizon 20 ans → capital final 152 260,91 € (72 000 € versés + 80 260,91 € d'intérêts), point de bascule à 10 ans et 1 mois, point d'accélération à 16 ans. Résultats identiques entre le moteur JS et le script de contrôle indépendant.

## 2. Nouvel écran « Ma stratégie » (fidèle à la maquette de référence)
Reconstruit dans l'ordre exact demandé : point de bascule (avec jauge semi-circulaire), paramètres (« Vue rapide » éditable), « Ton argent travaille pour toi » (€/an, €/mois, €/jour) + « Ton capital travaille à X % de ton effort annuel » + « Taux de liberté financière » (calculé à partir des vraies dépenses annuelles de Budget Orion), graphique « Évolution de ton capital » (onglets Capital total/Intérêts cumulés/Versements, projections 5/10/15/20/30 ans), point d'accélération (jauge semi-circulaire), comparaison des 3 scénarios (jauges circulaires + montants), simulateur « Et si ? » (curseur de versement mensuel, recalcul instantané sans rechargement), projection détaillée (grand graphique avec info-bulle tactile), tableau des repères clés (Année/Capital/Intérêts/Versements), et un bloc « Informations importantes » avec les avertissements réglementaires demandés (rendements non garantis, performances passées, risque de perte, effet de l'inflation non intégré aux projections).
- Sur mobile, les blocs s'empilent exactement dans l'ordre demandé (vérifié par capture d'écran à 390 px).
- Sur PC/tablette (≥ 860 px), les cartes qui s'y prêtent (point de bascule + paramètres, repères clés) passent en 2 colonnes ; les graphiques et jauges restent pleine largeur pour la lisibilité. Cette largeur élargie (`--strategy-wide`) ne s'applique **qu'à** l'écran Ma stratégie ; toutes les autres pages restent inchangées (~480 px).
- Capital, versement, rendement et horizon sont éditables via `strategyForm` (bouton « Modifier mes paramètres », et via les zones cliquables identifiées par `data-explain`) ; les 3 taux de scénario (Prudent/Central/Dynamique) sont également personnalisables. Toute modification recalcule immédiatement l'écran entier et est sauvegardée dans `extra.strategy` (persistant après rechargement).
- Design conforme à la référence : fond très clair, vert Budget Orion, cartes blanches à bords fins et ombres très subtiles, aucune trace de thème sombre sur cet écran.

## 3. Corrections de bugs découverts pendant les tests de cette version
- **Jauges invisibles / mise en page instable** : le HTML généré par `semiGauge()` utilisait des classes CSS (`gauge-arc`, `gauge-arc-bg`) qui ne correspondaient à aucune règle du fichier CSS (qui définit `.gauge-fill`). Résultat : la jauge s'affichait avec une hauteur nulle, ce qui faisait remonter l'étiquette centrale (`margin-top:-38%`) par-dessus le contenu au-dessus d'elle — rendant certains éléments du haut de l'écran temporairement inaccessibles au clic/tactile. Corrigé en alignant `semiGauge()` sur les classes réellement stylées (`.gauge-fill`) et en passant la couleur et le pourcentage via les variables CSS attendues (`--gcolor`, `--pct`).
- **Position de défilement non réinitialisée lors du changement d'écran** : naviguer vers un nouvel écran (par exemple depuis un lien à l'intérieur de la page « Plus », plus longue que l'écran) conservait la position de défilement de l'écran précédent. Sur un écran plus long comme « Ma stratégie », cela pouvait laisser l'utilisateur au milieu du contenu, avec l'en-tête collant (`position:sticky`) recouvrant des éléments qui semblaient alors « bloqués ». Corrigé : `render()` remet le défilement en haut de page uniquement lors d'un réel changement d'écran (pas lors d'un rafraîchissement de la même page, pour ne pas perturber la navigation par mois/année).

## 4. Tests réellement effectués pour cette version
Navigateur headless (Playwright), mêmes conditions que la V6 :
- Modification de capital, versement mensuel, rendement annuel et horizon de projection : recalcul immédiat vérifié sur l'ensemble de l'écran (point de bascule, point d'accélération, graphiques, scénarios, tableau).
- Les 3 scénarios rapides (Prudent 5 %, Central 7 %, Dynamique 10 %) et la personnalisation de leurs taux : valeurs cohérentes entre elles et avec le moteur, persistées après rechargement.
- Changement d'onglet du graphique « Évolution de ton capital » (Capital total / Intérêts cumulés / Versements) et de l'onglet « Projection détaillée » (Prudent/Central/Dynamique) : contenu bien mis à jour.
- Point de bascule et point d'accélération : dates et jauges vérifiées par un calcul indépendant (voir section 1).
- Simulateur « Et si ? » (curseur de versement mensuel) : recalcul en direct, sans rechargement de page, de l'impact sur le point de bascule, le capital à l'horizon et les intérêts supplémentaires.
- Info-bulle tactile/souris sur les deux graphiques (survol et changement d'année).
- Explications au tap sur « point de bascule », « point d'accélération » et « taux de liberté financière » (ouverture d'une fiche explicative).
- Changement de mois/année pendant que l'écran Ma stratégie est ouvert : aucune donnée ni calcul de stratégie affecté.
- Rechargement de page après modification des paramètres : capital, versement, rendement, horizon et les 3 taux de scénario personnalisés sont bien conservés.
- Vérification mobile (390 px, ordre d'empilement des 9 blocs conforme à la demande) et desktop (1280 px et 1400 px, mise en page élargie en plusieurs colonnes uniquement sur cet écran, ~480 px inchangé partout ailleurs).
- Absence d'erreur console/page sur l'ensemble des scénarios ci-dessus.
- Non-régression : ré-exécution de l'intégralité des tests V6 (Accueil, Dépenses avec les 3 portées de modification/suppression, Planification, Analyse, Épargne, Objectifs, sauvegardes/migration, import/export) — tous verts, aucun impact de cette évolution sur le reste de l'application.

## Ce qu'il reste raisonnable de vérifier en conditions réelles (V6.1)
- Test sur de vraies données de production (montants, devises, historique long) pour confirmer la lisibilité des grands nombres dans les jauges et le tableau des repères sur des écrans très petits (< 360 px).
- Test tactile réel sur téléphone (le survol/tap du graphique a été validé en émulation Playwright, un test manuel sur iPhone/Android est recommandé).
- Relecture juridique/marketing du texte des avertissements (« Informations importantes ») si l'application venait à être partagée publiquement au-delà d'un usage personnel.
