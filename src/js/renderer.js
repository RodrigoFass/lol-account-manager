'use strict';

const api = window.electronAPI;
let allAccounts         = [];
let currentSection      = 'dashboard';
let dragSrcId           = null;
let ddVersion           = '15.10.1';   // Data Dragon version — refreshed non-blocking on init
let currentView         = 'table';     // 'table' | 'cards'
let selectedForCompare  = new Set();   // account IDs checked for comparison
let _accountSelectDirty = false;       // true when history dropdown needs rebuild on next visit

// ── Bootstrap ────────────────────────────────────────────────
async function init() {
  loadQueueFilterPref();      // preset filter BEFORE first render so columns are right from the start
  loadViewPref();             // restore table/cards toggle preference
  loadDDVersion();            // non-blocking — fire & forget; fallback version already set
  loadAppVersion();           // sync sidebar version label with package.json (non-blocking)
  loadLastRefresh();          // restore last batch-refresh time label (non-blocking)
  await loadAccounts();
  await loadSettings();
  loadApiKeyStatus();
  setupEventListeners();
  populateAccountSelects();
}

// Reads the real app version from the main process so the sidebar label
// always reflects package.json — no more hardcoded version drift.
async function loadAppVersion() {
  try {
    const v = await api.app.getVersion();
    const el = document.getElementById('app-version');
    if (v && el) el.textContent = 'v' + v;
  } catch { /* keep hardcoded fallback */ }
}

// Updates the "última atualização" label in the dashboard header.
// Re-renders relative time every 30s while the dashboard is visible.
let _lastRefreshTs = 0;
function updateLastRefreshLabel(ts) {
  if (ts) _lastRefreshTs = ts;
  const el = document.getElementById('last-refresh-label');
  if (!el) return;
  if (!_lastRefreshTs) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.textContent = '🕒 ' + timeAgo(new Date(_lastRefreshTs).toISOString());
}

async function loadLastRefresh() {
  try {
    const ts = await api.app.getLastRefresh();
    if (ts) updateLastRefreshLabel(ts);
  } catch { /* no-op */ }
}
// Keep the relative-time label fresh without polling the main process
setInterval(() => { if (currentSection === 'dashboard' && _lastRefreshTs) updateLastRefreshLabel(); }, 30000);

function loadViewPref() {
  currentView = localStorage.getItem('pref_view') || 'table';
  // Sync button state
  document.getElementById('view-table-btn')?.classList.toggle('active', currentView === 'table');
  document.getElementById('view-cards-btn')?.classList.toggle('active', currentView === 'cards');
}

function setView(v, btn) {
  currentView = v;
  localStorage.setItem('pref_view', v);
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterAccounts();
}

// Fetches the current Data Dragon version from main process (one network call, cached there).
// Called non-blocking so it never delays the first render.
async function loadDDVersion() {
  try {
    const v = await api.riot.getDDVersion();
    if (v) ddVersion = v;
  } catch { /* keep fallback version */ }
}

// Loads (or defaults to 'solo') the user's queue filter preference from localStorage
function loadQueueFilterPref() {
  const saved = localStorage.getItem('pref_queueFilter') ?? 'solo';
  const sel   = document.getElementById('filter-queue');
  if (sel) sel.value = saved;
  // applyQueueFilter will be triggered by renderAccounts on first load
}

function setupEventListeners() {
  api.on('rankUpdate', ({ accountId, rankData, flexRankData, profileIconId, inGame }) => {
    updateAccountRow(accountId, rankData, flexRankData, profileIconId, inGame);
    // Only rebuild the history dropdown when the user is actually on that section
    // (avoids 50 full DOM rebuilds per refresh cycle when section is not visible)
    if (currentSection === 'history') populateAccountSelects();
    else _accountSelectDirty = true;
  });

  // Resync UI + restart countdown (handles powerMonitor resume and key renewal)
  api.on('apiKeyStatus', status => {
    updateApiKeyUI(status);
    startCountdown(status);
  });

  // Last batch-refresh timestamp — fired after refreshAll completes
  // (including background auto-refresh triggered by the 15-min timer)
  api.on('lastRefresh', ts => updateLastRefreshLabel(ts));

  api.on('notification', ({ type, message }) => {
    const t = type.includes('rank') ? (type === 'rankUp' ? 'success' : 'error') : 'warning';
    showToast(message, t);
  });

  api.on('closeRequest', () => {
    document.getElementById('close-dialog').classList.add('open');
  });

  api.on('navigate', section => navigate(section));

  // Auto-update events
  api.on('update:status', ({ status, version, error }) => {
    const statusText   = document.getElementById('update-status-text');
    const installRow   = document.getElementById('install-update-row');
    const progressRow  = document.getElementById('download-progress-row');
    const versionText  = document.getElementById('update-version-text');
    const checkBtn     = document.getElementById('check-update-btn');

    if (!statusText) return;

    if (progressRow) progressRow.style.display = 'none';
    if (installRow)  installRow.style.display  = 'none';

    switch (status) {
      case 'checking':
        statusText.textContent = 'Verificando novas versões...';
        if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = '⏳ Verificando...'; }
        break;
      case 'upToDate':
        statusText.textContent = '✅ O app está atualizado!';
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = '🔄 Verificar'; }
        break;
      case 'available':
        statusText.textContent = `Nova versão ${version} disponível! Baixando em background...`;
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = '🔄 Verificar'; }
        if (progressRow) progressRow.style.display = '';
        break;
      case 'downloaded':
        statusText.textContent = `v${version} baixada e pronta para instalar.`;
        if (versionText) versionText.textContent = `Versão ${version} — reinicie para aplicar.`;
        if (installRow)  installRow.style.display  = '';
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = '🔄 Verificar'; }
        showToast(`Nova versão v${version} disponível! Vá em Configurações → Atualizações.`, 'info', 6000);
        break;
      case 'error':
        statusText.textContent = `Erro ao verificar: ${error || 'desconhecido'}`;
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = '🔄 Verificar'; }
        break;
    }
  });

  api.on('update:progress', ({ percent }) => {
    const bar  = document.getElementById('download-progress-bar');
    const text = document.getElementById('download-progress-text');
    if (bar)  bar.style.width    = `${percent}%`;
    if (text) text.textContent   = `${percent}%`;
  });
}

// ── Navigation ────────────────────────────────────────────────
function navigate(section) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.querySelector(`[data-section="${section}"]`)?.classList.add('active');
  currentSection = section;

  if (section === 'settings') loadSettingsUI();
  if (section === 'history') {
    // Rebuild dropdown lazily — only if rank updates arrived while on another section
    if (_accountSelectDirty) { populateAccountSelects(); _accountSelectDirty = false; }
    else populateAccountSelects();
  }
}

// ── Accounts ─────────────────────────────────────────────────
async function loadAccounts() {
  allAccounts = await api.accounts.getAll();
  renderAccounts(allAccounts);
  populateAccountSelects();
}

function renderAccounts(accounts) {
  const empty        = document.getElementById('accounts-empty');
  const tableWrapper = document.getElementById('accounts-table-wrapper');
  const cardsWrapper = document.getElementById('accounts-cards-wrapper');

  if (!accounts.length) {
    empty.style.display        = 'flex';
    tableWrapper.style.display = 'none';
    if (cardsWrapper) cardsWrapper.style.display = 'none';
    return;
  }
  empty.style.display = 'none';

  if (currentView === 'cards') {
    tableWrapper.style.display = 'none';
    if (cardsWrapper) {
      cardsWrapper.style.display = '';
      cardsWrapper.innerHTML = `<div class="accounts-cards-grid">${accounts.map(buildCard).join('')}</div>`;
    }
  } else {
    tableWrapper.style.display = '';
    if (cardsWrapper) cardsWrapper.style.display = 'none';
    const tbody = document.getElementById('accounts-tbody');
    tbody.innerHTML = accounts.map((a, i) => buildRow(a, i + 1)).join('');
    initDragDrop();
    applyQueueFilter(document.getElementById('filter-queue')?.value || '');
  }
}

// Shared cell renderer — both Solo/Duo and Flex use this exact layout:
//   Top row:  [Badge  LP]  ←— space-between —→  [XX%]
//   Bottom row: [==progress bar==]  [XV YD]
function rankCell(rank) {
  if (!rank || rank.tier === 'UNRANKED') {
    // Wrapped in .rank-cell so it occupies the same height as a ranked cell
    return `<div class="rank-cell rank-cell-empty"><span class="tier-badge tier-UNRANKED">Sem Rank</span></div>`;
  }
  const wr = winrate(rank.wins, rank.losses);
  return `<div class="rank-cell">
    <div class="rank-cell-top">
      <div class="rank-cell-left">
        ${rankBadge(rank)}
        <span class="lp-value">${rank.lp}<span style="font-weight:400;color:var(--text-dim)"> LP</span></span>
      </div>
      ${wrChip(wr)}
    </div>
    ${winrateBar(rank.wins, rank.losses)}
  </div>`;
}

