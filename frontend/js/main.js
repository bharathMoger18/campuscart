// js/main.js
import { api } from './core/api.js';
import { showAlert } from './core/utils.js';
import * as storage from './core/storage.js';
import { getUnreadCount, startPolling } from './core/notifications.js';

const navbarTarget = document.getElementById('site-navbar');
const footerTarget = document.getElementById('site-footer');

function renderNavbar(user, cartCount = 0) {
  if (!navbarTarget) return;

  navbarTarget.innerHTML = `
    <nav class="nav container">
      <a class="logo" href="/index.html">CampusCart</a>
      <div class="nav-actions">
        <a href="/index.html">Products</a>
        <a href="/wishlist.html">Wishlist</a>
        <a href="/cart.html" class="cart-link">
          Cart <span id="cartCount" class="cart-badge">${cartCount}</span>
        </a>
        ${
          user
            ? `
          <a href="/orders/my_orders.html">My Orders</a>
          <a href="/reviews/my_reviews.html" class="highlighted-link">My Reviews</a>
          <a href="/seller/dashboard.html">Seller Dashboard</a>
          <a id="notifBell" href="/notifications.html" class="notif-bell" aria-label="Notifications">
            🔔 <span id="notifCount" class="notif-badge" aria-hidden="true">0</span>
          </a>
          <span class="nav-user">Hi, ${escapeHtml(
            user.name || user.email
          )}</span>
          <button id="logoutBtn" class="btn btn-ghost">Logout</button>
        `
            : `<a href="/login.html">Login</a>`
        }
      </div>
    </nav>
  `;

  // basic styles for new bell & highlighted link
  const styleId = 'main-navbar-inline-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .nav-actions a.highlighted-link { color: var(--primary-color); font-weight:600; }
      .nav-actions a.highlighted-link:hover { color: var(--accent-color); text-decoration:underline; }
      .notif-bell { display:inline-flex; align-items:center; gap:6px; text-decoration:none; margin-left:8px; position:relative; }
      .notif-badge {
        background:#ef4444; color:#fff; font-weight:700; font-size:0.75rem; padding:0 6px; border-radius:999px;
        margin-left:6px; min-width:20px; text-align:center; display:inline-block;
      }
      .nav-user { margin-left:12px; font-weight:600; color:#111827; }
    `;
    document.head.appendChild(style);
  }

  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', () => {
    storage.clearTokens();
    showAlert('Logged out successfully.', 'info');
    renderNavbar(null, 0);
    window.location.href = '/login.html';
  });

  // wire notification bell update (if user)
  if (user) {
    const bell = document.getElementById('notifBell');
    bell?.addEventListener('click', () => {
      // navigation handled by <a href>, but we could mark read on open
    });

    // Listen to poll events
    window.addEventListener('notifCountUpdated', (e) => {
      const count = e?.detail?.count ?? 0;
      const el = document.getElementById('notifCount');
      if (el) el.textContent = count > 0 ? String(count) : '';
      if (el) el.style.display = count > 0 ? 'inline-block' : 'none';
    });

    // start polling notifications
    startPolling(20000);
  }
}

async function loadUserAndCart() {
  let user = null;
  try {
    user = await api.get('/users/me/');
  } catch (err) {
    user = null;
  }

  let cartCount = 0;
  try {
    const cart = await api.get('/cart/');
    cartCount = cart?.total_items ?? 0;
  } catch (e) {
    cartCount = 0;
  }

  renderNavbar(user, cartCount);

  // Push an immediate notif count update (for logged in users)
  if (user) {
    try {
      const unread = await getUnreadCount();
      window.dispatchEvent(
        new CustomEvent('notifCountUpdated', { detail: { count: unread } })
      );
    } catch (e) {
      // ignore
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadUserAndCart();
});

window.addEventListener('updateCartCount', async () => {
  try {
    const cart = await api.get('/cart/');
    const cnt = cart?.total_items ?? 0;
    const badge = document.getElementById('cartCount');
    if (badge) badge.textContent = cnt;
  } catch (err) {
    const badge = document.getElementById('cartCount');
    if (badge) badge.textContent = '0';
  }
});

window.addEventListener('cartUpdated', () => {
  window.dispatchEvent(new CustomEvent('updateCartCount'));
});

function escapeHtml(s) {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
