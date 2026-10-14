/**
 * ==========================================================================
 *  POA · Extraction automatique Meta (Instagram, Facebook, Meta Ads) et TikTok
 *  vers l'onglet Flux_auto du Google Sheet "Tableau de bord KPI POA"
 * ==========================================================================
 *
 *  OÙ LE COLLER
 *    Google Sheet > Extensions > Apps Script > remplace le contenu de Code.gs
 *    par ce fichier > Enregistrer. (Supprime l'ancien apps-script-meta.gs.)
 *
 *  IDENTIFIANTS (jamais dans le code)
 *    Apps Script > Paramètres du projet (roue dentée) > Propriétés du script :
 *      META_TOKEN       jeton de l'utilisateur système Meta (n'expire pas)
 *      IG_USER_ID       identifiant du compte Instagram pro      } donnés par
 *      FB_PAGE_ID       identifiant de la Page Facebook          } trouverMesIdentifiants
 *      AD_ACCOUNT_ID    compte publicitaire, sans "act_"         } (optionnel)
 *      TT_APP_ID        TikTok for Business : App ID              } optionnel,
 *      TT_SECRET        TikTok for Business : Secret              } voir le guide
 *    Les jetons TikTok (accès, rafraîchissement) sont enregistrés tout seuls.
 *
 *  ORDRE DE LANCEMENT (menu déroulant en haut de l'éditeur, puis Exécuter)
 *    1. trouverMesIdentifiants   liste tes Pages, comptes Instagram et pubs
 *    2. testerConnexion          vérifie chaque source et chaque métrique
 *    3. rattraperHistorique      remplit l'historique (depuis le 1er juillet par défaut)
 *    4. installerDeclencheurs    extraction chaque jour vers 7 h + stories toutes les 6 h
 *
 *  CE QUE FAIT L'EXTRACTION QUOTIDIENNE
 *    Relit les 3 derniers jours (Meta corrige ses chiffres jusqu'à 48 h après)
 *    et met à jour les lignes existantes au lieu de créer des doublons.
 *    Chaque exécution est notée dans l'onglet Journal_auto ; en cas d'erreur,
 *    un e-mail part vers le propriétaire du script (une fois par jour au plus).
 *
 *  AUTO-RÉPARATION
 *    Meta retire régulièrement des métriques. Si une métrique est refusée,
 *    le script la met de côté, continue avec les autres et le note au journal.
 * ==========================================================================
 */

const AUTO = {
  FUSEAU: 'Europe/Paris',
  GRAPH: 'v25.0',                          // version de l'API Meta (v25 : février 2026)
  TIKTOK_API: 'https://business-api.tiktok.com/open_api/v1.3',
  FEUILLE: 'Flux_auto',
  JOURNAL: 'Journal_auto',
  STORIES: '_stories',                      // onglet technique : stories vues passer
  JOURS_RELECTURE: 3,                       // la veille + 2 jours de correction
  HISTORIQUE_DEPUIS: '2026-07-01',          // début du rattrapage (toujours un 1er du mois)
  DOSSIER_IMPORT_TIKTOK: 'POA - Import TikTok', // plan B : exports TikTok Studio déposés ici
  ALERTE_EMAIL: true,
};

/* Métriques demandées à chaque plateforme -> code du dashboard.
   Une métrique refusée par l'API est mise de côté automatiquement. */
const IG_METRIQUES = {          // GET /{ig-user}/insights, metric_type=total_value, period=day
  views: 'ig_vues',
  total_interactions: 'ig_interactions',
  profile_links_taps: 'ig_clics_lien',
  profile_views: 'ig_visites_profil',   // absente de la doc actuelle : gardée si l'API l'accepte encore
};
const FB_METRIQUES = {          // GET /{page}/insights, period=day (série par jour)
  page_media_view: 'fb_vues',
  page_post_engagements: 'fb_interactions',
  page_views_total: 'fb_visites_profil',
  page_total_actions: 'fb_clics_lien',
  page_daily_follows_unique: 'fb_nouveaux',
};
const TT_CHAMPS = ['followers_count', 'profile_views', 'video_views', 'likes', 'comments', 'shares', 'bio_link_clicks'];
const TT_CHAMPS_MINIMUM = ['followers_count', 'profile_views', 'video_views', 'likes', 'comments', 'shares'];

const SOURCES = { meta: 'Meta API', tiktok: 'TikTok API', export: 'TikTok Studio (export)', calcul: 'Calcul (écart abonnés)' };

/* ==========================================================================
   1. FONCTIONS À LANCER
   ========================================================================== */

