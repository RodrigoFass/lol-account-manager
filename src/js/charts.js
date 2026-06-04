'use strict';

// Chart line color keyed by tier — mirrors the --tier-* vars in global.css
const TIER_CHART_COLORS = {
  IRON:        '#8a8a8a',
  BRONZE:      '#ad5c2a',
  SILVER:      '#a8a8b8',
  GOLD:        '#c89b3c',
  PLATINUM:    '#009b8b',
  EMERALD:     '#00a36c',
  DIAMOND:     '#576bce',
  MASTER:      '#9d48e0',
  GRANDMASTER: '#e84057',
  CHALLENGER:  '#f0c060',
  UNRANKED:    '#555577',
};

let historyChart          = null;
let historyRange          = 'week';
let historyQueue          = 'solo';  // 'solo' | 'flex'
let currentHistoryAccount = null;
let _chartData            = [];      // module-level ref — tooltip callbacks always read fresh data
let _lastChartAccountId   = null;    // track last rendered account for update vs recreate

// ── Public entry points ───────────────────────────────────────

function setHistoryRange(range, btn) {
  historyRange = range;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (currentHistoryAccount) renderHistoryChart(currentHistoryAccount);
}

function setHistoryQueue(queue, btn) {
  historyQueue = queue;
  document.querySelectorAll('.queue-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (currentHistoryAccount) renderHistoryChart(currentHistoryAccount);
}

async function loadHistory() {
  const sel        = document.getElementById('history-account-select');
  const id         = sel?.value;
  const emptyEl    = document.getElementById('history-empty');
  const contentEl  = document.getElementById('history-content');
  const controlsEl = document.getElementById('history-controls');

  if (!id) {
    if (emptyEl) {
      emptyEl.querySelector('h3').textContent = 'Selecione uma conta';
      emptyEl.querySelector('p').textContent  = 'Escolha uma conta para ver a evolução do elo ao longo do tempo.';
      emptyEl.style.display = 'flex';
    }
    if (contentEl)  contentEl.style.display  = 'none';
    if (controlsEl) controlsEl.style.display = 'none';   // hide controls until an account is picked
    currentHistoryAccount = null;
    return;
  }

  const account = allAccounts.find(a => a.id === id);
  if (!account) return;
  currentHistoryAccount = account;

  if (controlsEl) controlsEl.style.display = 'flex';     // queue + range stay visible even on empty state
  if (emptyEl)    emptyEl.style.display    = 'none';
  if (contentEl)  contentEl.style.display  = '';
  renderHistoryChart(account);
}

// ── Data helpers ──────────────────────────────────────────────

function filterHistoryData(history) {
  // Remove consecutive identical snapshots (same tier + division + lp)
  const deduped = history.filter((h, i) => {
    if (i === 0) return true;
    const p = history[i - 1];
    return h.tier !== p.tier || h.division !== p.division || h.lp !== p.lp;
  });
  if (historyRange === 'all') return deduped;
  const now    = Date.now();
  const cutoff = { week: 7 * 86400000, month: 30 * 86400000 }[historyRange] || 7 * 86400000;
  // Return empty array if no entries fall within range — caller handles empty state
  return deduped.filter(h => now - new Date(h.timestamp).getTime() <= cutoff);
}

function entryScore(h) {
  return tierToNumber(h.tier, h.division) + (h.lp || 0);
}

// Short rank label for display ("Ouro II" or "Mestre 450 LP")
function rankLabel(h) {
  if (!h || h.tier === 'UNRANKED') return 'Sem Rank';
  const name = TIER_PT[h.tier] || h.tier;
  return ['MASTER','GRANDMASTER','CHALLENGER'].includes(h.tier)
    ? `${name} ${h.lp} LP`
    : `${name} ${h.division}`;
}

function periodLabel() {
  return historyRange === 'week'  ? 'últimos 7 dias'
       : historyRange === 'month' ? 'últimos 30 dias'
       :                            'todo o histórico';
}

// ── Main renderer ─────────────────────────────────────────────

function renderHistoryChart(account) {
  const isFlex    = historyQueue === 'flex';
  const history   = isFlex ? (account.flexHistory || []) : (account.history || []);
  const emptyEl   = document.getElementById('history-empty');
  const contentEl = document.getElementById('history-content');

  const showEmpty = (title, msg) => {
    if (emptyEl) {
      emptyEl.querySelector('h3').textContent = title;
      emptyEl.querySelector('p').textContent  = msg;
      emptyEl.style.display = 'flex';
    }
    if (contentEl) contentEl.style.display = 'none';
  };

  if (!history.length) {
    const queue = isFlex ? 'Flex' : 'Solo/Duo';
    showEmpty(`Sem histórico de ${queue}`,
      isFlex
        ? 'Nenhuma partida de Flex registrada ainda. Jogue Flex e atualize a conta para acumular histórico.'
        : 'Atualize o rank desta conta para começar a acumular histórico.');
    return;
  }

  const data = filterHistoryData(history);

  // When the date range filter yields no data, show an explicit message
  // instead of silently falling back to older data outside the range
  if (!data.length && historyRange !== 'all') {
    const rangeLabel = historyRange === 'week' ? '7 dias' : '30 dias';
    showEmpty(`Sem dados nos últimos ${rangeLabel}`,
      `Nenhuma mudança de rank registrada neste período. Tente selecionar "Tudo" para ver o histórico completo.`);
    return;
  }

  if (data.length < 2) {
    const h = data[0] || {};
    showEmpty('Apenas 1 registro',
      `Rank atual: ${rankLabel(h)} — ${h.lp || 0} LP. Jogue mais partidas e atualize o rank para ver a evolução.`);
    return;
  }

  if (emptyEl)   emptyEl.style.display   = 'none';
  if (contentEl) contentEl.style.display = '';

  renderHistorySummary(account, data);
  buildHistoryChart(account, data);
  renderHistoryTimeline(data);
}

// ── Summary cards ─────────────────────────────────────────────

function renderHistorySummary(account, data) {
  const el = document.getElementById('history-summary');
  if (!el) return;

  const first = data[0];
  const last  = data[data.length - 1];
  const peak  = data.reduce((best, h) => entryScore(h) > entryScore(best) ? h : best, first);

  // Period change: rank-aware label
  const firstTS = tierToNumber(first.tier, first.division);
  const lastTS  = tierToNumber(last.tier,  last.division);
  let changeHtml, changeClass;
  if (firstTS === lastTS) {
    const diff   = (last.lp || 0) - (first.lp || 0);
    const sign   = diff >= 0 ? '+' : '';
    changeHtml  = `${sign}${diff} LP`;
    changeClass = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
  } else {
    const up    = lastTS > firstTS;
    changeHtml  = `${up ? '↑' : '↓'} ${rankLabel(first)} → ${rankLabel(last)}`;
    changeClass = up ? 'positive' : 'negative';
  }

  // Trend (score delta across the whole period)
  const delta = entryScore(last) - entryScore(first);
  let trendIcon, trendTxt, trendClass;
  if      (delta >  100) { trendIcon = '↑'; trendTxt = 'Subindo';  trendClass = 'trend-up';   }
  else if (delta < -100) { trendIcon = '↓'; trendTxt = 'Caindo';   trendClass = 'trend-down'; }
  else                   { trendIcon = '→'; trendTxt = 'Estável';   trendClass = 'trend-neutral'; }

  // Current rank: use the right queue, fall back to last history entry
  const isFlex = historyQueue === 'flex';
  const raw    = isFlex ? account.flexRank : account.currentRank;
  const cur    = (raw && raw.tier && raw.tier !== 'UNRANKED')
    ? raw
    : { tier: last.tier, division: last.division, lp: last.lp };

  el.innerHTML = `
    <div class="hist-stat-card">
      <div class="hist-stat-label">Rank Atual</div>
      <div class="hist-stat-value">${rankBadge(cur)}</div>
      <div class="hist-stat-sub">${cur.lp} LP</div>
    </div>
    <div class="hist-stat-card">
      <div class="hist-stat-label">Pico no Período</div>
      <div class="hist-stat-value">${rankBadge({ tier: peak.tier, division: peak.division, lp: peak.lp })}</div>
      <div class="hist-stat-sub">${peak.lp} LP</div>
    </div>
    <div class="hist-stat-card">
      <div class="hist-stat-label">Variação no Período</div>
      <div class="hist-stat-value hist-delta ${changeClass}">${changeHtml}</div>
      <div class="hist-stat-sub">${data.length} registros · ${periodLabel()}</div>
    </div>
    <div class="hist-stat-card">
      <div class="hist-stat-label">Tendência</div>
      <div class="hist-stat-value ${trendClass}">${trendIcon} ${trendTxt}</div>
      <div class="hist-stat-sub">vs. início do período</div>
    </div>
  `;
}

// ── Chart ─────────────────────────────────────────────────────

function buildHistoryChart(account, data) {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;

  // Always update module-level reference so tooltip callbacks get fresh data
  _chartData = data;

  const labels = data.map(h => {
    const d = new Date(h.timestamp);
    return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const values = data.map(entryScore);

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad    = Math.max(0, (300 - (rawMax - rawMin)) / 2);
  const yMin   = Math.max(0, Math.floor((rawMin - pad - 50) / 100) * 100);
  const yMax   = Math.ceil((rawMax + pad + 50) / 100) * 100;

  const tierColor = TIER_CHART_COLORS[data[data.length - 1].tier] || '#c0392b';
  const ptColors  = values.map((v, i) =>
    i === 0             ? tierColor
    : v > values[i - 1] ? '#2ecc71'
    : v < values[i - 1] ? '#e74c3c'
    :                      tierColor
  );
  const chartLabel = `${account.nickname}#${account.tag} — ${historyQueue === 'flex' ? 'Flex' : 'Solo/Duo'}`;

  // ── Fast path: same account — update data in-place (no flicker, no DOM recreate) ──
  const isSameAccount = historyChart && account.id === _lastChartAccountId;
  if (isSameAccount) {
    const ds                        = historyChart.data.datasets[0];
    historyChart.data.labels        = labels;
    ds.data                         = values;
    ds.label                        = chartLabel;
    ds.borderColor                  = tierColor;
    ds.backgroundColor              = tierColor + '1a';
    ds.pointBackgroundColor         = ptColors;
    ds.pointBorderColor             = ptColors;
    ds.pointRadius                  = data.length <= 30 ? 4 : 2;
    historyChart.options.scales.y.min = yMin;
    historyChart.options.scales.y.max = yMax;
    historyChart.update('active');
    return;
  }

  // ── Slow path: new account or first render — recreate with full config ──
  if (historyChart) { historyChart.destroy(); historyChart = null; }
  _lastChartAccountId = account.id;

  const light = document.body.classList.contains('theme-light');
  const tc = {
    text:     light ? '#6c7a8c' : '#8888aa',
    grid:     light ? 'rgba(180,185,215,0.4)' : 'rgba(37,37,72,0.5)',
    ttBg:     light ? '#ffffff' : '#12122a',
    ttBorder: light ? '#dde1ea' : '#252548',
    ttTitle:  light ? '#2c3e50' : '#e0e0f0',
    ttBody:   light ? '#6c7a8c' : '#8888aa',
  };

  historyChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:                chartLabel,
        data:                 values,
        borderColor:          tierColor,
        backgroundColor:      tierColor + '1a',
        borderWidth:          2.5,
        pointBackgroundColor: ptColors,
        pointBorderColor:     ptColors,
        pointRadius:          data.length <= 30 ? 4 : 2,
        pointHoverRadius:     7,
        tension:              0.35,
        fill:                 true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tc.text, font: { size: 12 } } },
        tooltip: {
          backgroundColor: tc.ttBg,
          borderColor:     tc.ttBorder,
          borderWidth:     1,
          titleColor:      tc.ttTitle,
          bodyColor:       tc.ttBody,
          padding:         10,
          callbacks: {
            // Callbacks reference _chartData (module-level) so they always use current data
            title: ctx => {
              const d  = new Date(_chartData[ctx[0].dataIndex].timestamp);
              const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' });
              const dt = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
              const tm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
              return `${wd}, ${dt} — ${tm}`;
            },
            label: ctx => {
              const h = _chartData[ctx.dataIndex];
              return ` ${rankLabel(h)} — ${h.lp} LP`;
            },
            afterLabel: ctx => {
              if (ctx.dataIndex === 0) return null;
              const curr = _chartData[ctx.dataIndex];
              const prev = _chartData[ctx.dataIndex - 1];
              if (curr.tier !== prev.tier || curr.division !== prev.division) {
                return ` ${rankLabel(prev)} → ${rankLabel(curr)}`;
              }
              const lp = (curr.lp || 0) - (prev.lp || 0);
              if (lp === 0) return ' → sem alteração';
              return lp > 0 ? ` ▲ +${lp} LP` : ` ▼ ${Math.abs(lp)} LP`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: tc.text, maxTicksLimit: 8, font: { size: 11 } },
          grid:  { color: tc.grid },
        },
        y: {
          min: yMin, max: yMax,
          ticks: {
            color: tc.text, font: { size: 11 }, stepSize: 100,
            callback: val => {
              if (val % 100 !== 0) return '';
              const tierIdx = Math.floor(val / 400);
              const tier    = TIER_ORDER[tierIdx];
              if (!tier) return '';
              const div = ['IV','III','II','I'][Math.floor((val % 400) / 100)] || '';
              return `${TIER_PT[tier] || tier} ${div}`;
            },
          },
          grid: { color: tc.grid },
        },
      },
    },
  });
}

