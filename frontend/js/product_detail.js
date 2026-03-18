// js/product_detail.js
import { api } from './core/api.js';
import { showAlert } from './core/utils.js';
import * as storage from './core/storage.js';

const container = document.getElementById('productDetail');
const reviewsList = document.getElementById('reviewsList');

document.addEventListener('DOMContentLoaded', run);

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function run() {
  const id = getQueryParam('id') || getQueryParam('product');
  if (!id) {
    container.innerHTML =
      '<div class="empty">Product ID is missing in URL</div>';
    return;
  }

  try {
    const product = await api.get(`/products/${encodeURIComponent(id)}/`);
    console.log('✅ Product loaded', product);
    renderProduct(product);
    renderReviews(product.reviews ?? []);
  } catch (err) {
    console.error('Product load error', err);
    container.innerHTML = '<div class="empty">Failed to load product.</div>';
    showAlert('❌ Failed to load product.', 'error');
  }
}

function renderProduct(p) {
  const imageSrc = p.image
    ? p.image.startsWith('http')
      ? p.image
      : `http://127.0.0.1:8000${p.image}`
    : '/assets/images/placeholder.png';

  container.innerHTML = `
    <div class="product-detail-grid">
      <div class="media-col">
        <img src="${imageSrc}" alt="${escapeHtml(p.title)}" />
      </div>

      <div class="info-col">
        <h1>${escapeHtml(p.title)}</h1>
        <div class="meta">
          <div class="price">₹${p.price}</div>
          <div class="rating">⭐ ${p.average_rating ?? 0} (${
    p.total_reviews ?? 0
  })</div>
          <div class="category">Category: ${escapeHtml(p.category ?? '')}</div>
        </div>

        <div class="description">
          <h3>Description</h3>
          <p>${escapeHtml(p.description ?? '')}</p>
        </div>

        <div class="purchase">
          <label for="qtyInput">Quantity</label>
          <input id="qtyInput" type="number" min="1" value="1" />
          <button id="addToCartBtn" class="btn btn-primary">Add to Cart</button>
          <button id="chatSellerBtn" class="btn btn-outline" style="margin-left:8px;">
            💬 Chat with Seller
          </button>
        </div>
      </div>
    </div>
  `;

  document
    .getElementById('addToCartBtn')
    ?.addEventListener('click', async () => {
      const qty = Math.max(
        1,
        parseInt(document.getElementById('qtyInput').value || '1', 10)
      );
      await addToCart(p.id, qty);
    });

  document
    .getElementById('chatSellerBtn')
    ?.addEventListener('click', () => startChatWithSeller(p));
}

// 🧩 Start Chat Helper — FIXED
async function startChatWithSeller(product) {
  if (!storage.getAccess()) {
    showAlert('⚠️ Please log in to start a chat with the seller.', 'error');
    setTimeout(() => (window.location.href = '/login.html'), 1000);
    return;
  }

  try {
    const me = await api.get('/users/me/');
    if (!me || !me.id) {
      showAlert('⚠️ Could not identify logged-in user.', 'error');
      return;
    }

    if (product.owner_email && product.owner_email === me.email) {
      showAlert('You are the seller of this product.', 'info');
      return;
    }

    // Use owner ID directly
    const sellerId = product.owner_id;
    if (!sellerId) {
      showAlert('Seller information is missing.', 'error');
      return;
    }

    const conv = await api.post('/conversations/', {
      product: product.id,
      other_user: sellerId,
    });

    if (conv?.id) {
      window.location.href = `/chat.html?conversation=${conv.id}`;
    } else {
      showAlert('Failed to start chat.', 'error');
    }
  } catch (err) {
    console.error('Chat init error:', err);
    showAlert(err?.data?.detail || '❌ Could not start chat.', 'error');
  }
}

async function renderReviews(reviews) {
  if (!reviews || reviews.length === 0) {
    reviewsList.innerHTML = '<div class="empty">No reviews yet.</div>';
    return;
  }

  // 🔹 Cache to avoid calling same user multiple times
  const userCache = {};

  // Helper to get user name from ID
  async function getUserName(userId, userEmail) {
    if (!userId) return userEmail ?? 'Anonymous';
    if (userCache[userId]) return userCache[userId];

    try {
      const userData = await api.get(`/users/public/${userId}/`);
      const name = userData?.name?.trim() || userEmail || 'Anonymous';
      userCache[userId] = name;
      return name;
    } catch (err) {
      console.warn(`Could not load user ${userId}`, err);
      return userEmail ?? 'Anonymous';
    }
  }

  // 🔹 Build all review DOM elements
  const frag = document.createDocumentFragment();
  for (const r of reviews) {
    const item = document.createElement('div');
    item.className = 'review-item';

    // temporary loading text
    item.innerHTML = `
      <div class="review-head">
        <strong>Loading...</strong>
        <span class="rating">⭐ ${r.rating ?? 0}</span>
      </div>
      <div class="review-body">${escapeHtml(r.comment ?? r.text ?? '')}</div>
    `;
    frag.appendChild(item);

    // fetch name async
    getUserName(r.user, r.user_email).then((name) => {
      item.querySelector('strong').textContent = name;
    });
  }

  reviewsList.innerHTML = '';
  reviewsList.appendChild(frag);
}

async function addToCart(productId, quantity = 1) {
  if (!storage.getAccess()) {
    showAlert('⚠️ Please log in to add items to your cart.', 'error');
    setTimeout(() => (window.location.href = '/login.html'), 1000);
    return;
  }

  try {
    const res = await api.post('/cart/add/', {
      product_id: productId,
      quantity,
    });
    showAlert(res?.detail || '✅ Product added to cart!', 'success');
    window.dispatchEvent(new CustomEvent('cartUpdated'));
  } catch (err) {
    console.error('Add to cart error', err);
    const msg = err?.data?.detail || err?.data || '❌ Could not add to cart';
    showAlert(msg, 'error');
  }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  s = String(s); // ensures numbers, booleans, etc become strings
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
