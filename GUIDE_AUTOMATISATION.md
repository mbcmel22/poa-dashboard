# Automatiser l'extraction Meta et TikTok

Objectif : chaque matin, les chiffres Instagram, Facebook, Meta Ads et TikTok arrivent seuls dans le Google Sheet, et le dashboard les affiche au prochain clic sur **Actualiser**.

Fichier à installer : `poa-automatisation.gs` (il remplace l'ancien `apps-script-meta.gs`).

## Ce qui est automatisé

| Indicateur du dashboard | Instagram | Facebook | TikTok |
|---|---|---|---|
| Vues de publication | `views` | `page_media_view` | `video_views` |
| Interactions | `total_interactions` | `page_post_engagements` | likes + commentaires + partages |
| Clics sur un lien | `profile_links_taps` | `page_total_actions` (clics sur les boutons de la Page) | `bio_link_clicks` si disponible |
| Visites du profil | `profile_views` si Meta la fournit encore | `page_views_total` si Meta la fournit encore | `profile_views` |
| Publications | posts, carrousels, reels + stories | publications de la Page | vidéos publiées |
| Abonnés au total | relevé chaque matin | relevé chaque matin | total du jour |
| Nouveaux abonnés | calculés (écart entre deux relevés) | `page_daily_follows_unique` | calculés |

Meta Ads, au niveau du compte publicitaire et par jour : **budget dépensé**, **impressions**, **clics sur le lien**. Le dashboard en déduit le CTR du mois (clics ÷ impressions), plus juste qu'une moyenne de taux journaliers.

## Comment ça tourne

```
Meta Graph API ──┐
TikTok API ──────┼──► Apps Script (chaque jour vers 7 h) ──► onglet Flux_auto ──► CSV publié ──► dashboard
Exports TikTok ──┘         relit les 3 derniers jours            Date | Code | Valeur | Source
(dossier Drive)            journal + alerte e-mail
```

- **Relecture sur 3 jours** : Meta corrige ses chiffres jusqu'à 48 h après. Le script met à jour les lignes existantes, sans créer de doublon.
- **Auto-réparation** : Meta retire régulièrement des métriques (impressions et fans de Page en novembre 2025, d'autres en juin 2026). Si une métrique est refusée, le script la met de côté, continue avec les autres et le note dans l'onglet `Journal_auto`.
- **Une panne n'en bloque pas une autre** : si TikTok échoue, Instagram et Facebook sont quand même relevés. Tu reçois un e-mail (un par jour au plus).
- **Onglets créés tout seuls** : `Flux_auto` (les données), `Journal_auto` (chaque exécution), `_stories` (masqué, sert à compter les stories).

Compte environ 45 minutes pour Meta. Pour TikTok, il faut une validation de TikTok qui prend quelques jours : le plan B fonctionne dès aujourd'hui.

---

## Partie 1 : Meta (Instagram, Facebook, Meta Ads)

### Prérequis
- Le compte Instagram @poa.food est un **compte professionnel** (Entreprise ou Créateur) **relié à la Page Facebook** POA.
- La Page et le compte publicitaire sont dans le **portefeuille business** POA (Meta Business Suite), dont tu es administrateur.

### 1. Créer l'app Meta
1. Va sur [developers.facebook.com](https://developers.facebook.com) > **Mes apps** > **Créer une app**.
2. Nom : `POA Dashboard`. Cas d'usage : **Autre**, puis type **Entreprise**. Rattache-la au portefeuille business POA.
3. Rien à publier : l'app reste en mode développement. Elle ne lit que les comptes de POA, donc **aucune validation par Meta n'est nécessaire**.

### 2. Créer un utilisateur système (jeton qui n'expire pas)
Un utilisateur système est un compte technique du portefeuille business. Son jeton ne dépend pas de ton compte personnel et n'expire pas, contrairement à un jeton classique (60 jours).

1. Meta Business Suite > **Paramètres** > **Utilisateurs** > **Utilisateurs système** > **Ajouter**. Nom : `poa-dashboard`, rôle **Employé**.
2. **Attribuer des éléments** à cet utilisateur, avec un accès en lecture ou « voir les performances » :
   - la Page Facebook POA ;
   - le compte Instagram @poa.food ;
   - le compte publicitaire (si tu veux Meta Ads) ;
   - l'app `POA Dashboard`.

### 3. Générer le jeton
1. Sur l'utilisateur système : **Générer un nouveau jeton**, choisis l'app `POA Dashboard`, expiration **Jamais**.
2. Coche ces autorisations :
   `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, `ads_read`, `business_management`.
3. Copie le jeton. **Il ne s'affiche qu'une fois** : colle-le directement à l'étape suivante, ne l'envoie ni par e-mail ni sur une messagerie.

### 4. Installer le script
1. Ouvre le Google Sheet **Tableau de bord KPI POA** > **Extensions** > **Apps Script**.
2. Supprime le contenu de `Code.gs` (et l'ancien script Meta s'il existe), colle `poa-automatisation.gs`, puis **Enregistrer**.
3. **Paramètres du projet** (roue dentée) > **Propriétés du script** > ajoute `META_TOKEN` avec le jeton.
4. Retour à l'éditeur : choisis la fonction **trouverMesIdentifiants** dans le menu en haut, puis **Exécuter**.
   - Google affiche « Google n'a pas validé cette application » : c'est normal pour un script personnel. **Paramètres avancés** > **Accéder à POA Dashboard** > **Autoriser**.
   - Le journal d'exécution affiche tes identifiants : `FB_PAGE_ID = …`, `IG_USER_ID = …`, `AD_ACCOUNT_ID = …`.
5. Ajoute ces trois propriétés du script.

### 5. Vérifier puis remplir l'historique
1. Exécute **testerConnexion**. Tu dois voir le nombre d'abonnés Instagram et Facebook, les métriques d'hier, et la liste des métriques refusées par Meta (normal, elles sont mises de côté).
2. Compare 2 ou 3 chiffres avec l'application Instagram (statistiques d'hier). De petits écarts sont normaux (voir « Points d'attention »).
3. Exécute **rattraperHistorique** : il remplit tout depuis le 1er juillet 2026 (réglable en haut du script, `HISTORIQUE_DEPUIS`, toujours un 1er du mois). S'il y a beaucoup de jours, il se relance tout seul une minute plus tard.
4. Exécute **installerDeclencheurs** : extraction chaque jour vers 7 h, relevé des stories toutes les 6 h.

Si le jeton cesse un jour de fonctionner (mot de passe changé, utilisateur système supprimé), le journal l'indique : refais l'étape 3 et remplace `META_TOKEN`.

---

## Partie 2 : TikTok

### Plan B, opérationnel aujourd'hui : l'export TikTok Studio (2 minutes par semaine)
1. Dans Google Drive (le même compte que le script), crée un dossier nommé exactement **`POA - Import TikTok`**.
2. Chaque lundi, sur ordinateur : **TikTok Studio** > **Statistiques** > **Télécharger les données**, période 7 jours (ou 28), format **CSV**.
3. Dépose le fichier, ou le `.zip` tel quel, dans le dossier.
4. Le lendemain à 7 h, le script lit les fichiers, verse les chiffres dans Flux_auto et les range dans un sous-dossier **Importés**. Le journal indique combien de lignes ont été importées.

Fichiers reconnus, en anglais ou en français : vue d'ensemble (vues des vidéos, vues du profil, j'aime, commentaires, partages), historique des abonnés (total et variation) et contenu (une ligne par vidéo, pour compter les publications). Si un fichier n'est pas reconnu, le journal le signale : envoie-moi ses en-têtes de colonnes et j'adapte la lecture.

### Plan A, la cible : l'API officielle (TikTok for Business)
À lancer en parallèle, car TikTok doit valider l'app (quelques jours en général).

1. Le compte TikTok de POA doit être un **compte Entreprise** (Paramètres > Compte > Passer à un compte Entreprise).
2. Crée un compte développeur sur le [portail TikTok API for Business](https://business-api.tiktok.com/portal), puis une app avec l'accès aux **comptes TikTok** (Accounts API). Demande les autorisations de lecture du profil, des statistiques du compte et de la liste des vidéos avec leurs statistiques. Description à donner : « Lecture des statistiques de notre propre compte pour notre tableau de bord interne ».
3. Une fois l'app validée, note l'**App ID** et le **Secret** dans les propriétés du script : `TT_APP_ID`, `TT_SECRET`.
4. Dans Apps Script : **Déployer** > **Nouveau déploiement** > type **Application Web**, exécuter en tant que **moi**, accès **Tout le monde**. Copie l'URL obtenue : c'est l'**URL de redirection** à déclarer dans l'app TikTok. (Elle ne montre aucune donnée : elle sert uniquement à recevoir l'autorisation.)
5. Ouvre le **lien d'autorisation** fourni par le portail, connecté au compte TikTok de POA, et valide. La page « TikTok est relié au dashboard POA » confirme : les jetons sont enregistrés et se renouvellent seuls. Il faut réautoriser une fois par an : le script te prévient par e-mail un mois avant.
6. Exécute **testerConnexion** et compare la réponse TikTok avec TikTok Studio, en particulier le nombre d'abonnés (`followers_count`). Exécute ensuite **rattraperHistorique** : l'API remonte environ 60 jours.

Tu peux garder le plan B en secours : si l'API et un export donnent le même jour, la dernière valeur lue l'emporte.

---

## Partie 3 : brancher le dashboard

1. Google Sheet > **Fichier** > **Partager** > **Publier sur le web** > onglet **Flux_auto**, format **CSV** > **Publier**. Ne publie que cet onglet (et l'onglet POA), jamais le document entier.
2. Colle l'URL dans `config.js`, entre apostrophes :
   ```js
   SHEET_FLUX_AUTO_CSV: 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv',
   ```
3. Envoie `config.js` sur GitHub : Vercel redéploie.
4. Page **Sources & automatisation** : le statut affiche « flux auto actif » et chaque indicateur alimenté passe en **Auto**, avec le nom de sa source.

### Règles de fusion avec ta saisie manuelle
- Pour un mois donné, la valeur automatique **remplace** la valeur saisie dans l'onglet POA, **à condition de couvrir au moins 80 % des jours du mois**. Sinon (par exemple TikTok en août, dont l'API ne remonte qu'une partie), ta saisie est conservée et la page Sources le signale.
- Abonnés au total : la dernière valeur du mois l'emporte toujours.
- Les campagnes Meta saisies en blocs dans l'onglet POA restent la référence pour le détail par campagne. Les chiffres du compte publicitaire servent quand aucun bloc n'est saisi, et les impressions ne sont jamais comptées deux fois.

---

## Points d'attention (qualité des données)

- **« Vues » Meta** : depuis 2025, Meta compte des vues (y compris répétées) à la place des impressions. Les historiques antérieurs saisis à la main avec une autre définition ne sont pas strictement comparables.
- **Nouveaux abonnés Instagram** : sous 100 abonnés, Meta ne fournit pas les abonnés gagnés par jour. Le script les calcule à partir du total relevé chaque matin : c'est un **solde net** (gains moins pertes), et il commence à partir du deuxième relevé.
- **Visites du profil Instagram** : la métrique n'apparaît plus dans la documentation Meta. Si Meta la refuse, elle reste saisie à la main (lisible dans l'application Instagram).
- **Clics Facebook** : `page_total_actions` compte les clics sur les boutons et coordonnées de la Page, pas les clics sur les liens des publications.
- **Stories** : l'API ne les montre que 24 h. Elles sont comptées grâce au relevé toutes les 6 h ; une story publiée avant l'installation n'est pas rattrapable.
- **Découpage des journées** : Meta découpe certaines statistiques de Page selon l'heure du Pacifique. Un léger décalage d'un jour sur l'autre est possible ; le total du mois reste juste.
- **Données sensibles** : le jeton Meta et les jetons TikTok restent dans les propriétés du script, invisibles dans le Sheet. L'onglet publié ne contient que des chiffres.

## Les fonctions du script

| Fonction | Quand l'utiliser |
|---|---|
| `trouverMesIdentifiants` | Une fois, pour obtenir les identifiants Page, Instagram et pub |
| `testerConnexion` | À l'installation, puis en cas de doute (n'écrit rien dans Flux_auto) |
| `rattraperHistorique` | Une fois, puis si tu changes `HISTORIQUE_DEPUIS` (sans risque de doublon) |
| `installerDeclencheurs` | Une fois (le relancer ne crée pas de doublon) |
| `extraireTout` | Tourne seul chaque matin ; lançable à la main pour forcer une mise à jour |
| `releverStories` | Tourne seul toutes les 6 h |
| `tiktokLienAutorisation` | Rappelle l'URL de redirection TikTok à déclarer |

## Dépannage

| Ce que tu vois | Cause probable | Que faire |
|---|---|---|
| Journal : « jeton Meta expiré ou révoqué » | Jeton supprimé ou utilisateur système modifié | Partie 1, étape 3, puis remplace `META_TOKEN` |
| `trouverMesIdentifiants` ne liste aucune Page | Page non attribuée à l'utilisateur système | Partie 1, étape 2 |
| Instagram absent sous la Page | Compte Instagram non professionnel ou non relié à la Page | Le relier dans les paramètres de la Page |
| Journal : « Métrique … mise de côté » | Meta a retiré la métrique | Rien à faire ; l'indicateur reste en saisie manuelle |
| TikTok : « rafraîchissement refusé » | Autorisation expirée ou révoquée | Partie 2, plan A, étape 5 |
| Import TikTok « Ignoré » | Fichier au format Excel ou image | Réexporte en CSV, ou dépose le .zip |
| Dashboard : « flux auto non branché » | URL Flux_auto absente de `config.js` | Partie 3 |
| Chiffres pas à jour sur le dashboard | Cache Google du CSV publié | Attends 5 minutes, puis Actualiser |

## Pour aller plus loin
- **Campagnes Meta détaillées** : quand une campagne tourne, le script peut écrire une ligne par campagne et par jour dans un onglet dédié, que le dashboard lirait à la place des blocs saisis à la main.
- **Landing page (GA4)** et **Google Ads** : même principe, mêmes codes (`lp_visites`, `gads_impressions`…), à brancher ensuite.
