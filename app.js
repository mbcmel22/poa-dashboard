/* ============================================================
   APP.JS : tableau de bord KPI POA
   Lit l'onglet "POA" (saisie mensuelle) et, en option, l'onglet
   "Flux_auto" (lignes ajoutées par l'automatisation), fusionne
   les deux par mois puis dessine les 5 pages.

   Structure attendue de l'onglet POA (souple) :
   Section | Plateforme | Indicateur | Janvier ... Décembre
   - la ligne d'en-tête est celle qui contient "Janvier"
   - l'indicateur est la colonne juste avant "Janvier"
   - Section et Plateforme se prolongent vers le bas tant qu'elles sont vides
   - dans la section Meta Ads, chaque texte en colonne Plateforme ouvre
     une nouvelle campagne ; ses lignes suivantes décrivent ses résultats
   ============================================================ */

/* ---------- Garde-fou : config.js ou demo-data.js illisible ----------
   Une faute de frappe dans config.js (apostrophes oubliées autour de
   l'URL) empêche le fichier de se charger. Plutôt qu'un chargement
   infini, on repart sur des réglages par défaut et on le signale. */
const CONFIG_BROKEN = typeof CONFIG === 'undefined';
if (CONFIG_BROKEN) {
  window.CONFIG = {
    SHEET_POA_CSV: null, SHEET_FLUX_AUTO_CSV: null, ANNEE: 2026, PRIX_ABONNEMENT: 50, AUTO_REFRESH_MINUTES: 0,
    OBJECTIFS: [
      { code: 'churn', label: 'Churn mensuel', cible: 0.06, sens: 'max', format: 'pct' },
      { code: 'nps', label: 'NPS', cible: 40, sens: 'min', format: 'num' },
      { code: 'ltv_cac', label: 'Ratio LTV / CAC', cible: 3, sens: 'min', format: 'ratio' },
    ],
  };
}
if (typeof DEMO_POA_CSV === 'undefined') window.DEMO_POA_CSV = '';

/* ---------- Réseaux ---------- */
const NETS = [
  { key: 'ig', label: 'Instagram', color: '#BF5223', re: /instagram/ },
  { key: 'fb', label: 'Facebook',  color: '#3F7FB5', re: /facebook/ },
  { key: 'tt', label: 'TikTok',    color: '#B8960C', re: /tik ?tok/ },
];
const NET_BY_KEY = Object.fromEntries(NETS.map(n => [n.key, n]));

/* ---------- Catalogue des indicateurs ----------
   kind : stock = dernière valeur du mois / flux = somme / moy = moyenne
   fmt  : int, pct, duree, num, ratio                                   */
const NET_FIELDS = [
  { key: 'abonnes',        label: 'Abonnés',             kind: 'stock' },
  { key: 'nouveaux',       label: 'Nouveaux abonnés',    kind: 'flux' },
  { key: 'vues',           label: 'Vues de publication', kind: 'flux' },
  { key: 'visites_profil', label: 'Visites du profil',   kind: 'flux' },
  { key: 'interactions',   label: 'Interactions',        kind: 'flux' },
  { key: 'publications',   label: 'Publications',        kind: 'flux' },
  { key: 'clics_lien',     label: 'Clics sur un lien',   kind: 'flux' },
];

const METRICS = [
  ...NETS.flatMap(n => NET_FIELDS.map(f => ({
    code: `${n.key}_${f.key}`, sec: 'rs', net: n.key, field: f.key,
    label: `${f.label} ${n.label}`, kind: f.kind, fmt: 'int',
  }))),
  { code: 'rs_telechargements', sec: 'rs',   label: 'Téléchargements (réseaux)',     kind: 'flux', fmt: 'int' },
  { code: 'rs_abonnements',     sec: 'rs',   label: 'Abonnements (réseaux)',         kind: 'flux', fmt: 'int' },

  { code: 'lp_visites',         sec: 'lp',   label: 'Visites',                       kind: 'flux', fmt: 'int',   match: /^nombre de visites?$|^visites?$|sessions/ },
  { code: 'lp_pages_visite',    sec: 'lp',   label: 'Pages par visite',              kind: 'moy',  fmt: 'num',   match: /visites?\s*\/\s*pages?|pages?\s*\/\s*visites?|pages? par visite/ },
  { code: 'lp_duree',           sec: 'lp',   label: 'Durée moyenne de session',      kind: 'moy',  fmt: 'duree', match: /duree/ },
  { code: 'lp_rebond',          sec: 'lp',   label: 'Taux de rebond',                kind: 'moy',  fmt: 'pct',   match: /rebond/, better: 'down' },
  { code: 'lp_telechargements', sec: 'lp',   label: 'Téléchargements (landing)',     kind: 'flux', fmt: 'int',   match: /telechargement/ },
  { code: 'lp_abonnements',     sec: 'lp',   label: 'Abonnements (landing)',         kind: 'flux', fmt: 'int',   match: /abonnement/ },

  { code: 'meta_depense',       sec: 'meta', label: 'Budget dépensé Meta Ads',       kind: 'flux', fmt: 'eur' },
  { code: 'meta_impressions',   sec: 'meta', label: 'Impressions Meta Ads',          kind: 'flux', fmt: 'int',   match: /impression/ },
  { code: 'meta_clics',         sec: 'meta', label: 'Clics sur le lien Meta Ads',    kind: 'flux', fmt: 'int' },
  { code: 'meta_ctr',           sec: 'meta', label: 'Taux de clics Meta Ads',        kind: 'moy',  fmt: 'pct',   match: /taux de clics?|ctr/ },
  { code: 'meta_conversion',    sec: 'meta', label: 'Taux de conversion Meta Ads',   kind: 'moy',  fmt: 'pct',   match: /taux de conversion/ },
  { code: 'gads_impressions',   sec: 'gads', label: 'Impressions Google Ads',        kind: 'flux', fmt: 'int',   match: /impression/ },
  { code: 'gads_ctr',           sec: 'gads', label: 'Taux de clics Google Ads',      kind: 'moy',  fmt: 'pct',   match: /taux de clics?|ctr/ },
  { code: 'gads_conversion',    sec: 'gads', label: 'Taux de conversion Google Ads', kind: 'moy',  fmt: 'pct',   match: /taux de conversion/ },

  { code: 'churn',              sec: 'biz',  label: 'Churn mensuel',                 kind: 'moy',  fmt: 'pct',   match: /churn/, better: 'down' },
  { code: 'nps',                sec: 'biz',  label: 'NPS',                           kind: 'moy',  fmt: 'num',   match: /\bnps\b/ },
  { code: 'ltv_cac',            sec: 'biz',  label: 'Ratio LTV / CAC',               kind: 'moy',  fmt: 'ratio', match: /ltv/ },
];
const BY_CODE = Object.fromEntries(METRICS.map(m => [m.code, m]));
const SECTIONS = { rs: 'Réseaux sociaux', lp: 'Landing page', meta: 'Meta Ads', gads: 'Google Ads', biz: 'Business' };

const C = { ink: '#23261E', ink2: '#5C5F55', ink3: '#8E8F86', grid: '#F1EBE1', sageDk: '#5F6B44', meta: '#3F7FB5', gads: '#7C8F3E', terra: '#BF5223' };
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* ---------- État ---------- */
const STATE = {
  values: {}, autoLast: {}, autoRows: 0, autoSrc: {}, partial: [], unknownCodes: new Set(),
  campaigns: [], tests: [], warnings: [],
  months: [], sel: [], net: 'ig', mode: 'demo', charts: {},
  gran: 'mois', vue: 'mois', day: null, week: null, lastData: null, dataDays: new Set(),
  daily: {}, weekly: {}, days: [], weeks: [], range: null, preset: null,
};

/* ============================================================
   OUTILS
   ============================================================ */
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

function toNum(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s || /^(n\/?a|-)$/i.test(s)) return null;
  const pct = s.includes('%');
  s = s.replace(/[\s  €%]/g, '').replace(/[a-zA-Zéû]+$/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return pct ? n / 100 : n;
}

function parseDuration(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const hms = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (hms) return hms[3] !== undefined ? (+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3]) : (+hms[1]) * 60 + (+hms[2]);
  const min = s.match(/(\d+(?:[.,]\d+)?)\s*min/i);
  const sec = s.match(/(\d+(?:[.,]\d+)?)\s*s(?:ec)?\b/i);
  if (min || sec) return (min ? toNum(min[1]) * 60 : 0) + (sec ? toNum(sec[1]) : 0);
  return toNum(s);
}

function parseValue(raw, metric) {
  if (metric.fmt === 'duree') return parseDuration(raw);
  const n = toNum(raw);
  if (n === null) return null;
  if (metric.fmt === 'pct' && !String(raw).includes('%') && n > 1) return n / 100;
  return n;
}