/** Liste les Pages, comptes Instagram et comptes publicitaires visibles avec META_TOKEN. */
function trouverMesIdentifiants() {
  const moi = graph_('me', { fields: 'id,name' });
  if (moi.error) throw new Error('META_TOKEN refusé : ' + moi.error.message);
  Logger.log('Jeton valide pour : ' + moi.name + ' (' + moi.id + ')');

  const pages = graph_('me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: 50 });
  if (pages.error) Logger.log('Pages : ' + pages.error.message);
  (pages.data || []).forEach(p => {
    Logger.log('PAGE  ' + p.name + '  ->  FB_PAGE_ID = ' + p.id);
    if (p.instagram_business_account) Logger.log('      Instagram @' + p.instagram_business_account.username + '  ->  IG_USER_ID = ' + p.instagram_business_account.id);
    else Logger.log('      (aucun compte Instagram pro relié à cette Page)');
  });
  if (!(pages.data || []).length) Logger.log('Aucune Page : vérifie que la Page est bien assignée à l\'utilisateur système.');

  const ads = graph_('me/adaccounts', { fields: 'account_id,name,account_status', limit: 50 });
  (ads.data || []).forEach(a => Logger.log('PUB   ' + a.name + '  ->  AD_ACCOUNT_ID = ' + a.account_id));
  if (ads.error) Logger.log('Comptes publicitaires : ' + ads.error.message);
}

/** Vérifie chaque source et chaque métrique, sans rien écrire dans Flux_auto. */
function testerConnexion() {
  const p = props_();
  const hier = jour_(-1);
  feuille_(AUTO.FEUILLE, ['Date', 'Code', 'Valeur', 'Source']);
  feuille_(AUTO.JOURNAL, ['Horodatage', 'Action', 'Statut', 'Lignes', 'Détail']);
  effacerMetriquesRefusees_();

  if (p.META_TOKEN) {
    if (p.IG_USER_ID) {
      const ig = graph_(p.IG_USER_ID, { fields: 'username,followers_count,media_count' });
      Logger.log(ig.error ? 'Instagram : ' + ig.error.message : 'Instagram @' + ig.username + ' : ' + ig.followers_count + ' abonnés, ' + ig.media_count + ' publications');
      Logger.log('  Métriques du ' + hier + ' : ' + JSON.stringify(lignesInstagramJour_(hier, p).map(l => l[1] + '=' + l[2])));
    } else Logger.log('Instagram : IG_USER_ID manquant');
    if (p.FB_PAGE_ID) {
      const fb = graph_(p.FB_PAGE_ID, { fields: 'name,followers_count', access_token: jetonPage_() });
      Logger.log(fb.error ? 'Facebook : ' + fb.error.message : 'Facebook ' + fb.name + ' : ' + fb.followers_count + ' abonnés');
      Logger.log('  Métriques du ' + hier + ' : ' + JSON.stringify(lignesFacebook_(hier, hier, p).map(l => l[0] + ' ' + l[1] + '=' + l[2])));
    } else Logger.log('Facebook : FB_PAGE_ID manquant');
    if (p.AD_ACCOUNT_ID) Logger.log('Meta Ads (7 derniers jours) : ' + JSON.stringify(lignesMetaAds_(jour_(-7), hier, p).map(l => l[0] + ' ' + l[1] + '=' + l[2])));
  } else Logger.log('Meta : META_TOKEN manquant');

  const refusees = metriquesRefusees_();
  if (Object.keys(refusees).length) Logger.log('Métriques refusées par l\'API (mises de côté) : ' + JSON.stringify(refusees));

  if (p.TT_REFRESH_TOKEN || p.TT_ACCESS_TOKEN) {
    let r = tiktokCompte_(jour_(-7), hier, TT_CHAMPS);
    if (r.code !== 0) { Logger.log('TikTok : champ optionnel refusé (' + r.message + '), essai avec les champs de base.'); r = tiktokCompte_(jour_(-7), hier, TT_CHAMPS_MINIMUM); }
    Logger.log('TikTok (réponse brute, à comparer avec TikTok Studio) : ' + JSON.stringify(r).slice(0, 1500));
  } else Logger.log('TikTok API : pas encore autorisée (voir le guide, ou utilise le dossier ' + AUTO.DOSSIER_IMPORT_TIKTOK + ').');

  Logger.log('Exports TikTok en attente dans Drive : ' + fichiersImportTikTok_().length);
}

/** Extraction quotidienne : à brancher sur le déclencheur de 7 h. */
function extraireTout() {
  executer_('Extraction quotidienne', () => {
    const p = props_();
    const fin = jour_(-1), debut = jour_(-AUTO.JOURS_RELECTURE);
    let lignes = [];
    const etapes = [], erreurs = [];
    // Une plateforme en panne n'empêche pas les autres d'être relevées
    const etape = (nom, fn) => {
      try { const l = fn() || []; lignes = lignes.concat(l); etapes.push(nom + ' ' + l.length); }
      catch (e) { etapes.push(nom + ' en erreur'); erreurs.push(nom + ' : ' + e.message); }
    };

    if (p.META_TOKEN && p.IG_USER_ID) {
      etape('Instagram', () => {
        releverStories_(p);
        let l = [];
        jours_(debut, fin).forEach(d => { l = l.concat(lignesInstagramJour_(d, p)); });
        l = l.concat(lignesPublicationsInstagram_(debut, fin, p));
        const ig = graph_(p.IG_USER_ID, { fields: 'followers_count' });
        if (!ig.error) l.push([fin, 'ig_abonnes', ig.followers_count, SOURCES.meta]);
        return l;
      });
    }
    if (p.META_TOKEN && p.FB_PAGE_ID) {
      etape('Facebook', () => {
        const l = lignesFacebook_(debut, fin, p).concat(lignesPublicationsFacebook_(debut, fin, p));
        const fb = graph_(p.FB_PAGE_ID, { fields: 'followers_count', access_token: jetonPage_() });
        if (!fb.error && fb.followers_count != null) l.push([fin, 'fb_abonnes', fb.followers_count, SOURCES.meta]);
        return l;
      });
    }
    if (p.META_TOKEN && p.AD_ACCOUNT_ID) etape('Meta Ads', () => lignesMetaAds_(debut, fin, p));
    if (p.TT_REFRESH_TOKEN || p.TT_ACCESS_TOKEN) etape('TikTok API', () => lignesTikTokApi_(debut, fin, p));
    etape('Import TikTok', () => importerExportsTikTok_());

    const n = ecrire_(lignes);
    const n2 = ecrire_(lignesNouveauxCalcules_());
    if (erreurs.length) throw new Error(erreurs.join(' | ') + ' (lignes écrites quand même : ' + (n + n2) + ' · ' + etapes.join(' · ') + ')');
    return { lignes: n + n2, detail: etapes.join(' · ') };
  });
}

/** Remplit l'historique depuis AUTO.HISTORIQUE_DEPUIS (relançable sans risque de doublon). */
function rattraperHistorique() {
  executer_('Rattrapage historique', () => {
    supprimerDeclencheurs_('rattraperHistorique'); // nettoie une éventuelle relance programmée
    const p = props_();
    const debut = AUTO.HISTORIQUE_DEPUIS, fin = jour_(-1);
    const t0 = Date.now();
    let lignes = [];
    const etapes = [];

    if (p.META_TOKEN && p.IG_USER_ID) {
      // Instagram : une requête par jour, envoyées par paquets en parallèle
      const curseur = PropertiesService.getScriptProperties().getProperty('HISTO_IG_CURSEUR') || debut;
      const jours = jours_(curseur, fin);
      let fait = 0;
      for (let i = 0; i < jours.length; i += 20) {
        if (Date.now() - t0 > 4 * 60 * 1000) break; // garde une marge sous la limite de 6 min
        lignes = lignes.concat(lignesInstagramJours_(jours.slice(i, i + 20), p));
        fait = Math.min(i + 20, jours.length);
      }
      if (fait < jours.length) {
        PropertiesService.getScriptProperties().setProperty('HISTO_IG_CURSEUR', jours[fait]);
        relancerDansUneMinute_('rattraperHistorique');
        etapes.push('Instagram jusqu\'au ' + jours[fait - 1] + ' (suite programmée)');
      } else {
        PropertiesService.getScriptProperties().deleteProperty('HISTO_IG_CURSEUR');
        lignes = lignes.concat(lignesPublicationsInstagram_(curseur, fin, p));
        etapes.push('Instagram ' + jours.length + ' j');
      }
    }
    if (p.META_TOKEN && p.FB_PAGE_ID) {
      morceaux_(debut, fin, 89).forEach(([a, b]) => { lignes = lignes.concat(lignesFacebook_(a, b, p)); });
      lignes = lignes.concat(lignesPublicationsFacebook_(debut, fin, p));
      etapes.push('Facebook');
    }
    if (p.META_TOKEN && p.AD_ACCOUNT_ID) { lignes = lignes.concat(lignesMetaAds_(debut, fin, p)); etapes.push('Meta Ads'); }
    if (p.TT_REFRESH_TOKEN || p.TT_ACCESS_TOKEN) {
      const debutTt = jour_(-59) > debut ? jour_(-59) : debut; // TikTok ne remonte pas au-delà d'environ 60 jours
      lignes = lignes.concat(lignesTikTokApi_(debutTt, fin, p));
      etapes.push('TikTok depuis le ' + debutTt);
    }
    lignes = lignes.concat(importerExportsTikTok_());

    const n = ecrire_(lignes);
    const n2 = ecrire_(lignesNouveauxCalcules_());
    return { lignes: n + n2, detail: etapes.join(' · ') };
  });
}

/** Installe les déclencheurs : extraction chaque jour vers 7 h, stories toutes les 6 h. */
function installerDeclencheurs() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['extraireTout', 'releverStories', 'extraireMetaQuotidien'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('extraireTout').timeBased().everyDays(1).atHour(7).inTimezone(AUTO.FUSEAU).create();
  ScriptApp.newTrigger('releverStories').timeBased().everyHours(6).create();
  Logger.log('Déclencheurs installés : extraireTout chaque jour vers 7 h, releverStories toutes les 6 h.');
}

/** Les stories Instagram disparaissent de l'API après 24 h : on les note au passage. */
function releverStories() {
  const p = props_();
  if (p.META_TOKEN && p.IG_USER_ID) releverStories_(p);
}

/* ==========================================================================
   2. INSTAGRAM
   ========================================================================== */

function requeteInstagramJour_(jour, p, metriques) {
  return {
    chemin: p.IG_USER_ID + '/insights',
    params: { metric: metriques.join(','), metric_type: 'total_value', period: 'day', since: debutJourUnix_(jour), until: debutJourUnix_(jour_(1, jour)) },
  };
}

function lignesInstagramJour_(jour, p) { return lignesInstagramJours_([jour], p); }

function lignesInstagramJours_(jours, p) {
  const metriques = metriquesAcceptees_('ig', Object.keys(IG_METRIQUES));
  if (!metriques.length) return [];
  let reps = graphMany_(jours.map(j => requeteInstagramJour_(j, p, metriques)));
  // Une métrique refusée fait échouer toute la requête : on isole la fautive puis on recommence
  if (reps.some(r => estMetriqueInvalide_(r))) {
    sonderMetriques_('ig', metriques, m => graph_(requeteInstagramJour_(jours[0], p, [m]).chemin, requeteInstagramJour_(jours[0], p, [m]).params));
    const ok = metriquesAcceptees_('ig', Object.keys(IG_METRIQUES));
    if (!ok.length) return [];
    reps = graphMany_(jours.map(j => requeteInstagramJour_(j, p, ok)));
  }
  const lignes = [];
  reps.forEach((r, i) => {
    if (r.error) { journalErreurApi_('Instagram ' + jours[i], r.error); return; }
    (r.data || []).forEach(m => {
      const code = IG_METRIQUES[m.name];
      const v = m.total_value && m.total_value.value;
      if (code && v !== undefined && v !== null) lignes.push([jours[i], code, Number(v), SOURCES.meta]);
    });
  });
  return lignes;
}

/** Publications du fil (posts, carrousels, reels) + stories relevées, par jour. */
function lignesPublicationsInstagram_(debut, fin, p) {
  const parJour = {};
  jours_(debut, fin).forEach(d => { parJour[d] = 0; });
  let r = graph_(p.IG_USER_ID + '/media', { fields: 'id,timestamp,media_product_type', limit: 50 });
  let pages = 0;
  while (r && !r.error && pages++ < 20) {
    let plusAncien = null;
    (r.data || []).forEach(m => {
      const d = dateLocale_(m.timestamp);
      if (d in parJour) parJour[d]++;
      if (!plusAncien || d < plusAncien) plusAncien = d;
    });
    if (!r.paging || !r.paging.next || (plusAncien && plusAncien < debut)) break;
    r = graphUrl_(r.paging.next);
  }
  if (r && r.error) { journalErreurApi_('Instagram publications', r.error); return []; }
  const stories = storiesParJour_();
  return Object.keys(parJour).map(d => [d, 'ig_publications', parJour[d] + (stories[d] || 0), SOURCES.meta]);
}

function releverStories_(p) {
  const r = graph_(p.IG_USER_ID + '/stories', { fields: 'id,timestamp' });
  if (r.error) { journalErreurApi_('Instagram stories', r.error); return; }
  const sh = feuille_(AUTO.STORIES, ['id', 'date']);
  const deja = new Set(sh.getDataRange().getValues().slice(1).map(l => String(l[0])));
  const nouvelles = (r.data || []).filter(s => !deja.has(String(s.id))).map(s => [String(s.id), dateLocale_(s.timestamp)]);
  if (nouvelles.length) {
    sh.getRange(sh.getLastRow() + 1, 1, nouvelles.length, 2).setNumberFormat('@').setValues(nouvelles);
  }
}

function storiesParJour_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTO.STORIES);
  const out = {};
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(l => { const d = texteDate_(l[1]); if (d) out[d] = (out[d] || 0) + 1; });
  return out;
}

