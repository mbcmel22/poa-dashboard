/**
 * POA · Extraction quotidienne Meta (Instagram, Facebook, Meta Ads) vers l'onglet Flux_auto
 *
 * Où le coller : dans le Google Sheet "Tableau de bord KPI POA",
 *   Extensions > Apps Script > coller ce fichier > Enregistrer.
 *
 * Avant de lancer :
 *   1. Projet Apps Script > Paramètres du projet > Propriétés du script, ajoute :
 *        META_TOKEN    : jeton d'accès longue durée (utilisateur système Meta Business conseillé)
 *        IG_USER_ID    : identifiant du compte Instagram professionnel de @poa.food
 *        FB_PAGE_ID    : identifiant de la Page Facebook POA
 *        AD_ACCOUNT_ID : identifiant du compte publicitaire, sans "act_" (optionnel)
 *   2. Exécute une fois "testerConnexion" et accepte les autorisations.
 *   3. Exécute "installerDeclencheurQuotidien" : le script tournera chaque jour vers 7 h.
 *
 * Chaque exécution ajoute des lignes "Date | Code | Valeur | Source" pour la veille.
 * Les codes correspondent au catalogue du dashboard (page Sources & automatisation).
 *
 * À vérifier une fois en conditions réelles : les noms de métriques Meta évoluent
 * à chaque version de l'API. Mets GRAPH_VERSION à jour si Meta en déprécie une.
 */

const GRAPH_VERSION = 'v23.0';
const SHEET_NAME = 'Flux_auto';
const SOURCE = 'Apps Script Meta';

function extraireMetaQuotidien() {
  const p = PropertiesService.getScriptProperties().getProperties();
  if (!p.META_TOKEN) throw new Error('Propriété META_TOKEN manquante');

  const hier = new Date(); hier.setDate(hier.getDate() - 1);
  const jour = Utilities.formatDate(hier, 'Europe/Paris', 'yyyy-MM-dd');
  const debut = Math.floor(new Date(jour + 'T00:00:00').getTime() / 1000);
  const fin = debut + 86400;
  const lignes = [];
  const ajouter = (code, valeur) => { if (valeur !== null && valeur !== undefined && !isNaN(valeur)) lignes.push([jour, code, valeur, SOURCE]); };

  // ---- Instagram : abonnés (champ du compte, disponible même sous 100 abonnés)
  if (p.IG_USER_ID) {
    const ig = graph_(p.IG_USER_ID, { fields: 'followers_count,media_count' }, p.META_TOKEN);
    ajouter('ig_abonnes', ig.followers_count);

    // Interactions de la veille (likes, commentaires, enregistrements, partages, réponses)
    const ins = graph_(p.IG_USER_ID + '/insights',
      { metric: 'total_interactions', metric_type: 'total_value', period: 'day', since: debut, until: fin }, p.META_TOKEN, true);
    const tv = ins && ins.data && ins.data[0] && ins.data[0].total_value;
    ajouter('ig_interactions', tv ? tv.value : 0);

    // Vues, visites du profil et clics sur le lien de la veille (une requête par métrique : si Meta en retire une, les autres continuent)
    [['views', 'ig_vues'], ['profile_views', 'ig_visites_profil'], ['profile_links_taps', 'ig_clics_lien']].forEach(([metric, code]) => {
      const r = graph_(p.IG_USER_ID + '/insights', { metric: metric, metric_type: 'total_value', period: 'day', since: debut, until: fin }, p.META_TOKEN, true);
      const t = r && r.data && r.data[0] && r.data[0].total_value;
      if (t) ajouter(code, t.value);
    });

    // Publications de la veille (posts du fil ; les stories ne sont visibles que 24 h)
    const media = graph_(p.IG_USER_ID + '/media', { fields: 'timestamp', limit: 50 }, p.META_TOKEN, true);
    const nb = ((media && media.data) || []).filter(m => m.timestamp && m.timestamp.slice(0, 10) === jour).length;
    ajouter('ig_publications', nb);
  }

  // ---- Facebook : abonnés de la Page
  if (p.FB_PAGE_ID) {
    const page = graph_(p.FB_PAGE_ID, { fields: 'followers_count,fan_count' }, p.META_TOKEN, true);
    if (page) ajouter('fb_abonnes', page.followers_count != null ? page.followers_count : page.fan_count);
  }

  // ---- Meta Ads : impressions et taux de clics de la veille
  if (p.AD_ACCOUNT_ID) {
    const ads = graph_('act_' + p.AD_ACCOUNT_ID + '/insights',
      { fields: 'impressions,clicks,ctr,spend', time_range: JSON.stringify({ since: jour, until: jour }) }, p.META_TOKEN, true);
    const row = ads && ads.data && ads.data[0];
    if (row) {
      ajouter('meta_impressions', Number(row.impressions));
      ajouter('meta_ctr', Number(row.ctr) / 100); // Meta renvoie un pourcentage (ex. 3.4)
    }
  }

  if (lignes.length) feuille_().getRange(feuille_().getLastRow() + 1, 1, lignes.length, 4).setValues(lignes);
  Logger.log(lignes.length + ' lignes ajoutées pour le ' + jour);
}

/* ---------- Outils ---------- */
function graph_(chemin, params, token, tolerant) {
  params.access_token = token;
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const url = 'https://graph.facebook.com/' + GRAPH_VERSION + '/' + chemin + '?' + qs;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(res.getContentText());
  if (json.error) {
    Logger.log('Erreur Meta sur ' + chemin + ' : ' + json.error.message);
    if (!tolerant) throw new Error(json.error.message);
    return null;
  }
  return json;
}

function feuille_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['Date', 'Code', 'Valeur', 'Source']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function testerConnexion() {
  const p = PropertiesService.getScriptProperties().getProperties();
  if (p.IG_USER_ID) Logger.log(JSON.stringify(graph_(p.IG_USER_ID, { fields: 'username,followers_count' }, p.META_TOKEN)));
  if (p.FB_PAGE_ID) Logger.log(JSON.stringify(graph_(p.FB_PAGE_ID, { fields: 'name,followers_count' }, p.META_TOKEN, true)));
  feuille_();
  Logger.log('Onglet ' + SHEET_NAME + ' prêt.');
}

function installerDeclencheurQuotidien() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'extraireMetaQuotidien')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('extraireMetaQuotidien').timeBased().everyDays(1).atHour(7).inTimezone('Europe/Paris').create();
  Logger.log('Déclencheur quotidien installé (vers 7 h).');
}