function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ymLabel = k => { if (!k) return ''; const [y, m] = k.split('-'); return `${MONTHS_SHORT[+m - 1]} ${y}`; };
const ymShort = k => { if (!k) return ''; const [, m] = k.split('-'); return MONTHS_SHORT[+m - 1]; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const mondayOf = k => { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); return addDays(k, -((dt.getDay() + 6) % 7)); };
const dayShort = k => { const [, m, d] = k.split('-'); return `${+d} ${MONTHS_SHORT[+m - 1]}`; };
const dayLabel = k => `${dayShort(k)} ${k.slice(0, 4)}`;
/* Libellés selon la granularité choisie (mois, semaine, jour) */
const keyShort = k => STATE.gran === 'mois' ? ymShort(k) : dayShort(k);
const keyLabel = k => STATE.gran === 'mois' ? ymLabel(k) : STATE.gran === 'jour' ? dayLabel(k) : `sem. du ${dayLabel(k)}`;
const keyHead = () => ({ mois: 'Mois', semaine: 'Semaine', jour: 'Jour' }[STATE.gran]);
const fr = (n, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

function fmt(v, f) {
  if (v === null || v === undefined || !isFinite(v)) return 'n/a';
  switch (f) {
    case 'pct':   return `${fr(v * 100, v < 0.01 ? 2 : 1)} %`;
    case 'duree': { const m = Math.floor(v / 60), s = Math.round(v % 60); return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`; }
    case 'num':   return fr(v, Number.isInteger(v) ? 0 : 1);
    case 'ratio': return `${fr(v, 1)}×`;
    case 'eur':   return `${fr(v, 2)} €`;
    default:      return fr(Math.round(v));
  }
}

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const sum = arr => { const v = arr.filter(x => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const ratio = (a, b) => (a !== null && b) ? a / b : null;

/* ============================================================
   CHARGEMENT
   ============================================================ */
async function fetchCsv(url) {
  const sep = url.includes('?') ? '&' : '?';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try { res = await fetch(`${url}${sep}_=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 200))) throw new Error("L'URL ne renvoie pas un CSV (onglet publié ?)");
  return text;
}

async function loadData() {
  Object.assign(STATE, { values: {}, daily: {}, weekly: {}, days: [], weeks: [], autoLast: {}, autoRows: 0, autoSrc: {}, partial: [], unknownCodes: new Set(), campaigns: [], tests: [], warnings: [], fluxError: null });
  let error = null;

  if (CONFIG.SHEET_POA_CSV) {
    try {
      parsePoaSheet(Papa.parse(await fetchCsv(CONFIG.SHEET_POA_CSV), { skipEmptyLines: false }).data);
      STATE.mode = 'live';
    } catch (e) { error = e; console.error('Onglet POA :', e); }
  }
  if (!CONFIG.SHEET_POA_CSV || error) {
    Object.assign(STATE, { values: {}, campaigns: [], tests: [] });
    parsePoaSheet(Papa.parse(DEMO_POA_CSV, { skipEmptyLines: false }).data);
    STATE.mode = error ? 'error' : 'demo';
  }

  if (CONFIG.SHEET_FLUX_AUTO_CSV) {
    try { parseFluxAuto(Papa.parse(await fetchCsv(CONFIG.SHEET_FLUX_AUTO_CSV), { header: true, skipEmptyLines: true }).data); }
    catch (e) { console.error('Onglet Flux_auto :', e); STATE.fluxError = e; }
  }

  deriveNewFollowers();
  computeMonths();
  computeDays();
  return error;
}

function classifySection(label) {
  const s = norm(label);
  if (!s) return null;
  if (s.includes('reseau')) return 'rs';
  if (s.includes('google')) return 'gads';
  if (s.includes('meta') || s.includes('facebook ads')) return 'meta';
  if (s === 'lp' || s.includes('landing') || s.includes('site')) return 'lp';
  if (s.includes('business') || s.includes('app') || s.includes('retention')) return 'biz';
  return 'other';
}

const netFrom = text => { const s = norm(text); const n = NETS.find(x => x.re.test(s)); return n ? n.key : null; };

/* Reconnaît un indicateur réseau social ("Nombre d'abonnés", "Followers en plus"...) */
function rsField(label) {
  if (/telechargement/.test(label)) return 'telechargements';
  if (/abonnement/.test(label)) return 'abonnements_app';
  if (/followers? en plus|nouveaux (abonnes|followers)|(abonnes|followers) (en plus|gagnes)/.test(label)) return 'nouveaux';
  if (/abonnes|followers/.test(label)) return 'abonnes';
  if (/visites? du (compte|profil)|vues du profil/.test(label)) return 'visites_profil';
  if (/vues|impressions/.test(label)) return 'vues';
  if (/publication/.test(label)) return 'publications';
  if (/interaction/.test(label)) return 'interactions';
  if (/clic/.test(label)) return 'clics_lien';
  return null;
}

function setValue(code, key, v, src) {
  if (v === null || v === undefined) return;
  (STATE.values[code] ||= {})[key] = { v, src };
}

function parsePoaSheet(rows) {
  const hdrIdx = rows.findIndex(r => (r || []).some(c => norm(c) === 'janvier'));
  if (hdrIdx < 0) throw new Error("En-tête des mois introuvable dans l'onglet POA");
  const monthCols = {};
  rows[hdrIdx].forEach((c, j) => { const i = MONTHS.indexOf(norm(c)); if (i >= 0 && !(i in monthCols)) monthCols[i] = j; });
  const firstMonthCol = Math.min(...Object.values(monthCols));
  const indCol = firstMonthCol - 1;
  const platCol = indCol >= 2 ? indCol - 1 : -1;
  const keyOf = mi => `${CONFIG.ANNEE}-${String(+mi + 1).padStart(2, '0')}`;

  let section = null, platform = '', campaign = null;
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (String(row[0] ?? '').trim()) { section = classifySection(row[0]); platform = ''; campaign = null; }
    const platRaw = platCol >= 0 ? String(row[platCol] ?? '').trim() : '';
    if (platRaw) {
      platform = platRaw;
      if (section === 'meta') { campaign = newCampaign(platRaw); STATE.campaigns.push(campaign); }
    }
    const label = norm(row[indCol]);
    if (!label || !section) continue;

    if (section === 'meta' && campaign) { fillCampaign(campaign, label, row, monthCols, keyOf); continue; }

    if (section === 'rs') {
      const field = rsField(label);
      if (!field) continue;
      let code;
      if (field === 'telechargements') code = 'rs_telechargements';
      else if (field === 'abonnements_app') code = 'rs_abonnements';
      else { const net = netFrom(label) || netFrom(platform); if (!net) continue; code = `${net}_${field}`; }
      for (const [mi, j] of Object.entries(monthCols)) setValue(code, keyOf(mi), parseValue(row[j], BY_CODE[code]), 'manuel');
      continue;
    }

    const metric = METRICS.find(m => (m.sec === section || m.sec === 'biz') && m.match && m.match.test(label));
    if (!metric) continue;
    for (const [mi, j] of Object.entries(monthCols)) setValue(metric.code, keyOf(mi), parseValue(row[j], metric), 'manuel');
  }
  parseTests(rows);
}

/* ---------- Campagnes Meta Ads (un bloc par publication sponsorisée) ---------- */
function newCampaign(text) {
  let t = String(text).replace(/^publication (instagram|facebook)\s*:\s*/i, '').trim();
  const lines = t.split(/\n+/).map(l => l.trim()).filter(Boolean);
  let name = lines[0] || 'Campagne';
  if (name.replace(/[^\p{L}\p{N}]/gu, '').length < 8 && lines[1]) name = `${name} ${lines[1]}`;
  if (name.length > 70) name = name.slice(0, 68).trim() + '…';
  return { name, month: null, n: 0 };
}

function fillCampaign(c, label, row, monthCols, keyOf) {
  let raw = null, key = null;
  for (const [mi, j] of Object.entries(monthCols)) { if (String(row[j] ?? '').trim()) { raw = String(row[j]).trim(); key = keyOf(mi); break; } }
  if (raw === null) return;
  if (!c.month) c.month = key;
  const num = toNum(raw);
  if (/cout par/.test(label)) c.cpv = num;
  else if (/visites? du profil/.test(label)) c.visites = num;
  else if (/spectat|couverture|personnes touchees/.test(label)) c.reach = num;
  else if (/^vues|impressions/.test(label)) c.vues = num;
  else if (/interaction/.test(label)) c.interactions = num;
  else if (/ctr|taux de clics?/.test(label)) c.ctr = num !== null && !raw.includes('%') && num > 1 ? num / 100 : num;
  else if (/clic/.test(label)) c.clics = num;
  else if (/followers|abonnes/.test(label)) c.followers = num;
  else if (/objectif/.test(label)) c.objectif = raw;
  else if (/budget quotidien|budget par jour/.test(label)) c.budgetJour = num;
  else if (/duree/.test(label)) c.duree = num;
  else if (/depense|montant/.test(label)) c.depense = num;
}

function finalizeCampaigns() {
  STATE.campaigns = STATE.campaigns.filter(c => c.month);
  STATE.campaigns.sort((a, b) => a.month.localeCompare(b.month));
  STATE.campaigns.forEach((c, i) => {
    c.n = i + 1;
    c.short = `Campagne ${i + 1}`;
    c.depense ??= (c.budgetJour && c.duree) ? c.budgetJour * c.duree : null;
    c.cpv ??= ratio(c.depense, c.visites);
    c.cpf = ratio(c.depense, c.followers);
    c.cpc = ratio(c.depense, c.clics);
    c.ctr ??= ratio(c.clics, c.vues);
  });
}

/* ---------- Ancien tableau "Levier" (tests Meta) ---------- */
function parseTests(rows) {
  for (let i = 0; i < rows.length; i++) {
    const j = (rows[i] || []).findIndex(c => norm(c) === 'levier');
    if (j < 0) continue;
    const headers = rows[i].slice(j).map(norm);
    const col = re => { const k = headers.findIndex(h => re.test(h)); return k < 0 ? -1 : j + k; };
    const idx = { budget: col(/budget|depense/), impr: col(/impression/), clics: col(/^clics?$/), conv: col(/conversion/), gains: col(/gain|revenu/) };
    for (let k = i + 1; k < rows.length; k++) {
      const r = rows[k] || [];
      const name = String(r[j] ?? '').trim();
      if (!name) break;
      const get = c => (c < 0 ? null : toNum(r[c]));
      STATE.tests.push({ name, budget: get(idx.budget), impr: get(idx.impr), clics: get(idx.clics), conv: get(idx.conv), gains: get(idx.gains) });
    }
    break;
  }
}

