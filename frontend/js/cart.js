import { api } from './core/api.js';
import { showAlert } from './core/utils.js';

const cartContainer = document.getElementById('cartContainer');
const clearCartBtn = document.getElementById('clearCartBtn');
const checkoutBtn = document.getElementById('checkoutBtn');

document.addEventListener('DOMContentLoaded', () => {
  loadCart();
  clearCartBtn?.addEventListener('click', async () => {
    if (!confirm('Clear all items from cart?')) return;
    await clearCart();
  });
  checkoutBtn?.addEventListener('click', () => {
    window.location.href = '/orders/checkout.html';
  });
  window.addEventListener('cartUpdated', () => {
    loadCart(false);
    window.dispatchEvent(new CustomEvent('updateCartCount'));
  });
});

async function loadCart(showLoader = true) {
  if (showLoader) cartContainer.innerHTML = `<div class="loader">Loading cart...</div>`;
  try {
    const data = await api.get('/cart/');
    renderCart(data);
  } catch (err) {
    cartContainer.innerHTML = `<div class="empty">Unable to load cart.</div>`;
    showAlert('Unable to load cart.', 'error');
    if (checkoutBtn) checkoutBtn.disabled = true;
  }
}

function renderCart(cart) {
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    cartContainer.innerHTML = `
      <div class="empty-cart">
        <div class="empty-icon">🛒</div>
        <h2>Your cart is empty</h2>
        <p>Add some products to get started</p>
        <a href="/index.html" class="btn btn-primary">Browse Products</a>
      </div>`;
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  const table = document.createElement('div');
  table.className = 'cart-table';

  const header = document.createElement('div');
  header.className = 'cart-row cart-header';
  header.innerHTML = `<div>Product</div><div>Price</div><div>Quantity</div><div>Total</div><div>Action</div>`;
  table.appendChild(header);

  cart.items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'cart-row';
    const imageUrl = it.product.image || '/assets/images/placeholder.png';
    const safeTitle = escapeHtml(it.product.title);
    row.innerHTML = `
      <div class="cart-product">
        <img src="${imageUrl}" alt="${safeTitle}" />
        <div class="cart-product-title">${safeTitle}</div>
      </div>
      <div class="cart-price">&#8377;${it.product.price}</div>
      <div class="cart-qty">
        <button class="qty-btn qty-decrease" data-product="${it.product.id}">&#8722;</button>
        <span>${it.quantity}</span>
        <button class="qty-btn qty-increase" data-product="${it.product.id}">&#43;</button>
      </div>
      <div class="cart-total">&#8377;${it.total_price}</div>
      <div>
        <button class="btn-remove remove-item" data-product="${it.product.id}">Remove</button>
      </div>
    `;
    table.appendChild(row);
  });

  const summary = document.createElement('div');
  summary.className = 'cart-summary-box';
  summary.innerHTML = `
    <div class="summary-row"><span>Items</span><span>${cart.total_items}</span></div>
    <div class="summary-row total"><span>Total</span><span>&#8377;${cart.total_price}</span></div>
  `;

  cartContainer.innerHTML = '';
  cartContainer.appendChild(table);
  cartContainer.appendChild(summary);
  attachCartActions();
  if (checkoutBtn) checkoutBtn.disabled = false;
}

function attachCartActions() {
  cartContainer.querySelectorAll('.remove-item').forEach(btn => {
    btn.addEventListener('click', async () => { btn.disabled = true; await removeItem(btn.dataset.product); });
  });
  cartContainer.querySelectorAll('.qty-increase').forEach(btn => {
    btn.addEventListener('click', async () => { btn.disabled = true; await changeQuantity(btn.dataset.product, 'increase'); });
  });
  cartContainer.querySelectorAll('.qty-decrease').forEach(btn => {
    btn.addEventListener('click', async () => { btn.disabled = true; await changeQuantity(btn.dataset.product, 'decrease'); });
  });
}

async function removeItem(productId) {
  try {
    const res = await api.post('/cart/remove/', { product_id: productId });
    showAlert(res?.detail || 'Item removed.', 'success');
    loadCart(false);
    window.dispatchEvent(new CustomEvent('updateCartCount'));
  } catch { showAlert('Unable to remove item.', 'error'); }
}

async function clearCart() {
  try {
    const res = await api.post('/cart/clear/', {});
    showAlert(res?.detail || 'Cart cleared.', 'success');
    loadCart(false);
    window.dispatchEvent(new CustomEvent('updateCartCount'));
  } catch { showAlert('Unable to clear cart.', 'error'); }
}

async function changeQuantity(productId, action) {
  try {
    if (action === 'increase') await api.post('/cart/add/', { product_id: productId, quantity: 1 });
    else await api.post('/cart/remove/', { product_id: productId });
    loadCart(false);
    window.dispatchEvent(new CustomEvent('updateCartCount'));
  } catch { showAlert('Unable to update quantity.', 'error'); }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
