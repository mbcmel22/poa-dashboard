# POA · Tableau de bord KPI marketing

Dashboard web aux couleurs de POA, branché sur le Google Sheet **Tableau de bord KPI POA**. Site 100 % statique : HTML, CSS, JavaScript, Chart.js et PapaParse inclus en local. Aucun build, aucune installation.

## Les 8 pages

1. **Vue d'ensemble** : vues, interactions, taux d'engagement et nouveaux abonnés sur la période, vues par réseau, objectifs business (churn, NPS, LTV / CAC), tunnel vues → visites du profil → clics → téléchargements → abonnements, meilleure campagne Meta.
2. **Recommandations** : le brief de l'agent stratégique (chaque matin vers 8 h, aussi par e-mail), les priorités à adopter ou écarter, la matrice impact et effort, les signaux du moment recalculés sur la période, les 3 contenus de la semaine (agent du lundi) et l'historique.
3. **Réseaux sociaux** : un onglet par réseau (Instagram, Facebook, TikTok). Pour le réseau choisi : 8 indicateurs, vues, interactions, taux d'engagement et audience par période, répartition de l'audience (genre, âge, sources de trafic, recherches), spectateurs nouveaux et fidèles, statistiques de chaque publication, puis le détail période par période.
4. **Concurrents** : benchmark Instagram et TikTok (POA compris, même méthode), évolution des abonnés en base 100, carte de positionnement, publications qui surperforment, formats qui marchent.
5. **Veille** : mentions de POA et tonalité, part de voix, sujets qui montent, fil d'actualité marque, concurrents et secteur.
6. **Landing page** : visites, pages par visite, durée de session, taux de rebond, tunnel jusqu'à l'abonnement.
7. **Publicité** : campagnes Meta Ads (coût par visite, par clic, par abonné), diffusion mensuelle, Google Ads.
8. **Sources & automatisation** : état de chaque indicateur, son code, sa dernière valeur et son origine (Manuel / Auto).

Le filtre **Période** (en haut) filtre tout le dashboard et propose quatre vues :
- **Jour** : « Aujourd'hui », « Hier » ou n'importe quel jour dans le calendrier. Les tuiles comparent à la veille ; les graphiques montrent les 14 jours jusqu'au jour choisi, mis en avant.
- **Semaine** : « Cette semaine », « Semaine dernière » ou une semaine choisie d'un clic dans le calendrier (lundi à dimanche). Comparaison avec la semaine précédente ; graphiques sur les 8 semaines jusqu'à celle choisie.
- **Mois** : un clic sur un mois depuis « Tout » l'affiche seul ; chaque clic suivant ajoute ou retire un mois ; Maj + clic sélectionne une plage.
- **Personnalisé** : raccourcis (7, 30 ou 90 derniers jours, ce mois-ci, mois dernier, tout) ou une période choisie en deux clics dans le calendrier (premier jour, puis dernier jour).

Les vues Jour, Semaine et Personnalisé utilisent le détail quotidien de l'onglet Flux_auto (réseaux sociaux, Meta Ads). Les chiffres saisis au mois (landing page, blocs de campagne) restent en vue Mois. Dans le calendrier, un point signale les jours qui ont des chiffres ; ceux d'une journée arrivent le lendemain vers 6 h.

Les tuiles affichent le total de la période et, quand elle est continue, le comparent à la période précédente de même durée.

## Contenu du dossier