/* ---------- Onglet Flux_auto ---------- */
function parseFluxAuto(rows) {
  const pick = (r, names) => { for (const k of Object.keys(r)) if (names.includes(norm(k))) return r[k]; return undefined; };
  const groups = {};
  for (const r of rows) {
    const code = norm(pick(r, ['code', 'indicateur', 'metric']));
    const d = parseDate(pick(r, ['date', 'jour']));
    if (!code || !d) continue;
    const metric = BY_CODE[code];
    if (!metric) { STATE.unknownCodes.add(code); continue; }
    const v = parseValue(pick(r, ['valeur', 'value']), metric);
    if (v === null) continue;
    STATE.autoRows++;
    const src = String(pick(r, ['source']) ?? '').trim();
    if (src) (STATE.autoSrc[code] ||= new Set()).add(src);
    ((groups[code] ||= {})[ym(d)] ||= []).push({ d, v });
    (STATE.daily[code] ||= {})[ymd(d)] = v; // détail jour par jour (vues Jour et Semaine)
    if (!STATE.autoLast[code] || d > STATE.autoLast[code]) STATE.autoLast[code] = d;
  }
  for (const [code, byMonth] of Object.entries(groups)) {
    const kind = BY_CODE[code].kind;
    for (const [key, list] of Object.entries(byMonth)) {
      list.sort((a, b) => a.d - b.d);
      const v = kind === 'stock' ? list[list.length - 1].v
        : kind === 'flux' ? list.reduce((s, x) => s + x.v, 0)
        : list.reduce((s, x) => s + x.v, 0) / list.length;
      // Un mois couvert en partie par l'automatisation ne remplace pas une saisie manuelle complète
      const cov = kind === 'stock' ? 1 : monthCoverage(key, list);
      const manual = STATE.values[code]?.[key];
      if (cov < MIN_COUVERTURE && manual && manual.src === 'manuel') { STATE.partial.push({ code, key, cov, kept: 'manuel' }); continue; }
      if (cov < MIN_COUVERTURE) STATE.partial.push({ code, key, cov, kept: 'auto' });
      setValue(code, key, v, 'auto');
    }
  }
  // CTR Meta Ads recalculé sur le mois (clics ÷ impressions) plutôt qu'une moyenne de taux journaliers
  for (const key of Object.keys(groups.meta_clics || {})) {
    const c = STATE.values.meta_clics?.[key], i = STATE.values.meta_impressions?.[key];
    if (c?.src === 'auto' && i?.src === 'auto' && i.v > 0) setValue('meta_ctr', key, c.v / i.v, 'auto');
  }
}

/* Part des jours du mois présents dans Flux_auto (mois en cours : jusqu'à la veille) */
const MIN_COUVERTURE = 0.8;
function monthCoverage(key, list) {
  const [y, m] = key.split('-').map(Number);
  let days = new Date(y, m, 0).getDate();
  const now = new Date();
  if (y === now.getFullYear() && m === now.getMonth() + 1) days = Math.max(now.getDate() - 1, 1);
  const distinct = new Set(list.map(x => x.d.toDateString())).size;
  return Math.min(distinct / days, 1);
}

/* Nouveaux abonnés calculés à partir du total d'abonnés quand la ligne "Followers en plus" manque */
function deriveNewFollowers() {
  for (const n of NETS) {
    const stock = STATE.values[`${n.key}_abonnes`];
    if (!stock) continue;
    const keys = Object.keys(stock).sort();
    keys.forEach((k, i) => {
      if (i === 0 || valM(`${n.key}_nouveaux`, k) !== null) return;
      const [y, m] = k.split('-').map(Number);
      const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
      if (stock[prevKey]) setValue(`${n.key}_nouveaux`, k, stock[k].v - stock[prevKey].v, 'calcul');
    });
  }
}

/* Jours couverts par Flux_auto (continu) et regroupement par semaine (lundi) */
function computeDays() {
  const all = new Set();
  Object.values(STATE.daily).forEach(o => Object.keys(o).forEach(k => all.add(k)));
  const today = ymd(new Date());
  const sorted = [...all].filter(k => k <= today).sort();
  STATE.days = []; STATE.weeks = []; STATE.weekly = {}; STATE.dataDays = new Set(sorted); STATE.lastData = null;
  if (!sorted.length) return;
  STATE.lastData = sorted[sorted.length - 1];
  // Les jours vont jusqu'à aujourd'hui (même sans chiffre encore) pour pouvoir les choisir
  for (let k = sorted[0]; k <= today; k = addDays(k, 1)) STATE.days.push(k);
  for (let w = mondayOf(STATE.days[0]); w <= STATE.days[STATE.days.length - 1]; w = addDays(w, 7)) STATE.weeks.push(w);
  for (const [code, byDay] of Object.entries(STATE.daily)) {
    const kind = BY_CODE[code].kind, groups = {};
    Object.keys(byDay).sort().forEach(k => (groups[mondayOf(k)] ||= []).push(byDay[k]));
    STATE.weekly[code] = Object.fromEntries(Object.entries(groups).map(([w, l]) => [w,
      kind === 'stock' ? l[l.length - 1] : kind === 'flux' ? l.reduce((a, b) => a + b, 0) : l.reduce((a, b) => a + b, 0) / l.length]));
  }
  // CTR Meta Ads par jour et par semaine : clics ÷ impressions
  for (const store of [STATE.daily, STATE.weekly]) {
    const c = store.meta_clics || {}, i = store.meta_impressions || {};
    Object.keys(c).forEach(k => { if (i[k] > 0) (store.meta_ctr ||= {})[k] = c[k] / i[k]; });
  }
}

function computeMonths() {
  finalizeCampaigns();
  const keys = new Set(STATE.campaigns.map(c => c.month));
  for (const byMonth of Object.values(STATE.values)) Object.keys(byMonth).forEach(k => keys.add(k));
  const sorted = [...keys].sort();
  if (!sorted.length) { STATE.months = [ym(new Date())]; return; }
  const out = [];
  let [y, m] = sorted[0].split('-').map(Number);
  const [ly, lm] = sorted[sorted.length - 1].split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  STATE.months = out;
}

/* ============================================================
   ACCÈS AUX VALEURS
   ============================================================ */
/* Clés de la granularité active : mois 'YYYY-MM', jours 'YYYY-MM-DD', semaines = lundi 'YYYY-MM-DD' */
const allKeys = () => STATE.gran === 'mois' ? STATE.months : STATE.gran === 'jour' ? STATE.days : STATE.weeks;
/* Clés de la période choisie (tuiles) */
function periodMonths() {
  if (STATE.vue === 'mois') return STATE.months.filter(k => STATE.sel.includes(k));
  if (STATE.vue === 'jour') return STATE.day ? [STATE.day] : [];
  if (STATE.vue === 'semaine') return STATE.week ? [STATE.week] : [];
  const { from, to } = STATE.range || {};
  return from ? STATE.days.filter(k => k >= from && k <= to) : [];
}
/* Clés affichées dans les graphiques et tableaux : un jour ou une semaine se montre dans son contexte */
function viewKeys() {
  if (STATE.vue === 'jour' && STATE.day) { const i = STATE.days.indexOf(STATE.day); return STATE.days.slice(Math.max(0, i - 13), i + 1); }
  if (STATE.vue === 'semaine' && STATE.week) { const i = STATE.weeks.indexOf(STATE.week); return STATE.weeks.slice(Math.max(0, i - 7), i + 1); }
  return periodMonths();
}
const focusMode = () => STATE.vue === 'jour' || STATE.vue === 'semaine';
/* Clés choisies consécutives ? (sinon pas de comparaison possible) */
function isContiguous(months = periodMonths()) {
  const keys = allKeys();
  const idx = months.map(k => keys.indexOf(k));
  return idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
}
function prevMonths() {
  const cur = periodMonths(), keys = allKeys();
  if (!cur.length || !isContiguous(cur)) return [];
  const i = keys.indexOf(cur[0]);
  return i - cur.length >= 0 ? keys.slice(i - cur.length, i) : [];
}
const valM = (code, key) => STATE.values[code]?.[key]?.v ?? null; // toujours mensuel
function val(code, key) {
  if (STATE.gran === 'mois') return valM(code, key);
  const v = (STATE.gran === 'jour' ? STATE.daily : STATE.weekly)[code]?.[key];
  return v === undefined ? null : v;
}
function lastPointM(code) {
  for (let i = STATE.months.length - 1; i >= 0; i--) { const v = valM(code, STATE.months[i]); if (v !== null) return { v, key: STATE.months[i] }; }
  return null;
}
const series = (code, months = viewKeys()) => months.map(k => val(code, k));
const hasAny = (codes, months = viewKeys()) => codes.some(c => months.some(k => val(c, k) !== null));