/* ==========================================================================
   3. FACEBOOK
   ========================================================================== */

let JETON_PAGE_CACHE = null;
function jetonPage_() {
  if (JETON_PAGE_CACHE) return JETON_PAGE_CACHE;
  const p = props_();
  const r = graph_(p.FB_PAGE_ID, { fields: 'access_token' });
  // Avec un utilisateur système, le jeton de Page s'obtient à partir du jeton principal
  JETON_PAGE_CACHE = (!r.error && r.access_token) ? r.access_token : p.META_TOKEN;
  return JETON_PAGE_CACHE;
}

function lignesFacebook_(debut, fin, p) {
  const tok = jetonPage_();
  const req = ms => ({ metric: ms.join(','), period: 'day', since: debut, until: jour_(1, fin), access_token: tok });
  let ms = metriquesAcceptees_('fb', Object.keys(FB_METRIQUES));
  if (!ms.length) return [];
  let r = graph_(p.FB_PAGE_ID + '/insights', req(ms));
  if (estMetriqueInvalide_(r)) {
    sonderMetriques_('fb', ms, m => graph_(p.FB_PAGE_ID + '/insights', req([m])));
    ms = metriquesAcceptees_('fb', Object.keys(FB_METRIQUES));
    if (!ms.length) return [];
    r = graph_(p.FB_PAGE_ID + '/insights', req(ms));
  }
  if (r.error) { journalErreurApi_('Facebook insights', r.error); return []; }
  const lignes = [];
  (r.data || []).forEach(m => {
    const code = FB_METRIQUES[m.name];
    if (!code || m.period !== 'day') return;
    (m.values || []).forEach(v => {
      // end_time = fin de la journée mesurée : la valeur appartient à la veille de end_time
      const d = jour_(-1, String(v.end_time).slice(0, 10));
      if (d >= debut && d <= fin && typeof v.value === 'number') lignes.push([d, code, v.value, SOURCES.meta]);
    });
  });
  return lignes;
}