Tous les fichiers sont à la racine (plus simple pour l'envoi sur GitHub par le navigateur) :

```
index.html, styles.css, app.js     le dashboard
notes.js                           notes partagées (commentaires) et export PDF
intel.js                           pages Recommandations, Concurrents et Veille
config.js                          URLs Google Sheets et réglages (à remplir)
demo-data.js                       copie de l'onglet POA pour le mode démo
*.min.js                           Chart.js, plugin annotation, PapaParse
gravitas-one.woff2                 police des titres (charte POA)
nobel-uno-*.woff2                  police du texte (charte POA)
logo.png                           logo POA + baseline (barre latérale)
favicon.ico, favicon-32.png        icône d'onglet (mascotte sur rond vert)
apple-touch-icon.png               icône sur l'écran d'accueil du téléphone
GUIDE_AUTOMATISATION.md            mise en route pas à pas de l'extraction automatique
poa-automatisation.gs              script Apps Script : Instagram, Facebook, Meta Ads, TikTok
poa-veille.gs                      second fichier Apps Script : concurrents (Apify), veille, briefs des agents, e-mails
tiktok-callback.html               page de retour de l'autorisation TikTok (URL de redirection)
modele_Flux_auto.csv               exemple de l'onglet Flux_auto
vercel.json                        en-têtes de sécurité, site non indexé
```

## 1. Déployer sur Vercel

Le projet `gemo-dashboard` reste intact : on crée un **nouveau projet** pour POA.

**Option A, glisser-déposer**
1. Dézippe le dossier.
2. Va sur [vercel.com/new](https://vercel.com/new), clique sur **folder** sous la barre de recherche et choisis le dossier `poa-dashboard`.
3. Nom du projet : `poa-dashboard`. Framework : *Other*. Build et Output : vides. **Deploy**.

**Option B, GitHub (conseillé pour les mises à jour)**
```bash
cd poa-dashboard
git init && git add . && git commit -m "Dashboard KPI POA"
git branch -M main
git remote add origin https://github.com/mbcmel22/poa-dashboard.git
git push -u origin main
```
Puis sur Vercel : **Add New > Project > Import** du dépôt. Chaque `git push` redéploie le site.

Sans configuration, le site tourne en **mode démo** avec les dernières valeurs connues du Sheet (janvier à septembre 2026, campagnes Meta de février et mars).

## 2. Brancher le Google Sheet

1. Ouvre **Tableau de bord KPI POA** > **Fichier > Partager > Publier sur le web**.
2. Onglet **Lien** : choisis l'onglet **POA** (pas « Document entier »), format **Valeurs séparées par des virgules (.csv)**, puis **Publier**.
3. Copie l'URL et colle-la dans `config.js`, entre apostrophes simples :
   ```js
   SHEET_POA_CSV: 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv',
   ```
4. Enregistre (Bloc-notes, pas Word), redéploie. En bas de la barre latérale, le point passe au vert : **Google Sheet connecté**.

Ensuite : tu modifies le Sheet, tu cliques **Actualiser** sur le dashboard. Compte 1 à 5 minutes de cache côté Google.

### Ce que le dashboard sait lire dans l'onglet POA
- Les colonnes **Janvier à Décembre** (année réglée dans `config.js`, `ANNEE`). L'indicateur est la colonne juste avant « Janvier ».
- Les sections en colonne A : **RÉSEAUX SOCIAUX**, **LP**, **CAMPAGNE META ADS**, **CAMPAGNE GOOGLE ADS**. Elles se prolongent vers le bas tant que la cellule est vide.
- La **plateforme** (Instagram, Facebook, TikTok) en colonne B, prolongée elle aussi vers le bas.
- Indicateurs réseaux reconnus : nombre d'abonnés, followers en plus, visites du compte / vues du profil, vues de publication, publications, interactions, clics sur un lien.
- **Section Meta Ads** : chaque texte de publication en colonne B ouvre une **campagne**. Ses lignes suivantes (visites du profil, coût par visite, vues, spectateurs, interactions, clics, CTR, followers en plus, objectif, budget quotidien, durée, montant dépensé) sont lues dans la colonne du mois où tu les as saisies.
- Le tableau qui commence par **Levier** est encore lu, mais ses « gains » ne sont pas repris (voir points d'attention).
- Formats : `13,79 €`, `3 061`, `4,49%`, `7 jours`, `1:42` pour une durée.

Tu peux ajouter une ligne `Churn`, `NPS` ou `LTV / CAC` dans l'onglet : elle sera reconnue aussi.

## 3. Automatiser

Voir `GUIDE_AUTOMATISATION.md`. En résumé : le script `poa-automatisation.gs` relève chaque matin Instagram, Facebook, Meta Ads et TikTok, et met à jour l'onglet `Flux_auto` (`Date | Code | Valeur | Source`). Tu publies cet onglet en CSV, tu colles l'URL dans `SHEET_FLUX_AUTO_CSV`. Le dashboard fusionne tout seul : une valeur automatique remplace la saisie manuelle quand elle couvre au moins 80 % des jours du mois.

## Réglages (`config.js`)

| Réglage | Rôle |
|---|---|
| `SHEET_POA_CSV` | URL CSV de l'onglet POA |
| `SHEET_FLUX_AUTO_CSV` | URL CSV de l'onglet Flux_auto (optionnel) |
| `ANNEE` | Année des colonnes de mois |
| `PRIX_ABONNEMENT` | 50 € : sert à estimer les gains des tests Meta |
| `AUTO_REFRESH_MINUTES` | Rechargement automatique de la page (0 = off) |
| `OBJECTIFS` | Cibles business : churn < 6 %, NPS ≥ 40, LTV / CAC ≥ 3 |

## Points d'attention

- **Gains Meta Ads** : dans le tableau « Levier », les conversions (13 et 19) correspondent aux followers gagnés par les campagnes, pas à des abonnements payants. Les gains de 650 € et 950 € (conversions × 50 €) ne sont donc pas repris : le dashboard affiche plutôt le coût par visite, par clic et par abonné gagné.
- **Taux d'engagement** : calculé seulement pour les mois à 50 vues ou plus, pour éviter qu'un mois à 2 vues affiche 100 %.
- **Confidentialité** : un onglet publié en CSV est lisible par toute personne qui a l'URL. Ne publie que les onglets POA et Flux_auto, pas le document entier. Le site est marqué non indexable.
- **config.js** : l'URL doit être entre apostrophes simples. Sans elles, le fichier est illisible : le dashboard l'indique en bas de la barre latérale et affiche les données de démo.
- **Charte** : couleurs et polices tirées de la charte POA 2026 (Vert #93A170, Rouge #BF5223, Bleu #8FB0C7, Orange #F79E2B, Crème #FFFAF2 ; Gravitas One pour les titres, Nobel Uno pour le texte). Pour changer de logo, remplace `logo.png` (fond transparent, texte clair).
