/* ============================================================
   CONFIG.JS : réglages du tableau de bord POA
   ============================================================

   1. Ouvre le Google Sheet "Tableau de bord KPI POA".
   2. Fichier > Partager > Publier sur le web.
   3. Onglet "Lien" : choisis l'onglet "POA", format
      "Valeurs séparées par des virgules (.csv)", puis Publier.
   4. Colle l'URL obtenue dans SHEET_POA_CSV ci-dessous,
      entre apostrophes simples.
   5. (Plus tard) fais de même avec l'onglet "Flux_auto" alimenté
      par l'automatisation, et colle l'URL dans SHEET_FLUX_AUTO_CSV.
   6. Enregistre, puis redéploie sur Vercel (ou git push).

   Tant que les URLs sont à null, le site tourne en MODE DÉMO avec
   les dernières valeurs connues du Sheet.
   ============================================================ */

const CONFIG = {
  // URL CSV de l'onglet "POA" (saisie manuelle mensuelle)
  SHEET_POA_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4m7HEuHmqlPy2hNxaKrCbwQaP8_d9vUsBXJtcZaPUZxSreC3c92HMdV-ojXd7M_NHR06DwOSd5cKa/pub?gid=591477432&single=true&output=csv',

  // URL CSV de l'onglet "Flux_auto" (lignes ajoutées par l'automatisation)
  // Laisse null tant que l'automatisation n'est pas en place.
  SHEET_FLUX_AUTO_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4m7HEuHmqlPy2hNxaKrCbwQaP8_d9vUsBXJtcZaPUZxSreC3c92HMdV-ojXd7M_NHR06DwOSd5cKa/pub?gid=276008607&single=true&output=csv',

  // URL CSV des onglets "Audience" (répartitions) et "Contenus" (statistiques par publication)
  // Laisse null tant qu'ils ne sont pas publiés.
  SHEET_AUDIENCE_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4m7HEuHmqlPy2hNxaKrCbwQaP8_d9vUsBXJtcZaPUZxSreC3c92HMdV-ojXd7M_NHR06DwOSd5cKa/pub?gid=92194363&single=true&output=csv',
  SHEET_CONTENUS_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4m7HEuHmqlPy2hNxaKrCbwQaP8_d9vUsBXJtcZaPUZxSreC3c92HMdV-ojXd7M_NHR06DwOSd5cKa/pub?gid=1323977159&single=true&output=csv',

  // URL de l'application Web du script Apps Script (se termine par /exec) : notes et décisions partagées.
  // Laisse null pour masquer les commentaires.
  COMMENTS_API: 'https://script.google.com/macros/s/AKfycby5SYW0AF58P-_LhDaElBG1xg5I4tZoUEgiBQmjOtE8AVC5FmwvpDkrpyVCw1eAoxc/exec',

  // Année des colonnes Janvier à Décembre de l'onglet POA
  ANNEE: 2026,

  // Prix de l'abonnement annuel (sert au calcul des gains Meta Ads)
  PRIX_ABONNEMENT: 50,

  // Rafraîchissement automatique de la page, en minutes (0 = désactivé)
  AUTO_REFRESH_MINUTES: 0,

  // Objectifs business affichés sur la vue d'ensemble
  // sens : "max" = la valeur doit rester sous la cible, "min" = au-dessus
  OBJECTIFS: [
    { code: 'churn',   label: 'Churn mensuel', cible: 0.06, sens: 'max', format: 'pct' },
    { code: 'nps',     label: 'NPS',           cible: 40,   sens: 'min', format: 'num' },
    { code: 'ltv_cac', label: 'Ratio LTV / CAC', cible: 3,  sens: 'min', format: 'ratio' },
  ],
};