/* Agrégat d'un indicateur sur une liste de mois (somme, dernière valeur ou moyenne) */
function agg(code, months = periodMonths()) {
  const m = BY_CODE[code];
  const vals = months.map(k => val(code, k)).filter(v => v !== null);
  if (!vals.length) return null;
  if (m.kind === 'stock') return vals[vals.length - 1];
  if (m.kind === 'flux') return vals.reduce((a, b) => a + b, 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
const aggNets = (field, months) => sum(NETS.map(n => agg(`${n.key}_${field}`, months)));
const MIN_VUES_ENGAGEMENT = 50; // en dessous, le taux mensuel n'est pas significatif
const engMonth = (net, k) => { const v = val(`${net}_vues`, k); return v !== null && v >= MIN_VUES_ENGAGEMENT ? ratio(val(`${net}_interactions`, k), v) : null; };
const engagement = (net, months) => {
  const v = net ? agg(`${net}_vues`, months) : aggNets('vues', months);
  if (v === null || v < MIN_VUES_ENGAGEMENT) return null;
  return ratio(net ? agg(`${net}_interactions`, months) : aggNets('interactions', months), v);
};

function lastPoint(code, months = periodMonths()) {
  for (let i = months.length - 1; i >= 0; i--) {
    const v = val(code, months[i]);
    if (v !== null) return { v, key: months[i] };
  }
  return null;
}

function periodLabel(months = periodMonths()) {
  if (!months.length) return '';
  if (STATE.gran !== 'mois') { // période en dates réelles
    const a = months[0], b = STATE.gran === 'jour' ? months[months.length - 1] : addDays(months[months.length - 1], 6);
    const fin = STATE.days.length && b > STATE.days[STATE.days.length - 1] ? STATE.days[STATE.days.length - 1] : b;
    return a === fin ? dayLabel(a) : `${dayShort(a)} au ${dayLabel(fin)}`;
  }
  if (months.length === 1) return ymLabel(months[0]);
  if (isContiguous(months)) return `${ymShort(months[0])} à ${ymLabel(months[months.length - 1])}`;
  if (months.length > 4) return `${months.length} mois choisis`;
  return `${months.slice(0, -1).map(ymShort).join(', ')} et ${ymLabel(months[months.length - 1])}`;
}

/* ============================================================
   COMPOSANTS HTML
   ============================================================ */
function deltaHtml(cur, prev, f, better = 'up') {
  if (cur === null || prev === null || cur === undefined || prev === undefined) return '';
  let txt, diff;
  if (f === 'pct') { diff = (cur - prev) * 100; txt = `${diff >= 0 ? '+' : ''}${fr(diff, 1)} pt`; }
  else if (prev === 0) { if (cur === 0) return ''; diff = cur; txt = `+${fr(cur)}`; }
  else { diff = (cur - prev) / Math.abs(prev) * 100; txt = diff > 999 ? '> +999 %' : `${diff >= 0 ? '+' : ''}${fr(diff, 0)} %`; }
  const cls = Math.abs(diff) < 0.05 ? 'flat' : ((diff > 0) === (better === 'up') ? 'up' : 'down');
  const arrow = cls === 'flat' ? '' : (diff > 0 ? '↑ ' : '↓ ');
  return `<span class="delta ${cls}">${arrow}${txt}</span>`;
}

/* Tuile : valeur sur la période + comparaison à la période précédente de même durée */
function tile({ label, value, prev = null, f = 'int', accent, better = 'up', note = '', extra = '' }) {
  const empty = value === null || value === undefined;
  const pm = prevMonths();
  const cmp = prev !== null && pm.length ? `vs ${periodLabel(pm)}` : periodLabel();
  const foot = empty ? 'Pas encore de donnée' : `${deltaHtml(value, prev, f, better)}<span>${note || cmp}</span>`;
  return `<div class="tile" style="${accent ? `--accent:${accent}` : ''}">
    <div class="tile-label">${accent ? '<span class="sw"></span>' : ''}${escapeHtml(label)}</div>
    <div class="tile-value ${empty ? 'empty' : ''}">${empty ? '·' : fmt(value, f)}</div>
    <div class="tile-foot">${foot}</div>${extra}</div>`;
}

const emptyState = (title, hint) => `<div class="empty-state"><strong>${title}</strong><span>${hint}</span></div>`;
const ICONS = {
  good: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  bad:  '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 6v7M12 16.5v.5"/></svg>',
  none: '<svg viewBox="0 0 24 24"><path d="M8 12h8"/></svg>',
};
const statusHtml = (cls, label) => `<span class="status ${cls}">${ICONS[cls] || ''}${label}</span>`;

/* ============================================================
   GRAPHIQUES
   ============================================================ */
function setupChartDefaults() {
  if (window['chartjs-plugin-annotation']) Chart.register(window['chartjs-plugin-annotation']);
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = C.ink2;
  Chart.defaults.transitions.resize = { animation: { duration: 0 } };
  Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: '#2E3424', padding: 12, cornerRadius: 10, boxPadding: 6, usePointStyle: true,
    titleFont: { weight: '600' }, bodyFont: { size: 12 } });
  const genLabels = Chart.defaults.plugins.legend.labels.generateLabels;
  Chart.defaults.plugins.legend.labels.generateLabels = chart => genLabels(chart).map(it => {
    const ds = chart.data.datasets[it.datasetIndex];
    if (ds && ds.legendColor) { it.fillStyle = ds.legendColor; it.strokeStyle = ds.legendColor; }
    return it;
  });
  Object.assign(Chart.defaults.plugins.legend.labels, { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16, color: C.ink });
}

/* Axe de comptage : graduations entières uniquement (évite « 1, 1, 0 » quand les valeurs sont faibles) */
const fint = v => fr(v);
function baseScales(yTick = fint, stacked = false) {
  return {
    x: { stacked, grid: { display: false }, border: { color: '#E6DED0' }, ticks: { color: C.ink3 } },
    y: { stacked, beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.ink3, callback: yTick, maxTicksLimit: 6, ...(yTick === fint ? { precision: 0 } : {}) }, suggestedMax: yTick === fint ? 4 : undefined },
  };
}

function drawChart(id, config, hasData, emptyTitle, emptyHint) {
  if (STATE.charts[id]) { STATE.charts[id].destroy(); delete STATE.charts[id]; }
  const wrap = $(`wrap-${id}`);
  if (!hasData) { wrap.innerHTML = emptyState(emptyTitle, emptyHint); return; }
  wrap.innerHTML = `<canvas id="c-${id}" role="img" aria-label="${escapeHtml(emptyTitle)}"></canvas>`;
  const visible = !!wrap.closest('.page.active');
  config.options = { ...(config.options || {}), animation: visible ? { duration: 450 } : false };
  STATE.charts[id] = new Chart($(`c-${id}`), config);
}

const lineDs = (label, data, color) => ({
  label, data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: .3,
  pointRadius: 4, pointHoverRadius: 6, pointBorderColor: '#fff', pointBorderWidth: 2, spanGaps: true,
});
const barDs = (label, data, color, extra = {}) => ({
  label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'start', borderColor: '#fff',
  borderWidth: { top: 0, left: 1, right: 1, bottom: 0 }, maxBarThickness: 34, ...extra,
});
/* Barres d'une série temporelle : en vue Jour ou Semaine, la période choisie est pleine, le contexte est atténué */
function fbar(label, data, color, extra = {}) {
  const ds = barDs(label, data, color, extra);
  if (focusMode()) {
    const f = new Set(periodMonths());
    ds.backgroundColor = viewKeys().map(k => (f.has(k) ? color : color + '59'));
    ds.legendColor = color;
  }
  return ds;
}
const commonOpts = (yTick, stacked = false, legend = true, tip) => ({
  responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: legend, position: 'bottom' }, ...(tip ? { tooltip: { callbacks: tip } } : {}) },
  scales: baseScales(yTick, stacked),
});
const netCodes = field => NETS.map(n => `${n.key}_${field}`);

/* ============================================================
   PAGE : VUE D'ENSEMBLE
   ============================================================ */
function renderVue() {
  const months = periodMonths(), pm = prevMonths();
  const P = m => m.length ? m : null;
  const vues = aggNets('vues', months), vuesP = P(pm) && aggNets('vues', pm);
  const inter = aggNets('interactions', months), interP = P(pm) && aggNets('interactions', pm);
  const eng = engagement(null, months), engP = P(pm) && engagement(null, pm);
  const nouv = aggNets('nouveaux', months), nouvP = P(pm) && aggNets('nouveaux', pm);

  $('tiles-vue').innerHTML = [
    tile({ label: 'Vues des publications', value: vues, prev: vuesP ?? null }),
    tile({ label: 'Interactions', value: inter, prev: interP ?? null }),
    tile({ label: "Taux d'engagement", value: eng, prev: engP ?? null, f: 'pct' }),
    tile({ label: 'Nouveaux abonnés', value: nouv, prev: nouvP ?? null }),
  ].join('');

  drawChart('communaute', {
    type: 'bar',
    data: { labels: viewKeys().map(keyShort), datasets: NETS.map(n => fbar(n.label, series(`${n.key}_vues`), n.color, { stack: 'v' })) },
    options: commonOpts(fint, true, true, { footer: items => `Total : ${fr(items.reduce((s, i) => s + (i.raw || 0), 0))}` }),
  }, hasAny(netCodes('vues')), 'Aucune vue renseignée', "Onglet POA, lignes « Vues de publication »");

  $('objectifs').innerHTML = CONFIG.OBJECTIFS.map(o => {
    const p = lastPointM(o.code);
    const cible = `${o.sens === 'max' ? '<' : '≥'} ${fmt(o.cible, o.format)}`;
    const st = !p ? statusHtml('none', 'À brancher')
      : (o.sens === 'max' ? p.v < o.cible : p.v >= o.cible) ? statusHtml('good', 'Atteint') : statusHtml('bad', 'Sous la cible');
    return `<div class="obj"><div><div class="obj-name">${escapeHtml(o.label)}</div><div class="obj-target">Cible ${cible}${p ? ` · ${ymLabel(p.key)}` : ''}</div></div>
      <div class="obj-right">${p ? `<span class="obj-val">${fmt(p.v, o.format)}</span>` : ''}${st}</div></div>`;
  }).join('') + `<p class="note">Ajoute une ligne Churn, NPS ou LTV / CAC dans l'onglet POA, ou les codes <code>churn</code>, <code>nps</code>, <code>ltv_cac</code> dans Flux_auto.</p>`;

  const dl = sum([agg('rs_telechargements', months), agg('lp_telechargements', months)]);
  const ab = sum([agg('rs_abonnements', months), agg('lp_abonnements', months)]);
  $('funnel').innerHTML = funnelHtml([
    { label: 'Vues', v: vues },
    { label: 'Visites du profil', v: aggNets('visites_profil', months) },
    { label: 'Clics sur un lien', v: aggNets('clics_lien', months) },
    { label: 'Téléchargements', v: dl },
    { label: 'Abonnements', v: ab },
  ], 'Tunnel vide', 'Les vues, visites et clics apparaîtront dès la première saisie');

  renderBestCampaign();
}

