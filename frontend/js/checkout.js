// /frontend/js/checkout.js
import { api } from './core/api.js';
import {
  showAlert,
  showLoader,
  hideLoader,
  parseErrors,
  redirectTo,
} from './core/utils.js';

const summary = document.getElementById('checkoutSummary');
const btn = document.getElementById('placeOrderBtn');
const addressInput = document.getElementById('address');
const paymentSelect = document.getElementById('payment');
const cardSection = document.getElementById('cardSection');

paymentSelect.addEventListener('change', () => {
  if (paymentSelect.value === 'card') cardSection.classList.add('visible');
  else cardSection.classList.remove('visible');
});

async function loadSummary() {
  try {
    const cart = await api.get('/cart/');
    if (!cart.items?.length) {
      summary.innerHTML = `<p class="empty">Your cart is empty.</p>`;
      btn.disabled = true;
      return;
    }

    summary.classList.remove('loading');
    summary.innerHTML = `
      <div class="cart-table">
        ${cart.items
          .map(
            (i) => `
          <div class="cart-row">
            <div class="cart-product">
              <img src="${
                i.product.image
                  ? `http://localhost:8000/media/${i.product.image.replace(
                      /^\/?media\//,
                      ''
                    )}`
                  : '/assets/images/noimg.png'
              }" alt="${i.product.title}">
              <span>${i.product.title}</span>
            </div>
            <div class="price">₹${i.product.price}</div>
            <div>x${i.quantity}</div>
            <div class="price">₹${i.total_price}</div>
          </div>`
          )
          .join('')}
      </div>
      <div class="cart-summary">
        <div>Total: ₹${cart.total_price}</div>
      </div>
    `;
  } catch (err) {
    summary.innerHTML = `<p class="empty">Failed to load cart.</p>`;
  }
}

btn.addEventListener('click', async () => {
  const address = addressInput.value.trim();
  const payment_method = paymentSelect.value;

  if (!address) return showAlert('Please enter shipping address.', 'error');

  btn.disabled = true;
  btn.textContent = 'Processing...';
  showLoader(btn);

  try {
    // 🧾 Step 1: Create the order
    const response = await api.post('/orders/create/', {
      address,
      payment_method,
    });

    const order = Array.isArray(response) ? response[0] : response;
    const orderId = order?.id;

    if (!orderId) {
      showAlert('Order ID not received from server.', 'error');
      return;
    }

    // 💵 Step 2: Handle COD (immediate redirect)
    if (payment_method === 'cod') {
      showAlert('Order placed successfully (Cash on Delivery).', 'success');
      redirectTo(`./order_detail.html?id=${orderId}`, 1000);
      return;
    }

    // 💳 Step 3: Handle Online Payment via Stripe Checkout
    const cart = await api.get('/cart/');
    const totalAmount = cart?.total_price
      ? Math.round(cart.total_price * 100) // convert ₹ to cents
      : 5000;

    const session = await api.post('/payments/create-checkout-session/', {
      order_id: orderId,
      amount: totalAmount,
      product_name: `Order #${orderId}`,
    });

    if (session?.url) {
      // ✅ Redirect to Stripe Checkout
      window.location.href = session.url;
    } else {
      showAlert('Failed to initialize payment session.', 'error');
    }
  } catch (err) {
    console.error('Order creation failed:', err);
    const msg = parseErrors(err.data);
    showAlert(msg || 'Failed to place order.', 'error');
  } finally {
    hideLoader(btn);
    btn.disabled = false;
    btn.textContent = 'Place Order';
  }
});

loadSummary();