function lignesPublicationsFacebook_(debut, fin, p) {
  const parJour = {};
  jours_(debut, fin).forEach(d => { parJour[d] = 0; });
  let r = graph_(p.FB_PAGE_ID + '/posts', { fields: 'created_time', since: debutJourUnix_(debut), until: debutJourUnix_(jour_(1, fin)), limit: 100, access_token: jetonPage_() });
  let pages = 0;
  while (r && !r.error && pages++ < 20) {
    (r.data || []).forEach(m => { const d = dateLocale_(m.created_time); if (d in parJour) parJour[d]++; });
    if (!r.paging || !r.paging.next) break;
    r = graphUrl_(r.paging.next);
  }
  if (r && r.error) { journalErreurApi_('Facebook publications', r.error); return []; }
  return Object.keys(parJour).map(d => [d, 'fb_publications', parJour[d], SOURCES.meta]);
}

/* ==========================================================================
   4. META ADS (niveau compte, par jour)
   ========================================================================== */

function lignesMetaAds_(debut, fin, p) {
  const lignes = [];
  let r = graph_('act_' + p.AD_ACCOUNT_ID + '/insights', {
    fields: 'spend,impressions,inline_link_clicks', level: 'account', time_increment: 1,
    time_range: JSON.stringify({ since: debut, until: fin }), limit: 100,
  });
  let pages = 0;
  while (r && !r.error && pages++ < 30) {
    (r.data || []).forEach(x => {
      const d = x.date_start;
      if (x.spend != null) lignes.push([d, 'meta_depense', Number(x.spend), SOURCES.meta]);
      if (x.impressions != null) lignes.push([d, 'meta_impressions', Number(x.impressions), SOURCES.meta]);
      if (x.inline_link_clicks != null) lignes.push([d, 'meta_clics', Number(x.inline_link_clicks), SOURCES.meta]);
    });
    if (!r.paging || !r.paging.next) break;
    r = graphUrl_(r.paging.next);
  }
  if (r && r.error) journalErreurApi_('Meta Ads', r.error);
  return lignes;
}

/* ==========================================================================
   5. TIKTOK : API (Accounts API de TikTok for Business)
   ========================================================================== */