function buildRow(a, idx) {
  // Profile icon
  const initial = escHtml((a.nickname || '?').charAt(0).toUpperCase());
  const hasIcon = a.profileIconId != null;
  const iconSrc = `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${a.profileIconId}.png`;
  const iconImg = hasIcon
    ? `<img class="account-icon" src="${iconSrc}" alt=""
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const iconPlaceholder = `<span class="account-icon-placeholder"${hasIcon ? ' style="display:none"' : ''}>${initial}</span>`;

  // Decay warning: Diamond+ with no update for 21+ days
  const DECAY_TIERS = ['DIAMOND','MASTER','GRANDMASTER','CHALLENGER'];
  const decayBadge = (() => {
    if (!a.currentRank || !DECAY_TIERS.includes(a.currentRank.tier)) return '';
    if (!a.lastUpdated) return '';
    const days = (Date.now() - new Date(a.lastUpdated).getTime()) / 86400000;
    if (days < 21) return '';
    return `<span class="decay-badge" title="Sem atualização há ${Math.floor(days)} dias — risco de decay de LP">⚠️ Decay</span>`;
  })();

  // Watched account
  const isWatched   = a.accountType === 'watched';
  const watchBadge  = isWatched ? `<span class="watched-badge" title="Conta monitorada (sem credenciais)">👁️</span>` : '';
  const credBtns    = isWatched ? '' : `
    <button class="btn-icon btn-icon-success" onclick="copyField('${a.id}','login')"    title="Copiar Login">📋</button>
    <button class="btn-icon btn-icon-success" onclick="copyField('${a.id}','password')" title="Copiar Senha">🔑</button>`;

  // Compare checkbox state
  const isChecked   = selectedForCompare.has(a.id);

  return `
  <tr id="row-${a.id}" data-id="${a.id}" draggable="true">
    <td class="compare-col">
      <input type="checkbox" class="compare-checkbox" data-id="${a.id}" ${isChecked ? 'checked' : ''} onchange="toggleCompare(this)">
    </td>
    <td class="drag-handle" title="Arrastar para reordenar">⠿</td>
    <td style="color:var(--text-dim)">${idx}</td>
    <td>
      <div class="account-name-cell account-clickable" onclick="openAccountDetail('${a.id}')" title="Ver análise detalhada">
        ${iconImg}${iconPlaceholder}
        <div>
          <div class="account-name">${escHtml(a.nickname)} ${watchBadge}</div>
          <div class="account-tag">#${escHtml(a.tag)} ${a.tags?.length ? a.tags.map(tagBadge).join('') : ''} ${decayBadge}</div>
        </div>
      </div>
    </td>
    <td><span class="server-badge">${a.server}</span></td>
    <td>${rankCell(a.currentRank)}</td>
    <td>${rankCell(a.flexRank)}</td>
    <td style="color:var(--text-muted);font-size:12px">${timeAgo(a.lastUpdated)}</td>
    <td>
      <div class="table-actions">
        ${credBtns}
        <button class="btn-icon${a.inGame ? ' ingame' : ''}" onclick="analyzeLiveGame('${a.id}',this)" title="${a.inGame ? 'Em partida — Analisar agora' : 'Analisar Partida ao Vivo'}">🔴</button>
        <button class="btn-icon" onclick="refreshOne('${a.id}',this)" title="Atualizar Rank">⟳</button>
        <button class="btn-icon" onclick="openEditModal('${a.id}')" title="Editar">✏️</button>
        <button class="btn-icon btn-icon-danger" onclick="confirmDelete('${a.id}','${escHtml(a.nickname)}')" title="Remover">🗑️</button>
      </div>
    </td>
  </tr>`;
}

// ── Card view builder ─────────────────────────────────────────
function buildCard(a) {
  const initial = escHtml((a.nickname || '?').charAt(0).toUpperCase());
  const hasIcon = a.profileIconId != null;
  const iconSrc = `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${a.profileIconId}.png`;
  const iconHtml = hasIcon
    ? `<img class="card-icon" src="${iconSrc}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
       <div class="card-icon-placeholder" style="display:none">${initial}</div>`
    : `<div class="card-icon-placeholder">${initial}</div>`;

  const isWatched = a.accountType === 'watched';
  const isChecked = selectedForCompare.has(a.id);
  const soloRank  = a.currentRank;
  const flexRank  = a.flexRank;

  // Decay check
  const DECAY_TIERS = ['DIAMOND','MASTER','GRANDMASTER','CHALLENGER'];
  const hasDecay = soloRank && DECAY_TIERS.includes(soloRank.tier) && a.lastUpdated &&
    (Date.now() - new Date(a.lastUpdated).getTime()) / 86400000 >= 21;

  const credBtns = isWatched ? '' : `
    <button class="btn-icon btn-icon-success" onclick="copyField('${a.id}','login')"    title="Copiar Login">📋</button>
    <button class="btn-icon btn-icon-success" onclick="copyField('${a.id}','password')" title="Copiar Senha">🔑</button>`;

  return `
  <div class="account-card${isChecked ? ' card-selected' : ''}" id="card-${a.id}">
    <input type="checkbox" class="card-compare-cb compare-checkbox" data-id="${a.id}" ${isChecked ? 'checked' : ''} onchange="toggleCompare(this)" title="Selecionar para comparar">
    <div class="card-top account-clickable" onclick="openAccountDetail('${a.id}')" title="Ver análise detalhada">
      ${iconHtml}
      <div class="card-identity">
        <div class="card-name">${escHtml(a.nickname)} ${isWatched ? '<span class="watched-badge">👁️</span>' : ''}</div>
        <div class="card-subtag">#${escHtml(a.tag)} · <span class="server-badge" style="font-size:10px">${a.server}</span></div>
      </div>
    </div>
    <div class="card-rank-section">
      <div class="card-rank-label">Solo / Duo</div>
      ${rankCell(soloRank)}
    </div>
    <div class="card-rank-section">
      <div class="card-rank-label">Flex</div>
      ${rankCell(flexRank)}
    </div>
    ${hasDecay ? `<span class="decay-badge" title="Risco de decay">⚠️ Decay</span>` : ''}
    <div class="card-actions">
      ${credBtns}
      <button class="btn-icon${a.inGame ? ' ingame' : ''}" onclick="analyzeLiveGame('${a.id}',this)" title="${a.inGame ? 'Em partida — Analisar agora' : 'Analisar Partida ao Vivo'}">🔴</button>
      <button class="btn-icon" onclick="refreshOne('${a.id}',this)" title="Atualizar Rank">⟳</button>
      <button class="btn-icon" onclick="openEditModal('${a.id}')" title="Editar">✏️</button>
      <button class="btn-icon btn-icon-danger" onclick="confirmDelete('${a.id}','${escHtml(a.nickname)}')" title="Remover">🗑️</button>
    </div>
  </div>`;
}

function updateAccountRow(accountId, rankData, flexRankData, profileIconId, inGame) {
  const idx = allAccounts.findIndex(a => a.id === accountId);
  if (idx === -1) return;
  allAccounts[idx].currentRank = rankData;
  if (flexRankData  !== undefined) allAccounts[idx].flexRank      = flexRankData;
  if (profileIconId != null)       allAccounts[idx].profileIconId = profileIconId;
  if (inGame        !== undefined) allAccounts[idx].inGame        = inGame;
  allAccounts[idx].lastUpdated = new Date().toISOString();

  // Table view — drag delegation is on <tbody>, not on rows;
  // no need to re-register listeners when a single <tr> is replaced
  const row = document.getElementById(`row-${accountId}`);
  if (row) row.outerHTML = buildRow(allAccounts[idx], idx + 1);

  // Card view — update the card in-place so cards mode stays live too
  const card = document.getElementById(`card-${accountId}`);
  if (card) card.outerHTML = buildCard(allAccounts[idx]);
}

function filterAccounts() {
  const q            = (document.getElementById('search-input')?.value  || '').toLowerCase();
  const tierFilter   =  document.getElementById('filter-tier')?.value   || '';
  const serverFilter =  document.getElementById('filter-server')?.value || '';
  const tagFilter    =  document.getElementById('filter-tag')?.value    || '';
  const queueFilter  =  document.getElementById('filter-queue')?.value  || '';

  const filtered = allAccounts.filter(a => {
    const matchSearch = !q ||
      a.nickname.toLowerCase().includes(q) ||
      a.tag.toLowerCase().includes(q) ||
      a.server.toLowerCase().includes(q);

    // Tier filter applies against the selected queue's rank
    const rankForTier = (queueFilter === 'flex') ? a.flexRank : a.currentRank;
    const accountTier = rankForTier?.tier || 'UNRANKED';
    const matchTier   = !tierFilter || accountTier === tierFilter;

    const matchServer = !serverFilter || a.server === serverFilter;
    const matchTag    = !tagFilter || (a.tags && a.tags.includes(tagFilter));

    return matchSearch && matchTier && matchServer && matchTag;
  });

  // Persist user's queue filter preference
  localStorage.setItem('pref_queueFilter', queueFilter);

  renderAccounts(filtered);
}

// Controls which rank columns are visible based on queue filter
function applyQueueFilter(queueFilter) {
  const table = document.getElementById('accounts-table');
  if (!table) return;
  // hide-flex-col → hides Flex column (col 6) when Solo/Duo selected
  // hide-solo-col → hides Solo/Duo col (col 5) + Winrate col (col 7) when Flex selected
  table.classList.toggle('hide-flex-col', queueFilter === 'solo');
  table.classList.toggle('hide-solo-col', queueFilter === 'flex');
}

// ── Add / Edit Modal ──────────────────────────────────────────
function openAddModal() {
  document.getElementById('modal-title').textContent     = 'Adicionar Conta';
  document.getElementById('edit-account-id').value       = '';
  document.getElementById('f-nickname').value            = '';
  document.getElementById('f-tag').value                 = '';
  document.getElementById('f-login').value               = '';
  document.getElementById('f-password').value            = '';
  document.getElementById('f-server').value              = 'BR1';
  document.getElementById('f-tags').value                = '';
  document.getElementById('f-notes').value               = '';
  document.getElementById('f-puuid').value               = '';
  document.getElementById('f-login').disabled            = false;
  document.getElementById('f-password').disabled         = false;
  document.getElementById('f-login').placeholder            = 'Login da conta Riot';
  document.getElementById('f-password').placeholder         = 'Senha da conta';
  // Reset watch mode toggle
  const watchCb = document.getElementById('f-watch-mode');
  if (watchCb) { watchCb.checked = false; toggleWatchMode(false); }
  // Show watch mode row (hidden during edit)
  const watchRow = document.getElementById('watch-mode-row');
  if (watchRow) watchRow.style.display = '';
  openModal('account-modal');
}

async function openEditModal(id) {
  const a = allAccounts.find(x => x.id === id);
  if (!a) return;
  const isWatched = a.accountType === 'watched';

  document.getElementById('modal-title').textContent  = 'Editar Conta';
  document.getElementById('edit-account-id').value    = id;
  document.getElementById('f-nickname').value         = a.nickname;
  document.getElementById('f-tag').value              = a.tag;
  document.getElementById('f-server').value           = a.server;
  document.getElementById('f-tags').value             = a.tags?.[0] || '';
  document.getElementById('f-notes').value            = a.notes || '';
  document.getElementById('f-puuid').value            = a.puuid || '';

  // Always ensure credentials-group is visible (removes any leftover 'hidden' class
  // from a previous watch-mode session — pointer-events:none would block typing)
  toggleWatchMode(false);

  if (isWatched) {
    // Watched accounts have no credentials stored — keep fields disabled
    document.getElementById('f-login').value       = '';
    document.getElementById('f-password').value    = '';
    document.getElementById('f-login').disabled    = true;
    document.getElementById('f-password').disabled = true;
    document.getElementById('f-login').placeholder    = 'Conta monitorada — sem credenciais';
    document.getElementById('f-password').placeholder = 'Conta monitorada — sem credenciais';
  } else {
    // Full account — clear fields so user can type new credentials.
    // Leaving blank = keep existing; typing = update.
    document.getElementById('f-login').value       = '';
    document.getElementById('f-password').value    = '';
    document.getElementById('f-login').disabled    = false;
    document.getElementById('f-password').disabled = false;
    document.getElementById('f-login').placeholder    = 'Deixe em branco para não alterar';
    document.getElementById('f-password').placeholder = 'Deixe em branco para não alterar';
  }

  // Hide watch-mode toggle — accountType cannot change after creation
  const watchRow = document.getElementById('watch-mode-row');
  if (watchRow) watchRow.style.display = 'none';

  openModal('account-modal');
}

function closeModal() { closeModalById('account-modal'); }

async function saveAccount() {
  try {
    const id       = document.getElementById('edit-account-id').value;
    const nickname = document.getElementById('f-nickname').value.trim();
    const tag      = document.getElementById('f-tag').value.trim().replace(/^#+/, '');
    const login    = document.getElementById('f-login').value.trim();
    const password = document.getElementById('f-password').value;          // don't trim passwords
    const server   = document.getElementById('f-server').value;
    const tagVal   = document.getElementById('f-tags').value;
    const notes    = document.getElementById('f-notes').value.trim();
    const isWatch  = document.getElementById('f-watch-mode')?.checked ?? false;
    const puuidInput = document.getElementById('f-puuid')?.value?.trim() || null;

    if (!nickname || !tag || !server) {
      showToast('Preencha Nickname, Tag e Servidor.', 'warning');
      return;
    }

    if (id) {
      // ── EDIT ────────────────────────────────────────────────
      const u = { nickname, tag, server, tags: tagVal ? [tagVal] : [], notes };
      if (puuidInput) u.puuid = puuidInput;
      // Only send credentials if the user actually typed something (blank = keep existing)
      if (login)    u.login    = login;
      if (password) u.password = password;

      const res = await api.accounts.update(id, u);
      if (res.success) {
        showToast('Conta atualizada!', 'success');
      } else {
        showToast(res.error || 'Erro ao atualizar.', 'error');
        return;
      }
    } else {
      // ── ADD ─────────────────────────────────────────────────
      if (!isWatch && (!login || !password)) {
        showToast('Login e senha são obrigatórios (ou ative "Monitorar sem credenciais").', 'warning');
        return;
      }
      const payload = { nickname, tag, server, tags: tagVal ? [tagVal] : [], notes, puuid: puuidInput };
      if (isWatch) {
        payload.accountType = 'watched';
      } else {
        payload.login    = login;
        payload.password = password;
      }
      const res = await api.accounts.add(payload);
      if (res.success) {
        showToast(isWatch ? '👁️ Conta monitorada adicionada!' : 'Conta adicionada!', 'success');
      } else {
        showToast(res.error || 'Erro ao adicionar.', 'error');
        return;
      }
    }

    closeModal();
    await loadAccounts();
  } catch (err) {
    console.error('[saveAccount] erro inesperado:', err);
    showToast('Erro inesperado ao salvar. Verifique o console.', 'error', 5000);
  }
}

async function lookupPuuid() {
  const nickname = document.getElementById('f-nickname')?.value?.trim();
  const tag      = document.getElementById('f-tag')?.value?.trim().replace(/^#+/, '');
  const server   = document.getElementById('f-server')?.value || 'BR1';
  if (!nickname || !tag) { showToast('Preencha o Nickname e a Tag antes de buscar o PUUID.', 'warning'); return; }

  const btn = document.getElementById('lookup-puuid-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  const res = await api.riot.lookupPuuid(nickname, tag, server);

  if (res.found) {
    document.getElementById('f-puuid').value = res.puuid;
    // In edit mode: auto-persist the PUUID immediately so the refresh button works right away
    const editId = document.getElementById('edit-account-id')?.value;
    if (editId) {
      await api.accounts.update(editId, { puuid: res.puuid });
      // Keep in-memory cache in sync so the Edit modal shows the correct PUUID on re-open
      const idx = allAccounts.findIndex(a => a.id === editId);
      if (idx !== -1) allAccounts[idx].puuid = res.puuid;
      showToast('✅ PUUID salvo! Feche este modal e clique em ⟳ para atualizar o rank.', 'success', 6000);
    } else {
      showToast('✅ PUUID encontrado! Clique em Salvar Conta para confirmar.', 'success', 5000);
    }
  } else if (res.devKeyBlocked) {
    showToast(
      '🔒 Chave de desenvolvimento bloqueada nos endpoints de busca. ' +
      'Obtenha o PUUID manualmente em developer.riotgames.com → API Explorer → ACCOUNT-V1 → by-riot-id (Region: americas).',
      'warning', 12000
    );
    api.apiKey.openRenewalPage();
  } else {
    showToast(`Não foi possível buscar o PUUID: ${res.error || 'erro desconhecido'}.`, 'error', 6000);
  }

  if (btn) { btn.disabled = false; btn.textContent = '🔍 Buscar'; }
}

function confirmDelete(id, name) {
  const text = document.getElementById('confirm-delete-text');
  const btn  = document.getElementById('confirm-delete-ok');
  if (!text || !btn) return;
  text.textContent = `Deseja remover a conta "${name}"?`;
  // Replace the confirm button to avoid stacking old listeners
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener('click', async () => {
    closeModalById('confirm-delete-modal');
    const res = await api.accounts.delete(id);
    if (res.success) {
      // Remove from compare selection so Set doesn't hold stale IDs
      selectedForCompare.delete(id);
      updateCompareBar();
      showToast('Conta removida.', 'info');
      await loadAccounts();
    } else {
      showToast(res.error || 'Erro ao remover.', 'error');
    }
  });
  openModal('confirm-delete-modal');
}

// ── Refresh ───────────────────────────────────────────────────
async function refreshOne(id, btn) {
  const orig = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;
  const res = await api.riot.fetchRanking(id);
  if (res.success) {
    showToast('Rank atualizado!', 'success');
  } else {
    const isPuuidRequired = res.error && res.error.includes('PUUID_REQUIRED');
    const isLeagueBlocked = res.error && res.error.includes('LEAGUE_BLOCKED');
    const isStepError     = res.error && res.error.startsWith('STEP:');
    const isKeyError      = !isPuuidRequired && !isLeagueBlocked && !isStepError &&
                            res.error && (res.error.includes('403') || res.error.includes('401'));
    let msg, type, duration;
    if (isPuuidRequired) {
      msg      = '⚠️ Chave de desenvolvimento bloqueada nos endpoints de busca. Clique em ✏️ Editar na conta e preencha o campo PUUID (obtenha em developer.riotgames.com → API Explorer).';
      type     = 'warning';
      duration = 12000;
    } else if (isLeagueBlocked) {
      msg      = '🔒 Chave de desenvolvimento bloqueada no endpoint de rank. Para ver dados de ranked, é necessária uma Personal API Key — acesse developer.riotgames.com → Register Product → Personal API Key.';
      type     = 'warning';
      duration = 15000;
    } else if (isKeyError) {
      msg      = 'API Key expirada ou inválida — vá em ⚙️ Configurações, cole a nova chave e clique em Validar e Salvar.';
      type     = 'error';
      duration = 7000;
    } else {
      // Strip internal "STEP:endpoint → " prefix before showing to user
      let raw = (res.error || '').replace(/^STEP:\S+ → /, '');
      if (!raw || raw.length < 5) {
        raw = 'Não foi possível obter os dados da conta.';
      } else if (/erro de rede|sem conex|failed to fetch/i.test(raw)) {
        raw = 'Sem conexão com a internet. Verifique sua rede e tente novamente.';
      } else if (/404|não encontrado|not found/i.test(raw)) {
        raw = 'Conta não encontrada na Riot API. Verifique o nickname, a tag e o servidor.';
      } else if (/429/i.test(raw)) {
        raw = 'Limite de requisições atingido. Aguarde alguns segundos e tente novamente.';
      } else if (/50[0-9]/i.test(raw)) {
        raw = 'Servidores da Riot indisponíveis no momento. Tente novamente em alguns minutos.';
      }
      msg      = raw;
      type     = 'error';
      duration = 8000;
    }
    showToast(msg, type, duration);
    if (isKeyError) navigate('settings');
  }
  btn.textContent = orig;
  btn.disabled = false;
  // rankUpdate push event already updated allAccounts + DOM in-place;
  // only reload from disk on error to ensure UI matches persisted state
  if (!res.success) await loadAccounts();
}

async function refreshAll() {
  const btn = document.getElementById('refresh-all-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="refreshing">⟳</span>';
  const res = await api.riot.fetchAllRankings();
  if (res.success) showToast('Todos os ranks atualizados!', 'success');
  else             showToast(res.error || 'Erro ao atualizar.', 'error');
  btn.disabled = false;
  btn.innerHTML = '⟳';
  // rankUpdate push events already updated allAccounts + DOM per account;
  // a full reload is only needed when the batch fails entirely
  if (!res.success) await loadAccounts();
}

// ── Clipboard ─────────────────────────────────────────────────
async function copyField(id, field) {
  const fn  = field === 'login' ? api.clipboard.copyLogin : api.clipboard.copyPassword;
  const res = await fn(id);
  if (res.success) showToast(field === 'login' ? 'Login copiado! Será limpo em 30s.' : 'Senha copiada! Será limpa em 30s.', 'success', 2500);
  else             showToast(res.error || 'Erro ao copiar.', 'error');
}

// ── Account selects ───────────────────────────────────────────
function populateAccountSelects() {
  // Keep hidden native select in sync (charts.js reads .value)
  const sel = document.getElementById('history-account-select');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Selecionar conta...</option>' +
      allAccounts.map(a =>
        `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${escHtml(a.nickname)}#${escHtml(a.tag)}</option>`
      ).join('');
  }
  buildAccountDropdown();
}


