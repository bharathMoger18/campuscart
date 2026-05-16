import { api } from './core/api.js';
import { showAlert } from './core/utils.js';

const checkoutSummary = document.getElementById('checkoutSummary');
const placeOrderBtn = document.getElementById('placeOrderBtn');

document.addEventListener('DOMContentLoaded', () => {
  loadCheckoutSummary();
  placeOrderBtn?.addEventListener('click', placeOrder);
});

async function loadCheckoutSummary() {
  try {
    const cart = await api.get('/cart/');
    if (!cart.items?.length) {
      checkoutSummary.innerHTML = `<div class="empty">Your cart is empty.</div>`;
      if (placeOrderBtn) placeOrderBtn.disabled = true;
      return;
    }
    const itemsHtml = cart.items.map(it => `
      <div class="checkout-item">
        <img src="${it.product.image || '/assets/images/placeholder.png'}" alt="${escapeHtml(it.product.title)}" />
        <div class="checkout-item-info">
          <strong>${escapeHtml(it.product.title)}</strong>
          <span>Qty: ${it.quantity}</span>
        </div>
        <div class="checkout-item-price">&#8377;${it.total_price}</div>
      </div>
    `).join('');

    checkoutSummary.innerHTML = `
      ${itemsHtml}
      <div class="checkout-total-row">
        <span>Total (${cart.total_items} items)</span>
        <span>&#8377;${cart.total_price}</span>
      </div>
    `;
  } catch (err) {
    checkoutSummary.innerHTML = `<div class="empty">Unable to load summary.</div>`;
  }
}

async function placeOrder() {
  const address = document.getElementById('address').value.trim();
  const payment = document.querySelector('input[name=payment]:checked')?.value || 'cod';

  if (!address) {
    showAlert('Please enter your shipping address.', 'error');
    return;
  }

  placeOrderBtn.disabled = true;
  placeOrderBtn.textContent = 'Placing Order...';

  try {
    await api.post('/orders/create/', { address, payment_method: payment });
    showAlert('Order placed successfully!', 'success');
    setTimeout(() => window.location.href = '/orders/my_orders.html', 1000);
  } catch (err) {
    showAlert(err?.data?.detail || 'Failed to place order.', 'error');
  } finally {
    placeOrderBtn.disabled = false;
    placeOrderBtn.textContent = 'Place Order →';
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
