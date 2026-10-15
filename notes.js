/* ============================================================
   NOTES.JS : commentaires partagés et export PDF du dashboard POA
   - Les commentaires sont stockés dans l'onglet "Commentaires" du
     Google Sheet, via l'application Web du script Apps Script
     (CONFIG.COMMENTS_API), protégée par un code équipe.
   - Un commentaire couvre une période (un jour, une semaine, un mois,
     ou une plage) : il apparaît dans toute vue qui chevauche cette période.
   ============================================================ */

const NOTE_TYPES = {
  evenement: { label: 'Événement', court: 'Événement', color: '#F79E2B', aide: 'Lancement, publication, campagne, actualité qui explique un chiffre' },
  analyse:   { label: 'Analyse', court: 'Analyse', color: '#3F7FB5', aide: 'Lecture d’une tendance, enseignement' },
  decision:  { label: 'Décision / action', court: 'Décision', color: '#5F6B44', aide: 'Ce qu’on décide de faire, avec un suivi « à faire / fait »' },
  alerte:    { label: 'Alerte données', court: 'Alerte', color: '#BF5223', aide: 'Chiffre douteux, panne de suivi, rupture de méthode' },
};
const NOTE_PAGES = { toutes: 'Tout le dashboard', reseaux: 'Réseaux sociaux', landing: 'Landing page', pub: 'Publicité' };
/* Une note posée depuis la vue d'ensemble ou les sources concerne tout le dashboard */
const pageNote = p => (NOTE_PAGES[p] && p !== 'toutes' ? p : 'toutes');
const NOTES = { list: [], loaded: false, error: null, scope: 'periode', pageFilter: 'toutes', editing: null };

/* ---------- Accès au stockage local (code équipe, prénom) ---------- */
const ls = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
  del: k => { try { localStorage.removeItem(k); } catch (e) { /* stockage indisponible */ } },
};
const notesActives = () => typeof CONFIG !== 'undefined' && !!CONFIG.COMMENTS_API;

/* ---------- Périodes ---------- */
const lastDayOfMonth = ym => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m, 0)); };
/* Période affichée, en jours : {from, to} */
function currentRange() {
  if (STATE.vue === 'mois') {
    const m = periodMonths();
    if (!m.length) return null;
    return { from: m[0] + '-01', to: lastDayOfMonth(m[m.length - 1]) };
  }
  const d = periodDays();
  return d.length ? { from: d[0], to: d[d.length - 1] } : null;
}
/* Période couverte par une case de graphique */
function bucketRange(k) {
  if (STATE.gran === 'mois') return { from: k + '-01', to: lastDayOfMonth(k) };
  if (STATE.gran === 'semaine') return { from: k, to: addDays(k, 6) };
  return { from: k, to: k };
}
const overlaps = (c, r) => !!r && c.debut <= r.to && c.fin >= r.from;
function rangeText(a, b) {
  if (a === b) return dayLabel(a);
  if (a.slice(8) === '01' && b === lastDayOfMonth(b.slice(0, 7))) {
    return a.slice(0, 7) === b.slice(0, 7) ? ymLabel(a.slice(0, 7)) : `${ymShort(a.slice(0, 7))} à ${ymLabel(b.slice(0, 7))}`;
  }
  if (weekdayOf(a) === 1 && b === addDays(a, 6)) return weekText(a);
  return `${dayShort(a)} au ${dayLabel(b)}`;
}
/* Commentaires pertinents pour une page, un réseau et une période */
function notesFor({ page = null, net = null, range = currentRange(), all = false } = {}) {
  return NOTES.list.filter(c =>
    (all || overlaps(c, range)) &&
    (!page || pageNote(c.page) === 'toutes' || c.page === page) &&
    (!net || c.reseau === 'tous' || c.reseau === net))
    .sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : a.cree < b.cree ? -1 : 1));
}