/** Lien d'autorisation : à ouvrir une fois, connecté au compte TikTok de POA. */
function tiktokLienAutorisation() {
  const p = props_();
  if (!p.TT_APP_ID) throw new Error('Ajoute d\'abord TT_APP_ID et TT_SECRET dans les propriétés du script.');
  const url = ScriptApp.getService().getUrl();
  if (!url) throw new Error('Déploie d\'abord le script en application Web (voir le guide, étape TikTok 4).');
  Logger.log('1. URL de redirection à déclarer dans l\'app TikTok : ' + url);
  Logger.log('2. Copie le lien d\'autorisation affiché dans le portail TikTok for Business (page de ton app), puis ouvre-le connecté au compte TikTok de POA.');
  Logger.log('   Après validation, TikTok renvoie vers cette URL et le script enregistre les jetons tout seul.');
}

/** Retour d'autorisation TikTok (l'URL de l'application Web). */
function doGet(e) {
  const code = e && e.parameter && (e.parameter.code || e.parameter.auth_code);
  if (!code) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">POA · automatisation : aucun code TikTok reçu.</p>');
  const p = props_();
  const r = tiktokPost_('/tt_user/oauth2/token/', {
    client_id: p.TT_APP_ID, client_secret: p.TT_SECRET, grant_type: 'authorization_code',
    auth_code: code, redirect_uri: ScriptApp.getService().getUrl(),
  });
  if (r.code !== 0) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Échec TikTok : ' + escapeHtml_(r.message) + '</p>');
  enregistrerJetonsTikTok_(r.data);
  journal_('Autorisation TikTok', 'OK', 0, 'Compte relié : ' + (r.data.open_id || ''));
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">TikTok est relié au dashboard POA. Tu peux fermer cet onglet.</p>');
}

function enregistrerJetonsTikTok_(d) {
  const sp = PropertiesService.getScriptProperties();
  const maintenant = Date.now();
  sp.setProperties({
    TT_ACCESS_TOKEN: d.access_token,
    TT_ACCESS_EXPIRE: String(maintenant + (Number(d.expires_in) || 86400) * 1000),
    TT_REFRESH_TOKEN: d.refresh_token || sp.getProperty('TT_REFRESH_TOKEN') || '',
    TT_REFRESH_EXPIRE: String(maintenant + (Number(d.refresh_token_expires_in) || 365 * 86400) * 1000),
    TT_BUSINESS_ID: d.open_id || sp.getProperty('TT_BUSINESS_ID') || '',
  });
}

/** Jeton d'accès valide (valable 24 h, rafraîchi automatiquement). */
function jetonTikTok_() {
  const p = props_();
  if (p.TT_ACCESS_TOKEN && Number(p.TT_ACCESS_EXPIRE || 0) > Date.now() + 10 * 60 * 1000) return p.TT_ACCESS_TOKEN;
  if (!p.TT_REFRESH_TOKEN) throw new Error('TikTok : jeton expiré et aucun jeton de rafraîchissement. Relance l\'autorisation.');
  const r = tiktokPost_('/tt_user/oauth2/refresh_token/', {
    client_id: p.TT_APP_ID, client_secret: p.TT_SECRET, grant_type: 'refresh_token', refresh_token: p.TT_REFRESH_TOKEN,
  });
  if (r.code !== 0) throw new Error('TikTok : rafraîchissement refusé (' + r.message + '). Relance l\'autorisation.');
  enregistrerJetonsTikTok_(r.data);
  const resteJours = (Number(props_().TT_REFRESH_EXPIRE) - Date.now()) / 86400000;
  if (resteJours < 30) alerte_('TikTok : autorisation à renouveler', 'L\'autorisation TikTok expire dans ' + Math.round(resteJours) + ' jours. Relance tiktokLienAutorisation.');
  return r.data.access_token;
}

function tiktokCompte_(debut, fin, champs) {
  const p = props_();
  return tiktokGet_('/business/get/', { business_id: p.TT_BUSINESS_ID, start_date: debut, end_date: fin, fields: JSON.stringify(champs) });
}

function lignesTikTokApi_(debut, fin, p) {
  const lignes = [];
  morceaux_(debut, fin, 29).forEach(([a, b]) => {
    let r = tiktokCompte_(a, b, TT_CHAMPS);
    if (r.code !== 0) r = tiktokCompte_(a, b, TT_CHAMPS_MINIMUM); // un champ optionnel refusé : on se replie
    if (r.code !== 0) throw new Error('TikTok business/get : ' + r.message);
    const d = r.data || {};
    (d.metrics || []).forEach(m => {
      const jour = texteDate_(m.date);
      if (!jour) return;
      const num = k => (m[k] === undefined || m[k] === null || m[k] === '') ? null : Number(m[k]);
      const push = (code, v) => { if (v !== null && !isNaN(v)) lignes.push([jour, code, v, SOURCES.tiktok]); };
      push('tt_vues', num('video_views'));
      push('tt_visites_profil', num('profile_views'));
      push('tt_clics_lien', num('bio_link_clicks'));
      const inter = ['likes', 'comments', 'shares'].map(num);
      if (inter.some(v => v !== null)) push('tt_interactions', inter.reduce((s, v) => s + (v || 0), 0));
      push('tt_abonnes', num('followers_count')); // total d'abonnés en fin de journée
    });
    if (!(d.metrics || []).length && d.followers_count != null) lignes.push([b, 'tt_abonnes', Number(d.followers_count), SOURCES.tiktok]);
  });
  return lignes.concat(lignesPublicationsTikTok_(debut, fin, p));
}