// ── Custom account dropdown (history section) ─────────────────
function _selIconHtml(a) {
  const url = a.profileIconId
    ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${a.profileIconId}.png`
    : '';
  const fallback = `<span class="sel-icon sel-icon-fallback" style="display:none">${escHtml(a.nickname.charAt(0).toUpperCase())}</span>`;
  return url
    ? `<img class="sel-icon" src="${url}" alt=""
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">${fallback}`
    : `<span class="sel-icon sel-icon-fallback">${escHtml(a.nickname.charAt(0).toUpperCase())}</span>`;
}

function buildAccountDropdown() {
  const optContainer = document.getElementById('account-select-options');
  if (!optContainer) return;
  const curId = document.getElementById('history-account-select')?.value || '';

  optContainer.innerHTML =
    allAccounts.map(a => `
      <div class="account-select-option ${a.id === curId ? 'selected' : ''}" data-id="${a.id}" onclick="selectHistoryAccount('${a.id}')">
        <span class="sel-icon-wrap">${_selIconHtml(a)}</span>
        <span class="sel-info">
          <span class="sel-name">${escHtml(a.nickname)}<span class="sel-tag">#${escHtml(a.tag)}</span></span>
          <span class="sel-meta">${rankBadge(a.currentRank)}<span class="sel-server">${escHtml(a.server)}</span></span>
        </span>
      </div>`).join('');

  refreshAccountSelectTrigger(curId);
}