/* ---------- API ---------- */
async function apiNotes(method, body) {
  const key = ls.get('poa-cmt-key');
  let res;
  if (method === 'GET') res = await fetch(`${CONFIG.COMMENTS_API}?action=commentaires&key=${encodeURIComponent(key)}&_=${Date.now()}`);
  else res = await fetch(CONFIG.COMMENTS_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key, ...body }) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.erreur || 'erreur');
  NOTES.list = (j.commentaires || []).filter(c => c.debut && c.fin && NOTE_TYPES[c.type]);
  NOTES.loaded = true; NOTES.error = null;
  return j;
}
async function chargerCommentaires() {
  if (!notesActives() || !ls.get('poa-cmt-key')) { rendreNotes(); return; }
  try { await apiNotes('GET'); }
  catch (e) { NOTES.error = e.message === 'code' ? 'code' : 'reseau'; if (e.message === 'code') ls.del('poa-cmt-key'); console.error('Commentaires :', e); }
  renderAll();
}

/* ---------- Repères dans les graphiques ---------- */
/* Appelé par drawChart avant de créer chaque graphique */
function decorerGraphique(id, config, wrap) {
  const labels = config.data && config.data.labels;
  const vk = viewKeys();
  if (!labels || labels.length !== vk.length || labels.join('|') !== vk.map(keyShort).join('|')) return; // pas une série temporelle
  const page = (wrap.closest('.page') || {}).id ? wrap.closest('.page').id.replace('page-', '') : null;
  const net = page === 'reseaux' ? STATE.net : null;
  // La vue d'ensemble montre les notes de toutes les pages ; les autres pages, les leurs et les notes générales
  const notes = notesFor({ page: page === 'vue' ? null : page, net, range: vk.length ? { from: bucketRange(vk[0]).from, to: bucketRange(vk[vk.length - 1]).to } : null });
  const plugins = (config.options.plugins ||= {});
  if (notes.length) {
    const numeros = new Map(notesFor({ range: currentRange() }).map((c, i) => [c.id, i + 1]));
    const parCase = {};
    notes.forEach(c => {
      const i0 = vk.findIndex(k => overlaps(c, bucketRange(k)));
      if (i0 < 0) return;
      (parCase[i0] ||= []).push(c);
    });
    const ann = {};
    Object.entries(parCase).forEach(([i, cs]) => {
      const col = NOTE_TYPES[cs[0].type].color;
      const nums = cs.map(c => numeros.get(c.id)).filter(Boolean);
      ann['n' + i] = {
        type: 'line', xMin: +i, xMax: +i, borderColor: col, borderWidth: 1.5, borderDash: [4, 3], drawTime: 'afterDatasetsDraw',
        label: { display: true, content: nums.length ? nums.join(' · ') : '•', position: 'end', yAdjust: -6, backgroundColor: col, color: '#fff',
          font: { size: 10, weight: '600' }, padding: { x: 5, y: 2 }, borderRadius: 6 },
      };
    });
    plugins.annotation = { annotations: ann };
    config.options.layout = { padding: { top: 14 } };
  }
  // Clic sur une case : ajouter un commentaire à cette date
  if (notesActives() && !STATE.exporting) {
    config.options.onClick = (evt, els, chart) => {
      const pts = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, false);
      if (!pts.length) return;
      const k = vk[pts[0].index];
      ouvrirNotes({ form: { ...bucketRange(k), page: pageNote(page), reseau: net || 'tous' } });
    };
    config.options.onHover = (evt, els, chart) => { chart.canvas.style.cursor = 'pointer'; };
  }
}