function lignesPublicationsTikTok_(debut, fin, p) {
  const parJour = {};
  jours_(debut, fin).forEach(d => { parJour[d] = 0; });
  let curseur = null, pages = 0;
  while (pages++ < 20) {
    const params = { business_id: p.TT_BUSINESS_ID, fields: JSON.stringify(['item_id', 'create_time']), max_count: 20 };
    if (curseur) params.cursor = curseur;
    const r = tiktokGet_('/business/video/list/', params);
    if (r.code !== 0) { journal_('TikTok vidéos', 'Avertissement', 0, r.message); return []; }
    const vids = (r.data && r.data.videos) || [];
    let plusAncien = null;
    vids.forEach(v => {
      const d = dateLocale_(new Date(Number(v.create_time) * 1000).toISOString());
      if (d in parJour) parJour[d]++;
      if (!plusAncien || d < plusAncien) plusAncien = d;
    });
    if (!r.data || !r.data.has_more || (plusAncien && plusAncien < debut)) break;
    curseur = r.data.cursor;
  }
  return Object.keys(parJour).map(d => [d, 'tt_publications', parJour[d], SOURCES.tiktok]);
}

function tiktokGet_(chemin, params) {
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  return tiktokFetch_(AUTO.TIKTOK_API + chemin + '?' + qs, { method: 'get', headers: { 'Access-Token': jetonTikTok_() } });
}
function tiktokPost_(chemin, corps) {
  return tiktokFetch_(AUTO.TIKTOK_API + chemin, { method: 'post', contentType: 'application/json', payload: JSON.stringify(corps) });
}
function tiktokFetch_(url, opts) {
  opts.muteHttpExceptions = true;
  const res = UrlFetchApp.fetch(url, opts);
  try { return JSON.parse(res.getContentText()); }
  catch (e) { return { code: -1, message: 'Réponse illisible (HTTP ' + res.getResponseCode() + ')' }; }
}

/* ==========================================================================
   6. TIKTOK : PLAN B, exports TikTok Studio déposés dans Google Drive
   Dépose dans le dossier "POA - Import TikTok" les fichiers téléchargés depuis
   TikTok Studio > Statistiques > Télécharger les données (CSV, ou le .zip tel quel).
   Le script les lit, les verse dans Flux_auto et les range dans "Importés".
   ========================================================================== */

function fichiersImportTikTok_() {
  const it = DriveApp.getFoldersByName(AUTO.DOSSIER_IMPORT_TIKTOK);
  if (!it.hasNext()) return [];
  const dossier = it.next();
  const out = [];
  const fichiers = dossier.getFiles();
  while (fichiers.hasNext()) out.push(fichiers.next());
  return out.map(f => ({ fichier: f, dossier: dossier }));
}

function importerExportsTikTok_() {
  let lignes = [];
  fichiersImportTikTok_().forEach(({ fichier, dossier }) => {
    const nom = fichier.getName();
    let tables = [];
    try {
      const blob = fichier.getBlob();
      if (/\.zip$/i.test(nom)) tables = Utilities.unzip(blob).filter(b => /\.csv$/i.test(b.getName())).map(b => ({ nom: b.getName(), csv: b.getDataAsString('UTF-8') }));
      else if (/\.csv$/i.test(nom)) tables = [{ nom: nom, csv: blob.getDataAsString('UTF-8') }];
      else { journal_('Import TikTok', 'Ignoré', 0, nom + ' : exporte en CSV (ou dépose le .zip)'); return; }
      let l = [];
      tables.forEach(t => { l = l.concat(lignesDepuisExportTikTok_(t.csv)); });
      lignes = lignes.concat(l);
      ranger_(fichier, dossier);
      journal_('Import TikTok', 'OK', l.length, nom);
    } catch (e) {
      journal_('Import TikTok', 'Erreur', 0, nom + ' : ' + e.message);
    }
  });
  return lignes;
}

/** Lit un CSV TikTok Studio (Overview, FollowerHistory ou Content), en anglais ou en français. */
function lignesDepuisExportTikTok_(csv) {
  const rows = Utilities.parseCsv(String(csv).replace(/^﻿/, ''));
  if (rows.length < 2) return [];
  const h = rows[0].map(normaliser_);
  const col = (...motifs) => h.findIndex(x => motifs.some(m => m.test(x)));

  const cDatePub = col(/post time|date de publication|heure de publication|publie/);
  const cDate = cDatePub >= 0 ? -1 : col(/^date$|^jour$|^date\b/);
  const out = [];

  // Fichier "Content" : une ligne par vidéo -> nombre de publications par jour
  if (cDatePub >= 0) {
    const parJour = {};
    rows.slice(1).forEach(r => { const d = texteDate_(r[cDatePub]); if (d) parJour[d] = (parJour[d] || 0) + 1; });
    Object.keys(parJour).forEach(d => out.push([d, 'tt_publications', parJour[d], SOURCES.export]));
    return out;
  }
  if (cDate < 0) return [];

  const cVues = col(/video views|vues de(s)? video|vues video/);
  const cProfil = col(/profile views|vues du profil|visites du profil/);
  const cLikes = col(/^likes?$|j.aime/);
  const cComm = col(/^comments?$|commentaires?/);
  const cPart = col(/^shares?$|partages?/);
  const cDiff = col(/difference|nouveaux abonnes|abonnes gagnes|variation/);
  const cAbo = h.findIndex((x, i) => i !== cDiff && /^followers$|^abonnes$|nombre d.abonnes|total followers/.test(x));

  rows.slice(1).forEach(r => {
    const d = texteDate_(r[cDate]);
    if (!d) return;
    const n = c => { if (c < 0) return null; const v = Number(String(r[c]).replace(/\s/g, '').replace(',', '.')); return isNaN(v) ? null : v; };
    const add = (code, v) => { if (v !== null) out.push([d, code, v, SOURCES.export]); };
    add('tt_vues', n(cVues));
    add('tt_visites_profil', n(cProfil));
    const inter = [n(cLikes), n(cComm), n(cPart)];
    if (inter.some(v => v !== null)) add('tt_interactions', inter.reduce((s, v) => s + (v || 0), 0));
    add('tt_abonnes', n(cAbo));
    add('tt_nouveaux', n(cDiff));
  });
  return out;
}

