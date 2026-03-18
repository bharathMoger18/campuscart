// js/core/utils.js
// showAlert (toast), showLoader/hideLoader, parse backend errors, redirect helper

export function showAlert(message, type = 'info', options = {}) {
  // types: success, error, warning, info
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.style.zIndex = 9999;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <div class="toast__content">${escapeHtml(message)}</div>
    <button class="toast__close" aria-label="Close">&times;</button>
  `;

  container.appendChild(toast);

  toast
    .querySelector('.toast__close')
    .addEventListener('click', () => toast.remove());

  const timeout = options.timeout ?? 4500;
  if (timeout) setTimeout(() => toast.remove(), timeout);
}

export function showLoader(el = null) {
  if (el) {
    el.setAttribute('data-loading', 'true');
  } else {
    const l = document.getElementById('global-loader');
    if (l) l.style.display = 'block';
  }
}
export function hideLoader(el = null) {
  if (el) {
    el.removeAttribute('data-loading');
  } else {
    const l = document.getElementById('global-loader');
    if (l) l.style.display = 'none';
  }
}

export function parseErrors(errData) {
  // Convert backend error objects/lists into readable string
  if (!errData) return 'An error occurred';
  if (typeof errData === 'string') return errData;
  if (errData.detail) return errData.detail;
  if (Array.isArray(errData)) return errData.join(' ');
  if (typeof errData === 'object') {
    const msgs = [];
    for (const key of Object.keys(errData)) {
      const val = errData[key];
      if (Array.isArray(val)) msgs.push(`${key}: ${val.join(' ')}`);
      else msgs.push(`${key}: ${val}`);
    }
    return msgs.join(' | ');
  }
  return String(errData);
}

// Utility to format date safely
export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date)) return '-';
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function redirectTo(href, delay = 0) {
  if (delay > 0) setTimeout(() => (window.location.href = href), delay);
  else window.location.href = href;
}