/* ---------- Rendu : badge, carte « Faits marquants », panneau ---------- */
function noteItemHtml(c, num, opts = {}) {
  const t = NOTE_TYPES[c.type];
  const tags = [pageNote(c.page) !== 'toutes' ? NOTE_PAGES[c.page] : null, c.reseau !== 'tous' && NET_BY_KEY[c.reseau] ? NET_BY_KEY[c.reseau].label : null, c.indicateur || null].filter(Boolean);
  const statut = c.type === 'decision' ? `<button type="button" class="note-statut ${c.statut === 'fait' ? 'fait' : ''}" data-act="statut" data-id="${escapeHtml(c.id)}" ${opts.readonly ? 'disabled' : ''}>${c.statut === 'fait' ? 'Fait' : 'À faire'}</button>` : '';
  return `<li class="note" style="--nc:${t.color}">
    <div class="note-head">${num ? `<span class="note-num">${num}</span>` : ''}<span class="note-type">${t.court}</span>
      <span class="note-date">${rangeText(c.debut, c.fin)}</span>${statut}</div>
    <p class="note-text">${escapeHtml(c.texte).replace(/\n/g, '<br>')}</p>
    <div class="note-foot">${tags.map(x => `<span class="note-tag">${escapeHtml(x)}</span>`).join('')}
      <span class="note-auteur">${escapeHtml(c.auteur || '')}${c.cree ? ` · ${dayShort(c.cree.slice(0, 10))}` : ''}</span>
      ${opts.readonly ? '' : `<span class="note-actions"><button type="button" data-act="voir" data-id="${escapeHtml(c.id)}">Voir</button><button type="button" data-act="suppr" data-id="${escapeHtml(c.id)}">Supprimer</button></span>`}</div>
  </li>`;
}

function rendreNotes() {
  if (!$('faits')) return;
  const on = notesActives();
  const enPeriode = notesFor({ range: currentRange() });
  $('notes-count').textContent = enPeriode.length || '';
  $('notes-count').hidden = !enPeriode.length;
  $('btn-notes').hidden = !on;

  // Vue d'ensemble : faits marquants de la période (toutes pages)
  const card = $('faits');
  if (!on) { card.innerHTML = emptyState('Commentaires non activés', 'Voir GUIDE_AUTOMATISATION.md, partie « Commentaires et rapport PDF »'); return; }
  if (!ls.get('poa-cmt-key')) { card.innerHTML = `<div class="notes-lock-inline">${emptyState('Commentaires protégés', 'Saisis le code équipe pour lire et ajouter les notes')}<button type="button" class="btn btn-light" data-open-notes>Saisir le code équipe</button></div>`; return; }
  if (NOTES.error === 'reseau') { card.innerHTML = emptyState('Commentaires injoignables', 'Vérifie l’URL COMMENTS_API dans config.js, puis Actualiser'); return; }
  const ordre = { alerte: 0, decision: 1, evenement: 2, analyse: 3 };
  const tri = enPeriode.map((c, i) => [c, i + 1]).sort((a, b) => ordre[a[0].type] - ordre[b[0].type] || (a[0].debut < b[0].debut ? -1 : 1));
  const aFaire = enPeriode.filter(c => c.type === 'decision' && c.statut !== 'fait').length;
  $('faits-hint').textContent = enPeriode.length ? `${enPeriode.length} note${enPeriode.length > 1 ? 's' : ''} sur ${periodLabel()}${aFaire ? ` · ${aFaire} action${aFaire > 1 ? 's' : ''} à faire` : ''}` : periodLabel();
  card.innerHTML = enPeriode.length
    ? `<ul class="notes-list notes-cols">${tri.slice(0, 6).map(([c, n]) => noteItemHtml(c, n)).join('')}</ul>${tri.length > 6 ? `<button type="button" class="link-btn" data-open-notes>Voir les ${tri.length} notes</button>` : ''}`
    : `<div class="notes-empty"><p>Aucune note sur cette période. Ajoute le contexte qui explique les chiffres : une campagne, une vidéo qui a pris, une décision, un doute sur une donnée.</p><button type="button" class="btn btn-light" data-new-note>Ajouter une note</button></div>`;
  if ($('notes-drawer').classList.contains('open')) rendrePanneau();
}

