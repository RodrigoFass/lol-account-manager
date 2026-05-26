'use strict';

let championsData = [];
const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';
let ddVersion = '14.10.1';

async function getDDVersion() {
  try {
    const r = await fetch(`${DDRAGON_BASE}/api/versions.json`);
    const v = await r.json();
    ddVersion = v[0] || ddVersion;
  } catch {}
}

async function loadChampions() {
  const sel = document.getElementById('champion-account-select');
  const id  = sel.value;
  const grid  = document.getElementById('champions-grid');
  const empty = document.getElementById('champions-empty');
  const stats = document.getElementById('champions-stats');

  if (!id) {
    grid.innerHTML   = '';
    empty.style.display = 'flex';
    stats.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">Carregando campeões...</p></div>';

  const res = await electronAPI.riot.fetchChampions(id);

  if (!res.success) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><h3>Erro</h3><p>${res.error}</p></div>`;
    return;
  }

  championsData = res.masteries || [];
  await getDDVersion();

  // Build champion id→name map from Data Dragon
  let champMap = {};
  try {
    const r = await fetch(`${DDRAGON_BASE}/cdn/${ddVersion}/data/pt_BR/champion.json`);
    const d = await r.json();
    Object.values(d.data).forEach(c => { champMap[c.key] = { name: c.name, id: c.id }; });
  } catch {
    championsData.forEach(c => { champMap[c.championId] = { name: `Campeão ${c.championId}`, id: `champion${c.championId}` }; });
  }

  // Stats
  const m7 = championsData.filter(c => c.championLevel >= 7).length;
  const m6 = championsData.filter(c => c.championLevel >= 6).length;
  document.getElementById('champ-total').textContent = championsData.length;
  document.getElementById('champ-m7').textContent    = m7;
  document.getElementById('champ-m6').textContent    = m6;
  stats.style.display = '';

  renderChampionsGrid(championsData, champMap);
}

function renderChampionsGrid(data, champMap) {
  const query = (document.getElementById('champion-search')?.value || '').toLowerCase();
  const filtered = query
    ? data.filter(c => (champMap[c.championId]?.name || '').toLowerCase().includes(query))
    : data;

  if (!filtered.length) {
    document.getElementById('champions-grid').innerHTML =
      '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🔍</div><h3>Nenhum resultado</h3></div>';
    return;
  }

  document.getElementById('champions-grid').innerHTML = filtered.map(c => {
    const champ = champMap[c.championId] || { name: `ID ${c.championId}`, id: 'Aatrox' };
    const imgUrl = `${DDRAGON_BASE}/cdn/${ddVersion}/img/champion/${champ.id}.png`;
    const lvl = c.championLevel || 0;
    const badgeColor = lvl >= 7 ? '#c0392b' : lvl >= 5 ? '#f39c12' : 'var(--text-dim)';
    return `
      <div class="champion-card" title="${champ.name} — Maestria ${lvl}">
        ${lvl > 0 ? `<span class="mastery-badge" style="background:${badgeColor}">${lvl}</span>` : ''}
        <img src="${imgUrl}" alt="${champ.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22><rect width=%2248%22 height=%2248%22 fill=%22%231a1a35%22/><text x=%2224%22 y=%2232%22 text-anchor=%22middle%22 font-size=%2220%22>⚔️</text></svg>'">
        <span class="champ-name">${champ.name}</span>
      </div>`;
  }).join('');
}

function filterChampions() {
  if (!championsData.length) return;
  // Re-fetch champion map is expensive; use cached render
  const query = (document.getElementById('champion-search')?.value || '').toLowerCase();
  document.querySelectorAll('.champion-card').forEach(el => {
    const name = el.querySelector('.champ-name')?.textContent.toLowerCase() || '';
    el.style.display = (!query || name.includes(query)) ? '' : 'none';
  });
}
