import { api } from './core/api.js';
import { showAlert } from './core/utils.js';

const checkoutSummary = document.getElementById('checkoutSummary');
const placeOrderBtn = document.getElementById('placeOrderBtn');
let cartData = null;

document.addEventListener('DOMContentLoaded', () => {
  loadCheckoutSummary();
  placeOrderBtn?.addEventListener('click', placeOrder);

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('cancel') === 'true') {
    showAlert('Payment cancelled. You can try again.', 'error');
  }
});

async function loadCheckoutSummary() {
  try {
    const cart = await api.get('/cart/');
    cartData = cart;
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
  } catch {
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
  placeOrderBtn.textContent = 'Processing...';

  // Save total before cart gets cleared
  const totalPrice = parseFloat(cartData?.total_price || 0);

  try {
    // API returns LIST of orders (one per seller)
    const orders = await api.post('/orders/create/', {
      address,
      payment_method: payment,
    });

    // Get first order ID (most common case — single seller)
    const orderList = Array.isArray(orders) ? orders : [orders];
    const firstOrder = orderList[0];
    const orderId = firstOrder?.id;

    if (payment === 'card') {
      placeOrderBtn.textContent = 'Redirecting to Stripe...';

      // Amount in paise (INR smallest unit)
      const amountInPaise = Math.round(totalPrice * 100);

      const stripeRes = await api.post('/payments/create-checkout-session/', {
        order_id: orderId,
        amount: amountInPaise,
        product_name: `CampusCart Order #${orderId}`,
      });

      if (stripeRes?.url) {
        window.location.href = stripeRes.url;
      } else {
        showAlert('Payment initiation failed. Order placed as COD.', 'error');
        setTimeout(() => window.location.href = '/orders/my_orders.html', 1500);
      }
    } else {
      showAlert('Order placed successfully!', 'success');
      setTimeout(() => window.location.href = '/orders/my_orders.html', 1000);
    }

  } catch (err) {
    showAlert(err?.data?.detail || 'Failed to place order.', 'error');
    placeOrderBtn.disabled = false;
    placeOrderBtn.textContent = 'Place Order →';
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