function ouvrirNotes({ form = null } = {}) {
  $('notes-drawer').classList.add('open');
  $('notes-overlay').hidden = false;
  document.body.classList.add('drawer-open');
  NOTES.editing = form;
  rendrePanneau();
  setTimeout(() => { const f = $('notes-drawer').querySelector(form ? '#nf-texte' : 'button, input'); if (f) f.focus(); }, 50);
}
function fermerNotes() {
  $('notes-drawer').classList.remove('open');
  $('notes-overlay').hidden = true;
  document.body.classList.remove('drawer-open');
  NOTES.editing = null;
}

function formHtml(f) {
  const opt = (obj, v) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const nets = { tous: 'Tous les réseaux', ...Object.fromEntries(NETS.map(n => [n.key, n.label])) };
  return `<form class="note-form" id="note-form">
    <div class="nf-types">${Object.entries(NOTE_TYPES).map(([k, t]) => `<label class="nf-type" style="--nc:${t.color}" title="${escapeHtml(t.aide)}">
      <input type="radio" name="type" value="${k}" ${k === (f.type || 'evenement') ? 'checked' : ''}><span>${t.court}</span></label>`).join('')}</div>
    <p class="nf-aide" id="nf-aide">${escapeHtml(NOTE_TYPES[f.type || 'evenement'].aide)}</p>
    <div class="nf-row"><label>Du<input type="date" name="debut" value="${f.from}" required></label><label>Au<input type="date" name="fin" value="${f.to}" required></label></div>
    <div class="nf-row"><label>Page<select name="page">${opt(NOTE_PAGES, f.page || 'toutes')}</select></label><label>Réseau<select name="reseau">${opt(nets, f.reseau || 'tous')}</select></label></div>
    <label>Indicateur concerné <span class="nf-opt">(facultatif)</span><input type="text" name="indicateur" maxlength="60" placeholder="ex. Vues TikTok, CTR Meta Ads"></label>
    <label>Note<textarea id="nf-texte" name="texte" rows="4" maxlength="1500" required placeholder="Ce qui s’est passé, ce qu’on en retient, ce qu’on décide"></textarea></label>
    <div class="nf-actions"><button type="button" class="btn btn-light" data-act="annuler">Annuler</button><button type="submit" class="btn">Enregistrer</button></div>
    <p class="nf-msg" id="nf-msg" role="status"></p>
  </form>`;
}

