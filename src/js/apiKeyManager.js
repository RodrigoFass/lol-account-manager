'use strict';

let apiKeyCountdownTimer = null;
let currentStatus        = null;
let _keyExpiryTs         = 0;   // absolute UTC timestamp when the key expires
let _lastFocusSync       = 0;   // throttle focus-based resyncs

async function loadApiKeyStatus() {
  const status = await electronAPI.apiKey.getStatus();
  updateApiKeyUI(status);
  startCountdown(status);
  updateSettingsApiKeyUI(status);
}

function updateApiKeyUI(status) {
  currentStatus = status;
  const banner     = document.getElementById('api-banner');
  const bannerTxt  = document.getElementById('banner-text');
  const bannerIcon = document.getElementById('banner-icon');
  const sidebarDot = document.getElementById('sidebar-dot');
  const sidebarTxt = document.getElementById('sidebar-api-text');

  banner.classList.remove('warning', 'expired');

  if (status.status === 'missing') {
    banner.classList.add('expired');
    bannerIcon.textContent = '🔑';
    bannerTxt.textContent  = 'API Key não configurada. Vá em Configurações para adicionar.';
    sidebarDot.className   = 'dot missing';
    sidebarTxt.textContent = 'API Key ausente';
    if (apiKeyCountdownTimer) { clearInterval(apiKeyCountdownTimer); apiKeyCountdownTimer = null; }
    updateTimerDisplay(0);

  } else if (status.status === 'expired') {
    banner.classList.add('expired');
    bannerIcon.textContent = '🚨';
    bannerTxt.textContent  = 'API Key expirada! Renove agora para retomar as atualizações automáticas.';
    sidebarDot.className   = 'dot expired';
    sidebarTxt.textContent = 'API Key expirada';
    if (apiKeyCountdownTimer) { clearInterval(apiKeyCountdownTimer); apiKeyCountdownTimer = null; }
    updateTimerDisplay(0);

  } else if (status.status === 'warning') {
    banner.classList.add('warning');
    bannerIcon.textContent = '⚠️';
    bannerTxt.textContent  = 'Sua API Key expira em breve — renove antes que as atualizações parem.';
    sidebarDot.className   = 'dot warning';
    sidebarTxt.textContent = 'API Key expirando';

  } else {
    // valid — hide banner
    sidebarDot.className   = 'dot valid';
    sidebarTxt.textContent = 'API Key válida';
  }

  updateSettingsApiKeyUI(status);
}

// ── Countdown — uses absolute expiry timestamp ────────────────
// Module-level tick reference so visibilitychange can pause/resume
// without recreating the closure (avoids drift on minimize/tray).
let _activeTick = null;

function _countdownTick() {
  const remaining = _keyExpiryTs - Date.now();
  if (remaining <= 0) {
    clearInterval(apiKeyCountdownTimer);
    apiKeyCountdownTimer = null;
    _activeTick = null;
    const expired = { status: 'expired', remaining: 0 };
    updateApiKeyUI(expired);
    updateSettingsApiKeyUI(expired);
    return;
  }
  const st = remaining <= 2 * 60 * 60 * 1000
    ? { status: 'warning', remaining }
    : { status: 'valid',   remaining };
  if (currentStatus?.status === 'valid' && st.status === 'warning') updateApiKeyUI(st);
  updateTimerDisplay(remaining);
  updateSettingsApiKeyUI(st);
}

function startCountdown(status) {
  if (apiKeyCountdownTimer) { clearInterval(apiKeyCountdownTimer); apiKeyCountdownTimer = null; }
  if (status.status !== 'valid' && status.status !== 'warning') return;

  _keyExpiryTs = Date.now() + status.remaining;
  _activeTick  = _countdownTick;

  _countdownTick();                                    // immediate first render
  apiKeyCountdownTimer = setInterval(_countdownTick, 1000);
}

// ── Pause countdown when window is hidden (minimized / sent to tray) ──
// The 1-second interval fires 86 400 times/day — zero value when invisible.
// Because _keyExpiryTs is absolute, resuming needs no recalculation.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause — clear interval, keep _keyExpiryTs intact
    if (apiKeyCountdownTimer) { clearInterval(apiKeyCountdownTimer); apiKeyCountdownTimer = null; }
  } else if (_activeTick && _keyExpiryTs - Date.now() > 0) {
    // Resume — restart interval with the same tick function (no drift)
    if (!apiKeyCountdownTimer) {
      _activeTick();   // immediate update on window restore
      apiKeyCountdownTimer = setInterval(_activeTick, 1000);
    }
  }
});

