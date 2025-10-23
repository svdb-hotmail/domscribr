const SESSION_KEY = 'domscribr:sessions';
const sessions = new Map();
let sessionsLoaded = false;

async function ensureSessionsLoaded() {
  if (sessionsLoaded) {
    return;
  }
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const payload = stored[SESSION_KEY] || {};
  for (const [tabId, value] of Object.entries(payload)) {
    sessions.set(Number(tabId), value);
  }
  sessionsLoaded = true;
}

async function persistSessions() {
  const payload = {};
  for (const [tabId, value] of sessions.entries()) {
    payload[tabId] = value;
  }
  await chrome.storage.local.set({ [SESSION_KEY]: payload });
}

function getOrCreateSession(tabId) {
  if (!sessions.has(tabId)) {
    sessions.set(tabId, {
      recording: false,
      messages: [],
      lastCapturedAt: null
    });
  }
  return sessions.get(tabId);
}

async function updateSession(tabId, updater) {
  await ensureSessionsLoaded();
  const session = getOrCreateSession(tabId);
  const result = await updater(session);
  sessions.set(tabId, session);
  await persistSessions();
  return result;
}

async function getSession(tabId) {
  await ensureSessionsLoaded();
  return getOrCreateSession(tabId);
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js']
    });
  } catch (error) {
    console.error('domscribr: failed to inject content script', error);
    throw error;
  }
}

async function startRecording(tabId) {
  await updateSession(tabId, (session) => {
    session.recording = true;
    session.messages = [];
    session.lastCapturedAt = null;
  });
  await injectContentScript(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'domscribr:start' });
  } catch (error) {
    console.error('domscribr: failed to send start command', error);
  }
}

async function stopRecording(tabId) {
  await updateSession(tabId, (session) => {
    session.recording = false;
  });
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'domscribr:stop' });
  } catch (error) {
    console.warn('domscribr: stop command error', error);
  }
}

async function exportRecording(tabId) {
  const session = await getSession(tabId);
  return {
    recording: session.recording,
    lastCapturedAt: session.lastCapturedAt,
    messageCount: session.messages.length,
    messages: session.messages
  };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!sessionsLoaded) {
    return;
  }
  if (sessions.delete(tabId)) {
    persistSessions().catch((error) => console.error('domscribr: persist on tab removal failed', error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'domscribr:popup-start': {
        const tabId = await activeTabId();
        if (!tabId) {
          sendResponse({ ok: false, error: 'No active tab available.' });
          return;
        }
        try {
          await startRecording(tabId);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
        return;
      }
      case 'domscribr:popup-stop': {
        const tabId = await activeTabId();
        if (!tabId) {
          sendResponse({ ok: false, error: 'No active tab available.' });
          return;
        }
        await stopRecording(tabId);
        sendResponse({ ok: true });
        return;
      }
      case 'domscribr:popup-export': {
        const tabId = await activeTabId();
        if (!tabId) {
          sendResponse({ ok: false, error: 'No active tab available.' });
          return;
        }
        const payload = await exportRecording(tabId);
        sendResponse({ ok: true, payload });
        return;
      }
      case 'domscribr:popup-status': {
        const tabId = await activeTabId();
        if (!tabId) {
          sendResponse({ ok: true, payload: { recording: false, messageCount: 0, lastCapturedAt: null } });
          return;
        }
        const session = await getSession(tabId);
        sendResponse({
          ok: true,
          payload: {
            recording: session.recording,
            messageCount: session.messages.length,
            lastCapturedAt: session.lastCapturedAt
          }
        });
        return;
      }
      case 'domscribr:messages': {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'Missing tab context.' });
          return;
        }
        await updateSession(tabId, (session) => {
          if (!Array.isArray(message.payload)) {
            return;
          }
          for (const entry of message.payload) {
            session.messages.push(entry);
            session.lastCapturedAt = entry.capturedAt;
          }
        });
        sendResponse({ ok: true });
        return;
      }
      case 'domscribr:ready': {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false });
          return;
        }
        const session = await getSession(tabId);
        sendResponse({ ok: true, recording: session.recording });
        if (session.recording) {
          try {
            await chrome.tabs.sendMessage(tabId, { type: 'domscribr:start' });
          } catch (error) {
            console.error('domscribr: failed to re-send start after ready', error);
          }
        }
        return;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type.' });
    }
  })().catch((error) => {
    console.error('domscribr: runtime message error', error);
    try {
      sendResponse({ ok: false, error: error?.message || String(error) });
    } catch (err) {
      console.error('domscribr: failed to send error response', err);
    }
  });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#1f2937' }).catch(() => {});
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
});
