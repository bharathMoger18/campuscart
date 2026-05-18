import { api } from './core/api.js';
import { showAlert } from './core/utils.js';
import * as storage from './core/storage.js';

const container = document.getElementById('productDetail');
const reviewsList = document.getElementById('reviewsList');

document.addEventListener('DOMContentLoaded', run);

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function run() {
  const id = getQueryParam('id') || getQueryParam('product');
  if (!id) { container.innerHTML = '<div class="empty">Product ID missing.</div>'; return; }
  try {
    const product = await api.get(`/products/${encodeURIComponent(id)}/`);
    console.log('Product loaded', product);
    renderProduct(product);
    renderReviews(product.reviews ?? []);
  } catch (err) {
    container.innerHTML = '<div class="empty">Failed to load product.</div>';
    showAlert('Failed to load product.', 'error');
  }
}

function renderProduct(p) {
  const imageSrc = p.image || '../assets/images/placeholder.png';
  container.innerHTML = `
    <div class="product-detail-grid">
      <div class="media-col">
        <img src="${imageSrc}" alt="${escapeHtml(p.title)}" />
      </div>
      <div class="info-col">
        <h1>${escapeHtml(p.title)}</h1>
        <div class="detail-meta">
          <div class="detail-price">&#8377;${p.price}</div>
          <div class="detail-rating">&#11088; ${p.average_rating ?? 0} (${p.total_reviews ?? 0})</div>
          <div class="detail-category">${escapeHtml(p.category ?? '')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.25rem;font-size:.85rem;color:var(--text-3)">
          &#128100; Sold by <span style="color:var(--primary-light);font-weight:600;margin-left:.25rem">${escapeHtml(p.owner_email ?? 'Unknown')}</span>
        </div>
        <div class="detail-divider"></div>
        <div class="detail-description">
          <h3>Description</h3>
          <p>${escapeHtml(p.description ?? 'No description available.')}</p>
        </div>
        <div class="purchase-block">
          <label for="qtyInput">Quantity</label>
          <div class="purchase-row">
            <input id="qtyInput" type="number" min="1" value="1" />
            <button id="addToCartBtn" class="btn btn-primary btn-cart">&#128722; Add to Cart</button>
          </div>
          <button id="wishlistBtn" class="btn-chat" style="margin-top:.5rem">❤️ Add to Wishlist</button>
          <button id="chatSellerBtn" class="btn-chat" style="margin-top:.5rem">💬 Chat with Seller</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('addToCartBtn')?.addEventListener('click', async () => {
    const qty = Math.max(1, parseInt(document.getElementById('qtyInput').value || '1', 10));
    await addToCart(p.id, qty);
  });
  document.getElementById('chatSellerBtn')?.addEventListener('click', () => startChatWithSeller(p));
}

async function startChatWithSeller(product) {
  if (!storage.getAccess()) {
    showAlert('Please log in to chat with the seller.', 'error');
    setTimeout(() => (window.location.href = '/login.html'), 1000);
    return;
  }
  try {
    const me = await api.get('/users/me/');
    if (product.owner_email && product.owner_email === me.email) {
      showAlert('You are the seller of this product.', 'info');
      return;
    }
    const sellerId = product.owner_id;
    if (!sellerId) { showAlert('Seller information missing.', 'error'); return; }
    const conv = await api.post('/conversations/', { product: product.id, other_user: sellerId });
    if (conv?.id) window.location.href = `/chat.html?conversation=${conv.id}`;
    else showAlert('Failed to start chat.', 'error');
  } catch (err) {
    showAlert(err?.data?.detail || 'Could not start chat.', 'error');
  }
}

async function renderReviews(reviews) {
  if (!reviews || reviews.length === 0) {
    reviewsList.innerHTML = '<div class="empty">No reviews yet. Be the first to review!</div>';
    return;
  }
  const userCache = {};
  async function getUserName(userId, userEmail) {
    if (!userId) return userEmail ?? 'Anonymous';
    if (userCache[userId]) return userCache[userId];
    try {
      const u = await api.get(`/users/public/${userId}/`);
      const name = u?.name?.trim() || userEmail || 'Anonymous';
      userCache[userId] = name;
      return name;
    } catch { return userEmail ?? 'Anonymous'; }
  }
  const frag = document.createDocumentFragment();
  for (const r of reviews) {
    const item = document.createElement('div');
    item.className = 'review-item fade-in';
    item.innerHTML = `
      <div class="review-head">
        <strong>Loading...</strong>
        <span class="rating">&#11088; ${r.rating ?? 0}/5</span>
      </div>
      <div class="review-body">${escapeHtml(r.comment ?? r.text ?? '')}</div>
    `;
    frag.appendChild(item);
    getUserName(r.user, r.user_email).then(name => {
      item.querySelector('strong').textContent = name;
    });
  }
  reviewsList.innerHTML = '';
  reviewsList.appendChild(frag);
}

async function addToCart(productId, quantity = 1) {
  if (!storage.getAccess()) {
    showAlert('Please log in to add items to cart.', 'error');
    setTimeout(() => (window.location.href = '/login.html'), 1000);
    return;
  }
  try {
    const res = await api.post('/cart/add/', { product_id: productId, quantity });
    showAlert(res?.detail || 'Product added to cart!', 'success');
    window.dispatchEvent(new CustomEvent('cartUpdated'));
  } catch (err) {
    showAlert(err?.data?.detail || 'Could not add to cart.', 'error');
  }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// Wishlist button handler - attached after renderProduct
document.addEventListener('click', async (e) => {
  if (e.target.id === 'wishlistBtn') {
    try {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'Adding...';
      const productId = new URLSearchParams(location.search).get('id');
      await api.post('/wishlist/add/', { product_id: productId });
      showAlert('Added to wishlist!', 'success');
      btn.textContent = '❤️ Added to Wishlist';
    } catch (err) {
      showAlert(err?.data?.message || 'Could not add to wishlist.', 'error');
      e.target.disabled = false;
      e.target.textContent = '❤️ Add to Wishlist';
    }
  }
});
