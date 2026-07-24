// WriteFlow — Background Service Worker
// Handles context menu, API calls, and message routing

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const FREE_DAILY_LIMIT = 10;

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'writeflow-rewrite',
    title: 'WriteFlow: Rewrite (Professional)',
    contexts: ['editable']
  });
  chrome.contextMenus.create({
    id: 'writeflow-casual',
    title: 'WriteFlow: Make Casual',
    contexts: ['editable']
  });
  chrome.contextMenus.create({
    id: 'writeflow-grammar',
    title: 'WriteFlow: Fix Grammar',
    contexts: ['editable']
  });
  chrome.contextMenus.create({
    id: 'writeflow-shorten',
    title: 'WriteFlow: Make Shorter',
    contexts: ['editable']
  });
  chrome.contextMenus.create({
    id: 'writeflow-expand',
    title: 'WriteFlow: Expand',
    contexts: ['editable']
  });
  chrome.contextMenus.create({
    id: 'writeflow-translate',
    title: 'WriteFlow: Translate to English',
    contexts: ['editable']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.menuItemId.toString().startsWith('writeflow-')) return;
  
  const action = info.menuItemId.replace('writeflow-', '');
  
  chrome.tabs.sendMessage(tab.id, {
    type: 'WRITEFLOW_GET_SELECTION'
  }, async (response) => {
    if (!response || !response.text) return;
    
    const result = await processText(response.text, action);
    if (result) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'WRITEFLOW_REPLACE',
        text: result
      });
    }
  });
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'WRITEFLOW_PROCESS') {
    processText(request.text, request.action).then(result => {
      sendResponse({ success: true, text: result });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep channel open for async response
  }
  
  if (request.type === 'WRITEFLOW_GET_USAGE') {
    getUsage().then(sendResponse);
    return true;
  }
  
  if (request.type === 'WRITEFLOW_SAVE_KEY') {
    chrome.storage.local.set({ openai_key: request.key }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.type === 'WRITEFLOW_GET_KEY') {
    chrome.storage.local.get(['openai_key'], (data) => {
      sendResponse({ key: data.openai_key || '' });
    });
    return true;
  }
});

async function processText(text, action) {
  const { openai_key } = await chrome.storage.local.get(['openai_key']);
  if (!openai_key) {
    throw new Error('No API key set. Open WriteFlow settings and add your OpenAI API key.');
  }
  
  // Check usage limit
  const usage = await getUsage();
  const { license_key } = await chrome.storage.local.get(['license_key']);
  
  if (!license_key && usage.count >= FREE_DAILY_LIMIT) {
    throw new Error(`Free limit reached (${FREE_DAILY_LIMIT}/day). Upgrade to Pro for unlimited use.`);
  }
  
  const prompts = {
    rewrite: 'Rewrite the following text to be more professional and polished. Keep the same meaning and length. Output ONLY the rewritten text with no explanation:',
    casual: 'Rewrite the following text to sound casual and conversational. Keep the same meaning. Output ONLY the rewritten text with no explanation:',
    grammar: 'Fix all grammar, spelling, and punctuation errors in the following text. Output ONLY the corrected text with no explanation:',
    shorten: 'Make the following text shorter and more concise while keeping the key message. Output ONLY the shortened text with no explanation:',
    expand: 'Expand the following text with more detail and substance. Keep the same tone. Output ONLY the expanded text with no explanation:',
    translate: 'Translate the following text to English. Output ONLY the translated text with no explanation:'
  };
  
  const system_prompt = prompts[action] || prompts.rewrite;
  
  const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openai_key}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: text }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });
  
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }
  
  const data = await response.json();
  const result = data.choices[0].message.content.trim();
  
  // Increment usage
  await incrementUsage();
  
  return result;
}

async function getUsage() {
  const today = new Date().toDateString();
  const { usage } = await chrome.storage.local.get(['usage']);
  
  if (!usage || usage.date !== today) {
    return { date: today, count: 0 };
  }
  return usage;
}

async function incrementUsage() {
  const usage = await getUsage();
  usage.count++;
  await chrome.storage.local.set({ usage });
}