function rendrePanneau() {
  const body = $('notes-body');
  const r = currentRange();
  $('notes-sub').textContent = NOTES.scope === 'periode' ? periodLabel() : 'Toutes les périodes';
  if (!notesActives()) { body.innerHTML = emptyState('Commentaires non activés', 'Ajoute COMMENTS_API dans config.js (voir le guide)'); return; }
  if (!ls.get('poa-cmt-key')) {
    body.innerHTML = `<form class="note-form" id="lock-form">
      <p class="nf-aide">Les notes sont partagées avec l’équipe POA. Saisis le code équipe (une seule fois sur cet appareil).</p>
      <label>Code équipe<input name="key" required autocomplete="off" placeholder="POA-XXXXXX" value="${NOTES.error === 'code' ? '' : ''}"></label>
      <label>Ton prénom<input name="auteur" required maxlength="40" value="${escapeHtml(ls.get('poa-cmt-auteur'))}"></label>
      <div class="nf-actions"><button type="submit" class="btn">Valider</button></div>
      <p class="nf-msg" role="status">${NOTES.error === 'code' ? 'Code refusé, vérifie-le auprès de Bryan.' : ''}</p></form>`;
    return;
  }
  const page = (location.hash.slice(1) || 'vue');
  const filtrer = c => NOTES.pageFilter === 'toutes' || pageNote(c.page) === 'toutes' || c.page === page;
  const liste = (NOTES.scope === 'periode' ? notesFor({ range: r }) : notesFor({ all: true })).filter(filtrer);
  const numeros = new Map(notesFor({ range: r }).map((c, i) => [c.id, i + 1]));
  const def = NOTES.editing || null;
  body.innerHTML = `
    ${def ? formHtml(def) : `<button type="button" class="btn note-add" data-new-note>Ajouter une note${r ? ` sur ${escapeHtml(periodLabel())}` : ''}</button>`}
    <div class="notes-filtres">
      <div class="seg seg-sm">${[['periode', 'Période affichée'], ['toutes', 'Toutes']].map(([k, l]) => `<button type="button" data-scope="${k}" class="${NOTES.scope === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg seg-sm">${[['toutes', 'Toutes pages'], ['page', 'Cette page']].map(([k, l]) => `<button type="button" data-pf="${k}" class="${(NOTES.pageFilter === 'toutes') === (k === 'toutes') ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    ${liste.length ? `<ul class="notes-list">${liste.map(c => noteItemHtml(c, numeros.get(c.id))).join('')}</ul>`
      : `<p class="notes-vide">Aucune note ${NOTES.scope === 'periode' ? 'sur cette période' : 'pour l’instant'}.</p>`}
    <p class="notes-legende">Les numéros correspondent aux repères dans les graphiques. Astuce : clique sur une barre ou un point d’un graphique pour noter quelque chose à cette date.
    <button type="button" class="link-btn" data-act="oublier">Changer de code ou de prénom</button></p>`;
}

/* Afficher la période d'un commentaire dans la vue la plus adaptée */
function voirNote(c) {
  const a = c.debut, b = c.fin;
  const inDays = STATE.days.length && a >= STATE.days[0] && b <= STATE.days[STATE.days.length - 1];
  if (a.slice(8) === '01' && b === lastDayOfMonth(b.slice(0, 7)) || !inDays) {
    setVue('mois');
    STATE.sel = STATE.months.filter(m => m >= a.slice(0, 7) && m <= b.slice(0, 7));
    if (!STATE.sel.length) STATE.sel = STATE.months.slice();
  } else if (a === b) { setVue('jour'); STATE.day = a; }
  else if (weekdayOf(a) === 1 && b === addDays(a, 6)) { setVue('semaine'); STATE.week = a; }
  else { setVue('perso'); STATE.range = { from: a, to: b }; STATE.preset = null; }
  if (c.reseau !== 'tous') STATE.net = c.reseau;
  fermerNotes();
  renderPeriod(); renderAll();
  if (pageNote(c.page) !== 'toutes' && location.hash.slice(1) !== c.page) location.hash = c.page;
}

async function onNotesClick(e) {
  const t = e.target;
  if (t.closest('[data-new-note]')) {
    const r = currentRange() || { from: ymd(new Date()), to: ymd(new Date()) };
    const page = location.hash.slice(1) || 'vue';
    NOTES.editing = { ...r, page: pageNote(page), reseau: page === 'reseaux' ? STATE.net : 'tous' };
    if (!$('notes-drawer').classList.contains('open')) ouvrirNotes({ form: NOTES.editing }); else rendrePanneau();
    return;
  }
  if (t.closest('[data-open-notes]')) { ouvrirNotes(); return; }
  const sc = t.closest('[data-scope]'); if (sc) { NOTES.scope = sc.dataset.scope; rendrePanneau(); return; }
  const pf = t.closest('[data-pf]'); if (pf) { NOTES.pageFilter = pf.dataset.pf === 'page' ? 'page' : 'toutes'; rendrePanneau(); return; }
  const b = t.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, c = NOTES.list.find(x => x.id === b.dataset.id);
  if (act === 'annuler') { NOTES.editing = null; rendrePanneau(); return; }
  if (act === 'oublier') { ls.del('poa-cmt-key'); NOTES.list = []; rendreNotes(); rendrePanneau(); renderAll(); return; }
  if (act === 'voir' && c) { voirNote(c); return; }
  if (act === 'suppr' && c) {
    if (!confirm(`Supprimer cette note pour toute l’équipe ?\n\n« ${c.texte.slice(0, 120)} »`)) return;
    await ecrire({ action: 'supprimer', id: c.id }, 'Note supprimée');
  }
  if (act === 'statut' && c) await ecrire({ action: 'statut', id: c.id, statut: c.statut === 'fait' ? 'a faire' : 'fait' }, c.statut === 'fait' ? 'Remise à faire' : 'Marquée comme faite');
}

async function ecrire(body, okMsg) {
  try { await apiNotes('POST', body); toast(okMsg); renderAll(); }
  catch (e) { toast(e.message === 'code' ? 'Code équipe refusé' : 'Enregistrement impossible, réessaie'); if (e.message === 'code') { ls.del('poa-cmt-key'); rendrePanneau(); } }
}

async function onNotesSubmit(e) {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f));
  if (f.id === 'lock-form') {
    ls.set('poa-cmt-key', d.key.trim()); ls.set('poa-cmt-auteur', d.auteur.trim());
    NOTES.error = null;
    try { await apiNotes('GET'); toast('Commentaires activés sur cet appareil'); renderAll(); }
    catch (err) { NOTES.error = err.message === 'code' ? 'code' : 'reseau'; if (err.message === 'code') ls.del('poa-cmt-key'); }
    rendrePanneau(); return;
  }
  if (f.id === 'note-form') {
    const msg = $('nf-msg'); msg.textContent = 'Enregistrement…';
    f.querySelector('[type=submit]').disabled = true;
    await ecrire({ action: 'ajouter', type: d.type, debut: d.debut, fin: d.fin, page: d.page, reseau: d.reseau, indicateur: d.indicateur, texte: d.texte, auteur: ls.get('poa-cmt-auteur') }, 'Note enregistrée');
    NOTES.editing = null; rendrePanneau();
  }
}

