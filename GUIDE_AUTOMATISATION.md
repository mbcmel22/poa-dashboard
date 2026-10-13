# Automatiser l'alimentation du dashboard POA

Objectif : que les chiffres Meta, TikTok, Google Ads et du site arrivent seuls dans le Google Sheet, et que le dashboard les affiche au prochain clic sur **Actualiser**.

## Le principe (déjà en place dans le dashboard)

```
Plateformes (Meta, Google, GA4...)
        │  chaque jour, un script ajoute des lignes
        ▼
Google Sheet · onglet Flux_auto     Date | Code | Valeur | Source
        │  publié en CSV
        ▼
Dashboard Vercel  →  regroupe par mois, fusionne avec l'onglet POA
```

- L'onglet **POA** reste ta saisie manuelle mensuelle. Rien à changer.
- L'onglet **Flux_auto** est une simple liste (une ligne = une mesure). C'est le format que les outils d'automatisation savent écrire, contrairement au tableau à colonnes fusionnées.
- Pour un même mois, une valeur automatique **remplace** la valeur manuelle.
- Regroupement mensuel : abonnés = dernière valeur du mois, interactions / publications / impressions = somme, taux = moyenne.
- La liste complète des codes est visible dans le dashboard, page **Sources & automatisation**.

## Quotidien ou hebdomadaire ?

Les deux fonctionnent, le dashboard agrège par mois. Recommandation : **quotidien** pour Meta (les données Instagram ne restent disponibles qu'un temps limité côté API), **hebdomadaire** ou mensuel pour le reste. Les données Meta arrivent avec un délai qui peut aller jusqu'à 48 h : le script récupère donc toujours la veille.

## Quel outil ?

| Option | Coût | Pour qui | Limite |
|---|---|---|---|
| **Google Apps Script** (recommandé) | Gratuit | Meta, GA4 | Un peu de configuration au départ |
| Make | Gratuit jusqu'à 1 000 crédits / mois et **2 scénarios actifs** | Si tu préfères le visuel | Tes scénarios de veille et de publication Instagram occupent déjà ces places : il faudrait passer au plan Core (environ 9 à 11 $ / mois) |
| Google Ads Scripts | Gratuit | Google Ads | Intégré à Google Ads |

Apps Script tourne directement dans le Google Sheet, sans limite de scénarios, avec un déclencheur quotidien. C'est le meilleur rapport effort / coût pour POA.

## Plateforme par plateforme

### Meta : Instagram, Facebook, Meta Ads (prêt à l'emploi)
Fichier fourni : `apps-script-meta.gs`.

1. Dans **Meta Business Suite**, crée une app (developers.facebook.com, type Business) reliée au compte Instagram professionnel @poa.food et à la Page Facebook.
2. Génère un **jeton longue durée** (idéalement via un utilisateur système Business, il n'expire pas) avec les autorisations `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, `ads_read`.
3. Dans le Google Sheet : **Extensions > Apps Script**, colle le fichier, puis renseigne les propriétés du script `META_TOKEN`, `IG_USER_ID`, `FB_PAGE_ID`, `AD_ACCOUNT_ID`.
4. Lance `testerConnexion`, puis `installerDeclencheurQuotidien`.

Codes alimentés : `ig_abonnes`, `ig_vues`, `ig_visites_profil`, `ig_interactions`, `ig_publications`, `ig_clics_lien`, `fb_abonnes`, `meta_impressions`, `meta_ctr`.

Les campagnes Meta détaillées (une par publication sponsorisée) restent saisies à la main dans la section Meta Ads de l'onglet POA : le dashboard lit chaque bloc comme une campagne.

À savoir : certaines métriques d'audience Instagram (ex. évolution quotidienne des abonnés) ne sont pas fournies sous 100 abonnés. Le script lit le **nombre total d'abonnés** du compte, disponible quelle que soit la taille.

### TikTok (organique)
TikTok ne propose pas d'accès gratuit et simple aux statistiques d'un compte sans faire valider une application développeur. Les modules TikTok de Make concernent la publicité, pas les statistiques organiques.
- **Solution réaliste aujourd'hui** : saisie manuelle hebdomadaire dans Flux_auto (2 minutes : `tt_vues`, `tt_interactions`, `tt_publications`, `tt_nouveaux`, `tt_visites_profil`) depuis TikTok Studio.
- **Plus tard** : demande d'accès à l'API TikTok for Developers, ou scraper payant (Apify) branché sur Make.

### Google Ads
Dans Google Ads : **Outils > Actions groupées > Scripts**. Un script quotidien peut écrire `gads_impressions`, `gads_ctr`, `gads_conversion` dans Flux_auto (même format 4 colonnes). Gratuit et natif.

### Landing page (Google Analytics 4)
Dans Apps Script, active le service avancé **Google Analytics Data API**, puis lance chaque jour un rapport sur la veille : sessions → `lp_visites`, taux de rebond → `lp_rebond`, durée moyenne d'engagement → `lp_duree` (en secondes), pages vues / sessions → `lp_pages_visite`. Téléchargements et abonnements viennent des stores (App Store Connect, Google Play Console) ou de la base de l'app : saisie mensuelle en attendant.

### Business (churn, NPS, LTV / CAC)
Ces chiffres viennent de la base d'abonnés et des enquêtes. Ajoute une ligne par mois dans Flux_auto : `churn` (ex. `5,2%`), `nps` (ex. `46`), `ltv_cac` (ex. `3,4`).

## Mise en route côté dashboard

1. Crée l'onglet `Flux_auto` (le script Meta le crée tout seul au premier lancement), avec les en-têtes `Date | Code | Valeur | Source`. Un exemple est fourni : `modele_Flux_auto.csv`.
2. **Fichier > Partager > Publier sur le web**, onglet `Flux_auto`, format CSV, Publier.
3. Colle l'URL dans `config.js` → `SHEET_FLUX_AUTO_CSV`, puis redéploie.
4. Page **Sources & automatisation** : la colonne Source passe à **Auto** pour chaque indicateur alimenté.

Formats acceptés : date `2026-10-12` ou `12/10/2026` ; valeur `3,4%`, `0,034` ou `72` ; durée en secondes ou `1:42`.