// ── Timeline ──────────────────────────────────────────────────

function renderHistoryTimeline(data) {
  const el = document.getElementById('history-timeline');
  if (!el) return;
  if (data.length < 2) { el.innerHTML = ''; return; }

  // Group in reverse-chronological order (most recent day first)
  const groups = new Map();
  [...data].reverse().forEach((h, i) => {
    const d       = new Date(h.timestamp);
    const key     = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const origIdx = data.length - 1 - i;
    const prev    = origIdx > 0 ? data[origIdx - 1] : null;
    if (!groups.has(key)) groups.set(key, { label: histDayLabel(d), entries: [] });
    groups.get(key).entries.push({ h, prev });
  });

  el.innerHTML = [...groups.values()].map(g => `
    <div class="timeline-day-group">
      <div class="timeline-day-label">${g.label}</div>
      <div class="timeline-entries">${g.entries.map(({ h, prev }) => histEntry(h, prev)).join('')}</div>
    </div>`
  ).join('');
}

function histDayLabel(d) {
  const today     = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const dateStr   = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  if (d.toDateString() === today.toDateString())     return `Hoje — ${dateStr}`;
  if (d.toDateString() === yesterday.toDateString()) return `Ontem — ${dateStr}`;
  const wd = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return `${wd.charAt(0).toUpperCase() + wd.slice(1)} — ${dateStr}`;
}

