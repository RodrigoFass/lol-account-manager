'use strict';

let apiKeyCountdownTimer = null;
let currentStatus = null;

async function loadApiKeyStatus() {
  const status = await electronAPI.apiKey.getStatus();
  updateApiKeyUI(status);
  startCountdown(status);
  updateSettingsApiKeyUI(status);
}

function updateApiKeyUI(status) {
  currentStatus = status;
  const banner    = document.getElementById('api-banner');
  const bannerTxt = document.getElementById('banner-text');
  const bannerIcon = document.getElementById('banner-icon');
  const sidebarDot = document.getElementById('sidebar-dot');
  const sidebarTxt = document.getElementById('sidebar-api-text');

  // Remove previous classes
  banner.classList.remove('warning', 'expired');

  if (status.status === 'missing') {
    banner.classList.add('expired');
    bannerIcon.textContent = '🔑';
    bannerTxt.textContent  = 'API Key não configurada. Vá em Configurações para adicionar.';
    sidebarDot.className = 'dot missing';
    sidebarTxt.textContent = 'API Key ausente';
    if (apiKeyCountdownTimer) { clearInterval(apiKeyCountdownTimer); apiKeyCountdownTimer = null; }
    updateTimerDisplay(0);
  } else if (status.status === 'expired') {
    banner.classList.add('expired');
    bannerIcon.textContent = '🚨';
    bannerTxt.textContent  = 'API Key expirada! Renove agora para retomar as atualizações.';
    sidebarDot.className = 'dot expired';
    sidebarTxt.textContent = 'API Key expirada';
    // Stop the countdown — showing remaining time while the key is expired is contradictory
    if (apiKeyCountdownTimer) { clearInterval(apiKeyCountdownTimer); apiKeyCountdownTimer = null; }
    updateTimerDisplay(0);
  } else if (status.status === 'warning') {
    banner.classList.add('warning');
    bannerIcon.textContent = '⚠️';
    bannerTxt.textContent  = 'Sua API Key está prestes a expirar.';
    sidebarDot.className = 'dot warning';
    sidebarTxt.textContent = 'API Key expirando';
  } else {
    // valid — hide banner
    sidebarDot.className = 'dot valid';
    sidebarTxt.textContent = 'API Key válida';
  }

  updateSettingsApiKeyUI(status);
}

function startCountdown(status) {
  if (apiKeyCountdownTimer) clearInterval(apiKeyCountdownTimer);
  if (status.status === 'valid' || status.status === 'warning') {
    let remaining = status.remaining;
    apiKeyCountdownTimer = setInterval(() => {
      remaining -= 1000;
      if (remaining <= 0) {
        clearInterval(apiKeyCountdownTimer);
        updateApiKeyUI({ status: 'expired', remaining: 0 });
        return;
      }
      const newStatus = remaining <= 2 * 60 * 60 * 1000
        ? { status: 'warning', remaining }
        : { status: 'valid', remaining };
      updateTimerDisplay(remaining);
      updateSettingsApiKeyUI(newStatus);
    }, 1000);
    updateTimerDisplay(remaining);
  }
}

function updateTimerDisplay(ms) {
  const el = document.getElementById('banner-timer');
  if (el) el.textContent = formatCountdown(ms);
}

function updateSettingsApiKeyUI(status) {
  const dot    = document.getElementById('settings-dot');
  const timer  = document.getElementById('settings-timer');
  const label  = document.getElementById('settings-status-label');
  const last   = document.getElementById('settings-last-saved');
  if (!dot) return;

  dot.className = 'dot ' + status.status;
  dot.style.width = '10px'; dot.style.height = '10px'; dot.style.borderRadius = '50%';

  if (status.status === 'valid' || status.status === 'warning') {
    timer.textContent = formatCountdown(status.remaining);
    label.textContent = status.status === 'warning' ? 'Expirando em breve' : 'API Key válida';
    label.style.color = status.status === 'warning' ? 'var(--warning)' : 'var(--success)';
  } else if (status.status === 'expired') {
    timer.textContent = '00:00:00';
    label.textContent = 'API Key expirada!';
    label.style.color = 'var(--danger)';
  } else {
    timer.textContent = '—';
    label.textContent = 'Sem API Key configurada';
    label.style.color = 'var(--text-muted)';
  }
}

async function validateAndSaveKey() {
  const input = document.getElementById('api-key-input');
  const btn   = document.getElementById('validate-btn');

  // Front-line sanitization: strip ALL whitespace and invisible Unicode chars
  // (BOM ﻿, NBSP  , zero-width spaces ​-‍, word-joiner ⁠, soft-hyphen ­)
  // This mirrors what the backend does, so validation and storage use the exact same string.
  const raw = input.value;
  const key = raw.replace(/[\s\u00A0\u00AD\u200B\u200C\u200D\u2060\uFEFF]/g, '');

  // Show the user if we silently stripped something — this explains intermittent failures
  if (key !== raw.trim()) {
    showToast('⚠️ Foram removidos espaços ou caracteres invisíveis da chave.', 'warning', 4000);
  }

  if (!key) { showToast('Cole a API Key no campo.', 'warning'); return; }
  if (!key.startsWith('RGAPI-')) { showToast('API Key inválida — deve começar com RGAPI-', 'error'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';

  // Salva a chave primeiro — a validação contra a Riot API é feita como verificação
  // informativa secundária. Bloquear o salvamento na validação impedia a chave de ser
  // armazenada quando o endpoint de status da Riot estava indisponível temporariamente
  // ou quando a chave ainda não havia propagado pelos servidores da Riot logo após a geração.
  const saveResult = await electronAPI.apiKey.save(key);
  if (!saveResult.success) {
    showToast(saveResult.error || 'Erro ao salvar a chave.', 'error');
    btn.disabled = false;
    btn.textContent = '✅ Validar e Salvar';
    return;
  }

  // Chave persistida — atualiza a UI imediatamente para refletir a nova chave
  input.value = '';
  await loadApiKeyStatus();

  // Agora valida contra a Riot API (informativo — não desfaz o salvamento)
  btn.textContent = '⏳ Verificando...';
  const result = await electronAPI.apiKey.validate(key);
  if (result.valid) {
    showToast('✅ API Key salva e verificada com sucesso!', 'success');
  } else {
    // Chave salva, mas a Riot retornou erro. Pode ser delay de propagação
    // (~30 s após regeneração) ou a chave pode ser inválida.
    showToast(
      `⚠️ Chave salva, mas a Riot ainda não a reconheceu: ${result.error || 'erro desconhecido'}. ` +
      'Aguarde ~30 s e clique em atualizar para confirmar.',
      'warning',
      8000
    );
  }

  btn.disabled = false;
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
    // Show detailed diagnostic so the user knows exactly what's failing
    const detail = res.rawBody ? ` | Riot: ${res.rawBody.substring(0, 80)}` : '';
    showToast(`${res.message}${detail}`, 'error', 10000);
  }

  if (btn) { btn.disabled = false; btn.textContent = '🔍 Testar Conexão Riot'; }
}