function renderBestCampaign() {
  const list = STATE.campaigns.filter(c => c.cpf !== null || c.cpv !== null);
  if (!list.length) { $('best-test').innerHTML = emptyState('Aucune campagne Meta', 'Ajoute un bloc de campagne dans la section Meta Ads du Sheet'); return; }
  const score = c => c.cpf ?? c.cpv * 10;
  const b = list.reduce((a, c) => (score(c) < score(a) ? c : a));
  $('best-test').innerHTML = `<div class="best">
    <div class="best-name"><span>${escapeHtml(b.name)}</span>${statusHtml('good', `${b.short} · ${ymLabel(b.month)}`)}</div>
    <div class="kv"><span>Dépensé</span><strong>${fmt(b.depense, 'eur')}</strong></div>
    <div class="kv"><span>Nouveaux abonnés</span><strong>${fmt(b.followers)}</strong></div>
    <div class="kv"><span>Coût par abonné</span><strong>${fmt(b.cpf, 'eur')}</strong></div></div>
    <p class="note">Critère : coût par nouvel abonné le plus bas. ${b.visites !== undefined ? `${fmt(b.visites)} visites du profil à ${fmt(b.cpv, 'eur')} l'une.` : ''}</p>`;
}

function funnelHtml(steps, emptyTitle, emptyHint) {
  if (steps.every(s => s.v === null)) return emptyState(emptyTitle, emptyHint);
  const max = Math.max(...steps.map(s => s.v || 0), 1);
  let html = '<div class="funnel">';
  steps.forEach((s, i) => {
    if (i > 0) {
      const p = steps[i - 1].v;
      const rate = p && s.v !== null ? `↓ ${fr(s.v / p * 100, s.v / p < 0.01 ? 2 : 1)} % passent à l'étape suivante` : '';
      html += `<div class="f-step"><span></span><div class="f-rate">${rate}</div></div>`;
    }
    html += `<div class="f-step"><span class="f-label">${s.label}</span>
      <div class="f-bar">${s.v === null ? '' : `<div class="f-fill" style="width:${Math.max(s.v / max * 100, 1.2)}%;opacity:${1 - i * 0.12}"></div>`}</div>
      <span class="f-val">${s.v === null ? '·' : fmt(s.v)}</span></div>`;
  });
  return html + '</div>';
}

/* ============================================================
   PAGE : RÉSEAUX SOCIAUX
   ============================================================ */
function renderReseaux() {
  const months = periodMonths(), pm = prevMonths();
  const n = NETS.find(x => x.key === STATE.net) || NETS[0];
  const code = f => `${n.key}_${f}`;

  // Onglets : un réseau à la fois
  $('net-tabs').innerHTML = NETS.map(x => `<button type="button" role="tab" class="net-tab ${x.key === n.key ? 'active' : ''}"
      aria-selected="${x.key === n.key}" data-net="${x.key}" style="--accent:${x.color}"><span class="sw-inline" style="background:${x.color}"></span>${x.label}</button>`).join('');

  const t = (f, label, opts = {}) => tile({ label, value: agg(code(f), months), prev: pm.length ? agg(code(f), pm) : null, accent: n.color, ...opts });
  const lastSel = months[months.length - 1];
  const abK = lastPoint(code('abonnes'), allKeys().filter(k => k <= lastSel));
  const abM = abK ? null : lastPointM(code('abonnes')); // repli sur la dernière saisie mensuelle
  const ab = abK ? { v: abK.v, lbl: keyLabel(abK.key) } : abM ? { v: abM.v, lbl: ymLabel(abM.key) } : null;
  $('tiles-reseaux').innerHTML = [
    t('vues', 'Vues des publications'),
    t('interactions', 'Interactions'),
    tile({ label: "Taux d'engagement", value: engagement(n.key, months), prev: pm.length ? engagement(n.key, pm) : null, f: 'pct', accent: n.color }),
    t('publications', 'Publications'),
    t('visites_profil', 'Visites du profil'),
    t('clics_lien', 'Clics sur le lien'),
    t('nouveaux', 'Nouveaux abonnés'),
    tile({ label: 'Abonnés au total', value: ab ? ab.v : null, accent: n.color, note: ab ? `relevé : ${ab.lbl}` : '' }),
  ].join('');

  const vk = viewKeys(), labels = vk.map(keyShort);
  const src = `Onglet POA, section Réseaux sociaux, ${n.label}`;
  drawChart('abonnes', { type: 'bar', data: { labels, datasets: [fbar('Vues', series(code('vues')), n.color)] }, options: commonOpts(fint, false, false) },
    hasAny([code('vues')]), `Aucune vue ${n.label} renseignée`, src);
  drawChart('interactions', { type: 'bar', data: { labels, datasets: [fbar('Interactions', series(code('interactions')), n.color)] }, options: commonOpts(fint, false, false) },
    hasAny([code('interactions')]), `Aucune interaction ${n.label} renseignée`, src);

  const eng = vk.map(k => engMonth(n.key, k));
  drawChart('publications', { type: 'line', data: { labels, datasets: [Object.assign(lineDs('Taux d\'engagement', eng, n.color), focusMode() ? { pointRadius: vk.map(k => (periodMonths().includes(k) ? 7 : 3)) } : {})] },
    options: commonOpts(v => `${fr(v * 100, Math.round(v * 1000) % 10 ? 1 : 0)} %`, false, false, { label: i => `Taux d'engagement : ${i.raw === null ? 'n/a' : fmt(i.raw, 'pct')}` }) },
    eng.some(v => v !== null), "Pas encore de taux d'engagement", `Calculé pour les mois à ${MIN_VUES_ENGAGEMENT} vues ou plus`);

  const aud = [['visites_profil', 'Visites du profil', C.sageDk], ['clics_lien', 'Clics sur le lien', C.gads], ['nouveaux', 'Nouveaux abonnés', n.color]];
  drawChart('pubs', { type: 'bar', data: { labels, datasets: aud.map(([f, l, c]) => fbar(l, series(code(f)), c)) }, options: commonOpts(fint) },
    hasAny(aud.map(([f]) => code(f))), `Aucune donnée d'audience ${n.label}`, src);

  // Détail : une ligne par mois, pour ce réseau seulement
  $('t-net-title').textContent = `Détail par mois · ${n.label}`;
  const fields = ['publications', 'vues', 'interactions', 'eng', 'visites_profil', 'clics_lien', 'nouveaux', 'abonnes'];
  const heads = { publications: 'Publications', vues: 'Vues', interactions: 'Interactions', eng: 'Engagement', visites_profil: 'Visites profil', clics_lien: 'Clics lien', nouveaux: 'Nouveaux abonnés', abonnes: 'Abonnés au total' };
  const focus = new Set(focusMode() ? periodMonths() : []);
  const rows = vk.slice().reverse().filter(k => NET_FIELDS.some(f => val(code(f.key), k))).map(k =>
    `<tr class="${focus.has(k) ? 'row-focus' : ''}"><td>${keyLabel(k)}</td>${fields.map(f => f === 'eng'
      ? `<td class="num ${engMonth(n.key, k) === null ? 'na' : ''}">${engMonth(n.key, k) === null ? '·' : fmt(engMonth(n.key, k), 'pct')}</td>`
      : cell(val(code(f), k))).join('')}</tr>`);
  $('t-efficacite').innerHTML = rows.length
    ? `<table><thead><tr><th>${keyHead()}</th>${fields.map(f => `<th class="num">${heads[f]}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
       <p class="note">Taux d'engagement = interactions ÷ vues, affiché à partir de ${MIN_VUES_ENGAGEMENT} vues. Les ${keyHead().toLowerCase()}s sans aucune activité sont masqués.</p>`
    : emptyState(`Aucune donnée ${n.label} sur la période`, 'Les lignes apparaîtront dès la première saisie');
}
const cell = (v, f = 'int') => `<td class="num ${v === null ? 'na' : ''}">${v === null ? '·' : fmt(v, f)}</td>`;

/* ============================================================
   PAGE : LANDING PAGE
   ============================================================ */
function renderLanding() {
  const months = periodMonths(), pm = prevMonths();
  const t = (code, label, f) => tile({ label, value: agg(code, months), prev: pm.length ? agg(code, pm) : null, f, better: BY_CODE[code].better || 'up' });
  $('tiles-landing').innerHTML = [
    t('lp_visites', 'Visites', 'int'), t('lp_pages_visite', 'Pages par visite', 'num'),
    t('lp_duree', 'Durée moyenne de session', 'duree'), t('lp_rebond', 'Taux de rebond', 'pct'),
  ].join('');

  drawChart('visites', { type: 'bar', data: { labels: viewKeys().map(keyShort), datasets: [fbar('Visites', series('lp_visites'), C.sageDk)] }, options: commonOpts(fint, false, false) },
    hasAny(['lp_visites']), 'Aucune visite renseignée', STATE.gran === 'mois' ? "Saisis les visites dans la section LP de l'onglet POA" : MSG_MENSUEL);

  $('funnel-lp').innerHTML = funnelHtml([
    { label: 'Visites', v: agg('lp_visites', months) },
    { label: 'Téléchargements', v: agg('lp_telechargements', months) },
    { label: 'Abonnements', v: agg('lp_abonnements', months) },
  ], 'Tunnel vide', STATE.gran === 'mois' ? 'Les données de la landing page sont encore à saisir' : MSG_MENSUEL);

  $('t-landing').innerHTML = tableByMonth(['lp_visites', 'lp_pages_visite', 'lp_duree', 'lp_rebond', 'lp_telechargements', 'lp_abonnements'], viewKeys());
}