function refreshAccountSelectTrigger(id) {
  const trigger = document.getElementById('account-select-trigger');
  if (!trigger) return;
  if (!id) {
    trigger.innerHTML = `<span class="sel-placeholder">Selecionar conta...</span><span class="sel-caret">▾</span>`;
    return;
  }
  const a = allAccounts.find(ac => ac.id === id);
  if (!a) {
    trigger.innerHTML = `<span class="sel-placeholder">Selecionar conta...</span><span class="sel-caret">▾</span>`;
    return;
  }
  trigger.innerHTML =
    `<span class="sel-icon-wrap">${_selIconHtml(a)}</span>
     <span class="sel-trigger-name">${escHtml(a.nickname)}<span class="sel-tag">#${escHtml(a.tag)}</span></span>
     <span class="sel-trigger-meta">${rankBadge(a.currentRank)}</span>
     <span class="sel-caret">▾</span>`;
}

// Stored reference so we can remove the listener when dropdown closes via selection,
// preventing orphaned document-level click listeners from accumulating.
let _ddCloseHandler = null;

function toggleAccountDropdown() {
  const dd = document.getElementById('account-select-options');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  _closeAccountDropdown(dd);         // always clean up existing handler first
  if (!isOpen) {
    dd.style.display = 'block';
    setTimeout(() => {
      _ddCloseHandler = e => {
        const wrapper = document.getElementById('history-account-dropdown');
        if (wrapper && !wrapper.contains(e.target)) _closeAccountDropdown(dd);
      };
      document.addEventListener('click', _ddCloseHandler);
    }, 0);
  }
}

function _closeAccountDropdown(dd) {
  if (!dd) dd = document.getElementById('account-select-options');
  if (dd) dd.style.display = 'none';
  if (_ddCloseHandler) {
    document.removeEventListener('click', _ddCloseHandler);
    _ddCloseHandler = null;
  }
}

function selectHistoryAccount(id) {
  const sel = document.getElementById('history-account-select');
  if (sel) {
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
  }
  document.querySelectorAll('#account-select-options .account-select-option').forEach(opt => {
    opt.classList.toggle('selected', (opt.dataset.id || '') === id);
  });
  refreshAccountSelectTrigger(id);
  _closeAccountDropdown(null); // close and remove listener in one call
}

// ── Close dialog ──────────────────────────────────────────────
async function handleClose() {
  const s = await api.settings.get();
  const action = s?.closeAction || 'ask';
  if (action === 'tray')  { api.window.hide();  return; }
  if (action === 'close') { api.window.close(); return; }
  // action === 'ask': show dialog
  document.getElementById('remember-close').checked = false;
  document.getElementById('close-dialog').classList.add('open');
}

async function closeApp(action) {
  const remember = document.getElementById('remember-close').checked;
  if (remember) await api.settings.set('closeAction', action);
  document.getElementById('close-dialog').classList.remove('open');
  if (action === 'tray') api.window.hide();
  else                   api.window.close();
}

// ── Settings ──────────────────────────────────────────────────
let settingsCache = {};

// ── Theme ─────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
}

// Immediately apply + persist theme when the select changes
async function changeTheme(theme) {
  applyTheme(theme);
  settingsCache.theme = theme;
  await api.settings.set('theme', theme);
  // Reset history chart so it's rebuilt with correct theme colors on next render
  if (typeof historyChart !== 'undefined' && historyChart) {
    historyChart.destroy();
    historyChart = null;
    if (typeof _lastChartAccountId !== 'undefined') _lastChartAccountId = null;
    if (typeof currentHistoryAccount !== 'undefined' && currentHistoryAccount) {
      renderHistoryChart(currentHistoryAccount);
    }
  }
}