function ranger_(fichier, dossier) {
  const it = dossier.getFoldersByName('Importés');
  const cible = it.hasNext() ? it.next() : dossier.createFolder('Importés');
  fichier.moveTo(cible);
}

/* ==========================================================================
   7. NOUVEAUX ABONNÉS CALCULÉS
   Sous 100 abonnés, Instagram ne fournit pas les abonnés gagnés par jour.
   On les déduit de l'écart entre deux relevés du total, jour après jour.
   ========================================================================== */

function lignesNouveauxCalcules_() {
  const sh = feuille_(AUTO.FEUILLE, ['Date', 'Code', 'Valeur', 'Source']);
  const vals = sh.getDataRange().getValues().slice(1);
  const stock = {}, existants = {};
  vals.forEach(([d, code, v, src]) => {
    const jour = texteDate_(d);
    if (!jour) return;
    const m = /^(ig|fb|tt)_(abonnes|nouveaux)$/.exec(String(code));
    if (!m) return;
    if (m[2] === 'abonnes') (stock[m[1]] ||= {})[jour] = Number(v);
    else if (src !== SOURCES.calcul) (existants[m[1]] ||= new Set()).add(jour);
  });
  const lignes = [];
  Object.keys(stock).forEach(net => {
    Object.keys(stock[net]).sort().forEach(jour => {
      const veille = jour_(-1, jour);
      if (stock[net][veille] === undefined) return;
      if (existants[net] && existants[net].has(jour)) return; // la plateforme fournit déjà le chiffre
      lignes.push([jour, net + '_nouveaux', stock[net][jour] - stock[net][veille], SOURCES.calcul]);
    });
  });
  return lignes;
}

/* ==========================================================================
   8. ÉCRITURE DANS FLUX_AUTO (mise à jour sans doublon)
   ========================================================================== */

/** lignes = [[date 'yyyy-MM-dd', code, valeur, source], ...]. Renvoie le nombre de lignes écrites. */
function ecrire_(lignes) {
  const propres = lignes.filter(l => l && l[0] && l[1] && l[2] !== null && l[2] !== undefined && !isNaN(l[2]));
  if (!propres.length) return 0;
  const sh = feuille_(AUTO.FEUILLE, ['Date', 'Code', 'Valeur', 'Source']);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sh.getDataRange().getValues();
    const entete = data.shift();
    const index = {};
    data.forEach((r, i) => { index[texteDate_(r[0]) + '|' + r[1]] = i; });
    propres.forEach(([d, code, v, src]) => {
      const cle = d + '|' + code;
      const ligne = [d, code, Math.round(Number(v) * 10000) / 10000, src];
      if (cle in index) data[index[cle]] = ligne;
      else { index[cle] = data.length; data.push(ligne); }
    });
    data.sort((a, b) => (texteDate_(a[0]) + a[1] < texteDate_(b[0]) + b[1] ? -1 : 1));
    data.forEach(r => { r[0] = texteDate_(r[0]); });
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 4).clearContent();
    sh.getRange(2, 1, data.length, 1).setNumberFormat('@');
    sh.getRange(1, 1, 1, 4).setValues([entete]);
    sh.getRange(2, 1, data.length, 4).setValues(data);
  } finally { lock.releaseLock(); }
  return propres.length;
}

/* ==========================================================================
   9. MÉTRIQUES REFUSÉES (auto-réparation)
   ========================================================================== */

function metriquesRefusees_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('METRIQUES_REFUSEES') || '{}'); }
  catch (e) { return {}; }
}
function metriquesAcceptees_(plateforme, toutes) {
  const ref = metriquesRefusees_()[plateforme] || [];
  return toutes.filter(m => !ref.includes(m));
}
function sonderMetriques_(plateforme, metriques, appel) {
  const ref = metriquesRefusees_();
  const liste = ref[plateforme] || [];
  metriques.forEach(m => {
    const r = appel(m);
    if (estMetriqueInvalide_(r) && !liste.includes(m)) {
      liste.push(m);
      journal_('Métrique ' + plateforme, 'Mise de côté', 0, m + ' : ' + r.error.message);
    }
  });
  ref[plateforme] = liste;
  PropertiesService.getScriptProperties().setProperty('METRIQUES_REFUSEES', JSON.stringify(ref));
}
function effacerMetriquesRefusees_() { PropertiesService.getScriptProperties().deleteProperty('METRIQUES_REFUSEES'); }
function estMetriqueInvalide_(r) {
  return !!(r && r.error && r.error.code === 100 && /metric/i.test(r.error.message || ''));
}

/* ==========================================================================
   10. OUTILS : API Meta, dates, feuilles, journal, alertes
   ========================================================================== */

function props_() { return PropertiesService.getScriptProperties().getProperties(); }

function urlGraph_(chemin, params) {
  const p = Object.assign({ access_token: props_().META_TOKEN }, params);
  const qs = Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&');
  return 'https://graph.facebook.com/' + AUTO.GRAPH + '/' + chemin + '?' + qs;
}
function graph_(chemin, params) { return graphUrl_(urlGraph_(chemin, params || {})); }

/** Appel Meta avec une nouvelle tentative si la plateforme est saturée. */
function graphUrl_(url) {
  for (let essai = 0; essai < 3; essai++) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    let json;
    try { json = JSON.parse(res.getContentText()); }
    catch (e) { json = { error: { message: 'Réponse illisible (HTTP ' + res.getResponseCode() + ')', code: -1 } }; }
    const c = json.error && json.error.code;
    if (json.error && ([1, 2, 4, 17, 32, 613].includes(c) || res.getResponseCode() >= 500) && essai < 2) { Utilities.sleep(2000 * (essai + 1)); continue; }
    return json;
  }
}