function histEntry(h, prev) {
  const d    = new Date(h.timestamp);
  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const tName = TIER_PT[h.tier] || h.tier;
  const tDiv  = ['MASTER','GRANDMASTER','CHALLENGER'].includes(h.tier) ? '' : ` ${h.division}`;

  // First entry ever — no previous to compare
  if (!prev) {
    return `
      <div class="timeline-entry entry-neutral">
        <span class="entry-time">${time}</span>
        <span class="tier-badge tier-${h.tier} entry-tier">${tName}${tDiv}</span>
        <span class="entry-arrow entry-neutral">→</span>
        <div class="entry-delta"><span class="entry-delta-text neutral">Primeiro registro</span></div>
        <span class="entry-lp">${h.lp} LP</span>
      </div>`;
  }

  // Compute rank change (tier+division score, without LP so promotions are unambiguous)
  const currTS = tierToNumber(h.tier,    h.division);
  const prevTS = tierToNumber(prev.tier, prev.division);
  const rankUp   = currTS > prevTS;
  const rankDown = currTS < prevTS;
  const lpDelta  = (h.lp || 0) - (prev.lp || 0);

  const pName = TIER_PT[prev.tier] || prev.tier;
  const pDiv  = ['MASTER','GRANDMASTER','CHALLENGER'].includes(prev.tier) ? '' : ` ${prev.division}`;

  let cls, arrow, inner;

  if (rankUp) {
    // Promotion (tier or division)
    cls = 'entry-positive'; arrow = '↑↑';
    inner = `<span class="entry-delta-text promoted">PROMOVIDO</span>
             <span class="entry-delta-sub">${pName}${pDiv} → ${tName}${tDiv}</span>`;
  } else if (rankDown) {
    // Demotion
    cls = 'entry-negative'; arrow = '↓↓';
    inner = `<span class="entry-delta-text demoted">REBAIXADO</span>
             <span class="entry-delta-sub">${pName}${pDiv} → ${tName}${tDiv}</span>`;
  } else if (lpDelta > 0) {
    cls = 'entry-positive'; arrow = '↑';
    inner = `<span class="entry-delta-text positive">+${lpDelta} LP</span>`;
  } else if (lpDelta < 0) {
    cls = 'entry-negative'; arrow = '↓';
    inner = `<span class="entry-delta-text negative">${lpDelta} LP</span>`;
  } else {
    cls = 'entry-neutral'; arrow = '→';
    inner = `<span class="entry-delta-text neutral">Sem alteração</span>`;
  }

  return `
    <div class="timeline-entry ${cls}">
      <span class="entry-time">${time}</span>
      <span class="tier-badge tier-${h.tier} entry-tier">${tName}${tDiv}</span>
      <span class="entry-arrow ${cls}">${arrow}</span>
      <div class="entry-delta">${inner}</div>
      <span class="entry-lp">${h.lp} LP</span>
    </div>`;
}
