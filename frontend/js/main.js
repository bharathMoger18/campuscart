import { api } from './core/api.js';
import { showAlert } from './core/utils.js';
import * as storage from './core/storage.js';
import { getUnreadCount, startPolling } from './core/notifications.js';

const navbarTarget = document.getElementById('site-navbar');

function renderNavbar(user, cartCount = 0) {
  if (!navbarTarget) return;

  navbarTarget.innerHTML = `
    <nav class="nav container">
      <a class="logo" href="/index.html">CampusCart</a>

      <button class="nav-toggle" id="navToggle" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>

      <div class="nav-actions" id="navActions">
        <a href="/index.html">Products</a>
        <a href="/wishlist.html">Wishlist</a>
        <a href="/cart.html">
          Cart <span id="cartCount" class="cart-badge">${cartCount}</span>
        </a>
        ${user ? `
          <a href="/orders/my_orders.html">My Orders</a>
          <a href="/reviews/my_reviews.html">My Reviews</a>
          <a href="/seller/dashboard.html">Seller</a>
          <a id="notifBell" href="/notifications.html" class="notif-bell">
            🔔<span id="notifCount" class="notif-badge" style="display:none">0</span>
          </a>
          <a href="/me.html" class="nav-user" style="text-decoration:none">Hi, ${escapeHtml(user.name || user.email)}</a>
          <button id="logoutBtn" class="btn btn-ghost" style="padding:0.4rem 0.9rem;font-size:0.85rem">Logout</button>
        ` : `
          <a href="/login.html" class="btn btn-primary" style="padding:0.4rem 1rem;font-size:0.85rem">Login</a>
        `}
      </div>
    </nav>
  `;

  /* ── Inject navbar styles once ── */
  if (!document.getElementById('navbar-styles')) {
    const s = document.createElement('style');
    s.id = 'navbar-styles';
    s.textContent = `
      #site-navbar {
        background: rgba(15,15,19,0.9);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-bottom: 1px solid rgba(255,255,255,0.07);
        position: sticky;
        top: 0;
        z-index: 100;
      }
      .nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.9rem 0;
        gap: 1rem;
      }
      .logo {
        font-family: 'Syne', sans-serif;
        font-weight: 800;
        font-size: 1.3rem;
        letter-spacing: -0.03em;
        background: linear-gradient(135deg, #f0f0f5, #8b85ff);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        text-decoration: none;
        flex-shrink: 0;
      }
      .nav-actions {
        display: flex;
        align-items: center;
        gap: 0.15rem;
        flex-wrap: wrap;
      }
      .nav-actions a {
        color: #a0a0b8;
        font-size: 0.88rem;
        font-weight: 500;
        padding: 0.4rem 0.7rem;
        border-radius: 8px;
        transition: all 0.2s;
        text-decoration: none;
        white-space: nowrap;
      }
      .nav-actions a:hover {
        color: #f0f0f5;
        background: rgba(255,255,255,0.06);
      }
      .cart-badge {
        background: #6c63ff;
        color: #fff;
        padding: 0.1rem 0.4rem;
        border-radius: 999px;
        margin-left: 0.25rem;
        font-weight: 700;
        font-size: 0.72rem;
      }
      .notif-bell {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        position: relative;
      }
      .notif-badge {
        background: #ef4444;
        color: #fff;
        font-weight: 700;
        font-size: 0.72rem;
        padding: 0 5px;
        border-radius: 999px;
        min-width: 18px;
        text-align: center;
      }
      .nav-user {
        font-size: 0.85rem;
        font-weight: 600;
        color: #a0a0b8;
        padding: 0 0.5rem;
        white-space: nowrap;
      }

      /* Hamburger */
      .nav-toggle {
        display: none;
        flex-direction: column;
        gap: 5px;
        background: none;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: 0.5rem 0.6rem;
        cursor: pointer;
        flex-shrink: 0;
      }
      .nav-toggle span {
        display: block;
        width: 20px;
        height: 2px;
        background: #a0a0b8;
        border-radius: 2px;
        transition: all 0.2s;
      }

      @media (max-width: 900px) {
        .nav-toggle { display: flex; }
        .nav-actions {
          display: none;
          position: absolute;
          top: 100%;
          left: 0; right: 0;
          background: #16161d;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          padding: 0.75rem 1.5rem 1rem;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.1rem;
          z-index: 99;
        }
        .nav-actions.open { display: flex; }
        .nav-actions a {
          width: 100%;
          padding: 0.65rem 0.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          border-radius: 0;
        }
        .nav-actions a:last-child { border-bottom: none; }
        .nav-user { padding: 0.65rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05); width: 100%; }
        #site-navbar { position: relative; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Hamburger toggle ── */
  document.getElementById('navToggle')?.addEventListener('click', () => {
    document.getElementById('navActions')?.classList.toggle('open');
  });

  /* ── Logout ── */
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    storage.clearTokens();
    showAlert('Logged out successfully.', 'info');
    window.location.href = '/login.html';
  });

  /* ── Notifications ── */
  if (user) {
    window.addEventListener('notifCountUpdated', (e) => {
      const count = e?.detail?.count ?? 0;
      const el = document.getElementById('notifCount');
      if (el) {
        el.textContent = count > 0 ? String(count) : '';
        el.style.display = count > 0 ? 'inline-block' : 'none';
      }
    });
    startPolling(20000);
  }

  /* ── Footer ── */
  const footer = document.getElementById('site-footer');
  if (footer && !footer.innerHTML.trim()) {
    footer.innerHTML = `
      <div style="text-align:center;padding:1.5rem;color:#606078;font-size:0.82rem;border-top:1px solid rgba(255,255,255,0.07)">
        © 2026 CampusCart — Built for students, by students.
      </div>`;
  }
}

async function loadUserAndCart() {
  let user = null;
  try { user = await api.get('/users/me/'); } catch { user = null; }

  let cartCount = 0;
  try {
    const cart = await api.get('/cart/');
    cartCount = cart?.total_items ?? 0;
  } catch { cartCount = 0; }

  renderNavbar(user, cartCount);

  if (user) {
    try {
      const unread = await getUnreadCount();
      window.dispatchEvent(new CustomEvent('notifCountUpdated', { detail: { count: unread } }));
    } catch { /* ignore */ }
  }
}

document.addEventListener('DOMContentLoaded', () => { loadUserAndCart(); });

window.addEventListener('updateCartCount', async () => {
  try {
    const cart = await api.get('/cart/');
    const cnt = cart?.total_items ?? 0;
    const badge = document.getElementById('cartCount');
    if (badge) badge.textContent = cnt;
  } catch {
    const badge = document.getElementById('cartCount');
    if (badge) badge.textContent = '0';
  }
});

window.addEventListener('cartUpdated', () => {
  window.dispatchEvent(new CustomEvent('updateCartCount'));
});

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