/* ============================================================
   EXPORT PDF : rapport mis en page, via l'impression du navigateur
   ============================================================ */
function ouvrirExport() {
  const nets = NETS.map(n => `<label class="pdf-opt"><input type="checkbox" name="net" value="${n.key}" checked> ${n.label}</label>`).join('');
  $('pdf-body').innerHTML = `<form id="pdf-form" class="note-form">
    <p class="nf-aide">Période : <strong>${escapeHtml(periodLabel())}</strong>. Le rapport reprend exactement les filtres affichés.</p>
    <fieldset><legend>Contenu</legend>
      <label class="pdf-opt"><input type="checkbox" name="sec" value="vue" checked> Synthèse (vue d’ensemble, objectifs, tunnel)</label>
      <div class="pdf-sub"><span>Réseaux sociaux :</span> ${nets}</div>
      <label class="pdf-opt"><input type="checkbox" name="sec" value="landing" ${STATE.vue === 'mois' ? 'checked' : ''}> Landing page</label>
      <label class="pdf-opt"><input type="checkbox" name="sec" value="pub" checked> Publicité</label>
    </fieldset>
    <fieldset><legend>Options</legend>
      <label class="pdf-opt"><input type="checkbox" name="notes" checked ${notesActives() && ls.get('poa-cmt-key') ? '' : 'disabled'}> Faits marquants et notes de la période</label>
      <label class="pdf-opt"><input type="checkbox" name="tables"> Tableaux détaillés (plus long)</label>
    </fieldset>
    <p class="nf-aide">Dans la fenêtre d’impression, choisis <strong>Enregistrer au format PDF</strong>.</p>
    <div class="nf-actions"><button type="button" class="btn btn-light" data-close-pdf>Annuler</button><button type="submit" class="btn">Générer le PDF</button></div>
  </form>`;
  $('pdf-modal').hidden = false;
}
const fermerExport = () => { $('pdf-modal').hidden = true; };
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