// Immediately persist one notification toggle on change  (Bug 2 fix)
async function saveNotifSetting(key, value) {
  if (!settingsCache.notifications) settingsCache.notifications = {};
  settingsCache.notifications[key] = value;
  await api.settings.set('notifications', { ...settingsCache.notifications });
}

async function loadSettings() {
  settingsCache = await api.settings.get();
  applyTheme(settingsCache.theme || 'dark');
}

async function loadSettingsUI() {
  const s = await api.settings.get();
  settingsCache = s;
  const el = id => document.getElementById(id);
  el('refresh-interval').value       = s.refreshInterval ?? 15;
  el('theme-select').value           = s.theme           ?? 'dark';
  el('close-action').value           = s.closeAction     ?? 'ask';
  el('notif-rankUp').checked         = s.notifications?.rankUp         ?? true;
  el('notif-rankDown').checked       = s.notifications?.rankDown       ?? true;
  el('notif-promo').checked          = s.notifications?.promo          ?? true;
  el('notif-apiKeyExpiring').checked = s.notifications?.apiKeyExpiring ?? true;
  // Startup toggle — read directly from OS registry via main process
  const startup = await api.startup.get();
  el('startup-toggle').checked = startup.openAtLogin;
}

async function saveStartupSetting(value) {
  await api.startup.set(value);
  showToast(
    value ? '✅ App configurado para iniciar com o Windows.' : 'Inicialização automática desativada.',
    'success', 3000
  );
}

async function saveSettings() {
  try {
    const el    = id => document.getElementById(id);
    const theme = el('theme-select').value;
    // Note: theme is already persisted immediately via changeTheme().
    // Note: notifications are already persisted immediately via saveNotifSetting().
    // saveSettings only needs to handle refreshInterval and closeAction here.
    await api.settings.set('refreshInterval', parseInt(el('refresh-interval').value) || 15);
    await api.settings.set('theme',           theme);
    await api.settings.set('closeAction',     el('close-action').value);
    await api.settings.set('notifications', {
      rankUp:         el('notif-rankUp').checked,
      rankDown:       el('notif-rankDown').checked,
      promo:          el('notif-promo').checked,
      apiKeyExpiring: el('notif-apiKeyExpiring').checked,
    });
    applyTheme(theme);
    settingsCache = await api.settings.get(); // refresh local cache
    showToast('Configurações salvas!', 'success');
  } catch (err) {
    showToast('Erro ao salvar configurações: ' + (err.message || err), 'error');
  }
}

// ── Backup ────────────────────────────────────────────────────
async function exportBackup() {
  const pwd = document.getElementById('backup-export-pwd')?.value;
  if (!pwd) { showToast('Informe sua senha mestra para exportar.', 'warning'); return; }
  showToast('Preparando backup...', 'info', 1500);
  const res = await api.backup.export(pwd);
  if (res.canceled) return;
  if (res.success) {
    showToast(`✅ Backup exportado com ${res.count} conta(s)!`, 'success', 5000);
    document.getElementById('backup-export-pwd').value = '';
  } else {
    showToast(res.error || 'Erro ao exportar backup.', 'error');
  }
}

async function importBackup() {
  const pwd = document.getElementById('backup-import-pwd')?.value;
  if (!pwd) { showToast('Informe a senha mestra usada na exportação.', 'warning'); return; }
  showToast('Selecionando arquivo...', 'info', 1500);
  const res = await api.backup.import(pwd);
  if (res.canceled) return;
  if (res.success) {
    showToast(`✅ ${res.imported} de ${res.total} conta(s) importada(s)!`, 'success', 5000);
    document.getElementById('backup-import-pwd').value = '';
    await loadAccounts();
  } else {
    showToast(res.error || 'Erro ao importar backup.', 'error');
  }
}

// ── Auto-Update ───────────────────────────────────────────────
async function checkForUpdates() {
  const btn = document.getElementById('check-update-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando...'; }
  const res = await api.update.check();
  if (!res.success) {
    showToast(res.message || 'Auto-update não disponível.', 'info');
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Verificar'; }
    const el = document.getElementById('update-status-text');
    if (el) el.textContent = res.message || 'Indisponível em modo de desenvolvimento.';
  }
}

function installUpdate() {
  showToast('Instalando atualização... O app será reiniciado.', 'info', 4000);
  setTimeout(() => api.update.install(), 1500);
}

async function changePassword() {
  const oldPwd  = document.getElementById('old-pwd').value;
  const newPwd  = document.getElementById('new-pwd').value;
  const confirm = document.getElementById('confirm-pwd').value;
  if (!oldPwd || !newPwd) { showToast('Preencha todos os campos.', 'warning'); return; }
  if (newPwd.length < 6)  { showToast('Nova senha deve ter pelo menos 6 caracteres.', 'warning'); return; }
  if (newPwd !== confirm)  { showToast('As senhas não coincidem.', 'warning'); return; }
  const res = await api.auth.changePassword(oldPwd, newPwd);
  if (res.success) {
    showToast('Senha alterada com sucesso!', 'success');
    ['old-pwd','new-pwd','confirm-pwd'].forEach(id => document.getElementById(id).value = '');
  } else { showToast(res.error || 'Erro ao alterar senha.', 'error'); }
}

// ── Escape HTML ───────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Drag-and-drop reorder (event-delegated on tbody) ─────────
// Delegating to tbody means we attach ONCE and never accumulate
// duplicate listeners across re-renders or rankUpdate events.
function _ddRow(e)  { return e.target.closest('tr[data-id]'); }
function _ddClear(tbody) { tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over')); }

function _onDragStart(e) {
  const tr = _ddRow(e); if (!tr) return;
  dragSrcId = tr.dataset.id;
  tr.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcId);
}
function _onDragEnd(e) {
  const tbody = e.currentTarget;
  const tr = _ddRow(e); if (tr) tr.classList.remove('dragging');
  _ddClear(tbody);
}
function _onDragOver(e) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const tbody = e.currentTarget; _ddClear(tbody);
  const tr = _ddRow(e);
  if (tr && tr.dataset.id !== dragSrcId) tr.classList.add('drag-over');
}
function _onDragLeave(e) { const tr = _ddRow(e); if (tr) tr.classList.remove('drag-over'); }
async function _onDrop(e) {
  e.preventDefault();
  const tbody = e.currentTarget; _ddClear(tbody);
  const tr = _ddRow(e);
  if (!tr || !dragSrcId || dragSrcId === tr.dataset.id) return;
  const srcIdx = allAccounts.findIndex(a => a.id === dragSrcId);
  const dstIdx = allAccounts.findIndex(a => a.id === tr.dataset.id);
  if (srcIdx === -1 || dstIdx === -1) return;
  const [moved] = allAccounts.splice(srcIdx, 1);
  allAccounts.splice(dstIdx, 0, moved);
  filterAccounts();
  const reorderRes = await api.accounts.reorder(allAccounts.map(a => a.id));
  if (!reorderRes.success) {
    showToast('Erro ao salvar nova ordem. Recarregando...', 'error');
    await loadAccounts();
  }
  dragSrcId = null;
}

function initDragDrop() {
  const tbody = document.getElementById('accounts-tbody');
  if (!tbody) return;
  // Remove previous delegated handlers before re-attaching — idempotent
  tbody.removeEventListener('dragstart', _onDragStart);
  tbody.removeEventListener('dragend',   _onDragEnd);
  tbody.removeEventListener('dragover',  _onDragOver);
  tbody.removeEventListener('dragleave', _onDragLeave);
  tbody.removeEventListener('drop',      _onDrop);
  tbody.addEventListener('dragstart', _onDragStart);
  tbody.addEventListener('dragend',   _onDragEnd);
  tbody.addEventListener('dragover',  _onDragOver);
  tbody.addEventListener('dragleave', _onDragLeave);
  tbody.addEventListener('drop',      _onDrop);
}

// ── Compare Selection ─────────────────────────────────────────
function toggleCompare(cb) {
  const id = cb.dataset.id;
  if (cb.checked) selectedForCompare.add(id);
  else            selectedForCompare.delete(id);
  // Sync all checkboxes with same id (table + cards can both exist in DOM)
  document.querySelectorAll(`.compare-checkbox[data-id="${id}"]`).forEach(el => { el.checked = cb.checked; });
  // Sync card border
  const card = document.getElementById(`card-${id}`);
  if (card) card.classList.toggle('card-selected', cb.checked);
  updateCompareBar();
}

