// WriteFlow — Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  updateUsageDisplay();
  
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      document.getElementById('writeTab').classList.toggle('hidden', tabName !== 'write');
      document.getElementById('settingsTab').classList.toggle('hidden', tabName !== 'settings');
    });
  });
  
  // Action buttons
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => process(btn.dataset.action));
  });
  
  // Quick rewrite button
  document.getElementById('quickBtn').addEventListener('click', () => process('rewrite'));
  
  // Copy button
  document.getElementById('copyBtn').addEventListener('click', copyResult);
  
  // Settings: Save API key
  document.getElementById('saveKeyBtn').addEventListener('click', saveKey);
  
  // Settings: Activate license
  document.getElementById('activateLicenseBtn').addEventListener('click', activateLicense);
  
  // Upgrade link
  document.getElementById('upgradeLink').addEventListener('click', () => {
    document.querySelector('.tab[data-tab="settings"]').click();
  });
});

async function loadState() {
  const data = await chrome.storage.local.get(['openai_key', 'license_key', 'usage']);
  
  if (data.openai_key) {
    document.getElementById('apiKey').value = data.openai_key;
  }
  if (data.license_key) {
    document.getElementById('licenseKey').value = data.license_key;
    document.getElementById('planBadge').textContent = 'PRO';
    document.getElementById('planBadge').classList.add('pro');
  }
}

async function saveKey() {
  const key = document.getElementById('apiKey').value.trim();
  if (!key) return showStatus('Please enter an API key', 'error');
  
  await chrome.runtime.sendMessage({ type: 'WRITEFLOW_SAVE_KEY', key });
  showStatus('API key saved!', 'success');
}

async function activateLicense() {
  const key = document.getElementById('licenseKey').value.trim();
  if (!key) return showStatus('Please enter a license key', 'error');
  
  await chrome.storage.local.set({ license_key: key });
  
  document.getElementById('planBadge').textContent = 'PRO';
  document.getElementById('planBadge').classList.add('pro');
  showStatus('License activated! 🎉', 'success');
}

async function process(action) {
  const text = document.getElementById('inputText').value.trim();
  if (!text) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'WRITEFLOW_GET_SELECTION' });
        if (response && response.text) {
          document.getElementById('inputText').value = response.text;
          return process(action);
        }
      } catch (e) {}
    }
    return showStatus('Please enter or select some text first', 'error');
  }
  
  const resultDiv = document.getElementById('result');
  resultDiv.textContent = 'Processing...';
  resultDiv.classList.remove('empty');
  
  document.getElementById('quickBtn').disabled = true;
  document.querySelectorAll('[data-action]').forEach(b => b.disabled = true);
  
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'WRITEFLOW_PROCESS',
      text,
      action
    });
    
    if (response.success) {
      resultDiv.textContent = response.text;
      document.getElementById('copyBtn').style.display = 'block';
      showStatus('Done!', 'success');
      updateUsageDisplay();
    } else {
      resultDiv.textContent = '';
      resultDiv.classList.add('empty');
      resultDiv.textContent = 'Error — see below';
      showStatus(response.error, 'error');
    }
  } catch (err) {
    showStatus(err.message || 'Something went wrong', 'error');
  }
  
  document.getElementById('quickBtn').disabled = false;
  document.querySelectorAll('[data-action]').forEach(b => b.disabled = false);
}

function copyResult() {
  const text = document.getElementById('result').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showStatus('Copied to clipboard!', 'success');
  });
}

async function updateUsageDisplay() {
  const usage = await chrome.runtime.sendMessage({ type: 'WRITEFLOW_GET_USAGE' });
  const { license_key } = await chrome.storage.local.get(['license_key']);
  
  const dots = document.getElementById('usageDots');
  const label = document.getElementById('usageLabel');
  
  dots.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot' + (i < usage.count ? ' used' : '');
    dots.appendChild(dot);
  }
  
  if (license_key) {
    label.textContent = 'Unlimited (Pro)';
  } else {
    label.textContent = `${usage.count}/10 today`;
  }
}

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + type;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}
