import { api } from './core/api.js';
import { showAlert } from './core/utils.js';

const container = document.getElementById('wishlistContainer');
const clearBtn = document.getElementById('clearWishlistBtn');

document.addEventListener('DOMContentLoaded', () => {
  loadWishlist();
  clearBtn?.addEventListener('click', async () => {
    if (!confirm('Clear all items from wishlist?')) return;
    try {
      await api.post('/wishlist/clear/', {});
      showAlert('Wishlist cleared.', 'success');
      loadWishlist();
    } catch { showAlert('Failed to clear wishlist.', 'error'); }
  });
});

async function loadWishlist() {
  container.innerHTML = `<div class="loading">Loading wishlist...</div>`;
  try {
    const data = await api.get('/wishlist/');
    const items = data.items || [];
    renderWishlist(items);
  } catch {
    container.innerHTML = `<div class="empty">Failed to load wishlist.</div>`;
  }
}

function renderWishlist(items) {
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-wishlist">
        <div class="empty-icon">❤️</div>
        <h2>Your wishlist is empty</h2>
        <p>Save products you love and buy them later</p>
        <a href="/index.html" class="btn btn-primary">Browse Products</a>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="wishlist-grid">${items.map(item => {
    const p = item.product;
    const img = p.image || '/assets/images/placeholder.png';
    return `
      <div class="wishlist-card" data-id="${p.id}">
        <img src="${img}" alt="${escapeHtml(p.title)}" onerror="this.src='/assets/images/placeholder.png'" />
        <div class="wishlist-card-body">
          <div class="wishlist-card-title">${escapeHtml(p.title)}</div>
          <div class="wishlist-card-category">${escapeHtml(p.category || '')}</div>
          <div class="wishlist-card-price">&#8377;${p.price}</div>
        </div>
        <div class="wishlist-card-actions">
          <button class="btn-move" data-id="${p.id}">🛒 Move to Cart</button>
          <button class="btn-remove-wish" data-id="${p.id}">🗑️ Remove</button>
        </div>
      </div>`;
  }).join('')}</div>`;

  // Move to cart
  container.querySelectorAll('.btn-move').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Moving...';
      try {
        await api.post('/wishlist/move-to-cart/', { product_id: btn.dataset.id });
        showAlert('Moved to cart!', 'success');
        window.dispatchEvent(new CustomEvent('cartUpdated'));
        loadWishlist();
      } catch { showAlert('Failed to move to cart.', 'error'); btn.disabled = false; btn.textContent = '🛒 Move to Cart'; }
    });
  });

  // Remove
  container.querySelectorAll('.btn-remove-wish').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.post('/wishlist/remove/', { product_id: btn.dataset.id });
        showAlert('Removed from wishlist.', 'success');
        loadWishlist();
      } catch { showAlert('Failed to remove.', 'error'); btn.disabled = false; }
    });
  });
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