function toggleCompareAll(masterCb) {
  // Works in both table view (tr[data-id]) and card view (.compare-checkbox[data-id])
  const checkboxes = document.querySelectorAll('.compare-checkbox[data-id]');
  checkboxes.forEach(cb => {
    const id = cb.dataset.id;
    if (masterCb.checked) selectedForCompare.add(id);
    else                  selectedForCompare.delete(id);
    cb.checked = masterCb.checked;
    const card = document.getElementById(`card-${id}`);
    if (card) card.classList.toggle('card-selected', masterCb.checked);
  });
  updateCompareBar();
}

function updateCompareBar() {
  const bar = document.getElementById('compare-bar');
  if (!bar) return;
  const count = selectedForCompare.size;
  bar.style.display = count >= 2 ? 'flex' : 'none';
  bar.querySelector('.compare-count').textContent = `${count} conta${count !== 1 ? 's' : ''} selecionada${count !== 1 ? 's' : ''}`;
}

function clearCompare() {
  selectedForCompare.clear();
  document.querySelectorAll('.compare-checkbox').forEach(cb => cb.checked = false);
  document.querySelectorAll('.account-card').forEach(c => c.classList.remove('card-selected'));
  const master = document.getElementById('compare-all-cb');
  if (master) master.checked = false;
  updateCompareBar();
}

function openCompareModal() {
  const accounts = [...selectedForCompare]
    .map(id => allAccounts.find(a => a.id === id))
    .filter(Boolean);
  if (accounts.length < 2) { showToast('Selecione pelo menos 2 contas para comparar.', 'warning'); return; }
  buildCompareContent(accounts);
  openModal('compare-modal');
}

function buildCompareContent(accounts) {
  const body = document.getElementById('compare-modal-body');
  const n    = accounts.length;   // no cap — show all selected accounts

  // Find best values for highlighting
  const scores = accounts.map(a => {
    const r = a.currentRank;
    if (!r || r.tier === 'UNRANKED') return 0;
    return tierToNumber(r.tier, r.division) + (r.lp || 0);
  });
  const bestScore = Math.max(...scores);

  const cols = accounts.map((a, i) => {
    const hasIcon = a.profileIconId != null;
    const initial = escHtml((a.nickname || '?').charAt(0).toUpperCase());
    const iconSrc = `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${a.profileIconId}.png`;
    const iconHtml = hasIcon
      ? `<img class="cmp-icon" src="${iconSrc}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="cmp-icon-placeholder" style="display:none">${initial}</div>`
      : `<div class="cmp-icon-placeholder">${initial}</div>`;

    const r  = a.currentRank;
    const fr = a.flexRank;
    const wr = r ? winrate(r.wins, r.losses) : 0;
    const fwr = fr ? winrate(fr.wins, fr.losses) : 0;
    const isWinner = scores[i] === bestScore && bestScore > 0;

    return `
    <div class="compare-col-card${isWinner ? ' compare-winner' : ''}">
      <div class="cmp-header">
        ${iconHtml}
        <div>
          <div class="cmp-name">${escHtml(a.nickname)}</div>
          <div class="cmp-sub">#${escHtml(a.tag)} · ${a.server}</div>
        </div>
      </div>
      <div class="cmp-row">
        <span class="cmp-label">Solo/Duo</span>
        <span class="cmp-value${isWinner ? ' cmp-best' : ''}">${rankBadge(r)}</span>
      </div>
      <div class="cmp-row">
        <span class="cmp-label">LP</span>
        <span class="cmp-value">${r && r.tier !== 'UNRANKED' ? r.lp : '—'}</span>
      </div>
      <div class="cmp-row">
        <span class="cmp-label">Win Rate Solo</span>
        <span class="cmp-value" style="color:${wrColor(wr)}">${wr ? wr + '%' : '—'}</span>
      </div>
      <div class="cmp-row">
        <span class="cmp-label">Partidas Solo</span>
        <span class="cmp-value">${r && r.tier !== 'UNRANKED' ? `${r.wins}V ${r.losses}D` : '—'}</span>
      </div>
      <div class="cmp-row">
        <span class="cmp-label">Flex</span>
        <span class="cmp-value">${rankBadge(fr)}</span>
      </div>
      <div class="cmp-row">
        <span class="cmp-label">Win Rate Flex</span>
        <span class="cmp-value" style="color:${wrColor(fwr)}">${fwr ? fwr + '%' : '—'}</span>
      </div>
      <div class="cmp-row">
        <span class="cmp-label">Última atualização</span>
        <span class="cmp-value" style="font-size:11px">${timeAgo(a.lastUpdated)}</span>
      </div>
    </div>`;
  }).join('');

  const gridClass = `compare-grid compare-grid-${n <= 4 ? n : 'many'}`;
  body.innerHTML = `<div class="${gridClass}">${cols}</div>
    <p style="font-size:11px;color:var(--text-dim);margin-top:14px;text-align:center">
      🏆 Destaque verde = maior elo no grupo
    </p>`;
}

// ══════════════════════════════════════════════════════════════
// LIVE GAME ANALYSIS (Spectator)
// ══════════════════════════════════════════════════════════════
let _liveGame        = null;   // last loaded game data
let _liveAccountId   = null;   // account used to load the game
let _liveSort        = 'team'; // 'team' | 'elo' | 'lp' | 'winrate'
let _liveFilter      = 'all';  // 'all' | 'allies' | 'enemies'