const MSG_MENSUEL = 'Ces chiffres sont saisis au mois : passe en vue Mois pour les voir';
/* Jours réellement couverts par la période (vue Jour ou Semaine) */
function periodDays() {
  if (STATE.vue === 'jour') return STATE.day ? [STATE.day] : [];
  if (STATE.vue === 'semaine') return STATE.week ? [0, 1, 2, 3, 4, 5, 6].map(i => addDays(STATE.week, i)) : [];
  const { from, to } = STATE.range || {};
  return from ? STATE.days.filter(k => k >= from && k <= to) : [];
}

function tableByMonth(codes, months) {
  const rows = months.filter(k => codes.some(c => val(c, k) !== null));
  if (!rows.length) return emptyState('Aucune donnée sur la période', STATE.gran === 'mois' ? 'Les lignes apparaîtront dès la première saisie' : MSG_MENSUEL);
  return `<table><thead><tr><th>${keyHead()}</th>${codes.map(c => `<th class="num">${escapeHtml(BY_CODE[c].label)}</th>`).join('')}</tr></thead><tbody>
    ${rows.slice().reverse().map(k => `<tr><td>${keyLabel(k)}</td>${codes.map(c => cell(val(c, k), BY_CODE[c].fmt)).join('')}</tr>`).join('')}</tbody></table>`;
}

/* ============================================================
   PAGE : PUBLICITÉ
   ============================================================ */
function renderPub() {
  const months = periodMonths();
  const all = STATE.campaigns;
  const mensuel = STATE.gran === 'mois';
  // Les campagnes sont saisies au mois : en vue Jour ou Semaine, on montre celles des mois touchés par la période
  const moisCouverts = mensuel ? months : [...new Set(periodDays().map(k => k.slice(0, 7)))];
  const camps = all.filter(c => moisCouverts.includes(c.month));
  const outside = all.length - camps.length;
  $('hint-tests').textContent = `${camps.length} campagne${camps.length > 1 ? 's' : ''} ${mensuel ? 'sur la période' : 'sur les mois couverts (saisie mensuelle)'}${outside ? ` · ${outside} hors période` : ''}`;

  // Tuiles : blocs de campagne en vue Mois, sinon chiffres quotidiens du compte publicitaire (Flux_auto)
  const tot = k => mensuel ? sum(camps.map(c => c[k] ?? null)) : null;
  const ctrAuto = ratio(agg('meta_clics', months), agg('meta_impressions', months));
  const spent = tot('depense') ?? agg('meta_depense', months);
  $('tiles-pub').innerHTML = [
    tile({ label: 'Budget dépensé', value: spent, f: 'eur', note: periodLabel() }),
    tile({ label: 'Visites du profil obtenues', value: tot('visites'), note: `${fmt(ratio(spent, tot('visites')), 'eur')} par visite` }),
    tile({ label: 'Clics sur le lien', value: tot('clics') ?? agg('meta_clics', months), note: `CTR ${fmt(ratio(tot('clics'), tot('vues')) ?? ctrAuto ?? agg('meta_ctr', months), 'pct')}` }),
    tile({ label: 'Nouveaux abonnés', value: tot('followers'), note: `${fmt(ratio(spent, tot('followers')), 'eur')} par abonné` }),
  ].join('');

  $('t-tests').innerHTML = camps.length ? `<table class="compact"><thead><tr>
      <th>Campagne</th><th class="num">Dépensé</th><th class="num">Vues</th>
      <th class="num">Interactions</th><th class="num">Visites</th><th class="num">€ / visite</th><th class="num">Clics</th><th class="num">CTR</th>
      <th class="num">Abonnés</th><th class="num">€ / abonné</th></tr></thead><tbody>
    ${camps.map(c => `<tr><td class="camp-name"><strong>${c.short}</strong><span>${escapeHtml(c.name)}</span><em>${ymLabel(c.month)}${c.duree ? ` · ${fmt(c.duree)} jours` : ''}${c.reach ? ` · ${fmt(c.reach)} personnes touchées` : ''}${c.objectif ? `<br>Objectif : ${escapeHtml(c.objectif)}` : ''}</em></td>
      ${cell(c.depense ?? null, 'eur')}${cell(c.vues ?? null)}${cell(c.interactions ?? null)}
      ${cell(c.visites ?? null)}${cell(c.cpv ?? null, 'eur')}${cell(c.clics ?? null)}${cell(c.ctr ?? null, 'pct')}
      ${cell(c.followers ?? null)}<td class="num"><strong>${c.cpf !== null ? fmt(c.cpf, 'eur') : '·'}</strong></td></tr>`).join('')}
    </tbody></table>${levierNote()}`
    : emptyState('Aucune campagne sur la période', all.length ? 'Élargis la période pour voir les autres campagnes' : 'Ajoute un bloc de campagne dans la section Meta Ads du Sheet');

  const lab = camps.map(c => c.short);
  drawChart('cpa', { type: 'bar', data: { labels: lab, datasets: [
      barDs('Coût par visite du profil', camps.map(c => c.cpv ?? null), C.meta),
      barDs('Coût par clic sur le lien', camps.map(c => c.cpc ?? null), C.gads),
      barDs('Coût par nouvel abonné', camps.map(c => c.cpf ?? null), C.terra)] },
    options: commonOpts(v => `${fr(v, 2)} €`, false, true, { label: i => `${i.dataset.label} : ${fmt(i.raw, 'eur')}` }) },
    camps.length > 0, 'Aucune campagne', 'Les coûts unitaires apparaîtront ici');

  drawChart('roas', { type: 'bar', data: { labels: lab, datasets: [
      barDs('Visites du profil', camps.map(c => c.visites ?? null), C.meta),
      barDs('Clics sur le lien', camps.map(c => c.clics ?? null), C.gads),
      barDs('Nouveaux abonnés', camps.map(c => c.followers ?? null), C.terra)] },
    options: commonOpts(fint) }, camps.length > 0, 'Aucune campagne', 'Les résultats apparaîtront ici');

  // Impressions du compte si elles existent, sinon vues saisies dans les blocs de campagne (jamais les deux)
  const metaVues = viewKeys().map(k => val('meta_impressions', k) ?? (mensuel ? sum(all.filter(c => c.month === k).map(c => c.vues ?? null)) : null));
  drawChart('impr', { type: 'bar', data: { labels: viewKeys().map(keyShort), datasets: [
      fbar('Meta Ads', metaVues, C.meta), fbar('Google Ads', series('gads_impressions'), C.gads)] }, options: commonOpts(fint) },
    metaVues.some(v => v !== null) || hasAny(['gads_impressions']), 'Aucune diffusion', 'Sections Meta Ads et Google Ads');

  $('t-campagnes').innerHTML = tableByMonth(['gads_impressions', 'gads_ctr', 'gads_conversion'], viewKeys());
}

function levierNote() {
  const t = STATE.tests.filter(x => x.gains !== null && x.conv !== null);
  if (!t.length) return '<p class="note">Coûts recalculés par le dashboard à partir du montant dépensé.</p>';
  return `<p class="note warn-note"><strong>Attention au tableau « Levier » du Sheet :</strong> il compte ${t.map(x => `${fmt(x.conv)} conversions`).join(' et ')} valorisées à 50 € (${t.map(x => fmt(x.gains) + ' €').join(', ')}). Ces conversions correspondent aux abonnés Instagram gagnés, pas à des abonnements payants à l'app : ces gains ne sont pas repris ici.</p>`;
}

/* ============================================================
   PAGE : SOURCES & AUTOMATISATION
   ============================================================ */
