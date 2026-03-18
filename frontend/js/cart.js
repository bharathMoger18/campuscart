// js/cart.js
import { api } from './core/api.js';
import { showAlert } from './core/utils.js';
import * as storage from './core/storage.js';

const cartContainer = document.getElementById('cartContainer');
const clearCartBtn = document.getElementById('clearCartBtn');
const checkoutBtn = document.getElementById('checkoutBtn');

document.addEventListener('DOMContentLoaded', () => {
  loadCart();

  clearCartBtn?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear the cart?')) return;
    await clearCart();
  });

  checkoutBtn?.addEventListener('click', () => {
    // Navigate to checkout page
    window.location.href = '/orders/checkout.html';
  });

  // React to global cartUpdated event (triggered after add/remove)
  window.addEventListener('cartUpdated', () => {
    loadCart(false);
    window.dispatchEvent(new CustomEvent('updateCartCount'));
  });
});

async function loadCart(showLoader = true) {
  if (showLoader) {
    cartContainer.innerHTML = `<div class="loader">Loading cart...</div>`;
  }

  try {
    const data = await api.get('/cart/');
    renderCart(data);
  } catch (err) {
    console.error('Cart load error', err);
    cartContainer.innerHTML = `<div class="empty">Unable to load cart.</div>`;
    showAlert('Unable to load cart. Please try again.', 'error');
    if (checkoutBtn) checkoutBtn.disabled = true;
  }
}

function renderCart(cart) {
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    cartContainer.innerHTML = `<div class="empty">Your cart is empty.</div>`;
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  const table = document.createElement('div');
  table.className = 'cart-table';

  // header row
  const header = document.createElement('div');
  header.className = 'cart-row cart-header';
  header.innerHTML = `
    <div>Product</div>
    <div>Price</div>
    <div>Qty</div>
    <div>Total</div>
    <div>Action</div>
  `;
  table.appendChild(header);

  // rows
  cart.items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'cart-row';
    const imageUrl = it.product.image
      ? `http://localhost:8000/media/${it.product.image.replace(
          /^\/?media\//,
          ''
        )}`
      : '/assets/images/noimg.png';

    const safeTitle = escapeHtml(it.product.title);

    row.innerHTML = `
      <div class="cart-product">
        <img src="${imageUrl}" alt="${safeTitle}" />
        <div class="cart-product-title">${safeTitle}</div>
      </div>
      <div class="cart-price">₹${it.product.price}</div>
      <div class="cart-qty">
        <button class="qty-decrease btn-ghost" data-product="${it.product.id}">−</button>
        <span>${it.quantity}</span>
        <button class="qty-increase btn-ghost" data-product="${it.product.id}">+</button>
      </div>
      <div class="cart-total">₹${it.total_price}</div>
      <div>
        <button class="btn btn-danger remove-item" data-product="${it.product.id}">Remove</button>
      </div>
    `;
    table.appendChild(row);
  });

  // summary
  const summary = document.createElement('div');
  summary.className = 'cart-summary';
  summary.innerHTML = `
    <div>Total Items: <strong>${cart.total_items}</strong></div>
    <div>Total Price: <strong>₹${cart.total_price}</strong></div>
  `;

  // render
  cartContainer.innerHTML = '';
  cartContainer.appendChild(table);
  cartContainer.appendChild(summary);

  // attach handlers
  attachCartActions();
  if (checkoutBtn) checkoutBtn.disabled = false;
}

function attachCartActions() {
  cartContainer.querySelectorAll('.remove-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.product;
      btn.disabled = true;
      await removeItem(pid);
    });
  });

  cartContainer.querySelectorAll('.qty-increase').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.product;
      btn.disabled = true;
      await changeQuantity(pid, 'increase');
    });
  });

  cartContainer.querySelectorAll('.qty-decrease').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.product;
      btn.disabled = true;
      await changeQuantity(pid, 'decrease');
    });
  });
}

async function removeItem(productId) {
  try {
    const res = await api.post('/cart/remove/', { product_id: productId });
    showAlert(res?.detail || 'Item removed from cart.', 'success');
    loadCart(false);
    window.dispatchEvent(new CustomEvent('updateCartCount'));
  } catch (err) {
    console.error('Remove error', err);
    showAlert('Unable to remove item. Try again.', 'error');
  }
}

async function clearCart() {
  try {
    const res = await api.post('/cart/clear/', {});
    showAlert(res?.detail || 'Cart cleared successfully.', 'success');
    loadCart(false);
    window.dispatchEvent(new CustomEvent('updateCartCount'));
  } catch (err) {
    console.error('Clear cart error', err);
    showAlert('Unable to clear cart.', 'error');
  }
}

async function changeQuantity(productId, action) {
  try {
    if (action === 'increase') {
      await api.post('/cart/add/', { product_id: productId, quantity: 1 });
    } else {
      await api.post('/cart/remove/', { product_id: productId });
    }
    loadCart(false);
    window.dispatchEvent(new CustomEvent('updateCartCount'));
  } catch (err) {
    console.error('Change qty error', err);
    showAlert('Unable to update quantity.', 'error');
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
