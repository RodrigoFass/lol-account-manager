'use strict';

async function runTool(toolName, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="display:inline-block"></span> Executando...';

  try {
    const res = await electronAPI.tools[toolName]();
    if (res.success) showToast(res.message || 'Concluído com sucesso!', 'success');
    else             showToast(res.error   || 'Erro ao executar.', 'error');
  } catch (e) {
    showToast('Erro inesperado: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = orig;
}
