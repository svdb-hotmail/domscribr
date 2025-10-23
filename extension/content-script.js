(() => {
  const state = {
    recording: false,
    observer: null,
    seen: new Set(),
    sequence: 0
  };

  const MESSAGE_SELECTORS = [
    '[data-message-author-role]',
    '[data-message-id]',
    '[data-testid*="message" i]',
    'cib-chat-turn',
    'cib-message',
    'article',
    '.chat-message',
    '.message',
    '.conversation-turn',
    '.response',
    '.prompt'
  ];

  function normaliseText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function inferRole(element) {
    const directRole = element.getAttribute('data-message-author-role')
      || element.getAttribute('data-role')
      || element.getAttribute('data-message-role')
      || element.getAttribute('data-sender')
      || (element.dataset && (element.dataset.role || element.dataset.messageAuthorRole || element.dataset.sender));
    if (directRole) {
      const cleaned = directRole.toLowerCase();
      if (cleaned.includes('user') || cleaned.includes('customer')) {
        return 'user';
      }
      if (cleaned.includes('assistant') || cleaned.includes('bot') || cleaned.includes('ai') || cleaned.includes('model')) {
        return 'assistant';
      }
      if (cleaned.includes('system')) {
        return 'system';
      }
    }

    const className = typeof element.className === 'string' ? element.className.toLowerCase() : '';
    if (className.includes('assistant') || className.includes('bot') || className.includes('model')) {
      return 'assistant';
    }
    if (className.includes('user') || className.includes('prompt') || className.includes('sender-user')) {
      return 'user';
    }

    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('assistant') || ariaLabel.includes('bot')) {
      return 'assistant';
    }
    if (ariaLabel.includes('user')) {
      return 'user';
    }

    const roleAttr = element.getAttribute('role');
    if (roleAttr && roleAttr.toLowerCase() === 'status') {
      return 'system';
    }

    return 'assistant';
  }

  function hashString(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }

  function fingerprint(element, text) {
    const explicitId = element.getAttribute('data-message-id')
      || element.getAttribute('id')
      || element.getAttribute('data-id')
      || element.getAttribute('data-uuid');
    if (explicitId) {
      return `id:${explicitId}`;
    }
    const role = inferRole(element);
    const trimmed = text.slice(0, 200);
    return `hash:${hashString(role + '::' + trimmed)}:${trimmed.length}:${element.tagName}`;
  }

  function buildMessage(element) {
    const text = normaliseText(element.innerText || '');
    const html = (element.innerHTML || '').trim();
    if (!text && !html) {
      return null;
    }
    const id = fingerprint(element, text || html);
    if (state.seen.has(id)) {
      return null;
    }
    state.seen.add(id);
    state.sequence += 1;
    return {
      id,
      sequence: state.sequence,
      role: inferRole(element),
      text,
      html,
      capturedAt: new Date().toISOString(),
      source: {
        url: window.location.href,
        title: document.title
      }
    };
  }

  function uniqueElements(elements) {
    const acc = [];
    const seen = new Set();
    for (const element of elements) {
      if (!element || !(element instanceof HTMLElement)) {
        continue;
      }
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);
      acc.push(element);
    }
    return acc;
  }

  function collectCandidateElements(root) {
    const matches = [];
    if (root instanceof HTMLElement && isMessageElement(root)) {
      matches.push(root);
    }
    if (root instanceof HTMLElement || root instanceof Document || root instanceof ShadowRoot) {
      for (const selector of MESSAGE_SELECTORS) {
        root.querySelectorAll(selector).forEach((node) => {
          if (isMessageElement(node)) {
            matches.push(node);
          }
        });
      }
    }
    return uniqueElements(matches);
  }

  function isMessageElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (element.closest('[data-dom-scribr-ignore]')) {
      return false;
    }
    if (element.hasAttribute('data-message-id') || element.hasAttribute('data-message-author-role')) {
      return true;
    }
    const roleAttr = element.getAttribute('role');
    if (roleAttr && ['article', 'listitem', 'group'].includes(roleAttr.toLowerCase())) {
      return true;
    }
    const className = (element.className || '').toString().toLowerCase();
    if (/(message|assistant|user|conversation-turn|chat-item)/.test(className)) {
      return true;
    }
    if (element.tagName === 'ARTICLE') {
      return true;
    }
    return false;
  }

  function harvest(root) {
    const elements = collectCandidateElements(root);
    const messages = [];
    for (const element of elements) {
      const record = buildMessage(element);
      if (record) {
        messages.push(record);
      }
    }
    if (messages.length) {
      sendMessages(messages);
    }
  }

  function handleMutations(mutations) {
    if (!state.recording) {
      return;
    }
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement || node instanceof DocumentFragment) {
          harvest(node);
        }
      }
      if (mutation.type === 'characterData' && mutation.target?.parentElement) {
        harvest(mutation.target.parentElement);
      }
    }
  }

  function sendMessages(messages) {
    if (!messages.length) {
      return;
    }
    chrome.runtime.sendMessage({ type: 'domscribr:messages', payload: messages }).catch((error) => {
      console.warn('domscribr: failed to send messages', error);
    });
  }

  function startObserver() {
    if (state.observer) {
      state.observer.disconnect();
    }
    state.observer = new MutationObserver(handleMutations);
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function startRecording() {
    if (state.recording) {
      return;
    }
    state.recording = true;
    state.seen.clear();
    state.sequence = 0;
    harvest(document);
    startObserver();
  }

  function stopRecording() {
    state.recording = false;
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
      return;
    }
    if (message.type === 'domscribr:start') {
      startRecording();
      sendResponse?.({ ok: true });
      return;
    }
    if (message.type === 'domscribr:stop') {
      stopRecording();
      sendResponse?.({ ok: true });
    }
  });

  chrome.runtime.sendMessage({ type: 'domscribr:ready' }).then((response) => {
    if (response?.recording) {
      startRecording();
    }
  }).catch((error) => {
    console.warn('domscribr: ready handshake failed', error);
  });
})();