/* Copie d'une page avec ses graphiques convertis en images */
function capturer(pageEl, { tables }) {
  const canvases = [...pageEl.querySelectorAll('canvas')];
  const clone = pageEl.cloneNode(true);
  clone.removeAttribute('id'); clone.classList.remove('active', 'page'); clone.classList.add('rp-page');
  clone.querySelectorAll('canvas').forEach((cv, i) => {
    const img = document.createElement('img');
    try { img.src = canvases[i].toDataURL('image/png'); } catch (e) { /* graphique non capturable */ }
    img.className = 'rp-chart'; img.alt = '';
    cv.replaceWith(img);
  });
  clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  clone.querySelectorAll('.net-tabs, button, .callout, [data-no-print]').forEach(el => el.remove());
  clone.querySelectorAll('p.note').forEach(el => { if (el.querySelector('code')) el.remove(); }); // aides de saisie, inutiles sur papier
  if (!tables) clone.querySelectorAll('.table-wrap').forEach(el => { const card = el.closest('.card'); if (card && !card.querySelector('.rp-keep')) card.remove(); });
  // Un rapport ne montre pas de blocs vides : on retire les cartes et tuiles sans donnée
  clone.querySelectorAll('.card').forEach(card => {
    if (card.querySelector('.empty-state') && !card.querySelector('img, table, .aud-grid, .funnel, .obj, .best, .kv')) card.remove();
  });
  clone.querySelectorAll('.tile').forEach(t => { if (t.querySelector('.tile-value.empty')) t.remove(); });
  clone.querySelectorAll('.grid').forEach(g => { if (!g.children.length) g.remove(); else if (g.children.length === 1) g.classList.add('rp-single'); });
  clone.querySelectorAll('.tiles').forEach(t => { if (!t.children.length) t.remove(); });
  return clone;
}

function notesPrintHtml(list, titre) {
  if (!list.length) return '';
  const numeros = new Map(notesFor({ range: currentRange() }).map((c, i) => [c.id, i + 1]));
  return `<div class="card rp-notes"><div class="card-head"><h2>${titre}</h2></div><ul class="notes-list notes-cols">${list.map(c => noteItemHtml(c, numeros.get(c.id), { readonly: true })).join('')}</ul></div>`;
}

