import { api } from './core/api.js';
import { showAlert } from './core/utils.js';

const checkoutSummary = document.getElementById('checkoutSummary');
const placeOrderBtn = document.getElementById('placeOrderBtn');

document.addEventListener('DOMContentLoaded', () => {
  loadCheckoutSummary();

  placeOrderBtn?.addEventListener('click', async () => {
    await placeOrder();
  });
});

async function loadCheckoutSummary() {
  try {
    const cart = await api.get('/cart/');
    if (!cart.items?.length) {
      checkoutSummary.innerHTML = `<div class="empty">Your cart is empty.</div>`;
      placeOrderBtn.disabled = true;
      return;
    }

    const html = cart.items
      .map(
        (it) => `
        <div class="checkout-item">
          <img src="${it.product.image || '/assets/images/noimg.png'}" alt="${
          it.product.title
        }">
          <div class="checkout-item-info">
            <strong>${it.product.title}</strong>
            <span>Qty: ${it.quantity}</span>
          </div>
          <div>₹${it.total_price}</div>
        </div>
      `
      )
      .join('');

    checkoutSummary.innerHTML = `
      <div class="checkout-items">${html}</div>
      <div class="checkout-total">Total: <strong>₹${cart.total_price}</strong></div>
    `;
  } catch (err) {
    console.error('Checkout summary error', err);
    checkoutSummary.innerHTML = `<div class="empty">Unable to load summary.</div>`;
  }
}

async function placeOrder() {
  const address = document.getElementById('address').value.trim();
  const payment = document.getElementById('payment').value;

  if (!address) {
    showAlert('Please enter your shipping address.', 'error');
    return;
  }

  placeOrderBtn.disabled = true;
  placeOrderBtn.textContent = 'Placing Order...';

  try {
    const res = await api.post('/orders/create/', {
      address,
      payment_method: payment,
    });

    showAlert('Order placed successfully!', 'success');
    window.location.href = '/orders/my_orders.html';
  } catch (err) {
    console.error('Order creation failed', err);

    if (
      err.response?.status === 400 &&
      err.response.data?.detail === 'Some products unavailable'
    ) {
      const unavailable = err.response.data.products?.join(', ') || 'Unknown';
      showAlert(`Some products are unavailable: ${unavailable}`, 'warning');
    } else {
      showAlert('Failed to place order.', 'error');
    }
  } finally {
    placeOrderBtn.disabled = false;
    placeOrderBtn.textContent = 'Place Order';
  }
}