async function analyzeLiveGame(id, btn) {
  _liveAccountId = id;
  _liveGame = null;   // drop previous account's match so it can't be re-rendered while loading
  _liveSort = 'team'; _liveFilter = 'all';
  // Reset sort/filter button highlights to the defaults
  document.querySelectorAll('#livegame-modal .lg-sort-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.querySelectorAll('#livegame-modal .lg-filter-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  openModal('livegame-modal');
  const body = document.getElementById('livegame-body');
  const sub  = document.getElementById('livegame-subtitle');
  if (sub)  sub.textContent = 'Carregando partida...';
  if (body) body.innerHTML = `<div class="lg-loading"><span class="spinner"></span> Buscando jogadores da partida...</div>`;
  await _loadLiveGame();
}

async function _loadLiveGame() {
  const body = document.getElementById('livegame-body');
  const sub  = document.getElementById('livegame-subtitle');
  const res  = await api.riot.getLiveGame(_liveAccountId);

  if (!res.success) {
    _liveGame = null;   // clear stale data so sort/filter can't re-render the previous match
    let msg;
    if (res.notInGame)            msg = '🎮 Esta conta não está em partida no momento.';
    else if (res.puuidRequired)   msg = '⚠️ Esta conta não tem PUUID salvo. Edite a conta e clique em "🔍 Buscar" para obter o PUUID antes de analisar partidas.';
    else if (res.error?.includes('SPECTATOR_BLOCKED')) msg = '🔒 O endpoint de espectador está bloqueado para esta API Key. É necessária uma Personal API Key (developer.riotgames.com).';
    else                          msg = res.error || 'Não foi possível obter os dados da partida.';
    if (sub)  sub.textContent = '';
    if (body) body.innerHTML = `<div class="lg-empty">${msg}</div>`;
    return;
  }

  _liveGame = res.data;
  if (sub) {
    const mins = Math.floor((_liveGame.gameLength || 0) / 60);
    const secs = (_liveGame.gameLength || 0) % 60;
    const time = _liveGame.gameLength > 0 ? ` · ${mins}:${String(secs).padStart(2,'0')}` : '';
    sub.textContent = `${_liveGame.queueName}${time}`;
  }
  renderLiveGame();
}

function setLiveSort(sort, btn) {
  _liveSort = sort;
  document.querySelectorAll('#livegame-modal .lg-sort-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderLiveGame();
}
function setLiveFilter(filter, btn) {
  _liveFilter = filter;
  document.querySelectorAll('#livegame-modal .lg-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderLiveGame();
}

// Numeric score for sorting by elo (tier + division + LP)
function _eloScore(rank) {
  if (!rank || rank.tier === 'UNRANKED') return -1;
  return tierToNumber(rank.tier, rank.division) + (rank.lp || 0);
}

// Best available rank — prefers the higher of solo/flex (used for non-ranked queues)
function _bestRank(p) {
  const s = _eloScore(p.solo), f = _eloScore(p.flex);
  if (s < 0 && f < 0) return null;
  return f > s ? p.flex : p.solo;
}

// The single rank shown for a player, based on the current match's queue mode.
function _displayRank(p) {
  const mode = _liveGame?.queueMode;
  if (mode === 'solo') return p.solo;
  if (mode === 'flex') return p.flex;
  return _bestRank(p);   // 'other' → best available
}

function _sortPlayers(players) {
  const arr = [...players];
  // Sorting always uses the rank actually displayed (queue-aware)
  if (_liveSort === 'elo')     arr.sort((a, b) => _eloScore(_displayRank(b)) - _eloScore(_displayRank(a)));
  else if (_liveSort === 'winrate') {
    const wr = p => { const r = _displayRank(p); return r ? winrate(r.wins, r.losses) : -1; };
    arr.sort((a, b) => wr(b) - wr(a));
  }
  return arr;
}

function renderLiveGame() {
  const body = document.getElementById('livegame-body');
  if (!body || !_liveGame) return;

  const allies  = _liveGame.players.filter(p => p.isAlly);
  const enemies = _liveGame.players.filter(p => !p.isAlly);

  const allyCol = `
    <div class="lg-team lg-team-ally">
      <div class="lg-team-header lg-team-header-blue">🟦 Aliados</div>
      ${_sortPlayers(allies).map(buildPlayerCard).join('') || '<div class="lg-empty-team">Nenhum jogador</div>'}
    </div>`;
  const enemyCol = `
    <div class="lg-team lg-team-enemy">
      <div class="lg-team-header lg-team-header-red">🟥 Inimigos</div>
      ${_sortPlayers(enemies).map(buildPlayerCard).join('') || '<div class="lg-empty-team">Nenhum jogador</div>'}
    </div>`;

  let grid;
  if (_liveFilter === 'allies')      grid = allyCol;
  else if (_liveFilter === 'enemies') grid = enemyCol;
  else                                grid = `${allyCol}<div class="lg-vs">VS</div>${enemyCol}`;

  body.innerHTML = `<div class="lg-grid ${_liveFilter !== 'all' ? 'lg-grid-single' : ''}">${grid}</div>`;
}

function buildPlayerCard(p) {
  // Champion icon
  const champUrl = p.championImage
    ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${p.championImage}.png`
    : '';
  const champImg = champUrl
    ? `<img class="lg-champ" src="${champUrl}" alt="" title="${escHtml(p.championName)}" onerror="this.style.visibility='hidden'">`
    : `<div class="lg-champ lg-champ-fallback">?</div>`;

  // Name + tag
  const [name, tag] = (p.riotId || 'Desconhecido').split('#');
  const selfBadge = (p.puuid === _liveGame.selfPuuid) ? '<span class="lg-self-badge" title="Esta é a sua conta">★</span>' : '';
  const internalTags = (p.internalTags || []).map(tagBadge).join('');

  // Anonymous / streamer mode — identity hidden by the player, not an error
  if (p.anonymous) {
    return `
    <div class="lg-player lg-anon">
      <div class="lg-player-top">
        ${champImg}
        <div class="lg-player-id">
          <div class="lg-name">🕵️ Anônimo <span class="lg-anon-tag">Modo Streamer</span></div>
          <div class="lg-meta"><span class="lg-champname">${escHtml(p.championName)}</span></div>
        </div>
      </div>
      <div class="lg-rank-wrap">
        <div class="lg-rank-label">Oculto</div>
        <span class="tier-badge tier-UNRANKED">—</span>
      </div>
    </div>`;
  }

  // Error state — partial card
  if (p.error) {
    return `
    <div class="lg-player lg-player-error">
      <div class="lg-player-top">
        ${champImg}
        <div class="lg-player-id">
          <div class="lg-name">${escHtml(name || 'Desconhecido')}${selfBadge}</div>
          <div class="lg-champname">${escHtml(p.championName)}</div>
        </div>
      </div>
      <div class="lg-error-msg">⚠️ ${escHtml(p.error)}</div>
    </div>`;
  }

  // Show ONLY the rank relevant to this match's queue.
  // rankCell() is the exact same component used in the main table/cards —
  // it includes the tier badge, LP, win-rate chip AND the win-rate bar,
  // so the visual identity is identical across the whole app.
  const mode  = _liveGame.queueMode;          // 'solo' | 'flex' | 'other'
  const rank  = _displayRank(p);
  const isOther = mode === 'other';
  const qLabel  = mode === 'flex' ? 'Flex'
                : mode === 'solo' ? 'Solo / Duo'
                : (rank === p.flex && p.flex ? 'Flex (melhor elo)' : 'Solo / Duo');
  const casualTag = isOther ? '<span class="lg-casual-tag" title="Partida não ranqueada — exibindo o melhor elo disponível">Casual</span>' : '';

  const rankHtml = rank
    ? rankCell(rank)
    : `<span class="tier-badge tier-UNRANKED">Sem Rank</span>`;

  return `
  <div class="lg-player lg-clickable" onclick="openPlayerDetail('${p.puuid}')" title="Ver análise detalhada">
    <div class="lg-player-top">
      ${champImg}
      <div class="lg-player-id">
        <div class="lg-name">${escHtml(name || 'Desconhecido')}<span class="lg-tag">#${escHtml(tag || '')}</span>${selfBadge}</div>
        <div class="lg-meta">
          <span class="lg-champname">${escHtml(p.championName)}</span>
          ${p.level ? `<span class="lg-level">Nv. ${p.level}</span>` : ''}
          ${internalTags}
        </div>
      </div>
    </div>
    <div class="lg-rank-wrap">
      <div class="lg-rank-label">${qLabel}${casualTag}</div>
      ${rankHtml}
    </div>
  </div>`;
}

function refreshLiveGame() {
  if (!_liveAccountId) return;
  const body = document.getElementById('livegame-body');
  if (body) body.innerHTML = `<div class="lg-loading"><span class="spinner"></span> Atualizando partida...</div>`;
  _loadLiveGame();
}

// ══════════════════════════════════════════════════════════════
// PLAYER DEEP-DIVE DETAIL MODAL
// ══════════════════════════════════════════════════════════════
let _detailData   = null;   // last loaded player-details payload
let _detailPlayer = null;   // the player object being inspected
let _detailCtx    = null;   // { server, queueMode, championNow } — works for live game AND accounts

function _champIconUrl(image) {
  return image ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${image}.png` : '';
}
function _profileIconUrl(id) {
  return id != null ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${id}.png` : '';
}

// The rank shown in the detail's "Elo Atual" section, based on context queue mode.
function _detailRank(p) {
  const mode = _detailCtx?.queueMode;
  if (mode === 'flex') return p.flex;
  if (mode === 'solo') return p.solo;
  return _bestRank(p);   // 'other'/accounts → best available
}

// Entry from the LIVE GAME — player already has rank/level loaded
async function openPlayerDetail(puuid) {
  const p = _liveGame?.players.find(x => x.puuid === puuid);
  if (!p || p.anonymous) return;   // anonymous players have nothing to fetch
  _detailCtx = { server: _liveGame.server, queueMode: _liveGame.queueMode, championNow: p.championName };
  _openDetailModal(p);
}

// Entry from the CONTAS tab — build a player-like object from the saved account
async function openAccountDetail(id) {
  const a = allAccounts.find(x => x.id === id);
  if (!a) return;
  if (!a.puuid) {
    showToast('Esta conta não tem PUUID salvo. Edite a conta e clique em "🔍 Buscar" primeiro.', 'warning', 5000);
    return;
  }
  const p = {
    puuid:         a.puuid,
    riotId:        `${a.nickname}#${a.tag}`,
    level:         null,
    profileIconId: a.profileIconId ?? null,
    championName:  null,
    solo:          (a.currentRank && a.currentRank.tier !== 'UNRANKED') ? a.currentRank : null,
    flex:          (a.flexRank   && a.flexRank.tier   !== 'UNRANKED') ? a.flexRank   : null,
    internalTags:  a.tags || [],
  };
  _detailCtx = { server: a.server, queueMode: 'other', championNow: null };  // 'other' → best rank
  _openDetailModal(p);
}

async function _openDetailModal(p) {
  _detailPlayer = p; _detailData = null;
  openModal('player-detail-modal');
  _renderDetailHeader(p);                          // basic + ranked render instantly (already known)
  const body = document.getElementById('player-detail-body');
  if (body) body.innerHTML = `<div class="lg-loading"><span class="spinner"></span> Carregando análise detalhada...</div>`;

  const res = await api.riot.getPlayerDetails(p.puuid, _detailCtx.server);
  // Guard: user may have closed/switched player while loading
  if (_detailPlayer?.puuid !== p.puuid) return;
  if (!res.success) {
    if (body) body.innerHTML = `<div class="lg-empty">⚠️ ${escHtml(res.error || 'Não foi possível carregar os detalhes.')}</div>`;
    return;
  }
  _detailData = res.data;
  _renderDetailBody(p, res.data);
}

function _renderDetailHeader(p) {
  const header = document.getElementById('player-detail-header');
  if (!header) return;
  const [name, tag] = (p.riotId || 'Desconhecido').split('#');
  const icon = _profileIconUrl(p.profileIconId);
  const iconHtml = icon
    ? `<img class="pd-avatar" src="${icon}" alt="" onerror="this.style.display='none'">`
    : `<div class="pd-avatar pd-avatar-fallback">${escHtml((name||'?').charAt(0).toUpperCase())}</div>`;
  header.innerHTML = `
    ${iconHtml}
    <div class="pd-id">
      <div class="pd-name">${escHtml(name||'Desconhecido')}<span class="pd-tag">#${escHtml(tag||'')}</span></div>
      <div class="pd-sub">
        ${p.level ? `<span class="lg-level">Nv. ${p.level}</span>` : ''}
        <span class="pd-region">${escHtml(_detailCtx?.server || '')}</span>
        ${_detailCtx?.championNow ? `<span class="pd-champ-now">Jogando <strong>${escHtml(_detailCtx.championNow)}</strong></span>` : ''}
      </div>
    </div>`;
}

function _streakText(t) {
  if (!t.total) return null;
  if (t.streak >= 2) {
    return t.streakType === 'win'
      ? `🔥 ${t.streak} vitórias consecutivas`
      : `❄️ ${t.streak} derrotas consecutivas`;
  }
  if (t.losses > t.wins) return `📉 Perdeu ${t.losses} das últimas ${t.total} partidas`;
  if (t.wins > t.losses)  return `📈 Venceu ${t.wins} das últimas ${t.total} partidas`;
  return `Equilíbrio: ${t.wins}V / ${t.losses}D nas últimas ${t.total}`;
}

function _renderDetailBody(p, d) {
  const body = document.getElementById('player-detail-body');
  if (!body) return;

  // ── Section: Elo Atual (queue/context-relevant) ──
  const rank = _detailRank(p);
  const qLabel = (rank && rank === p.flex) ? 'Flex' : 'Solo / Duo';
  const series = rank?.series
    ? `<div class="pd-series">Série de promoção: ${rank.series.split('').map(c =>
        `<span class="pd-series-dot ${c==='W'?'w':c==='L'?'l':''}">${c==='W'?'V':c==='L'?'D':'•'}</span>`).join('')}</div>`
    : '';
  const eloSection = `
    <div class="pd-section">
      <div class="pd-section-title">Elo Atual · ${qLabel}</div>
      ${rank ? `<div class="pd-elo">${rankCell(rank)}</div>${series}`
             : `<div class="pd-empty-line"><span class="tier-badge tier-UNRANKED">Sem Rank</span></div>`}
    </div>`;

  // ── Section: Tendências ──
  const t = d.trends;
  const streak = _streakText(t);
  const trendsSection = t.total ? `
    <div class="pd-section">
      <div class="pd-section-title">Estatísticas Recentes (${t.total} partidas)</div>
      <div class="pd-trends">
        <div class="pd-trend-card">
          <div class="pd-trend-val" style="color:${wrColor(t.recentWinrate)}">${t.recentWinrate}%</div>
          <div class="pd-trend-lbl">Win Rate recente</div>
        </div>
        <div class="pd-trend-card">
          <div class="pd-trend-val">${t.wins}V <span style="color:var(--text-dim)">/</span> ${t.losses}D</div>
          <div class="pd-trend-lbl">Vitórias / Derrotas</div>
        </div>
        <div class="pd-trend-card">
          <div class="pd-trend-val">${t.distinctChamps}</div>
          <div class="pd-trend-lbl">Campeões diferentes</div>
        </div>
        <div class="pd-trend-card">
          <div class="pd-trend-val">${t.last7}</div>
          <div class="pd-trend-lbl">Partidas em 7 dias</div>
        </div>
      </div>
      ${streak ? `<div class="pd-streak">${streak}</div>` : ''}
    </div>` : '';

  // ── Section: Perfil de Jogo ──
  const profileSection = d.profile.length ? `
    <div class="pd-section">
      <div class="pd-section-title">Perfil de Jogo</div>
      <div class="pd-profile">
        ${d.profile.map(pt => `<span class="pd-profile-tag">${pt.icon} ${pt.label}</span>`).join('')}
      </div>
    </div>` : '';

  // ── Section: Campeões Mais Jogados (mastery) ──
  // Highlight: principal = top mastery; mais usado = most recent games; maior WR = best recent winrate (>=2 games)
  const mostUsed = d.recentChampStats[0]?.championId;
  const bestWr   = [...d.recentChampStats].filter(c => c.games >= 2).sort((a,b)=>b.winrate-a.winrate)[0]?.championId;
  const champSection = d.mastery.length ? `
    <div class="pd-section">
      <div class="pd-section-title">Campeões Mais Jogados (maestria)</div>
      <div class="pd-champs">
        ${d.mastery.map((c, i) => {
          const recent = d.recentChampStats.find(r => r.championId === c.championId);
          const tags = [];
          if (i === 0)                    tags.push('<span class="pd-champ-tag tag-main">Principal</span>');
          if (c.championId === mostUsed)  tags.push('<span class="pd-champ-tag tag-duo">Mais usado</span>');
          if (c.championId === bestWr)    tags.push('<span class="pd-champ-tag tag-smurf">Maior WR</span>');
          const url = _champIconUrl(c.image);
          return `
          <div class="pd-champ" onclick="togglePlayerChamp(${c.championId},this)">
            ${url ? `<img class="pd-champ-icon" src="${url}" alt="" onerror="this.style.visibility='hidden'">` : '<div class="pd-champ-icon"></div>'}
            <div class="pd-champ-info">
              <div class="pd-champ-name">${escHtml(c.name)} ${tags.join('')}</div>
              <div class="pd-champ-meta">
                <span class="pd-mastery">Maestria ${c.level} · ${(c.points/1000).toFixed(0)}k pts</span>
                ${recent ? `<span style="color:${wrColor(recent.winrate)}">${recent.winrate}% WR</span>
                            <span class="pd-kda-sm">${recent.kda.toFixed(1)} KDA</span>
                            <span style="color:var(--text-dim)">${recent.games}j</span>` : ''}
              </div>
            </div>
          </div>
          <div class="pd-champ-detail" id="pd-champ-${c.championId}" style="display:none"></div>`;
        }).join('')}
      </div>
    </div>` : '';

  // ── Section: Histórico Recente ──
  const histSection = d.recentMatches.length ? `
    <div class="pd-section">
      <div class="pd-section-title">Histórico Recente</div>
      <div class="pd-matches">
        ${d.recentMatches.map(m => {
          const url = _champIconUrl(m.championImage);
          const kda = ((m.kills + m.assists) / Math.max(m.deaths, 1)).toFixed(1);
          const mins = Math.floor(m.durationSec / 60);
          return `
          <div class="pd-match ${m.win ? 'pd-win' : 'pd-loss'}">
            ${url ? `<img class="pd-match-champ" src="${url}" alt="" onerror="this.style.visibility='hidden'">` : '<div class="pd-match-champ"></div>'}
            <div class="pd-match-info">
              <span class="pd-match-result">${m.win ? 'Vitória' : 'Derrota'}</span>
              <span class="pd-match-champ-name">${escHtml(m.championName)}</span>
            </div>
            <div class="pd-match-kda">${m.kills}/${m.deaths}/${m.assists}<span class="pd-kda-sm"> (${kda})</span></div>
            <div class="pd-match-meta">
              <span>${m.queueName}</span>
              <span class="pd-match-time">${mins}min · ${timeAgo(new Date(m.gameCreation).toISOString())}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : (d.matchError ? `<div class="pd-section"><div class="pd-empty-line">⚠️ Histórico indisponível: ${escHtml(d.matchError)}</div></div>` : '');

  body.innerHTML = eloSection + trendsSection + profileSection + champSection + histSection;
}

// Toggle the per-champion recent-stats detail line
function togglePlayerChamp(champId, el) {
  const box = document.getElementById(`pd-champ-${champId}`);
  if (!box || !_detailData) return;
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }
  const r = _detailData.recentChampStats.find(c => c.championId === champId);
  box.innerHTML = r
    ? `<div class="pd-champ-detail-inner">
         <span>${r.games} partidas recentes</span>
         <span style="color:${wrColor(r.winrate)}">${r.winrate}% WR (${r.wins}V ${r.games-r.wins}D)</span>
         <span>${r.kda.toFixed(2)} KDA médio</span>
       </div>`
    : `<div class="pd-champ-detail-inner"><span style="color:var(--text-dim)">Sem partidas recentes registradas</span></div>`;
  box.style.display = '';
}

// ── Watch Mode Form Toggle ────────────────────────────────────
function toggleWatchMode(isWatch) {
  const group = document.getElementById('credentials-group');
  if (!group) return;
  group.classList.toggle('hidden', isWatch);
  const loginEl    = document.getElementById('f-login');
  const passwordEl = document.getElementById('f-password');
  if (loginEl)    loginEl.disabled    = isWatch;
  if (passwordEl) passwordEl.disabled = isWatch;
  if (isWatch) {
    if (loginEl)    loginEl.value    = '';
    if (passwordEl) passwordEl.value = '';
  }
}

// ── Escape closes any open modal ─────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modals = ['player-detail-modal', 'account-modal', 'compare-modal', 'livegame-modal', 'confirm-delete-modal', 'confirm-logout-modal', 'close-dialog'];
  for (const id of modals) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('open')) { el.classList.remove('open'); break; }
  }
});

// ── Logout confirmation ───────────────────────────────────────
function confirmLogout() {
  openModal('confirm-logout-modal');
}

// Bootstrap
document.addEventListener('DOMContentLoaded', init);