function renderSources() {
  const filled = METRICS.filter(m => STATE.values[m.code]);
  const auto = METRICS.filter(m => Object.values(STATE.values[m.code] || {}).some(x => x.src === 'auto'));
  const lastAuto = Object.values(STATE.autoLast).sort((a, b) => b - a)[0];

  $('tiles-sources').innerHTML = [
    tile({ label: 'Indicateurs suivis', value: METRICS.length, note: `+ ${STATE.campaigns.length} campagne${STATE.campaigns.length > 1 ? 's' : ''} Meta` }),
    tile({ label: 'Indicateurs renseignés', value: filled.length, note: 'au moins une valeur' }),
    tile({ label: 'Alimentés automatiquement', value: auto.length, note: 'via Flux_auto' }),
    `<div class="tile"><div class="tile-label">Dernier flux automatique</div>
      <div class="tile-value ${lastAuto ? '' : 'empty'}">${lastAuto ? lastAuto.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : 'Non branché'}</div>
      <div class="tile-foot">${CONFIG.SHEET_FLUX_AUTO_CSV ? `${fr(STATE.autoRows)} lignes lues` : 'Onglet Flux_auto à publier'}</div></div>`,
  ].join('');

  const order = { rs: 0, lp: 1, meta: 2, gads: 3, biz: 4 };
  const rows = METRICS.slice().sort((a, b) => order[a.sec] - order[b.sec]).map(m => {
    const p = lastPointM(m.code);
    const srcs = new Set(Object.values(STATE.values[m.code] || {}).map(x => x.src));
    const autoNames = STATE.autoSrc[m.code] ? [...STATE.autoSrc[m.code]].join(', ') : '';
    const src = srcs.has('auto') ? `<span class="src auto" title="${escapeHtml(autoNames)}">Auto</span>${autoNames ? `<span class="src-detail">${escapeHtml(autoNames)}</span>` : ''}` : srcs.has('manuel') ? '<span class="src manuel">Manuel</span>'
      : srcs.has('calcul') ? '<span class="src manuel">Calculé</span>' : '<span class="src vide">Vide</span>';
    return `<tr><td><span class="sec-tag">${SECTIONS[m.sec]}</span></td><td>${escapeHtml(m.label)}</td><td><code>${m.code}</code></td>
      <td class="num ${p ? '' : 'na'}">${p ? fmt(p.v, m.fmt) : '·'}</td><td>${p ? ymLabel(p.key) : '<span class="na">Jamais</span>'}</td><td>${src}</td></tr>`;
  }).join('');
  const kept = STATE.partial.filter(x => x.kept === 'manuel');
  const partialNote = kept.length ? `<p class="note">Saisie manuelle conservée quand l'automatisation ne couvre qu'une partie du mois (moins de ${MIN_COUVERTURE * 100} % des jours) : ${kept.map(x => `<code>${x.code}</code> ${ymLabel(x.key)} (${Math.round(x.cov * 100)} %)`).join(', ')}.</p>` : '';
  const unknown = STATE.unknownCodes.size ? `<p class="note">Codes inconnus ignorés dans Flux_auto : ${[...STATE.unknownCodes].map(c => `<code>${escapeHtml(c)}</code>`).join(' ')}</p>` : '';
  $('t-sources').innerHTML = `<table><thead><tr><th>Section</th><th>Indicateur</th><th>Code</th><th class="num">Dernière valeur</th><th>Mois</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>${partialNote}${unknown}`;
}

/* ============================================================
   NAVIGATION, PÉRIODE, ORCHESTRATION
   ============================================================ */
const PAGES = ['vue', 'reseaux', 'landing', 'pub', 'sources'];

function showPage(id) {
  if (!PAGES.includes(id)) id = 'vue';
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${id}`));
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.page === id));
  const page = $(`page-${id}`);
  const title = page.dataset.title.replace('&amp;', '&');
  $('page-title').textContent = title;
  $('page-sub').textContent = page.dataset.sub;
  document.title = `POA · ${title}`;
  requestAnimationFrame(() => Object.values(STATE.charts).forEach(c => { if (c.canvas.closest('.page.active')) c.resize(); }));
}

function initPeriod() {
  STATE.sel = STATE.sel.filter(k => STATE.months.includes(k));
  if (!STATE.sel.length) STATE.sel = STATE.months.slice();
  if (STATE.vue !== 'mois' && !STATE.days.length) setVue('mois'); // pas de données quotidiennes
  if (STATE.days.length) {
    const today = STATE.days[STATE.days.length - 1];
    STATE.day = clampDay(STATE.day || STATE.lastData);
    STATE.week = clampWeek(STATE.week || addDays(mondayOf(today), -7)); // par défaut : la semaine dernière
    if (!STATE.range || STATE.preset) applyPreset(STATE.preset || '30j');
    else STATE.range = { from: clampDay(STATE.range.from), to: clampDay(STATE.range.to) };
  }
  renderPeriod();
}
const clampDay = k => { const f = STATE.days[0], l = STATE.days[STATE.days.length - 1]; return k < f ? f : k > l ? l : k; };
const clampWeek = w => { const f = STATE.weeks[0], l = STATE.weeks[STATE.weeks.length - 1]; return w < f ? f : w > l ? l : w; };
function setVue(v) { STATE.vue = v; STATE.gran = v === 'perso' ? 'jour' : v; }

/* Raccourcis de la vue Personnalisé, calculés à partir du dernier jour qui a des chiffres */
const PRESETS = [['7j', '7 derniers jours'], ['30j', '30 derniers jours'], ['90j', '90 derniers jours'], ['mois', 'Ce mois-ci'], ['moisprec', 'Mois dernier'], ['tout', 'Tout']];
function applyPreset(id) {
  const last = STATE.lastData || STATE.days[STATE.days.length - 1], first = STATE.days[0];
  const n = { '7j': 7, '30j': 30, '90j': 90 }[id];
  let from, to = last;
  if (n) from = addDays(last, -(n - 1));
  else if (id === 'mois') from = last.slice(0, 8) + '01';
  else if (id === 'moisprec') { to = addDays(last.slice(0, 8) + '01', -1); from = to.slice(0, 8) + '01'; }
  else { from = first; id = 'tout'; }
  STATE.range = { from: clampDay(from), to: clampDay(to) };
  STATE.preset = id;
}

const JOURS_SEM = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const weekdayOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const dayFull = k => `${JOURS_SEM[weekdayOf(k)]} ${dayLabel(k)}`;
function weekText(w) {
  const fin = addDays(w, 6);
  return w.slice(5, 7) === fin.slice(5, 7) ? `semaine du ${+w.slice(8)} au ${dayLabel(fin)}` : `semaine du ${dayShort(w)} au ${dayLabel(fin)}`;
}

function renderPeriod() {
  const v = STATE.vue, hasDaily = STATE.days.length > 0;
  $('gran').innerHTML = [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['perso', 'Personnalisé']].map(([k, l]) => {
    const off = k !== 'mois' && !hasDaily;
    return `<button type="button" data-g="${k}" class="${v === k ? 'on' : ''}" aria-pressed="${v === k}" ${off ? 'disabled title="Disponible dès que l\'automatisation alimente Flux_auto"' : ''}>${l}</button>`;
  }).join('');
  $('cal-btn').hidden = v === 'mois';
  closeCal();
  if (v === 'mois') { renderChips(); return; }

  const today = STATE.days[STATE.days.length - 1];
  let chips = [], label = '', hint = '';
  if (v === 'jour') {
    chips = [[today, 'Aujourd’hui'], [addDays(today, -1), 'Hier']].map(([d, l]) => [`d:${d}`, l, STATE.day === d]);
    label = dayFull(STATE.day);
    hint = STATE.lastData && STATE.day > STATE.lastData
      ? 'Pas encore de chiffres pour ce jour : ils arrivent le lendemain vers 7 h.'
      : 'Comparé à la veille · graphiques : les 14 jours jusqu’au jour choisi';
  } else if (v === 'semaine') {
    const cette = mondayOf(today);
    chips = [[cette, 'Cette semaine'], [addDays(cette, -7), 'Semaine dernière']].map(([w, l]) => [`w:${w}`, l, STATE.week === w]);
    label = weekText(STATE.week);
    const jours = STATE.lastData ? Math.max(0, Math.min(7, (Date.parse(STATE.lastData) - Date.parse(STATE.week)) / 86400000 + 1)) : 0;
    hint = (jours < 7 ? `Semaine en cours : ${jours} jour${jours > 1 ? 's' : ''} sur 7 disponibles · ` : '') + 'Comparée à la semaine précédente · graphiques : les 8 semaines jusqu’à celle choisie';
  } else {
    chips = PRESETS.map(([id, l]) => [`p:${id}`, l, STATE.preset === id]);
    label = periodLabel();
    const n = periodMonths().length;
    hint = `${n} jour${n > 1 ? 's' : ''} · comparé aux ${n} jours précédents`;
  }
  $('period-chips').innerHTML = chips.map(([k, l, on]) => `<button type="button" class="chip ${on ? 'on' : ''}" data-q="${k}" aria-pressed="${on}">${l}</button>`).join('');
  $('cal-label').textContent = label;
  $('period-hint').textContent = hint;
}

/* ============================================================
   CALENDRIER (jour, semaine ou période)
   ============================================================ */
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const CAL = { mode: null, month: null, start: null, hover: null };
const shiftMonth = (ymk, n) => { const [y, m] = ymk.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const calMonths = () => (CAL.mode === 'range' && window.innerWidth >= 720 ? 2 : 1);

function openCal() {
  CAL.mode = { jour: 'day', semaine: 'week', perso: 'range' }[STATE.vue];
  const ref = STATE.vue === 'jour' ? STATE.day : STATE.vue === 'semaine' ? addDays(STATE.week, 6) : STATE.range.to;
  CAL.month = shiftMonth(ref.slice(0, 7), 1 - calMonths());
  CAL.start = null; CAL.hover = null;
  $('cal-pop').hidden = false;
  $('cal-btn').setAttribute('aria-expanded', 'true');
  renderCal();
}
function closeCal() {
  if (!$('cal-pop')) return;
  $('cal-pop').hidden = true; CAL.mode = null;
  $('cal-btn').setAttribute('aria-expanded', 'false');
}

function renderCal() {
  const n = calMonths(), min = STATE.days[0], max = STATE.days[STATE.days.length - 1];
  const first = CAL.month, last = shiftMonth(first, n - 1);
  const canPrev = shiftMonth(first, -1) >= min.slice(0, 7), canNext = shiftMonth(last, 1) <= max.slice(0, 7);
  const grids = Array.from({ length: n }, (_, i) => monthGrid(shiftMonth(first, i))).join('');
  const help = { day: 'Choisis un jour', week: 'Choisis une semaine', range: CAL.start ? 'Choisis le dernier jour' : 'Choisis le premier jour' }[CAL.mode];
  $('cal-pop').innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1" ${canPrev ? '' : 'disabled'} aria-label="Mois précédent"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <span class="cal-help">${help}</span>
      <button type="button" class="cal-nav" data-nav="1" ${canNext ? '' : 'disabled'} aria-label="Mois suivant"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    <div class="cal-months">${grids}</div>
    <div class="cal-foot"><span class="cal-dot"></span> jour avec des chiffres</div>`;
  paintRange();
}

