// WriteFlow — Content Script
// Injected into every page to handle text selection and replacement

let activeElement = null;

// Track the currently focused editable element
document.addEventListener('focusin', (e) => {
  if (e.target.matches('input, textarea, [contenteditable="true"]')) {
    activeElement = e.target;
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'WRITEFLOW_GET_SELECTION') {
    const el = document.activeElement;
    if (el && (el.matches('input, textarea') || el.isContentEditable)) {
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const text = el.value ? el.value.substring(start, end) : window.getSelection().toString();
      
      if (text) {
        sendResponse({ text, elementType: el.matches('input, textarea') ? 'input' : 'contenteditable' });
        return;
      }
    }
    sendResponse({ text: '' });
  }
  
  if (request.type === 'WRITEFLOW_REPLACE') {
    const el = document.activeElement;
    if (el && el.matches('input, textarea')) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = el.value.substring(0, start) + request.text + el.value.substring(end);
      el.selectionStart = el.selectionEnd = start + request.text.length;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el && el.isContentEditable) {
      document.execCommand('insertText', false, request.text);
    }
    showToast('✓ Done!');
  }
});

// Subtle toast notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: #1a1a2e; color: #00d4aa; padding: 10px 18px;
    border-radius: 8px; font-family: system-ui; font-size: 14px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3); pointer-events: none;
    transition: opacity 0.3s;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
