'use strict';

async function runTool(toolName, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="display:inline-block"></span> Executando...';

  try {
    const res = await electronAPI.tools[toolName]();
    if (res.success) {
      const msg = res.message || 'Concluído com sucesso!';
      showToast(msg, 'success');
      appendToolsLog(toolName, msg, 'success');
    } else {
      const msg = res.error || 'Erro ao executar.';
      showToast(msg, 'error');
      appendToolsLog(toolName, msg, 'error');
    }
  } catch (e) {
    showToast('Erro inesperado: ' + e.message, 'error');
    appendToolsLog(toolName, 'Erro inesperado: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = orig;
}

// Friendly labels for the persistent execution log
const TOOL_LABELS = {
  killRiotProcesses: 'Encerrar Processos',
  clearClientCache:  'Limpar Cache',
  repairClient:      'Reparar Cliente',
  openDataFolder:    'Abrir Pasta de Dados',
};

// Appends a timestamped line to the persistent log (survives longer than a toast)
function appendToolsLog(toolName, message, type) {
  const wrapper = document.getElementById('tools-log-wrapper');
  const log     = document.getElementById('tools-log');
  if (!wrapper || !log) return;

  wrapper.style.display = '';
  const now   = new Date();
  const time  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const label = TOOL_LABELS[toolName] || toolName;
  const color = type === 'success' ? 'var(--success)' : 'var(--danger)';
  const icon  = type === 'success' ? '✓' : '✗';

  const line = document.createElement('div');
  line.innerHTML =
    `<span style="color:var(--text-dim)">[${time}]</span> ` +
    `<span style="color:${color};font-weight:700">${icon}</span> ` +
    `<span style="color:var(--text-secondary)">${label}:</span> ` +
    `<span>${escHtmlTool(message)}</span>`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function clearToolsLog() {
  const log     = document.getElementById('tools-log');
  const wrapper = document.getElementById('tools-log-wrapper');
  if (log)     log.innerHTML = '';
  if (wrapper) wrapper.style.display = 'none';
}

// Local escape (renderer.js's escHtml may not be loaded in all contexts)
function escHtmlTool(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
