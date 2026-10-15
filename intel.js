/* ============================================================
   INTEL.JS : Recommandations, Concurrents et Veille
   Données servies par l'application Web du script (action=intel),
   protégées par le code équipe, comme les notes.
   - Concurrents : relevés Apify (Instagram, TikTok) des comptes de
     l'onglet Concurrents_config, POA compris (même méthode).
   - Veille : Google News (marque, concurrents, secteur) et
     recherche TikTok de la marque.
   - Recommandations : briefs publiés chaque matin par l'agent
     stratégique et chaque lundi par l'agent contenus, plus des
     signaux recalculés en direct sur la période affichée.
   ============================================================ */

const INTEL = { data: null, loading: false, error: null, net: 'Instagram', base100: true, feed: 'tout', feedMax: 15, briefSel: null };
/* Couleurs par compte, ordre fixe (validé daltonisme) : POA d'abord, puis l'ordre de Concurrents_config */
const INTEL_COULEURS = ['#BF5223', '#2a78d6', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const INTEL_AUTRE = '#8E8F86';
const RESEAUX_INTEL = [{ key: 'Instagram', label: 'Instagram', color: '#BF5223' }, { key: 'TikTok', label: 'TikTok', color: '#B8960C' }];

const mediane = arr => { const v = arr.filter(x => x !== null && x !== undefined && isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const joursEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const aujourdhui = () => ymd(new Date());
const plur = (n, mot, pl = mot + 's') => `${fr(n)} ${n > 1 ? pl : mot}`;

/* Période affichée, toujours définie (sinon : tout) */
function rangeIntel() {
  const r = currentRange();
  if (!r) return { from: '2000-01-01', to: '2999-12-31' };
  // Les chiffres POA s'arrêtent à la veille, mais briefs, relevés et articles sont datés du jour :
  // une période qui va jusqu'au dernier jour de données inclut aussi aujourd'hui.
  const dernier = STATE.lastData || (STATE.days.length ? STATE.days[STATE.days.length - 1] : null);
  return dernier && r.to >= dernier && r.to < aujourdhui() ? { from: r.from, to: aujourdhui() } : r;
}
function rangePrecedent(r) {
  if (r.from === '2000-01-01') return null;
  const n = joursEntre(r.from, r.to) + 1;
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}
const dansR = (d, r) => !!d && d >= r.from && d <= r.to;

/* ============================================================
   CHARGEMENT
   ============================================================ */
async function chargerIntel() {
  if (!notesActives() || !ls.get('poa-cmt-key')) { INTEL.data = null; rendreIntel(); return; }
  INTEL.loading = true; rendreIntel();
  try {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try { res = await fetch(`${CONFIG.COMMENTS_API}?action=intel&key=${encodeURIComponent(ls.get('poa-cmt-key'))}&_=${Date.now()}`, { signal: ctrl.signal }); }
    finally { clearTimeout(t); }
    const j = await res.json();
    if (!j.ok) throw new Error(j.erreur || 'erreur');
    INTEL.data = lireIntel(j); INTEL.error = null;
  } catch (e) {
    INTEL.error = e.message === 'code' ? 'code' : e.message === 'action' ? 'script' : 'reseau';
    console.error('Veille :', e);
  }
  INTEL.loading = false;
  rendreIntel();
}

function lireIntel(j) {
  const comptes = (j.comptes || []).map((c, i) => ({ ...c, ordre: i }));
  const posts = (j.posts || []).map(p => ({ r: p[0], c: p[1], id: p[2], d: p[3], format: p[4] || 'Autre', lien: p[5], texte: p[6] || '', vues: p[7], likes: p[8], comm: p[9], part: p[10], enr: p[11], ab: p[12],
    inter: sum([p[8], p[9], p[10], p[11]]) }));
  const releves = (j.releves || []).map(r => ({ d: r[0], r: r[1], c: r[2], ab: r[3], pub: r[4] })).filter(r => r.ab !== null);
  const veille = (j.veille || []).map(v => ({ d: v[0], type: v[1], sujet: v[2], source: v[3], titre: v[4], lien: v[5], media: v[6], extrait: v[7], ton: v[8], vues: v[9] }))
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  const briefs = (j.briefs || []).filter(b => b.contenu).sort((a, b) => (a.date + a.genere < b.date + b.genere ? 1 : -1));
  // Couleur stable par compte : POA, puis l'ordre de la configuration
  const ordre = comptes.slice().sort((a, b) => (a.type === 'nous' ? -1 : b.type === 'nous' ? 1 : a.ordre - b.ordre));
  const couleurs = {};
  ordre.forEach((c, i) => { couleurs[c.nom] = INTEL_COULEURS[i] || INTEL_AUTRE; });
  return { maj: j.maj, apify: j.apify, comptes, posts, releves, veille, briefs, couleurs,
    fiches: j.fiches || {}, alertes: (j.alertes || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)), habitudes: j.habitudes || {} };
}

function infoCompte(net, handle) {
  const champ = net === 'TikTok' ? 'tiktok' : 'instagram';
  const c = INTEL.data.comptes.find(x => x[champ] === handle);
  return c ? { nom: c.nom, type: c.type, couleur: INTEL.data.couleurs[c.nom] || INTEL_AUTRE, etat: c[`etat_${champ}`] || '' }
    : { nom: handle, type: 'concurrent', couleur: INTEL_AUTRE, etat: '' };
}

/* ============================================================
   CALCULS : benchmark d'un réseau sur la période
   ============================================================ */
const engPost = (net, p) => (net === 'TikTok' ? (p.vues ? p.inter / p.vues : null) : (p.ab ? p.inter / p.ab : null));

function benchmark(net, r) {
  const D = INTEL.data, champ = net === 'TikTok' ? 'tiktok' : 'instagram';
  const handles = new Set([...D.comptes.filter(c => c.actif && c[champ]).map(c => c[champ]), ...D.releves.filter(x => x.r === net).map(x => x.c), ...D.posts.filter(p => p.r === net).map(p => p.c)]);
  const fin = r.to < aujourdhui() ? r.to : aujourdhui();
  return [...handles].map(h => {
    const info = infoCompte(net, h);
    const rel = D.releves.filter(x => x.r === net && x.c === h).sort((a, b) => (a.d < b.d ? -1 : 1));
    const avant = d => { let o = null; rel.forEach(x => { if (x.d <= d) o = x; }); return o; };
    const dernier = avant(r.to) || rel[rel.length - 1] || null;
    const premier = avant(r.from) || rel.find(x => dansR(x.d, r)) || null;
    const gain = dernier && premier && dernier !== premier ? dernier.ab - premier.ab : null;
    const ps = D.posts.filter(p => p.r === net && p.c === h);
    const dans = ps.filter(p => dansR(p.d, r));
    const plusAncien = ps.map(p => p.d).sort()[0];
    // fréquence : sur la partie de la période couverte par les publications relevées
    const debut = plusAncien && plusAncien > r.from ? plusAncien : r.from;
    const freq = ps.length && debut <= fin ? dans.length / (Math.max(7, joursEntre(debut, fin) + 1) / 7) : null;
    const parFormat = {};
    dans.forEach(p => { (parFormat[p.format] ||= []).push(engPost(net, p)); });
    const formats = Object.entries(parFormat).map(([f, l]) => ({ f, n: l.length, eng: mediane(l) })).filter(x => x.eng !== null);
    const meilleur = formats.filter(x => x.n >= 2).sort((a, b) => b.eng - a.eng)[0] || formats.sort((a, b) => b.eng - a.eng)[0] || null;
    return { h, ...info, ab: dernier ? dernier.ab : null, gain, gainPct: gain !== null && premier.ab ? gain / premier.ab : null,
      freq, n: dans.length, eng: mediane(dans.map(p => engPost(net, p))), vues: mediane(dans.map(p => p.vues)),
      medInter: mediane(ps.map(p => p.inter)), meilleur, formats };
  }).sort((a, b) => (b.ab ?? -1) - (a.ab ?? -1));
}

/* Publications qui surperforment : interactions rapportées à la médiane habituelle du compte */
function topPosts(net, r, max = 6) {
  const b = Object.fromEntries(benchmark(net, { from: '2000-01-01', to: '2999-12-31' }).map(x => [x.h, x]));
  return INTEL.data.posts.filter(p => p.r === net && dansR(p.d, r) && p.inter >= 5 && b[p.c] && b[p.c].type !== 'nous' && b[p.c].medInter)
    .map(p => ({ ...p, fois: p.inter / b[p.c].medInter, info: b[p.c] }))
    .sort((a, b2) => b2.fois - a.fois).slice(0, max);
}

/* ============================================================
   AFFICHAGE COMMUN
   ============================================================ */
function rendreIntel() {
  if (!$('intel-reco')) return;
  rendreReco(); rendreConcurrents(); rendreVeille();
}

/* Écran d'attente ou de verrouillage commun aux 3 pages ; renvoie true si la page peut s'afficher */
function etatIntel(el, quoi) {
  const bouton = '<button type="button" class="btn btn-light" data-intel-code>Saisir le code équipe</button>';
  let html = null;
  if (!notesActives()) html = emptyState(`${quoi} non activé`, 'Ajoute COMMENTS_API dans config.js (voir le guide, partie 4)');
  else if (!ls.get('poa-cmt-key')) html = `<div class="notes-lock-inline">${emptyState(`${quoi} réservé à l’équipe`, 'Saisis le code équipe (le même que pour les notes)')}${bouton}</div>`;
  else if (INTEL.loading && !INTEL.data) html = `<div class="intel-loading"><span class="spinner"></span>Chargement…</div>`;
  else if (INTEL.error === 'script' && !INTEL.data) html = emptyState('Script à mettre à jour', 'Ajoute le fichier Veille.gs dans Apps Script puis crée une nouvelle version du déploiement (guide, partie 5)');
  else if (INTEL.error === 'code') html = `<div class="notes-lock-inline">${emptyState('Code équipe refusé', 'Vérifie-le puis saisis-le à nouveau')}${bouton}</div>`;
  else if (INTEL.error && !INTEL.data) html = emptyState('Données injoignables', 'Vérifie ta connexion puis clique sur Actualiser');
  else if (!INTEL.data) html = `<div class="intel-loading"><span class="spinner"></span>Chargement…</div>`;
  if (html === null) return true;
  el.innerHTML = `<div class="card">${html}</div>`;
  return false;
}

/* Graphique hors séries temporelles du dashboard (pas de repères de notes) */
function graphIntel(id, config, ok, titre, aide) {
  if (STATE.charts[id]) { STATE.charts[id].destroy(); delete STATE.charts[id]; }
  const wrap = $(`wrap-${id}`);
  if (!wrap) return;
  if (!ok) { wrap.innerHTML = emptyState(titre, aide); return; }
  wrap.innerHTML = `<canvas id="c-${id}" role="img" aria-label="${escapeHtml(titre)}"></canvas>`;
  config.options = { ...(config.options || {}), animation: wrap.closest('.page.active') && !STATE.exporting ? { duration: 450 } : false };
  STATE.charts[id] = new Chart($(`c-${id}`), config);
}

const netTabs = (actif, attr) => RESEAUX_INTEL.map(n => `<button type="button" class="net-tab ${n.key === actif ? 'active' : ''}" role="tab" aria-selected="${n.key === actif}" ${attr}="${n.key}" style="--accent:${n.color}">${n.label}</button>`).join('');
const pct = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? '·' : `${fr(v * 100, d)} %`);
const signe = v => (v > 0 ? '+' : '');
const lienExt = (url, txt, cls = '') => (/^https?:\/\//.test(url || '') ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="${cls}">${txt}</a>` : `<span class="${cls}">${txt}</span>`);
const court = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function tileTexte(label, valeur, pied, accent) {
  return `<div class="tile" ${accent ? `style="--accent:${accent}"` : ''}><div class="tile-label">${escapeHtml(label)}</div>
    <div class="tile-value tile-text ${valeur ? '' : 'empty'}">${valeur ? escapeHtml(valeur) : '·'}</div><div class="tile-foot">${pied || ''}</div></div>`;
}

/* ============================================================
   PAGE : CONCURRENTS
   ============================================================ */
function rendreConcurrents() {
  const el = $('intel-concurrents');
  if (!etatIntel(el, 'Benchmark')) return;
  const D = INTEL.data, net = INTEL.net, r = rangeIntel();
  const sansReleve = !D.releves.length && !D.posts.length;
  const introuvables = D.comptes.filter(c => /^Introuvable/.test(c.etat_instagram || '') || /^Introuvable/.test(c.etat_tiktok || ''));

  el.innerHTML = `
    <div class="net-tabs" role="tablist" aria-label="Réseau">${netTabs(net, 'data-cnet')}</div>
    ${alertesHtml(r)}
    ${sansReleve ? `<div class="card">${emptyState('Pas encore de relevé des comptes', D.apify ? 'Le premier relevé arrive demain matin, ou lance testerVeille dans Apps Script' : 'Ajoute APIFY_TOKEN dans les propriétés du script, puis lance testerVeille (guide, partie 5)')}</div>` : `
    <div class="tiles" id="tiles-conc"></div>
    <div class="card">
      <div class="card-head rp-keep"><h2>Benchmark ${net}</h2><span class="card-hint" id="hint-bench"></span></div>
      <div class="table-wrap" id="t-bench"></div>
    </div>
    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h2>Évolution des abonnés</h2>
          <div class="seg seg-sm" data-no-print>${[[true, 'Base 100'], [false, 'Valeurs']].map(([v, l]) => `<button type="button" data-base="${v}" class="${INTEL.base100 === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="chart" id="wrap-conc-abo"></div>
        <p class="note">${INTEL.base100 ? 'Base 100 = premier relevé de la période : compare les rythmes de croissance, quelle que soit la taille du compte.' : 'Valeurs réelles : les grands comptes écrasent l’échelle, passe en base 100 pour comparer.'}</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>Carte de positionnement</h2><span class="card-hint">Rythme × engagement, taille = abonnés</span></div>
        <div class="chart" id="wrap-conc-map"></div>
        <p class="note">Lignes pointillées : médianes. En haut à droite, les comptes qui publient souvent ET engagent bien.</p>
      </div>
    </div>
    <div class="card">
      <div class="card-head rp-keep"><h2>Ce qui marche chez eux</h2><span class="card-hint" id="hint-top"></span></div>
      <div class="post-grid" id="top-posts"></div>
    </div>
    <div class="card">
      <div class="card-head rp-keep"><h2>Fiches concurrents</h2><span class="card-hint">Habitudes ${net} calculées sur 90 jours · ton et ligne éditoriale rédigés par l’agent veille</span></div>
      <div class="fiche-grid">${fichesHtml(net)}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Formats qui performent</h2><span class="card-hint">Engagement médian par format sur la période</span></div>
      <div class="chart chart-sm" id="wrap-conc-formats"></div>
    </div>`}
    ${introuvables.length ? `<p class="note warn-note" data-no-print>Comptes introuvables au dernier relevé : ${introuvables.map(c => `<strong>${escapeHtml(c.nom)}</strong>`).join(', ')}. Corrige le nom du compte dans l’onglet <code>Concurrents_config</code> du Google Sheet.</p>` : ''}`;
  if (sansReleve) return;

  const b = benchmark(net, r), nous = b.find(x => x.type === 'nous'), autres = b.filter(x => x.type !== 'nous');
  const medEng = mediane(autres.map(x => x.eng)), medFreq = mediane(autres.map(x => x.freq));
  const rang = nous && nous.ab !== null ? b.filter(x => x.ab !== null).indexOf(nous) + 1 : null;
  const dyn = autres.filter(x => x.gainPct !== null).sort((a, c) => c.gainPct - a.gainPct)[0];
  const baseEng = net === 'TikTok' ? 'interactions ÷ vues' : 'interactions ÷ abonnés';

  $('tiles-conc').innerHTML = [
    tile({ label: 'Abonnés POA', value: nous ? nous.ab : null, note: rang ? `${rang}${rang === 1 ? 'er' : 'e'} sur ${b.filter(x => x.ab !== null).length} comptes suivis` : 'Compte POA non relevé', accent: C.terra }),
    tile({ label: 'Engagement POA', value: nous ? nous.eng : null, f: 'pct', note: medEng !== null ? `médiane concurrents ${pct(medEng, 2)}` : baseEng }),
    tile({ label: 'Rythme POA', value: nous ? nous.freq : null, f: 'num', note: medFreq !== null ? `publications / sem. · concurrents ${fr(medFreq, 1)}` : 'publications par semaine' }),
    tileTexte('Concurrent le plus dynamique', dyn ? dyn.nom : '', dyn ? `<span class="delta ${dyn.gainPct >= 0 ? 'up' : 'down'}">${signe(dyn.gainPct)}${fr(dyn.gainPct * 100, 1)} %</span><span>d’abonnés sur la période</span>` : 'Il faut au moins 2 relevés', dyn ? dyn.couleur : null),
  ].join('');

  $('hint-bench').textContent = `${periodLabel()} · engagement = ${baseEng}, médiane par publication`;
  const cellN = (v, f = 'int', best = false) => `<td class="num ${v === null || v === undefined ? 'na' : ''} ${best ? 'best-cell' : ''}">${v === null || v === undefined ? '·' : fmt(v, f)}</td>`;
  const maxi = k => Math.max(...b.map(x => x[k] ?? -Infinity));
  $('t-bench').innerHTML = `<table class="bench"><thead><tr><th>Compte</th><th class="num">Abonnés</th><th class="num">Évolution</th><th class="num">Pub. / sem.</th>
      <th class="num">Vues médianes</th><th class="num">Engagement</th><th>Meilleur format</th></tr></thead><tbody>
    ${b.map(x => `<tr class="${x.type === 'nous' ? 'row-nous' : ''}">
      <td><span class="sw-inline" style="background:${x.couleur}"></span><strong>${escapeHtml(x.nom)}</strong>${x.type === 'nous' ? ' <span class="tag-nous">Nous</span>' : ''}<span class="handle">@${escapeHtml(x.h)}</span></td>
      ${cellN(x.ab)}
      <td class="num ${x.gain === null ? 'na' : ''}">${x.gain === null ? '·' : `${signe(x.gain)}${fmt(x.gain)} <span class="muted-inline">(${signe(x.gainPct)}${fr(x.gainPct * 100, 1)} %)</span>`}</td>
      ${cellN(x.freq, 'num', x.freq !== null && x.freq === maxi('freq'))}${cellN(x.vues)}
      <td class="num ${x.eng === null ? 'na' : ''} ${x.eng !== null && x.eng === maxi('eng') ? 'best-cell' : ''}">${pct(x.eng, 2)}</td>
      <td>${x.meilleur ? `${escapeHtml(x.meilleur.f)} <span class="muted-inline">${pct(x.meilleur.eng, 1)}</span>` : '<span class="na">·</span>'}</td></tr>`).join('')}
    </tbody></table>
    <p class="note">Chiffres publics relevés par Apify, POA compris (même méthode pour tous). Fréquence et engagement portent sur les dernières publications relevées de chaque compte (${net === 'TikTok' ? '10 vidéos' : '12 publications'}).</p>`;

  // Évolution des abonnés
  const dates = [...new Set(D.releves.filter(x => x.r === net && dansR(x.d, r)).map(x => x.d))].sort();
  const series = b.map(x => {
    const parDate = Object.fromEntries(D.releves.filter(y => y.r === net && y.c === x.h).map(y => [y.d, y.ab]));
    const brut = dates.map(d => parDate[d] ?? null);
    const ref = brut.find(v => v);
    return { x, brut, data: INTEL.base100 ? brut.map(v => (v !== null && ref ? v / ref * 100 : null)) : brut };
  });
  graphIntel('conc-abo', {
    type: 'line',
    data: { labels: dates.map(dayShort), datasets: series.map(s => ({ ...lineDs(s.x.nom, s.data, s.x.couleur), borderWidth: s.x.type === 'nous' ? 3 : 2, pointRadius: dates.length > 20 ? 0 : 3, brut: s.brut })) },
    options: { ...commonOpts(INTEL.base100 ? v => fr(v) : fint, false, true, { label: i => `${i.dataset.label} : ${fmt(i.dataset.brut[i.dataIndex])} abonnés${INTEL.base100 && i.raw !== null ? ` (indice ${fr(i.raw, 1)})` : ''}` }),
      scales: { ...baseScales(INTEL.base100 ? v => fr(v) : fint), y: { ...baseScales(INTEL.base100 ? v => fr(v) : fint).y, beginAtZero: !INTEL.base100 } } },
  }, dates.length >= 2, 'La courbe apparaît après 2 relevés', 'Un relevé par jour (Instagram) ou deux par semaine (TikTok)');

  // Carte de positionnement
  const pts = b.filter(x => x.freq !== null && x.eng !== null);
  const maxAb = Math.max(...pts.map(x => x.ab || 0), 1);
  const etiquettes = { id: 'etiquettes', afterDatasetsDraw(chart) {
    const ctx = chart.ctx; ctx.save(); ctx.font = `600 11px ${Chart.defaults.font.family}`; ctx.fillStyle = C.ink; ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, i) => chart.getDatasetMeta(i).data.forEach(pt => {
      const w = ctx.measureText(ds.label).width, droite = pt.x + pt.options.radius + 5 + w < chart.chartArea.right;
      ctx.textAlign = droite ? 'left' : 'right';
      ctx.fillText(ds.label, droite ? pt.x + pt.options.radius + 5 : pt.x - pt.options.radius - 5, pt.y);
    }));
    const xs = chart.scales.x, ys = chart.scales.y;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#D9D0C1'; ctx.lineWidth = 1;
    if (medFreq !== null) { const x = xs.getPixelForValue(medFreq); ctx.beginPath(); ctx.moveTo(x, ys.top); ctx.lineTo(x, ys.bottom); ctx.stroke(); }
    if (medEng !== null) { const y = ys.getPixelForValue(medEng * 100); ctx.beginPath(); ctx.moveTo(xs.left, y); ctx.lineTo(xs.right, y); ctx.stroke(); }
    ctx.restore();
  } };
  graphIntel('conc-map', {
    type: 'bubble',
    data: { datasets: pts.map(x => ({ label: x.nom, data: [{ x: x.freq, y: x.eng * 100, r: 6 + 20 * Math.sqrt((x.ab || 0) / maxAb) }], backgroundColor: x.couleur + 'B3', borderColor: '#fff', borderWidth: 2, hoverBorderColor: x.couleur })) },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14, right: 12 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => { const x = pts[i.datasetIndex]; return `${x.nom} : ${fr(x.freq, 1)} pub./sem., engagement ${pct(x.eng, 2)}, ${fmt(x.ab)} abonnés`; } } } },
      scales: { x: { title: { display: true, text: 'Publications par semaine', color: C.ink3 }, beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.ink3 } },
        y: { title: { display: true, text: `Engagement (%)`, color: C.ink3 }, beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.ink3, callback: v => `${fr(v, 1)} %` } } } },
    plugins: [etiquettes],
  }, pts.length >= 2, 'Pas assez de comptes comparables', 'Il faut des publications relevées sur la période');

  // Ce qui marche chez eux
  const tops = topPosts(net, r);
  $('hint-top').textContent = tops.length ? '« × 10 » = 10 fois plus d’interactions qu’une publication habituelle du même compte' : '';
  $('top-posts').innerHTML = tops.length ? tops.map(p => `<article class="post-card" style="--pc:${p.info.couleur}">
      <header><span class="sw-inline" style="background:${p.info.couleur}"></span><strong>${escapeHtml(p.info.nom)}</strong><span class="chip-mini">${escapeHtml(p.format)}</span><time>${dayLabel(p.d)}</time></header>
      <p class="post-text">${escapeHtml(court(p.texte, 180)) || '<em>Sans légende</em>'}</p>
      <div class="post-stats"><span class="fois" title="Interactions de cette publication ÷ interactions d’une publication habituelle de ${escapeHtml(p.info.nom)}">× ${fr(p.fois, 1)} <i>son niveau habituel</i></span><span>${p.vues !== null ? `${fmt(p.vues)} vues · ` : ''}${fmt(p.inter)} interactions</span></div>
      ${lienExt(p.lien, 'Voir la publication', 'post-link')}</article>`).join('')
    : emptyState('Aucune publication qui sort du lot sur la période', 'Élargis la période ou attends le prochain relevé');

  // Formats
  const fmts = [...new Set(b.flatMap(x => x.formats.map(f => f.f)))];
  const fMed = (filtre, f) => mediane(INTEL.data.posts.filter(p => p.r === net && dansR(p.d, r) && p.format === f && filtre(infoCompte(net, p.c))).map(p => engPost(net, p)));
  const nousF = fmts.map(f => fMed(i => i.type === 'nous', f)), concF = fmts.map(f => fMed(i => i.type !== 'nous', f));
  graphIntel('conc-formats', {
    type: 'bar',
    data: { labels: fmts, datasets: [barDs('POA', nousF.map(v => (v === null ? null : v * 100)), INTEL_COULEURS[0]), barDs('Concurrents (médiane)', concF.map(v => (v === null ? null : v * 100)), INTEL_COULEURS[1])] },
    options: { ...commonOpts(v => `${fr(v, 1)} %`, false, true, { label: i => `${i.dataset.label} : ${i.raw === null ? 'pas de publication' : `${fr(i.raw, 2)} %`}` }), indexAxis: 'y',
      scales: { x: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.ink3, callback: v => `${fr(v, 1)} %` } }, y: { grid: { display: false }, ticks: { color: C.ink } } } },
  }, fmts.length > 0, 'Pas de format à comparer', 'Aucune publication relevée sur la période');
}


/* ============================================================
   FICHES CONCURRENTS ET ALERTES
   ============================================================ */
const TYPES_ALERTE = { virage_strategique: 'Virage stratégique', ligne_editoriale: 'Ligne éditoriale', bad_buzz: 'Bad buzz', produit: 'Produit', prix: 'Prix', financement: 'Financement', partenariat: 'Partenariat', autre: 'Autre' };
const MENACES = { fort: ['Menace forte', 'bad'], moyen: ['Menace moyenne', 'warn'], faible: ['Menace faible', 'good'] };
const TENDANCES = { stable: 'Stable', en_evolution: 'En évolution', en_rupture: 'En rupture' };
const cap = t => String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1);
const sources = l => (l || []).filter(x => /^https?:\/\//.test(x.lien || '')).map(x => lienExt(x.lien, escapeHtml(x.titre || 'Source'))).join(' · ');

function alerteHtml(a) {
  return `<li class="alerte al-${a.niveau}">
    <div class="al-meta"><time>${dayLabel(a.date)}</time><strong>${escapeHtml(a.nom)}</strong><span class="chip-mini">${escapeHtml(TYPES_ALERTE[a.type] || a.type)}</span>
      ${statusHtml(a.niveau === 'haute' ? 'bad' : a.niveau === 'moyenne' ? 'warn' : 'none', a.niveau === 'haute' ? 'Importante' : a.niveau === 'moyenne' ? 'À suivre' : 'Info')}</div>
    <p class="al-titre">${escapeHtml(a.titre)}</p>
    ${a.detail ? `<p class="al-detail">${escapeHtml(a.detail)}</p>` : ''}
    ${a.implication_poa ? `<p class="al-poa"><b>Pour POA</b>${escapeHtml(a.implication_poa)}</p>` : ''}
    ${sources(a.sources) ? `<p class="al-src">${sources(a.sources)}</p>` : ''}</li>`;
}
function alertesHtml(r) {
  const l = INTEL.data.alertes.filter(a => dansR(a.date, r));
  if (!l.length) return '';
  const ordre = { haute: 0, moyenne: 1, info: 2 };
  return `<div class="card alertes-card"><div class="card-head rp-keep"><h2>Alertes concurrents</h2><span class="card-hint">Virages, changements de ligne et bad buzz détectés par l’agent veille · ${escapeHtml(periodLabel())}</span></div>
    <ul class="alertes">${l.slice().sort((a, b) => ordre[a.niveau] - ordre[b.niveau] || (a.date < b.date ? 1 : -1)).slice(0, 8).map(alerteHtml).join('')}</ul></div>`;
}

function habitudesChips(h) {
  if (!h) return [];
  return [
    h.publications_par_semaine !== null ? `${fr(h.publications_par_semaine, 1)} publication${h.publications_par_semaine >= 2 ? 's' : ''} / sem.` : null,
    h.jours.length ? `Surtout le ${h.jours.slice(0, 2).map(j => j.valeur).join(' et le ')}` : null,
    h.creneaux.length ? `${cap(h.creneaux[0].valeur.replace(/ \(.*\)/, ''))}${h.heure_mediane ? `, vers ${h.heure_mediane.replace(':', ' h ')}` : ''}` : null,
    h.formats.length ? `${h.formats[0].valeur} ${h.formats[0].part_pct} %` : null,
    h.langue.length ? `${cap(h.langue[0].valeur)} ${h.langue[0].part_pct} %` : null,
  ].filter(Boolean);
}

function ficheHtml(c, net) {
  const D = INTEL.data, F = D.fiches[c.nom], f = F && F.fiche, h = (D.habitudes[c.nom] || {})[net];
  const handle = net === 'TikTok' ? c.tiktok : c.instagram, coul = D.couleurs[c.nom] || INTEL_AUTRE;
  const m = f && MENACES[f.niveau_menace], chips = habitudesChips(h);
  const derniere = D.alertes.find(a => a.nom === c.nom && a.niveau !== 'info');
  const liste = (titre, l) => (l && l.length ? `<div><b>${titre}</b><ul>${l.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : '');
  return `<article class="fiche" style="--fc:${coul}">
    <header class="fiche-head"><span class="sw-inline" style="background:${coul}"></span><h3>${escapeHtml(c.nom)}</h3>${handle ? `<span class="handle">@${escapeHtml(handle)}</span>` : ''}
      <span class="fiche-badges">${m ? statusHtml(m[1], m[0]) : ''}${f && f.tendance ? `<span class="chip-mini tend-${f.tendance}">${TENDANCES[f.tendance]}</span>` : ''}</span></header>
    ${f && f.positionnement ? `<p class="fiche-pos">${escapeHtml(f.positionnement)}</p>` : '<p class="fiche-pos muted">Le portrait éditorial (ton, ligne, piliers) arrive au prochain passage de l’agent veille, chaque matin vers 7 h 20.</p>'}
    ${chips.length ? `<div class="fiche-habits">${chips.map(x => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : `<p class="muted">Pas de publication ${net} relevée sur 90 jours.</p>`}
    ${f ? `<dl class="fiche-dl">${f.ton ? `<dt>Ton</dt><dd>${escapeHtml(f.ton)}</dd>` : ''}${f.ligne_editoriale ? `<dt>Ligne éditoriale</dt><dd>${escapeHtml(f.ligne_editoriale)}</dd>` : ''}${f.cible ? `<dt>Cible</dt><dd>${escapeHtml(f.cible)}</dd>` : ''}</dl>` : ''}
    ${f && f.piliers.length ? `<div class="piliers">${f.piliers.map(p => `<span class="pilier" title="${escapeHtml(p.exemple || '')}">${escapeHtml(p.nom)}${p.part ? ` <b>${escapeHtml(p.part)}</b>` : ''}</span>`).join('')}</div>` : ''}
    ${f && f.a_retenir_pour_poa.length ? `<div class="fiche-poa"><b>À retenir pour POA</b><ul>${f.a_retenir_pour_poa.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
    ${(h && h.changements.length) || (f && f.evolution && f.tendance !== 'stable') || derniere ? `<div class="fiche-evol"><b>Ce qui bouge</b>
      ${f && f.evolution && f.tendance !== 'stable' ? `<p>${escapeHtml(f.evolution)}</p>` : ''}${h ? h.changements.map(x => `<p class="chg">${escapeHtml(x)}</p>`).join('') : ''}
      ${derniere ? `<p class="chg chg-alerte">${dayShort(derniere.date)} : ${escapeHtml(derniere.titre)}</p>` : ''}</div>` : ''}
    <details class="fiche-plus"><summary>Fiche complète</summary>
      ${f && f.habitudes ? `<p>${escapeHtml(f.habitudes)}</p>` : ''}
      <div class="fiche-cols">${liste('Forces', f && f.forces)}${liste('Faiblesses', f && f.faiblesses)}</div>
      ${liste('Formats signature', f && f.formats_signature)}
      ${h ? `<div class="fiche-stats"><span>Légende médiane : <b>${h.mots_par_legende ?? '·'} mots</b></span><span>Avec émoji : <b>${h.part_avec_emoji_pct ?? '·'} %</b></span><span>Avec question : <b>${h.part_avec_question_pct ?? '·'} %</b></span>
        <span>Engagement médian : <b>${h.engagement_median_pct === null ? '·' : `${fr(h.engagement_median_pct, 2)} %`}</b></span><span>Formats : <b>${h.formats.map(x => `${x.valeur} ${x.part_pct} %`).join(', ')}</b></span></div>` : ''}
      ${h && h.hashtags.length ? `<p class="cc-tags">${h.hashtags.map(escapeHtml).join(' ')}</p>` : ''}
      ${h && h.meilleure_publication ? `<p class="muted-block">Meilleure publication (90 j) : ${lienExt(h.meilleure_publication.lien, `« ${escapeHtml(court(h.meilleure_publication.texte, 90))} »`)}${h.meilleure_publication.fois_sa_mediane ? `, ${fr(h.meilleure_publication.fois_sa_mediane, 1)} fois son niveau habituel` : ''}</p>` : ''}
      ${f && sources(f.sources) ? `<p class="muted-block">Sources : ${sources(f.sources)}</p>` : ''}
      ${F ? `<p class="muted-block">Fiche mise à jour le ${dayLabel(F.maj)} par ${escapeHtml(F.auteur)}${F.precedente && F.precedente.ligne_editoriale && F.precedente.ligne_editoriale !== f.ligne_editoriale ? `. Ligne précédente : « ${escapeHtml(court(F.precedente.ligne_editoriale, 160))} »` : ''}</p>` : ''}
    </details>
  </article>`;
}
function fichesHtml(net) {
  const D = INTEL.data, rang = c => { const f = (D.fiches[c.nom] || {}).fiche; return f ? { fort: 0, moyen: 1, faible: 2 }[f.niveau_menace] ?? 1 : 3; };
  const l = D.comptes.filter(c => c.type !== 'nous' && c.actif).sort((a, b) => rang(a) - rang(b));
  return l.length ? l.map(c => ficheHtml(c, net)).join('') : emptyState('Aucun concurrent actif', 'Onglet Concurrents_config du Google Sheet');
}

/* ============================================================
   PAGE : VEILLE
   ============================================================ */
const MOTS_VIDES = new Set(('les des une un le la de du et en au aux pour par sur dans avec sans plus moins tout tous toute toutes son ses sa leur leurs nos notre vos votre ce cet cette ces qui que quoi dont ou où est sont été être fait faire '
  + 'comment pourquoi quand selon après avant entre chez vers très bien aussi encore déjà même mais donc car pas peu trop alors elle elles ils lui eux nous vous on ne se si y a ont avait avoir '
  + 'deux trois quatre cinq ans jour jours mois année 2025 2026 2027 voici voilà ceux celle celui quel quelle quels quelles faut peut doit veut nouveau nouvelle nouveaux nouvelles grand grande '
  + 'france français française vidéo photo article actualité actualités info infos direct exclusif hier demain aujourd’hui semaine fois chose choses vraiment beaucoup '
  + 'the and for with from this that your you are how what new').split(/\s+/));
function motsCles(items) {
  const compte = {}, forme = {};
  items.forEach(v => {
    const vus = new Set();
    (String(v.titre).match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu) || []).forEach(m => {
      const brut = m.replace(/^(l|d|j|qu|n|s|c)[’']/i, ''), k = norm(brut);
      if (k.length < 4 || MOTS_VIDES.has(k) || MOTS_VIDES.has(brut.toLowerCase()) || /^\d+$/.test(k) || vus.has(k)) return;
      vus.add(k); compte[k] = (compte[k] || 0) + 1;
      (forme[k] ||= {}); forme[k][brut.toLowerCase()] = (forme[k][brut.toLowerCase()] || 0) + 1;
    });
  });
  return Object.entries(compte).map(([k, n]) => ({ k, n, mot: Object.entries(forme[k]).sort((a, b) => b[1] - a[1])[0][0] }));
}

const TONS = { positive: ['Positive', 'good'], 'négative': ['Négative', 'bad'], neutre: ['Neutre', 'none'] };
function itemVeille(v) {
  const t = TONS[v.ton] || TONS.neutre;
  const typeLab = { marque: 'POA', concurrent: v.sujet, secteur: v.sujet }[v.type] || v.sujet;
  return `<li class="feed-item"><div class="feed-meta"><time>${dayLabel(v.d)}</time><span>${escapeHtml(v.media || v.source)}</span>
      <span class="chip-mini chip-${v.type}">${escapeHtml(typeLab)}</span>${v.type === 'marque' || v.ton !== 'neutre' ? `<span class="ton ton-${t[1]}" title="Tonalité estimée (indice, pas un verdict)">${t[0]}</span>` : ''}
      ${v.vues ? `<span class="muted-inline">${fmt(v.vues)} vues</span>` : ''}</div>
    ${lienExt(v.lien, escapeHtml(v.titre), 'feed-title')}
    ${v.extrait && norm(v.extrait).slice(0, 40) !== norm(v.titre).slice(0, 40) ? `<p class="feed-extrait">${escapeHtml(court(v.extrait, 220))}</p>` : ''}</li>`;
}

function rendreVeille() {
  const el = $('intel-veille');
  if (!etatIntel(el, 'Veille')) return;
  const D = INTEL.data, r = rangeIntel(), rp = rangePrecedent(r);
  if (!D.veille.length) { el.innerHTML = `<div class="card">${emptyState('Pas encore d’actualité relevée', 'Lance configurerVeille puis testerVeille dans Apps Script (guide, partie 5)')}</div>`; return; }
  const dans = D.veille.filter(v => dansR(v.d, r)), avant = rp ? D.veille.filter(v => dansR(v.d, rp)) : [];
  const marque = dans.filter(v => v.type === 'marque'), marqueP = avant.filter(v => v.type === 'marque');
  const voix = {};
  dans.filter(v => v.type !== 'secteur').forEach(v => { const s = v.type === 'marque' ? 'POA' : v.sujet; voix[s] = (voix[s] || 0) + 1; });
  const totalVoix = Object.values(voix).reduce((a, b) => a + b, 0);
  const pos = marque.filter(v => v.ton === 'positive').length, neg = marque.filter(v => v.ton === 'négative').length;
  const secteur = dans.filter(v => v.type === 'secteur');

  el.innerHTML = `
    <div class="tiles">
      ${tile({ label: 'Mentions de POA', value: marque.length, prev: rp ? marqueP.length : null, note: rp ? `vs ${rangeText(rp.from, rp.to)}` : periodLabel(), accent: C.terra })}
      ${tile({ label: 'Part de voix POA', value: totalVoix ? (voix.POA || 0) / totalVoix : null, f: 'pct', note: 'mentions POA ÷ POA + concurrents' })}
      ${tileTexte('Tonalité des mentions', marque.length ? (neg ? `${neg} négative${neg > 1 ? 's' : ''}` : pos ? `${pos} positive${pos > 1 ? 's' : ''}` : 'Neutre') : '',
        marque.length ? `<span>${plur(pos, 'positive')}, ${plur(neg, 'négative')}, ${plur(marque.length - pos - neg, 'neutre')}</span>` : '<span>Aucune mention sur la période</span>', neg ? '#B3261E' : null)}
      ${tile({ label: 'Articles du secteur', value: secteur.length, prev: rp ? avant.filter(v => v.type === 'secteur').length : null, note: 'Google News, requêtes de Veille_config' })}
    </div>
    <div class="grid g-3-2">
      <div class="card">
        <div class="card-head"><h2>Ce qui se dit de POA</h2><span class="card-hint">${periodLabel()}</span></div>
        ${marque.length ? `<ul class="feed">${marque.slice(0, 12).map(itemVeille).join('')}</ul>` : emptyState('Aucune mention de POA sur la période', 'Normal au lancement : chaque article, vidéo TikTok ou citation apparaîtra ici avec sa tonalité')}
      </div>
      <div class="card">
        <div class="card-head"><h2>Part de voix</h2><span class="card-hint">Mentions dans l’actualité, ${periodLabel()}</span></div>
        <div class="chart chart-sm" id="wrap-voix"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Sujets qui montent</h2><span class="card-hint">Mots les plus présents dans les titres du secteur et des concurrents${rp ? ', comparés à la période précédente' : ''}</span></div>
      <div id="mots"></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Fil d’actualité</h2>
        <div class="seg seg-sm" data-no-print>${[['tout', 'Tout'], ['secteur', 'Secteur'], ['concurrent', 'Concurrents'], ['marque', 'POA']].map(([k, l]) => `<button type="button" data-feed="${k}" class="${INTEL.feed === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div id="feed"></div>
    </div>`;

  // Part de voix : POA en couleur de marque, concurrents dans leur couleur
  const sujets = Object.entries(voix).sort((a, b) => b[1] - a[1]);
  graphIntel('voix', {
    type: 'bar',
    data: { labels: sujets.map(s => s[0]), datasets: [{ ...barDs('Mentions', sujets.map(s => s[1]), sujets.map(s => (s[0] === 'POA' ? INTEL_COULEURS[0] : D.couleurs[s[0]] || INTEL_AUTRE))), borderSkipped: 'start' }] },
    options: { ...commonOpts(fint, false, false, { label: i => `${i.label} : ${plur(i.raw, 'mention')} (${pct(i.raw / totalVoix, 0)})` }), indexAxis: 'y',
      scales: { x: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.ink3, precision: 0 } }, y: { grid: { display: false }, ticks: { color: C.ink } } } },
  }, sujets.length > 0, 'Aucune mention de marque', 'Ni POA ni les concurrents ne sont cités sur la période');

  // Sujets qui montent
  const cur = motsCles(dans.filter(v => v.type !== 'marque')), prev = Object.fromEntries(motsCles(avant.filter(v => v.type !== 'marque')).map(m => [m.k, m.n]));
  const mots = cur.filter(m => m.n >= 2).sort((a, b) => b.n - a.n).slice(0, 16);
  $('mots').innerHTML = mots.length ? `<div class="mots">${mots.map(m => {
    const p = prev[m.k] || 0, monte = rp && m.n >= p * 1.5 + 1;
    return `<span class="mot ${monte ? 'monte' : ''}" title="${m.n} titres${rp ? `, ${p} sur la période précédente` : ''}">${escapeHtml(m.mot)} <b>${m.n}</b>${monte ? (p ? ' ↑' : ' <i>nouveau</i>') : ''}</span>`;
  }).join('')}</div>` : emptyState('Pas assez d’articles pour dégager des sujets', 'Élargis la période');

  // Fil
  const liste = dans.filter(v => INTEL.feed === 'tout' || v.type === INTEL.feed);
  $('feed').innerHTML = liste.length ? `<ul class="feed">${liste.slice(0, INTEL.feedMax).map(itemVeille).join('')}</ul>
    ${liste.length > INTEL.feedMax ? `<button type="button" class="link-btn" data-feed-plus>Afficher ${Math.min(25, liste.length - INTEL.feedMax)} de plus (${liste.length} au total)</button>` : ''}`
    : emptyState('Rien sur la période pour ce filtre', 'Change de filtre ou élargis la période');
}

/* ============================================================
   PAGE : RECOMMANDATIONS
   ============================================================ */
const IMPACT = { fort: 3, moyen: 2, faible: 1 };
const CANAUX = { instagram: ['Instagram', 'reseaux', 'ig'], tiktok: ['TikTok', 'reseaux', 'tt'], facebook: ['Facebook', 'reseaux', 'fb'], meta_ads: ['Meta Ads', 'pub', 'tous'], landing: ['Landing page', 'landing', 'tous'], global: ['Global', 'toutes', 'tous'] };
const HUMEURS = { positif: ['Bonne dynamique', 'good'], vigilance: ['Points de vigilance', 'warn'], alerte: ['Alerte', 'bad'] };

/* Signaux recalculés en direct sur la période affichée (dashboard + veille + notes) */
function signauxLive() {
  const out = [], months = periodMonths(), pm = prevMonths(), r = rangeIntel();
  const cmp = pm.length ? `vs ${periodLabel(pm)}` : '';
  NETS.forEach(n => {
    const v = agg(`${n.key}_vues`, months), vp = pm.length ? agg(`${n.key}_vues`, pm) : null;
    if (v !== null && vp !== null && vp >= MIN_VUES_ENGAGEMENT) {
      const d = (v - vp) / vp;
      if (d >= 0.3) out.push({ niv: 'good', txt: `Vues ${n.label} en hausse de ${fr(d * 100)} % (${fmt(v)}) ${cmp}` });
      if (d <= -0.3) out.push({ niv: 'warn', txt: `Vues ${n.label} en baisse de ${fr(-d * 100)} % (${fmt(v)}) ${cmp}` });
    }
    const e = engagement(n.key, months), ep = pm.length ? engagement(n.key, pm) : null;
    if (e !== null && ep !== null && Math.abs(e - ep) >= 0.015) out.push({ niv: e > ep ? 'good' : 'warn', txt: `Engagement ${n.label} à ${pct(e)} (${pct(ep)} avant)` });
  });
  if (INTEL.data) {
    RESEAUX_INTEL.forEach(({ key }) => {
      const b = benchmark(key, r), nous = b.find(x => x.type === 'nous'), med = mediane(b.filter(x => x.type !== 'nous').map(x => x.freq));
      if (nous && nous.freq !== null && med && nous.freq < med * 0.6) out.push({ niv: 'warn', txt: `Rythme ${key} : ${fr(nous.freq, 1)} publication${nous.freq >= 2 ? 's' : ''} par semaine, contre ${fr(med, 1)} pour la médiane des concurrents` });
      const t = topPosts(key, r, 1)[0];
      if (t && t.fois >= 3) out.push({ niv: 'info', txt: `${t.info.nom} (${key}) : publication à ${fr(t.fois, 1)} fois son niveau habituel, « ${court(t.texte, 70)} »`, lien: t.lien });
    });
    INTEL.data.alertes.filter(a => a.niveau !== 'info' && dansR(a.date, r)).slice(0, 3)
      .forEach(a => out.push({ niv: a.niveau === 'haute' ? 'bad' : 'warn', txt: `${a.nom} : ${a.titre}`, lien: (a.sources[0] || {}).lien }));
    const neg = INTEL.data.veille.filter(v => v.type === 'marque' && v.ton === 'négative' && dansR(v.d, r));
    if (neg.length) out.push({ niv: 'bad', txt: `${plur(neg.length, 'mention')} de POA au ton négatif : « ${court(neg[0].titre, 80)} »`, lien: neg[0].lien });
  }
  const retard = NOTES.list.filter(c => c.type === 'decision' && c.statut !== 'fait' && c.fin < aujourdhui());
  if (retard.length) out.push({ niv: 'warn', txt: `${plur(retard.length, 'décision')} de l’équipe en retard (échéance passée)`, notes: true });
  const ordre = { bad: 0, warn: 1, good: 2, info: 3 };
  return out.sort((a, b) => ordre[a.niv] - ordre[b.niv]);
}

function briefsVisibles() {
  const D = INTEL.data, r = rangeIntel();
  const quot = D.briefs.filter(b => b.type === 'quotidien'), cont = D.briefs.filter(b => b.type === 'contenus');
  let sel = INTEL.briefSel && D.briefs.find(b => `${b.date}|${b.type}` === INTEL.briefSel && b.type === 'quotidien');
  const horsPeriode = !sel && !quot.some(b => dansR(b.date, r));
  sel = sel || quot.find(b => dansR(b.date, r)) || quot[0] || null;
  const contenus = cont.find(b => b.date <= r.to) || cont[0] || null;
  return { sel, contenus, horsPeriode, historique: D.briefs.filter(b => dansR(b.date, r)) };
}

function recoCard(b, x, i) {
  const st = (b.statuts || {})[x.id] || null, canal = CANAUX[x.canal] || CANAUX.global, peut = !!ls.get('poa-cmt-key');
  return `<article class="reco-card imp-${x.impact} ${st ? `st-${st.statut}` : ''}" data-reco="${escapeHtml(x.id)}">
    <div class="reco-top"><span class="reco-num">${i + 1}</span><h3>${escapeHtml(x.titre)}</h3></div>
    <div class="reco-badges"><span class="rb rb-impact">Impact ${escapeHtml(x.impact)}</span><span class="rb">Effort ${escapeHtml(x.effort)}</span>${x.horizon ? `<span class="rb">${escapeHtml(x.horizon)}</span>` : ''}<span class="rb">${canal[0]}</span></div>
    ${x.constat ? `<p class="reco-l"><b>Constat</b>${escapeHtml(x.constat)}</p>` : ''}
    ${x.action ? `<p class="reco-l reco-action"><b>Action</b>${escapeHtml(x.action)}</p>` : ''}
    ${x.kpi ? `<p class="reco-kpi">À suivre : ${escapeHtml(x.kpi)}</p>` : ''}
    ${x.pourquoi ? `<details class="reco-why"><summary>Pourquoi</summary><p>${escapeHtml(x.pourquoi)}</p></details>` : ''}
    <footer class="reco-foot">${st
      ? `<span class="reco-st">${st.statut === 'adoptee' ? statusHtml('good', 'Adoptée') : statusHtml('none', 'Écartée')}<span>${escapeHtml(st.auteur)}, ${dayShort(st.le)}${st.statut === 'adoptee' ? ' · dans les décisions' : ''}</span></span>${peut ? '<button type="button" class="link-btn" data-act-reco="annuler">Annuler</button>' : ''}`
      : peut ? '<button type="button" class="btn btn-sm" data-act-reco="adopter">Adopter</button><button type="button" class="btn btn-light btn-sm" data-act-reco="ecarter">Écarter</button><span class="reco-help">Adopter crée une décision « à faire » dans les notes</span>' : ''}</footer>
  </article>`;
}

function matriceHtml(recos) {
  const q = (imp, eff) => recos.map((x, i) => [x, i]).filter(([x]) => (imp ? IMPACT[x.impact] === 3 : IMPACT[x.impact] < 3) && (eff ? x.effort !== 'faible' : x.effort === 'faible'));
  const cell = (titre, l, cls) => `<div class="mx-cell ${cls}"><span class="mx-t">${titre}</span><div>${l.map(([x, i]) => `<a href="#reco" class="mx-dot imp-${x.impact}" data-goto-reco="${escapeHtml(x.id)}" title="${escapeHtml(x.titre)}">${i + 1}</a>`).join('')}</div></div>`;
  return `<div class="matrice"><span class="mx-y">Impact</span><div class="mx-grid">
      ${cell('Gains rapides', q(true, false), 'mx-quick')}${cell('Projets de fond', q(true, true), '')}${cell('Bonus', q(false, false), '')}${cell('Plus tard', q(false, true), 'mx-late')}
    </div><span class="mx-x">Effort</span></div>`;
}

function contenuCard(c, i) {
  return `<article class="content-card">
    <div class="cc-head"><span class="cc-num">${i + 1}</span><span class="chip-mini chip-fmt">${escapeHtml(c.format || 'Contenu')}</span><span class="chip-mini">${escapeHtml(c.reseau || '')}</span>${c.jour_conseille ? `<span class="cc-jour">${escapeHtml(c.jour_conseille)}</span>` : ''}</div>
    <h3>${escapeHtml(c.titre)}</h3>
    ${c.accroche ? `<blockquote>${escapeHtml(c.accroche)}</blockquote>` : ''}
    ${(c.deroule || []).length ? `<ol class="cc-steps">${c.deroule.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
    ${c.legende ? `<p class="reco-l"><b>Légende</b>${escapeHtml(c.legende)}</p>` : ''}
    ${c.cta ? `<p class="reco-l"><b>Appel à l’action</b>${escapeHtml(c.cta)}</p>` : ''}
    ${(c.hashtags || []).length ? `<p class="cc-tags">${c.hashtags.map(escapeHtml).join(' ')}</p>` : ''}
    ${c.pourquoi ? `<p class="reco-l reco-why-inline"><b>Pourquoi</b>${escapeHtml(c.pourquoi)}</p>` : ''}
    <footer class="cc-foot">${c.persona ? `<span>Pour ${escapeHtml(c.persona)}</span>` : ''}${c.kpi ? `<span>Objectif : ${escapeHtml(c.kpi)}</span>` : ''}
      ${c.inspiration && c.inspiration.compte ? `<span>Inspiration : ${lienExt(c.inspiration.lien, escapeHtml(c.inspiration.compte))}${c.inspiration.stat ? `, ${escapeHtml(c.inspiration.stat)}` : ''}</span>` : ''}
      <button type="button" class="link-btn" data-copier="${i}">Copier le brief</button></footer>
  </article>`;
}

function rendreReco() {
  const el = $('intel-reco');
  if (!etatIntel(el, 'Recommandations')) return;
  const { sel, contenus, horsPeriode, historique } = briefsVisibles();
  const sig = signauxLive();
  const sigHtml = sig.length ? `<ul class="signaux">${sig.map(s => `<li class="sig-${s.niv}">${statusHtml(s.niv === 'info' ? 'none' : s.niv, { good: 'Positif', warn: 'Vigilance', bad: 'Alerte', info: 'Info' }[s.niv])}<span>${escapeHtml(s.txt)}${s.lien ? ` ${lienExt(s.lien, 'voir')}` : ''}${s.notes ? ' <button type="button" class="link-btn" data-intel-notes>voir</button>' : ''}</span></li>`).join('')}</ul>`
    : '<p class="muted">Rien d’anormal sur la période affichée.</p>';

  if (!sel) {
    el.innerHTML = `<div class="card brief-empty">${emptyState('Pas encore de brief', 'L’agent stratégique publie chaque matin vers 8 h, l’agent contenus chaque lundi. Les signaux ci-dessous sont calculés en direct.')}</div>
      <div class="card"><div class="card-head"><h2>Signaux du moment</h2><span class="card-hint">${periodLabel()}</span></div>${sigHtml}</div>
      ${contenus ? `<div class="card" id="reco-contenus"><div class="card-head"><h2>Contenus de la semaine</h2></div><div class="content-grid">${contenus.contenu.contenus.map(contenuCard).join('')}</div></div>` : ''}`;
    return;
  }
  const b = sel.contenu, h = HUMEURS[b.humeur] || HUMEURS.vigilance;
  const recos = (b.recommandations || []).slice().map((x, i) => ({ ...x, _i: i }));
  const ordre = recos.slice().sort((a, c) => IMPACT[c.impact] - IMPACT[a.impact] || (a.effort === 'faible' ? -1 : 0) - (c.effort === 'faible' ? -1 : 0) || a._i - c._i);
  const st = sel.statuts || {}, nAdopt = Object.values(st).filter(x => x.statut === 'adoptee').length;
  const heure = (sel.genere || '').slice(11, 16).replace(':', ' h ');
  el.innerHTML = `
    ${horsPeriode ? `<p class="note warn-note">Aucun brief sur ${escapeHtml(periodLabel())} : voici le plus récent.</p>` : ''}
    <section class="card brief-hero">
      <div class="bh-top"><span class="bh-kicker">Brief du ${dayFull(sel.date)}${heure ? ` · ${heure}` : ''} · ${escapeHtml(sel.auteur)}</span>${statusHtml(h[1], h[0])}</div>
      <h2 class="bh-title">${escapeHtml(b.titre || 'Brief du jour')}</h2>
      <p class="bh-resume">${escapeHtml(b.resume)}</p>
      ${(b.chiffres_cles || []).length ? `<div class="bh-kpis">${b.chiffres_cles.map(c => `<div class="kv"><span>${escapeHtml(c.label)}</span><strong>${escapeHtml(c.valeur)}</strong>${c.variation ? `<em class="v-${c.sens}">${escapeHtml(c.variation)}</em>` : ''}</div>`).join('')}</div>` : ''}
      ${(b.alertes || []).length ? b.alertes.map(a => `<p class="bh-alerte al-${a.niveau}">${ICONS.bad}${escapeHtml(a.texte)}</p>`).join('') : ''}
    </section>
    <div class="grid g-3-2 reco-layout">
      <div class="card">
        <div class="card-head rp-keep"><h2>Priorités</h2><span class="card-hint">${plur(recos.length, 'recommandation')}${nAdopt ? ` · ${nAdopt} adoptée${nAdopt > 1 ? 's' : ''}` : ''} · classées par impact</span></div>
        <div class="reco-list" data-brief="${escapeHtml(sel.date)}|quotidien">${ordre.map(x => recoCard(sel, x, x._i)).join('')}</div>
      </div>
      <div class="reco-side">
        <div class="card"><div class="card-head"><h2>Impact et effort</h2><span class="card-hint">Commence en haut à gauche</span></div>${matriceHtml(recos)}</div>
        <div class="card"><div class="card-head"><h2>Signaux du moment</h2><span class="card-hint">Recalculés sur ${escapeHtml(periodLabel())}</span></div>${sigHtml}</div>
        ${(b.a_surveiller || []).length ? `<div class="card"><div class="card-head"><h2>À surveiller</h2></div><ul class="plain-list">${b.a_surveiller.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
        ${(b.veille_cle || []).length ? `<div class="card"><div class="card-head"><h2>Veille à lire</h2></div><ul class="plain-list">${b.veille_cle.map(v => `<li>${lienExt(v.lien, escapeHtml(v.titre))}${v.pourquoi ? `<span class="muted-block">${escapeHtml(v.pourquoi)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      </div>
    </div>
    ${contenus ? `<div class="card" id="reco-contenus">
      <div class="card-head rp-keep"><h2>Contenus de la semaine</h2><span class="card-hint">Agent contenus · ${dayFull(contenus.date)}${contenus.contenu.titre ? ` · ${escapeHtml(contenus.contenu.titre)}` : ''}</span></div>
      ${contenus.contenu.resume ? `<p class="cc-resume">${escapeHtml(contenus.contenu.resume)}</p>` : ''}
      <div class="content-grid" data-contenus="${escapeHtml(contenus.date)}">${contenus.contenu.contenus.map(contenuCard).join('')}</div></div>` : ''}
    ${historique.length > 1 ? `<div class="card" data-no-print>
      <div class="card-head"><h2>Historique des briefs</h2><span class="card-hint">${escapeHtml(periodLabel())} · clique pour relire</span></div>
      <ul class="histo">${historique.map(x => {
        const n = (x.contenu.recommandations || x.contenu.contenus || []).length, a = Object.values(x.statuts || {}).filter(s => s.statut === 'adoptee').length, hh = HUMEURS[x.contenu.humeur];
        const on = x === sel;
        return `<li><button type="button" class="histo-item ${on ? 'on' : ''}" data-brief-sel="${x.date}|${x.type}" ${x.type === 'contenus' ? 'data-scroll-contenus' : ''}>
          <span class="histo-date">${dayShort(x.date)}</span><span class="histo-type">${x.type === 'contenus' ? 'Contenus' : 'Brief'}</span>
          ${hh ? `<span class="dot dot-${hh[1]}"></span>` : '<span class="dot"></span>'}<span class="histo-titre">${escapeHtml(x.contenu.titre || x.resume || '')}</span>
          <span class="histo-n">${x.type === 'contenus' ? plur(n, 'idée') : `${a}/${n} adoptée${a > 1 ? 's' : ''}`}</span></button></li>`;
      }).join('')}</ul></div>` : ''}`;
  if (location.hash === '#reco-contenus' && !INTEL.scrolled) { INTEL.scrolled = true; requestAnimationFrame(() => { const c = $('reco-contenus'); if (c) c.scrollIntoView({ block: 'start' }); }); }
}

/* ---------- Actions ---------- */
async function postIntel(body) {
  const res = await fetch(CONFIG.COMMENTS_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: ls.get('poa-cmt-key'), ...body }) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.erreur || 'erreur');
  return j;
}

async function actionReco(btn) {
  const card = btn.closest('[data-reco]'), [date, type] = btn.closest('[data-brief]').dataset.brief.split('|');
  const brief = INTEL.data.briefs.find(b => b.date === date && b.type === type);
  const reco = brief.contenu.recommandations.find(x => x.id === card.dataset.reco);
  const act = btn.dataset.actReco, auteur = ls.get('poa-cmt-auteur') || 'Équipe';
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    const j = await postIntel({ action: 'statutReco', date, type, id: reco.id, statut: act === 'adopter' ? 'adoptee' : act === 'ecarter' ? 'ecartee' : '', auteur });
    brief.statuts = j.statuts;
    if (act === 'adopter') {
      const canal = CANAUX[reco.canal] || CANAUX.global, debut = aujourdhui();
      const hz = norm(reco.horizon || ''), fin = /aujourd/.test(hz) ? debut : /mois/.test(hz) ? addDays(debut, 29) : addDays(debut, 6);
      await apiNotes('POST', { action: 'ajouter', type: 'decision', debut, fin, page: canal[1], reseau: canal[2], indicateur: court(reco.kpi, 60),
        texte: court(`${reco.titre}. ${reco.action}`, 1500), auteur });
      toast('Adoptée : ajoutée aux décisions de l’équipe');
      renderAll();
    } else { toast(act === 'ecarter' ? 'Recommandation écartée : l’agent en tiendra compte' : 'Statut retiré'); rendreReco(); }
  } catch (e) {
    toast(e.message === 'code' ? 'Code équipe refusé' : 'Enregistrement impossible, réessaie');
    rendreReco();
  }
}

function copierContenu(i, dateContenus) {
  const b = INTEL.data.briefs.find(x => x.type === 'contenus' && x.date === dateContenus);
  const c = b && b.contenu.contenus[i];
  if (!c) return;
  const txt = [`${c.titre} (${c.format}, ${c.reseau})`, c.accroche ? `Accroche : ${c.accroche}` : '', ...(c.deroule || []).map((s, k) => `${k + 1}. ${s}`),
    c.legende ? `Légende : ${c.legende}` : '', c.cta ? `Appel à l’action : ${c.cta}` : '', (c.hashtags || []).join(' '), c.jour_conseille ? `Publication : ${c.jour_conseille}` : ''].filter(Boolean).join('\n');
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Brief copié'), () => toast('Copie impossible sur ce navigateur'));
}

function onIntelClick(e) {
  const t = e.target;
  if (t.closest('[data-intel-code]')) { ouvrirNotes(); return; }
  if (t.closest('[data-intel-notes]')) { ouvrirNotes(); return; }
  const cn = t.closest('[data-cnet]'); if (cn) { INTEL.net = cn.dataset.cnet; ls.set('poa-cnet', INTEL.net); rendreConcurrents(); return; }
  const bs = t.closest('[data-base]'); if (bs) { INTEL.base100 = bs.dataset.base === 'true'; rendreConcurrents(); return; }
  const fd = t.closest('[data-feed]'); if (fd) { INTEL.feed = fd.dataset.feed; INTEL.feedMax = 15; rendreVeille(); return; }
  if (t.closest('[data-feed-plus]')) { INTEL.feedMax += 25; rendreVeille(); return; }
  const ar = t.closest('[data-act-reco]'); if (ar) { actionReco(ar); return; }
  const cp = t.closest('[data-copier]'); if (cp) { copierContenu(+cp.dataset.copier, cp.closest('[data-contenus]') ? cp.closest('[data-contenus]').dataset.contenus : ''); return; }
  const gr = t.closest('[data-goto-reco]');
  if (gr) { e.preventDefault(); const c = document.querySelector(`#intel-reco [data-reco="${CSS.escape(gr.dataset.gotoReco)}"]`); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1200); } return; }
  const hs = t.closest('[data-brief-sel]');
  if (hs) {
    if (hs.hasAttribute('data-scroll-contenus')) { const c = $('reco-contenus'); if (c) c.scrollIntoView({ behavior: 'smooth' }); return; }
    INTEL.briefSel = hs.dataset.briefSel; rendreReco(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = ls.get('poa-cnet'); if (RESEAUX_INTEL.some(n => n.key === saved)) INTEL.net = saved;
  ['intel-reco', 'intel-concurrents', 'intel-veille'].forEach(id => $(id).addEventListener('click', onIntelClick));
});