async function genererRapport(opts) {
  const busy = $('busy'); busy.hidden = false;
  const report = $('report');
  const pageAvant = location.hash.slice(1) || 'vue', netAvant = STATE.net;
  STATE.exporting = true;
  try {
    const periode = periodLabel(), r = currentRange();
    const gran = { jour: 'Vue jour', semaine: 'Vue semaine', mois: 'Vue mois', perso: 'Période personnalisée' }[STATE.vue];
    const toutes = opts.notes ? notesFor({ range: r }) : [];
    const ordre = { alerte: 0, decision: 1, evenement: 2, analyse: 3 };
    report.innerHTML = `<header class="rp-cover">
        <img src="logo.png" alt="POA" class="rp-logo">
        <div><p class="rp-kicker">Rapport de performance marketing</p><h1>${escapeHtml(periode)}</h1>
        <p class="rp-meta">${gran} · généré le ${new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })} · ${escapeHtml($('source-status').innerText.trim())}</p></div>
      </header>`;
    const section = (titre, sous, node, notesHtml = '') => {
      const s = document.createElement('section'); s.className = 'rp-section';
      s.innerHTML = `<div class="rp-head"><h2>${escapeHtml(titre)}</h2><span>${escapeHtml(sous)}</span></div>`;
      if (notesHtml) s.insertAdjacentHTML('beforeend', notesHtml);
      if (!node.querySelector('.tile, img, table, .aud-grid, .funnel') && !notesHtml) {
        // Section sans aucune donnée : une ligne suffit, pas de page entière
        const m = document.createElement('p'); m.className = 'rp-vide';
        m.textContent = `${titre} : aucune donnée sur la période.`;
        report.appendChild(m); return;
      }
      s.appendChild(node); report.appendChild(s);
    };
    const prendre = async (page, render) => {
      showPage(page); render(); await frame();
      return capturer($(`page-${page}`), opts);
    };
    if (opts.secs.includes('vue')) {
      const node = await prendre('vue', renderVue);
      node.querySelectorAll('.card').forEach(cd => { if (cd.querySelector('.notes-list, .notes-empty, .notes-lock-inline') || cd.contains(node.querySelector('#faits'))) cd.remove(); });
      node.querySelectorAll('.faits-card').forEach(cd => cd.remove());
      const synth = toutes.slice().sort((a, b) => ordre[a.type] - ordre[b.type]);
      section('Synthèse', periode, node, notesPrintHtml(synth, 'Faits marquants et décisions'));
    }
    for (const n of NETS.filter(x => opts.nets.includes(x.key))) {
      STATE.net = n.key;
      const node = await prendre('reseaux', renderReseaux);
      section(`Réseaux sociaux · ${n.label}`, periode, node, opts.notes ? notesPrintHtml(notesFor({ page: 'reseaux', net: n.key, range: r }).filter(c => c.page === 'reseaux'), `Notes ${n.label}`) : '');
    }
    if (opts.secs.includes('landing')) section('Landing page', periode, await prendre('landing', renderLanding), opts.notes ? notesPrintHtml(toutes.filter(c => c.page === 'landing'), 'Notes landing page') : '');
    if (opts.secs.includes('pub')) section('Publicité', periode, await prendre('pub', renderPub), opts.notes ? notesPrintHtml(toutes.filter(c => c.page === 'pub'), 'Notes publicité') : '');
    report.insertAdjacentHTML('beforeend', `<footer class="rp-footer">POA · rapport généré depuis le tableau de bord marketing (poa-dashboard.vercel.app). Chiffres issus de l’onglet POA (saisie) et des API Meta et TikTok (automatique).</footer>`);
  } finally {
    STATE.exporting = false;
    STATE.net = netAvant;
    showPage(pageAvant); renderAll();
    busy.hidden = true;
  }
  const imgs = [...report.querySelectorAll('img')];
  await Promise.all(imgs.map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))));
  document.body.classList.add('printing');
  const titreAvant = document.title;
  document.title = `POA - rapport marketing - ${periodLabel()}`;
  const fin = () => { document.body.classList.remove('printing'); report.innerHTML = ''; document.title = titreAvant; window.removeEventListener('afterprint', fin); };
  window.addEventListener('afterprint', fin);
  window.print();
}

async function onPdfSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const opts = { secs: fd.getAll('sec'), nets: fd.getAll('net'), notes: !!fd.get('notes'), tables: !!fd.get('tables') };
  if (opts.nets.length) opts.secs.push('reseaux');
  fermerExport();
  await genererRapport(opts);
}

/* ---------- Branchement ---------- */
document.addEventListener('DOMContentLoaded', () => {
  $('btn-notes').addEventListener('click', () => ouvrirNotes());
  $('btn-pdf').addEventListener('click', ouvrirExport);
  $('notes-close').addEventListener('click', fermerNotes);
  $('notes-overlay').addEventListener('click', fermerNotes);
  $('notes-drawer').addEventListener('click', onNotesClick);
  $('faits').addEventListener('click', onNotesClick);
  $('notes-drawer').addEventListener('submit', onNotesSubmit);
  $('notes-drawer').addEventListener('change', e => {
    if (e.target.name === 'type') $('nf-aide').textContent = NOTE_TYPES[e.target.value].aide;
  });
  $('pdf-modal').addEventListener('click', e => { if (e.target === $('pdf-modal') || e.target.closest('[data-close-pdf]')) fermerExport(); });
  $('pdf-modal').addEventListener('submit', onPdfSubmit);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('pdf-modal').hidden) fermerExport();
    else if ($('notes-drawer').classList.contains('open')) fermerNotes();
  });
});