function graphMany_(requetes) {
  const res = UrlFetchApp.fetchAll(requetes.map(r => ({ url: urlGraph_(r.chemin, r.params), muteHttpExceptions: true })));
  return res.map((x, i) => {
    let json;
    try { json = JSON.parse(x.getContentText()); } catch (e) { json = { error: { message: 'Réponse illisible', code: -1 } }; }
    if (json.error && [1, 2, 4, 17, 32, 613].includes(json.error.code)) json = graph_(requetes[i].chemin, requetes[i].params); // nouvelle tentative isolée
    return json;
  });
}

/* Dates : toujours des chaînes 'yyyy-MM-dd' dans le fuseau de Paris */
function jour_(decalage, base) {
  const d = base ? new Date(base + 'T12:00:00Z') : new Date(Utilities.formatDate(new Date(), AUTO.FUSEAU, 'yyyy-MM-dd') + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (decalage || 0));
  return d.toISOString().slice(0, 10);
}
function jours_(debut, fin) { const out = []; for (let d = debut; d <= fin; d = jour_(1, d)) out.push(d); return out; }
function morceaux_(debut, fin, taille) {
  const out = [];
  for (let a = debut; a <= fin; a = jour_(taille + 1, a)) { const b = jour_(taille, a); out.push([a, b < fin ? b : fin]); }
  return out;
}
function debutJourUnix_(jour) {
  const decalage = Utilities.formatDate(new Date(jour + 'T12:00:00Z'), AUTO.FUSEAU, 'XXX'); // ex. +02:00
  return Math.floor(new Date(jour + 'T00:00:00' + decalage).getTime() / 1000);
}
function dateLocale_(iso) { return iso ? Utilities.formatDate(new Date(String(iso).replace(/\+0000$/, 'Z')), AUTO.FUSEAU, 'yyyy-MM-dd') : null; }

const MOIS_ = { jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2, mar: 3, mars: 3, march: 3, apr: 4, avr: 4, avril: 4, april: 4,
  may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7, aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, septembre: 9, september: 9,
  oct: 10, octobre: 10, october: 10, nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12 };

/** Convertit une date (objet Date, ISO, 13/10/2026, "October 13", "13 octobre 2026"...) en 'yyyy-MM-dd'. */
function texteDate_(x) {
  if (x === null || x === undefined || x === '') return null;
  if (Object.prototype.toString.call(x) === '[object Date]') return isNaN(x) ? null : Utilities.formatDate(x, AUTO.FUSEAU, 'yyyy-MM-dd');
  const s = String(x).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/.exec(s);
  if (m) return m[3] + '-' + pad_(m[2]) + '-' + pad_(m[1]);
  const t = normaliser_(s).replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
  let jourN = null, moisN = null, annee = null;
  t.forEach(w => {
    if (/^\d{4}$/.test(w)) annee = Number(w);
    else if (/^\d{1,2}$/.test(w)) jourN = Number(w);
    else if (MOIS_[w] || MOIS_[w.slice(0, 4)] || MOIS_[w.slice(0, 3)]) moisN = MOIS_[w] || MOIS_[w.slice(0, 4)] || MOIS_[w.slice(0, 3)];
  });
  if (!jourN || !moisN) return null;
  if (!annee) { // les exports TikTok omettent l'année : on prend la plus récente qui ne soit pas dans le futur
    annee = Number(jour_(0).slice(0, 4));
    if (annee + '-' + pad_(moisN) + '-' + pad_(jourN) > jour_(0)) annee--;
  }
  return annee + '-' + pad_(moisN) + '-' + pad_(jourN);
}
function pad_(n) { return String(n).padStart(2, '0'); }
function normaliser_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function escapeHtml_(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function feuille_(nom, entete) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    sh.getRange(1, 1, 1, entete.length).setValues([entete]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (nom === AUTO.STORIES) sh.hideSheet();
  }
  return sh;
}

function journal_(action, statut, lignes, detail) {
  const sh = feuille_(AUTO.JOURNAL, ['Horodatage', 'Action', 'Statut', 'Lignes', 'Détail']);
  sh.appendRow([Utilities.formatDate(new Date(), AUTO.FUSEAU, 'dd/MM/yyyy HH:mm'), action, statut, lignes, String(detail || '').slice(0, 500)]);
  Logger.log(action + ' · ' + statut + ' · ' + lignes + ' · ' + detail);
}
function journalErreurApi_(ou, err) {
  const expire = err.code === 190 ? ' Le jeton Meta est expiré ou révoqué : regénère-le (guide, étape Meta 5).' : '';
  journal_(ou, 'Avertissement', 0, (err.message || JSON.stringify(err)) + expire);
}

function executer_(nom, fn) {
  try {
    const r = fn();
    journal_(nom, 'OK', r.lignes, r.detail);
  } catch (e) {
    journal_(nom, 'Erreur', 0, e.message);
    alerte_('POA dashboard : échec de « ' + nom + ' »', e.message + '\n\nDétail dans l\'onglet ' + AUTO.JOURNAL + ' du Google Sheet.');
    throw e;
  }
}

function alerte_(sujet, corps) {
  if (!AUTO.ALERTE_EMAIL) return;
  const sp = PropertiesService.getScriptProperties();
  if (sp.getProperty('ALERTE_DERNIERE') === jour_(0)) return; // une alerte par jour au plus
  const dest = Session.getEffectiveUser().getEmail();
  if (!dest) return;
  MailApp.sendEmail(dest, sujet, corps);
  sp.setProperty('ALERTE_DERNIERE', jour_(0));
}

function supprimerDeclencheurs_(fonction) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === fonction).forEach(t => ScriptApp.deleteTrigger(t));
}
function relancerDansUneMinute_(fonction) {
  supprimerDeclencheurs_(fonction);
  ScriptApp.newTrigger(fonction).timeBased().after(60 * 1000).create();
}