function monthGrid(ymk) {
  const min = STATE.days[0], max = STATE.days[STATE.days.length - 1], today = max;
  const [y, m] = ymk.split('-').map(Number);
  const lastDay = `${ymk}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  let rows = '';
  for (let w = mondayOf(`${ymk}-01`); w <= lastDay; w = addDays(w, 7)) {
    const cells = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const d = addDays(w, i), inMonth = d.slice(0, 7) === ymk, off = d < min || d > max;
      if (!inMonth && CAL.mode !== 'week') return '<span class="cal-d empty"></span>';
      const cls = ['cal-d', inMonth ? '' : 'out', off ? 'off' : '', d === today ? 'today' : '', STATE.dataDays.has(d) ? 'has' : '',
        CAL.mode === 'day' && d === STATE.day ? 'sel' : ''].filter(Boolean).join(' ');
      return CAL.mode === 'week'
        ? `<span class="${cls}">${+d.slice(8)}</span>`
        : `<button type="button" class="${cls}" data-d="${d}" ${off ? 'disabled' : ''} aria-label="${dayFull(d)}">${+d.slice(8)}</button>`;
    }).join('');
    if (CAL.mode === 'week') {
      const off = addDays(w, 6) < min || w > max;
      rows += `<button type="button" class="cal-row cal-wk ${w === STATE.week ? 'sel' : ''}" data-w="${w}" ${off ? 'disabled' : ''} aria-label="${weekText(w)}">${cells}</button>`;
    } else rows += `<div class="cal-row">${cells}</div>`;
  }
  return `<div class="cal-month"><div class="cal-title">${MOIS_LONG[m - 1]} ${y}</div>
    <div class="cal-row cal-dow">${['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map(j => `<span>${j}</span>`).join('')}</div>${rows}</div>`;
}

/* Surlignage de la période (sélection en cours ou période active) sans reconstruire le calendrier */
function paintRange() {
  if (CAL.mode !== 'range') return;
  let a, b;
  if (CAL.start) { a = CAL.start; b = CAL.hover || CAL.start; } else { a = STATE.range.from; b = STATE.range.to; }
  if (a > b) [a, b] = [b, a];
  $('cal-pop').querySelectorAll('button.cal-d').forEach(el => {
    const d = el.dataset.d;
    el.classList.toggle('in', d > a && d < b);
    el.classList.toggle('start', d === a);
    el.classList.toggle('end', d === b);
  });
}

function onCalClick(e) {
  const nav = e.target.closest('[data-nav]');
  if (nav) { CAL.month = shiftMonth(CAL.month, +nav.dataset.nav); renderCal(); return; }
  if (CAL.mode === 'week') {
    const r = e.target.closest('[data-w]'); if (!r) return;
    STATE.week = r.dataset.w; closeCal(); renderPeriod(); renderAll(); return;
  }
  const c = e.target.closest('[data-d]'); if (!c) return;
  const d = c.dataset.d;
  if (CAL.mode === 'day') { STATE.day = d; closeCal(); renderPeriod(); renderAll(); return; }
  if (!CAL.start) { CAL.start = d; CAL.hover = d; $('cal-pop').querySelector('.cal-help').textContent = 'Choisis le dernier jour'; paintRange(); return; }
  const [from, to] = CAL.start <= d ? [CAL.start, d] : [d, CAL.start];
  STATE.range = { from, to }; STATE.preset = null;
  closeCal(); renderPeriod(); renderAll();
}

/* Filtre de période : puces de mois.
   - depuis « Tout », un clic garde seulement ce mois
   - ensuite, chaque clic ajoute ou retire un mois
   - Maj + clic sélectionne une plage */
function renderChips() {
  const all = STATE.sel.length === STATE.months.length;
  const multiYear = new Set(STATE.months.map(k => k.slice(0, 4))).size > 1;
  $('period-chips').innerHTML = `<button type="button" class="chip chip-all ${all ? 'on' : ''}" data-k="all" aria-pressed="${all}">Tout</button>` +
    STATE.months.map(k => {
      const on = !all && STATE.sel.includes(k);
      return `<button type="button" class="chip ${on ? 'on' : ''}" data-k="${k}" aria-pressed="${on}" title="${ymLabel(k)}">${multiYear ? ymLabel(k) : ymShort(k)}</button>`;
    }).join('');
  const n = STATE.sel.length;
  $('period-hint').textContent = all ? `${n} mois · clique un mois pour le voir seul` : `${periodLabel()}${n > 1 ? '' : ' · clique d’autres mois pour les ajouter'}`;
}

function onChip(e) {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.dataset.q) {
    const [t, x] = b.dataset.q.split(':');
    if (t === 'd') STATE.day = clampDay(x);
    else if (t === 'w') STATE.week = clampWeek(x);
    else applyPreset(x);
    renderPeriod(); renderAll(); return;
  }
  const k = b.dataset.k;
  const all = STATE.sel.length === STATE.months.length;
  if (k === 'all') STATE.sel = STATE.months.slice();
  else if (e.shiftKey && STATE.anchor) {
    const [i, j] = [STATE.months.indexOf(STATE.anchor), STATE.months.indexOf(k)].sort((a, b) => a - b);
    STATE.sel = STATE.months.slice(i, j + 1);
  } else if (all) STATE.sel = [k];
  else if (STATE.sel.includes(k)) { STATE.sel = STATE.sel.filter(x => x !== k); if (!STATE.sel.length) STATE.sel = STATE.months.slice(); }
  else STATE.sel = [...STATE.sel, k];
  if (k !== 'all') STATE.anchor = k;
  renderChips(); renderAll();
}

function onGran(e) {
  const b = e.target.closest('button[data-g]'); if (!b || b.disabled) return;
  setVue(b.dataset.g);
  try { localStorage.setItem('poa-vue', STATE.vue); } catch (err) { /* stockage indisponible */ }
  renderPeriod(); renderAll();
}

function renderAll() {
  const par = { mois: 'Par mois', semaine: 'Par semaine', jour: 'Par jour' }[STATE.gran];
  document.querySelectorAll('[data-gran-hint]').forEach(el => { el.textContent = par + el.dataset.granHint; });
  renderVue(); renderReseaux(); renderLanding(); renderPub(); renderSources();
}

function setStatus() {
  const el = $('source-status');
  const flux = CONFIG.SHEET_FLUX_AUTO_CSV ? (STATE.fluxError ? 'flux auto en erreur' : 'flux auto actif') : 'flux auto non branché';
  let txt = { live: `Google Sheet connecté · ${flux}`, demo: "Mode démo · colle l'URL du Sheet dans config.js", error: 'Sheet injoignable · données de démo affichées' }[STATE.mode];
  if (CONFIG_BROKEN) txt = "config.js contient une erreur (apostrophes autour de l'URL ?) · données de démo";
  el.className = `source-status ${CONFIG_BROKEN ? 'error' : STATE.mode}`;
  el.querySelector('.txt').textContent = txt;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function refresh(manual = false) {
  const btn = $('refresh');
  btn.classList.add('loading'); btn.disabled = true;
  const err = await loadData();
  initPeriod(); renderAll(); setStatus();
  $('last-load').textContent = `Données chargées le ${new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}`;
  btn.classList.remove('loading'); btn.disabled = false;
  if (manual) toast(err ? 'Impossible de lire le Google Sheet, données de démo affichées' : (STATE.mode === 'live' ? 'Données mises à jour' : 'Mode démo rechargé'));
}

async function init() {
  setupChartDefaults();
  $('period-chips').addEventListener('click', onChip);
  $('gran').addEventListener('click', onGran);
  $('cal-btn').addEventListener('click', e => { e.stopPropagation(); if (CAL.mode) closeCal(); else openCal(); });
  $('cal-pop').addEventListener('click', e => { e.stopPropagation(); onCalClick(e); });
  $('cal-pop').addEventListener('mouseover', e => {
    const c = e.target.closest('[data-d]');
    if (CAL.mode === 'range' && CAL.start && c && c.dataset.d !== CAL.hover) { CAL.hover = c.dataset.d; paintRange(); }
  });
  document.addEventListener('click', () => { if (CAL.mode) closeCal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && CAL.mode) { closeCal(); $('cal-btn').focus(); } });
  try { const v = localStorage.getItem('poa-vue'); if (['jour', 'semaine', 'mois', 'perso'].includes(v)) setVue(v); } catch (e) { /* stockage indisponible */ }
  try { const saved = localStorage.getItem('poa-net'); if (NETS.some(n => n.key === saved)) STATE.net = saved; } catch (e) { /* stockage indisponible */ }
  $('net-tabs').addEventListener('click', e => {
    const b = e.target.closest('.net-tab'); if (!b) return;
    STATE.net = b.dataset.net;
    try { localStorage.setItem('poa-net', STATE.net); } catch (err) { /* stockage indisponible */ }
    renderReseaux();
  });
  $('refresh').addEventListener('click', () => refresh(true));
  window.addEventListener('hashchange', () => showPage(location.hash.slice(1)));
  showPage(location.hash.slice(1));
  await refresh();
  showPage(location.hash.slice(1));
  if (CONFIG.AUTO_REFRESH_MINUTES > 0) setInterval(() => refresh(), CONFIG.AUTO_REFRESH_MINUTES * 60000);
}

document.addEventListener('DOMContentLoaded', init);
