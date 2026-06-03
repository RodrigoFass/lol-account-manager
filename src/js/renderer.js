'use strict';

const api = window.electronAPI;
let allAccounts         = [];
let currentSection      = 'dashboard';
let dragSrcId           = null;
let ddVersion           = '15.10.1';   // Data Dragon version — refreshed non-blocking on init
let currentView         = 'table';     // 'table' | 'cards'
let selectedForCompare  = new Set();   // account IDs checked for comparison

// ── Bootstrap ────────────────────────────────────────────────
async function init() {
  loadQueueFilterPref();      // preset filter BEFORE first render so columns are right from the start
  loadViewPref();             // restore table/cards toggle preference
  loadDDVersion();            // non-blocking — fire & forget; fallback version already set
  await loadAccounts();
  await loadSettings();
  loadApiKeyStatus();
  setupEventListeners();
  populateAccountSelects();
}

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
  api.on('rankUpdate', ({ accountId, rankData, flexRankData, profileIconId }) => {
    updateAccountRow(accountId, rankData, flexRankData, profileIconId);
    updateAccountSelects();
  });

  // Resync UI + restart countdown (handles powerMonitor resume and key renewal)
  api.on('apiKeyStatus', status => {
    updateApiKeyUI(status);
    startCountdown(status);
  });

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
  if (section === 'history')  populateAccountSelects();
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
    return `<span class="tier-badge tier-UNRANKED">Sem Rank</span>`;
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
      <div class="account-name-cell">
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
    <div class="card-top">
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
      <button class="btn-icon" onclick="refreshOne('${a.id}',this)" title="Atualizar Rank">⟳</button>
      <button class="btn-icon" onclick="openEditModal('${a.id}')" title="Editar">✏️</button>
      <button class="btn-icon btn-icon-danger" onclick="confirmDelete('${a.id}','${escHtml(a.nickname)}')" title="Remover">🗑️</button>
    </div>
  </div>`;
}

function updateAccountRow(accountId, rankData, flexRankData, profileIconId) {
  const idx = allAccounts.findIndex(a => a.id === accountId);
  if (idx === -1) return;
  allAccounts[idx].currentRank = rankData;
  if (flexRankData  !== undefined) allAccounts[idx].flexRank     = flexRankData;
  if (profileIconId != null)       allAccounts[idx].profileIconId = profileIconId;
  allAccounts[idx].lastUpdated = new Date().toISOString();
  const row = document.getElementById(`row-${accountId}`);
  if (row) {
    row.outerHTML = buildRow(allAccounts[idx], idx + 1);
    initDragDrop();
  }
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
    electronAPI.apiKey.openRenewalPage();
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
    if (res.success) { showToast('Conta removida.', 'info'); await loadAccounts(); }
    else             { showToast(res.error || 'Erro ao remover.', 'error'); }
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
  await loadAccounts();
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
  await loadAccounts();
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

function updateAccountSelects() { populateAccountSelects(); }

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

function toggleAccountDropdown() {
  const dd = document.getElementById('account-select-options');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(() => {
      function closeOutside(e) {
        const wrapper = document.getElementById('history-account-dropdown');
        if (wrapper && !wrapper.contains(e.target)) {
          dd.style.display = 'none';
          document.removeEventListener('click', closeOutside);
        }
      }
      document.addEventListener('click', closeOutside);
    }, 0);
  }
}

function selectHistoryAccount(id) {
  const sel = document.getElementById('history-account-select');
  if (sel) {
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
  }
  // Update option highlight states
  document.querySelectorAll('#account-select-options .account-select-option').forEach(opt => {
    opt.classList.toggle('selected', (opt.dataset.id || '') === id);
  });
  refreshAccountSelectTrigger(id);
  // Close dropdown
  const dd = document.getElementById('account-select-options');
  if (dd) dd.style.display = 'none';
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

// Immediately apply + persist theme when the select changes  (Bug 3 fix)
async function changeTheme(theme) {
  applyTheme(theme);
  settingsCache.theme = theme;
  await api.settings.set('theme', theme);
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
}

async function saveSettings() {
  try {
    const el    = id => document.getElementById(id);
    const theme = el('theme-select').value;
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

// ── Drag-and-drop reorder ─────────────────────────────────────
function initDragDrop() {
  const tbody = document.getElementById('accounts-tbody');
  if (!tbody) return;

  tbody.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('dragstart', e => {
      dragSrcId = tr.dataset.id;
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrcId);
    });

    tr.addEventListener('dragend', () => {
      tr.classList.remove('dragging');
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
    });

    tr.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      if (tr.dataset.id !== dragSrcId) tr.classList.add('drag-over');
    });

    tr.addEventListener('dragleave', () => {
      tr.classList.remove('drag-over');
    });

    tr.addEventListener('drop', async e => {
      e.preventDefault();
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      if (!dragSrcId || dragSrcId === tr.dataset.id) return;

      const srcIdx = allAccounts.findIndex(a => a.id === dragSrcId);
      const dstIdx = allAccounts.findIndex(a => a.id === tr.dataset.id);
      if (srcIdx === -1 || dstIdx === -1) return;

      // Reorder in memory
      const [moved] = allAccounts.splice(srcIdx, 1);
      allAccounts.splice(dstIdx, 0, moved);

      // Re-render with current filters applied
      filterAccounts();

      // Persist new order
      await api.accounts.reorder(allAccounts.map(a => a.id));
      dragSrcId = null;
    });
  });
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
  const rows = document.querySelectorAll('#accounts-tbody tr[data-id]');
  rows.forEach(tr => {
    const id = tr.dataset.id;
    if (masterCb.checked) selectedForCompare.add(id);
    else                  selectedForCompare.delete(id);
    tr.querySelector('.compare-checkbox').checked = masterCb.checked;
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

// ── Watch Mode Form Toggle ────────────────────────────────────
function toggleWatchMode(isWatch) {
  const group = document.getElementById('credentials-group');
  if (!group) return;
  group.classList.toggle('hidden', isWatch);
  // Clear fields when hiding
  if (isWatch) {
    document.getElementById('f-login').value    = '';
    document.getElementById('f-password').value = '';
  }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', init);
