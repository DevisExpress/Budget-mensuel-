# Budget Orion — V7 consolidation événements & alertes

- Anniversaires avec budget : création/synchronisation automatique d'une dépense dans le mois concerné.
- Événements/fêtes avec montant : création/synchronisation automatique d'une dépense liée.
- Liaison idempotente via `sourceEventId` / `sourceOccurrenceDate` : aucun doublon au rechargement.
- Une dépense liée déjà payée est conservée comme historique réel si l'événement source est déplacé/supprimé.
- Emojis/icônes des anniversaires et événements rétablis dans Accueil > À venir et Planification.
- Alertes de dépenses 1–2 jours avant, avec texte contextuel et estimation de solde.
- Centre d'alertes accessible via la cloche et Plus > Alertes de dépenses.
- PWA : manifest, service worker, icônes et cache réseau-first pour une meilleure expérience installée.

## Limite technique des notifications web
Sur iPhone, les notifications web sont les plus fiables quand Budget Orion est ajouté à l'écran d'accueil et que l'autorisation est accordée. Sans serveur push, une web app GitHub Pages ne peut pas garantir une alerte à heure fixe si elle n'est jamais ouverte ; Budget Orion vérifie les alertes à l'ouverture, au retour au premier plan et pendant une session active.
