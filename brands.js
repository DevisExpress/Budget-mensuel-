/* ============================================================================
   Budget Orion — Registre de marques (reconnaissance automatique)
   Objectif : nom saisi -> marque -> icône/logo -> catégorie suggérée.
   Système extensible : ajouter une entrée au tableau BRAND_RULES suffit.
   Ne bloque jamais la saisie : si rien ne correspond, un fallback générique
   basé sur la catégorie est utilisé (voir app.js: brandFor()).
   ========================================================================= */
(function (global) {
  'use strict';

  // Chaque règle : { test: regex appliquée au nom en minuscules (sans accents),
  //                  mark: glyphe/texte affiché dans le badge,
  //                  cls:  classe css pour la couleur/fond du badge,
  //                  label: nom affiché de la marque,
  //                  cat:  catégorie suggérée (peut être surchargée par l'utilisateur) }
  var BRAND_RULES = [
    { test: /\bnetflix\b/, mark: 'N', cls: 'brand-netflix', label: 'Netflix', cat: 'abonnements' },
    { test: /chatgpt|open ?ai/, mark: '✦', cls: 'brand-chatgpt', label: 'ChatGPT', cat: 'abonnements' },
    { test: /\bspotify\b/, mark: '●', cls: 'brand-spotify', label: 'Spotify', cat: 'abonnements' },
    { test: /\bprime video\b|\bamazon prime\b/, mark: 'P', cls: 'brand-amazon', label: 'Amazon Prime', cat: 'abonnements' },
    { test: /\bamazon\b/, mark: 'a', cls: 'brand-amazon', label: 'Amazon', cat: 'autres' },
    { test: /disney ?\+?|disneyplus/, mark: 'D+', cls: 'brand-disney', label: 'Disney+', cat: 'abonnements' },
    { test: /\byoutube\b/, mark: '▶', cls: 'brand-youtube', label: 'YouTube', cat: 'abonnements' },
    { test: /\bapple\b|icloud|itunes/, mark: '', cls: 'brand-apple', label: 'Apple', cat: 'abonnements' },
    { test: /\borange\b/, mark: 'O', cls: 'brand-orange', label: 'Orange', cat: 'abonnements' },
    { test: /\bfree\b|freebox/, mark: 'F', cls: 'brand-free', label: 'Free', cat: 'abonnements' },
    { test: /\bsfr\b/, mark: 'SFR', cls: 'brand-sfr', label: 'SFR', cat: 'abonnements' },
    { test: /bouygues/, mark: 'B', cls: 'brand-bouygues', label: 'Bouygues Telecom', cat: 'abonnements' },
    { test: /carrefour/, mark: '🛒', cls: 'brand-generic', label: 'Carrefour', cat: 'alimentation' },
    { test: /leclerc/, mark: 'E', cls: 'brand-generic', label: 'Leclerc', cat: 'alimentation' },
    { test: /\buber\b(?!.*eats)/, mark: '↗', cls: 'brand-uber', label: 'Uber', cat: 'transport' },
    { test: /uber ?eats|deliveroo|just ?eat/, mark: '🍔', cls: 'brand-generic', label: 'Livraison repas', cat: 'alimentation' },
    { test: /\bsncf\b|trainline/, mark: '🚆', cls: 'brand-generic', label: 'SNCF', cat: 'transport' },
    { test: /edf\b|engie|totalenergies/, mark: '⚡', cls: 'brand-generic', label: 'Énergie', cat: 'logement' },
    { test: /loyer|bailleur/, mark: '⌂', cls: 'brand-generic', label: 'Loyer', cat: 'logement' },
    { test: /banque|frais bancaire|carte bancaire/, mark: '€', cls: 'brand-bank', label: 'Banque', cat: 'autres' },
    { test: /assurance|maif|maaf|axa|macif|matmut/, mark: '◇', cls: 'brand-generic', label: 'Assurance', cat: 'assurances' },
    { test: /salle de sport|fitness|basic ?fit|onlyfit/, mark: '🏋', cls: 'brand-generic', label: 'Sport', cat: 'loisirs' },
    { test: /crèche|garderie|école|cantine/, mark: '🧒', cls: 'brand-generic', label: 'Enfants', cat: 'enfants' }
  ];

  // Icônes génériques par catégorie (fallback quand aucune marque n'est reconnue).
  var CATEGORY_ICONS = {
    logement: '⌂', alimentation: '◉', transport: '↗', loisirs: '☆', sante: '✚',
    abonnements: '∞', assurances: '◇', credits: '€', enfants: '♡', autres: '•'
  };

  function stripAccents(s) {
    try { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    catch (e) { return s; }
  }

  function identify(name, cat) {
    var n = stripAccents(String(name || '').toLowerCase());
    for (var i = 0; i < BRAND_RULES.length; i++) {
      if (BRAND_RULES[i].test.test(n)) {
        var r = BRAND_RULES[i];
        return { mark: r.mark, cls: r.cls, label: r.label, suggestedCat: r.cat, matched: true };
      }
    }
    var ic = CATEGORY_ICONS[cat] || CATEGORY_ICONS.autres;
    return { mark: ic, cls: 'brand-generic', label: null, suggestedCat: cat || 'autres', matched: false };
  }

  // Permet d'ajouter une marque à chaud (ex: depuis un futur écran de réglages).
  function addRule(rule) { if (rule && rule.test) BRAND_RULES.push(rule); }

  global.ORION_BRANDS = { identify: identify, addRule: addRule, rules: BRAND_RULES, categoryIcons: CATEGORY_ICONS };
})(window);
