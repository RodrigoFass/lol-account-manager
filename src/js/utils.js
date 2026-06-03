'use strict';

// ── Toast notifications ──────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span style="flex:1">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Tier helpers ─────────────────────────────────────────────
const TIER_PT = {
  IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro',
  PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante',
  MASTER: 'Mestre', GRANDMASTER: 'Grão-mestre', CHALLENGER: 'Challenger',
  UNRANKED: 'Sem Rank',
};

const TIER_ORDER = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'];

function tierToNumber(tier, div) {
  // IV is the lowest division within a tier, I is the highest.
  // Higher number = better rank so the chart goes up when the player improves.
  const divMap = { IV: 0, III: 1, II: 2, I: 3 };
  const base = TIER_ORDER.indexOf(tier) * 400;
  return base + (divMap[div] !== undefined ? divMap[div] * 100 : 0);
}

function formatRank(rank) {
  if (!rank || rank.tier === 'UNRANKED') return 'Sem Rank';
  const name = TIER_PT[rank.tier] || rank.tier;
  if (['MASTER','GRANDMASTER','CHALLENGER'].includes(rank.tier)) return `${name} ${rank.lp} LP`;
  return `${name} ${rank.division} — ${rank.lp} LP`;
}

// ── Tier emblem SVG (inline — no network request, works offline)
// Root cause: ddragon.leagueoflegends.com/cdn/img/ranked-emblems/ returns 403.
// Solution: generate hexagonal crest SVGs client-side with per-tier colours.
function tierEmblemSvg(tier) {
  const C = {
    IRON:        ['#5e5e5e', '#8a8a8a'],
    BRONZE:      ['#7a3310', '#c97a3a'],
    SILVER:      ['#606070', '#b8b8cc'],
    GOLD:        ['#8a6500', '#e8c030'],
    PLATINUM:    ['#006070', '#00b8b0'],
    EMERALD:     ['#005830', '#30b870'],
    DIAMOND:     ['#2840a0', '#6888f0'],
    MASTER:      ['#5010a0', '#b060f0'],
    GRANDMASTER: ['#980020', '#f03050'],
    CHALLENGER:  ['#906000', '#f0d040'],
  };
  const [dark, light] = C[tier] || ['#333355', '#555577'];
  // Three-layer hexagonal crest (flat-top hex; pointed sides)
  return `<svg class="tier-emblem" viewBox="0 0 20 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<polygon points="10,1 19,5.5 19,16.5 10,21 1,16.5 1,5.5" fill="${dark}"/>`
    + `<polygon points="10,3.5 16.5,7 16.5,15 10,18.5 3.5,15 3.5,7" fill="${light}" opacity=".85"/>`
    + `<polygon points="10,7 14,9.5 14,13.5 10,16 6,13.5 6,9.5" fill="rgba(255,255,255,.22)"/>`
    + `</svg>`;
}

function rankBadge(rank) {
  if (!rank || rank.tier === 'UNRANKED') {
    return `<span class="tier-badge tier-UNRANKED">Sem Rank</span>`;
  }
  const name   = TIER_PT[rank.tier] || rank.tier;
  const div    = ['MASTER','GRANDMASTER','CHALLENGER'].includes(rank.tier) ? '' : ` ${rank.division}`;
  const emblem = tierEmblemSvg(rank.tier);
  return `<span class="tier-badge tier-${rank.tier}">${emblem}${name}${div}</span>`;
}

function winrate(wins, losses) {
  const total = (wins || 0) + (losses || 0);
  return total === 0 ? 0 : Math.round((wins / total) * 100);
}

// Returns the fill/text color for a given win-rate percentage
// < 50  → red  |  50-59 → green  |  60-69 → blue  |  ≥ 70 → purple
function wrColor(wr) {
  if (wr >= 70) return '#FF9B00';          // laranja — desempenho excepcional
  if (wr >= 60) return 'var(--success)';  // verde  — desempenho alto
  if (wr >= 50) return 'var(--info)';     // azul   — desempenho positivo
  return 'var(--danger)';                 // vermelho — abaixo de 50%
}

// Returns a styled inline badge showing just the win-rate percentage
function wrChip(wr) {
  const color = wrColor(wr);
  let style = `color:${color};font-weight:600;font-size:13px;white-space:nowrap`;
  // Todas as faixas têm caixinha colorida, mesmo peso
  if (wr >= 70) {
    style += ';background:rgba(255,155,0,0.18);border-radius:5px;padding:2px 7px';
  } else if (wr >= 60) {
    style += ';background:rgba(46,204,113,0.13);border-radius:5px;padding:2px 7px';
  } else if (wr >= 50) {
    style += ';background:rgba(52,152,219,0.15);border-radius:5px;padding:2px 7px';
  } else {
    style += ';background:rgba(231,76,60,0.15);border-radius:5px;padding:2px 7px';
  }
  return `<span style="${style}">${wr}%</span>`;
}

// Returns the progress bar + V/D count row (no percentage badge — that lives in the top row)
function winrateBar(wins, losses) {
  const wr    = winrate(wins, losses);
  const color = wrColor(wr);
  return `
    <div class="rank-cell-bottom">
      <div class="winrate-track">
        <div class="winrate-fill" style="width:${wr}%;background:${color}"></div>
      </div>
      <span class="rank-vd">${wins || 0}V ${losses || 0}D</span>
    </div>
  `;
}

function tagBadge(tag) {
  if (!tag) return '';
  const cls   = tag.toLowerCase().replace(/\s+/, '');
  const label = tag;
  return `<span class="tag tag-${cls}">${label}</span>`;
}

// ── Time helpers ─────────────────────────────────────────────
function timeAgo(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}


// ── Toggle password ───────────────────────────────────────────
function toggleField(id) {
  const el = document.getElementById(id);
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}

// ── Modal helpers ─────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModalById(id) { document.getElementById(id).classList.remove('open'); }
