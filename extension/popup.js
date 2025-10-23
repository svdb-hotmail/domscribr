const statusTextEl = document.getElementById('status-text');
const statusCountEl = document.getElementById('status-count');
const statusLastEl = document.getElementById('status-last');
const statusMessageEl = document.getElementById('status-message');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const exportBtn = document.getElementById('export-btn');

function setButtons({ recording, hasMessages }) {
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
  exportBtn.disabled = !hasMessages;
}

function formatTimestamp(value) {
  if (!value) {
    return '—';
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch (error) {
    console.warn('domscribr: failed to format timestamp', error);
    return '—';
  }
}

async function sendRuntimeMessage(type) {
  try {
    return await chrome.runtime.sendMessage({ type });
  } catch (error) {
    console.error('domscribr: runtime message failed', error);
    return { ok: false, error: error?.message || String(error) };
  }
}

function showStatusMessage(text, tone = 'info') {
  if (!text) {
    statusMessageEl.hidden = true;
    statusMessageEl.textContent = '';
    statusMessageEl.dataset.tone = '';
    return;
  }
  statusMessageEl.hidden = false;
  statusMessageEl.textContent = text;
  statusMessageEl.dataset.tone = tone;
}

function applyStatus(status) {
  statusTextEl.textContent = status.recording ? 'Recording' : 'Idle';
  statusCountEl.textContent = String(status.messageCount ?? 0);
  statusLastEl.textContent = formatTimestamp(status.lastCapturedAt);
  setButtons({ recording: status.recording, hasMessages: (status.messageCount ?? 0) > 0 });
}

async function refreshStatus() {
  const response = await sendRuntimeMessage('domscribr:popup-status');
  if (response?.ok && response.payload) {
    applyStatus(response.payload);
  } else {
    showStatusMessage(response?.error || 'Unable to reach background script.', 'error');
  }
}

async function handleStart() {
  setButtons({ recording: true, hasMessages: false });
  showStatusMessage('Starting recorder…', 'info');
  const response = await sendRuntimeMessage('domscribr:popup-start');
  if (response?.ok) {
    showStatusMessage('Recorder armed. Capture activity in the active tab.', 'success');
  } else {
    showStatusMessage(response?.error || 'Failed to start recorder.', 'error');
  }
  await refreshStatus();
}

async function handleStop() {
  setButtons({ recording: false, hasMessages: true });
  const response = await sendRuntimeMessage('domscribr:popup-stop');
  if (response?.ok) {
    showStatusMessage('Recorder paused.', 'info');
  } else {
    showStatusMessage(response?.error || 'Failed to stop recorder.', 'error');
  }
  await refreshStatus();
}

function downloadPayload(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `domscribr-${timestamp}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleExport() {
  showStatusMessage('Preparing export…', 'info');
  const response = await sendRuntimeMessage('domscribr:popup-export');
  if (response?.ok && response.payload) {
    downloadPayload(response.payload);
    showStatusMessage(`Exported ${response.payload.messageCount ?? 0} messages.`, 'success');
  } else {
    showStatusMessage(response?.error || 'Export failed.', 'error');
  }
  await refreshStatus();
}

startBtn.addEventListener('click', () => {
  handleStart().catch((error) => {
    console.error('domscribr: start error', error);
    showStatusMessage('Unexpected error while starting.', 'error');
  });
});

stopBtn.addEventListener('click', () => {
  handleStop().catch((error) => {
    console.error('domscribr: stop error', error);
    showStatusMessage('Unexpected error while stopping.', 'error');
  });
});

exportBtn.addEventListener('click', () => {
  handleExport().catch((error) => {
    console.error('domscribr: export error', error);
    showStatusMessage('Unexpected error during export.', 'error');
  });
});

refreshStatus().catch((error) => {
  console.error('domscribr: initial status error', error);
  showStatusMessage('Unable to fetch recorder status.', 'error');
});