// ── Time formatting ───────────────────────────────────────────
// Returns a human-readable string: "22h 30min", "45 min", "4 min 12s", "30s"
// Adapts precision based on how much time is left.
function formatRemainingFriendly(ms) {
  if (ms <= 0) return 'Expirada';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h >= 1)  return m > 0 ? `${h}h ${m}min` : `${h}h`;
  if (m >= 5)  return `${m} min`;
  if (m >= 1)  return `${m} min ${s}s`;
  return `${s}s`;
}

function updateTimerDisplay(ms) {
  const el = document.getElementById('banner-timer');
  if (el) el.textContent = ms > 0 ? formatRemainingFriendly(ms) : '';
}

function updateSettingsApiKeyUI(status) {
  const dot   = document.getElementById('settings-dot');
  const timer = document.getElementById('settings-timer');
  const label = document.getElementById('settings-status-label');
  if (!dot) return;

  dot.className = 'dot ' + status.status;
  dot.style.width = '10px'; dot.style.height = '10px'; dot.style.borderRadius = '50%';

  if (status.status === 'valid' || status.status === 'warning') {
    const isWarn         = status.status === 'warning';
    timer.textContent    = formatRemainingFriendly(status.remaining);
    timer.style.color    = isWarn ? 'var(--warning)' : 'var(--success)';
    label.textContent    = isWarn ? 'Expirando em breve — renove logo!' : 'API Key válida';
    label.style.color    = isWarn ? 'var(--warning)' : 'var(--success)';
  } else if (status.status === 'expired') {
    timer.textContent    = 'Expirada';
    timer.style.color    = 'var(--danger)';
    label.textContent    = 'Renove agora em developer.riotgames.com';
    label.style.color    = 'var(--danger)';
  } else {
    timer.textContent    = '—';
    timer.style.color    = '';
    label.textContent    = 'Nenhuma API Key configurada';
    label.style.color    = 'var(--text-muted)';
  }
}

// ── Save / Validate ───────────────────────────────────────────
async function validateAndSaveKey() {
  const input = document.getElementById('api-key-input');
  const btn   = document.getElementById('validate-btn');

  const raw = input.value;
  const key = raw.replace(/[s ­​‌‍⁠﻿]/g, '');

  if (key !== raw.trim()) {
    showToast('⚠️ Foram removidos espaços ou caracteres invisíveis da chave.', 'warning', 4000);
  }

  if (!key) { showToast('Cole a API Key no campo.', 'warning'); return; }
  if (!key.startsWith('RGAPI-')) {
    showToast('Formato inválido — a API Key deve começar com RGAPI-', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ Salvando...';

  const saveResult = await electronAPI.apiKey.save(key);
  if (!saveResult.success) {
    showToast(saveResult.error || 'Erro ao salvar a chave.', 'error');
    btn.disabled    = false;
    btn.textContent = '✅ Validar e Salvar';
    return;
  }

  input.value = '';
  await loadApiKeyStatus();

  btn.textContent = '⏳ Verificando...';
  const result = await electronAPI.apiKey.validate(key);

  if (result.valid) {
    showToast('✅ API Key salva e verificada com sucesso!', 'success');
  } else {
    // Key saved but Riot hasn't activated it yet (common right after generation)
    showToast(
      '⚠️ Chave salva! A Riot ainda não a reconheceu — isso é normal nos primeiros 1–2 minutos após a geração. ' +
      'Aguarde e clique em ⟳ para confirmar.',
      'warning',
      9000
    );
  }

  btn.disabled    = false;
  btn.textContent = '✅ Validar e Salvar';
}

async function testStoredApiKey() {
  const btn = document.getElementById('test-key-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Testando...'; }

  const res = await electronAPI.apiKey.testStored();

  if (!res.stored) {
    showToast('Nenhuma chave armazenada — cole uma chave e clique em Validar e Salvar primeiro.', 'warning', 5000);
  } else if (res.ok) {
    showToast(res.message, 'success', 6000);
  } else {
    const detail = res.rawBody ? ` | Riot: ${res.rawBody.substring(0, 80)}` : '';
    showToast(`${res.message}${detail}`, 'error', 10000);
  }

  if (btn) { btn.disabled = false; btn.textContent = '🔍 Testar Conexão Riot'; }
}

// ── Re-sync on window focus ───────────────────────────────────
// Covers the case where the user wakes the computer, switches back
// to the app, and the setInterval hasn't fired yet (or fired with a
// stale _keyExpiryTs). The absolute-timestamp approach already
// self-corrects in the next tick, but re-fetching from disk is the
// safest guarantee — max once every 60 s to avoid IPC spam.
window.addEventListener('focus', () => {
  const now = Date.now();
  if (now - _lastFocusSync > 60_000) {
    _lastFocusSync = now;
    loadApiKeyStatus();
  }
});
