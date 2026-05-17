import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

const target = document.getElementById('orderDetail');
const params = new URLSearchParams(location.search);
const id = params.get('id');
const paymentSuccess = params.get('payment') === 'success';

if (!id) {
  target.innerHTML = `<div class="empty">Invalid order ID.</div>`;
  throw new Error('Order ID missing');
}

function statusClass(s) {
  const m = { pending:'status-pending', paid:'status-paid', shipped:'status-shipped', delivered:'status-delivered', completed:'status-delivered', cancelled:'status-cancelled' };
  return m[s?.toLowerCase()] || 'status-pending';
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

async function handlePaymentSuccess(order) {
  // If coming back from Stripe with success, simulate payment to mark as PAID
  if (paymentSuccess && order.status?.toLowerCase() === 'pending') {
    try {
      await api.post(`/orders/${id}/simulate_payment/`, {
        method: 'CARD',
        result: 'success'
      });
      showAlert('Payment successful! Order confirmed.', 'success');
      // Clean URL
      window.history.replaceState({}, '', `order_detail.html?id=${id}`);
      // Reload order with updated status
      await loadOrder();
      return true;
    } catch {
      showAlert('Payment recorded but status update failed.', 'error');
    }
  }
  return false;
}

async function loadOrder() {
  target.innerHTML = `<div class="loading">Loading order...</div>`;
  try {
    const order = await api.get(`/orders/${id}/`);

    // Handle Stripe return
    if (paymentSuccess) {
      const handled = await handlePaymentSuccess(order);
      if (handled) return;
    }

    const status = order.status?.toUpperCase() || 'UNKNOWN';
    const statusLower = status.toLowerCase();
    const currentUserEmail = localStorage.getItem('user_email') || '';
    const isSeller = order.seller?.email === currentUserEmail;

    const itemsHTML = order.items?.length
      ? order.items.map(i => `
          <div class="order-item">
            <img src="${i.product?.image || '/assets/images/placeholder.png'}" alt="${escapeHtml(i.product?.title)}" onerror="this.src='/assets/images/placeholder.png'" />
            <div class="order-item-info">
              <strong>${escapeHtml(i.product?.title)}</strong>
              <span>Quantity: ${i.quantity}</span>
            </div>
            <div class="order-item-price">&#8377;${i.total_price}</div>
          </div>`).join('')
      : '<div class="empty">No items in this order.</div>';

    const actions = [];
    if (status === 'PENDING') actions.push(`<button class="btn btn-danger" id="cancelBtn">Cancel Order</button>`);
    if (status === 'PAID') actions.push(`<button class="btn btn-ghost" id="refundBtn">Request Refund</button>`);
    if (status === 'SHIPPED' && !isSeller) actions.push(`<button class="btn btn-primary" id="confirmBtn">Confirm Delivery</button>`);
    if (status === 'DELIVERED' && isSeller) actions.push(`<button class="btn btn-primary" id="completeBtn">Mark Completed</button>`);
    if (status === 'COMPLETED' && !isSeller) actions.push(`<button class="btn btn-ghost" id="reviewBtn">&#11088; Add Review</button>`);

    target.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem">
        <div>
          <h2 style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;color:var(--text);margin:0 0 .5rem">Order #${order.id}</h2>
          <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
            <span style="color:var(--text-3);font-size:.88rem">Status:</span>
            <span class="status-badge ${statusClass(statusLower)}">${status}</span>
          </div>
        </div>
        <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;color:var(--primary-light)">&#8377;${order.total_price}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.5rem">
        <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.75rem 1rem">
          <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:.25rem">Seller</div>
          <div style="color:var(--text);font-size:.9rem;font-weight:600">${escapeHtml(order.seller?.email || 'N/A')}</div>
        </div>
        <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.75rem 1rem">
          <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:.25rem">Placed On</div>
          <div style="color:var(--text);font-size:.9rem;font-weight:600">${new Date(order.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
        </div>
      </div>

      <div style="margin-bottom:1.5rem">
        <h3 style="font-family:var(--font-display);font-size:1rem;font-weight:700;color:var(--text);margin-bottom:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--border)">Items</h3>
        ${itemsHTML}
      </div>

      <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <span style="font-weight:700;color:var(--text)">Total</span>
        <span style="font-family:var(--font-display);font-size:1.4rem;font-weight:800;color:var(--primary-light)">&#8377;${order.total_price}</span>
      </div>

      <div style="display:flex;flex-direction:column;gap:.6rem">
        ${actions.length ? actions.join('') : `<div style="color:var(--text-3);font-size:.85rem;text-align:center;padding:.5rem">No actions available for this order status.</div>`}
        <a href="track.html?id=${order.id}" class="btn btn-ghost" style="text-align:center">&#128663; View Tracking</a>
      </div>
    `;

    bindActions(order);
  } catch {
    target.innerHTML = `<div class="empty">Failed to load order details.</div>`;
  }
}

function bindActions(order) {
  document.getElementById('cancelBtn')?.addEventListener('click', async () => {
    if (!confirm('Cancel this order?')) return;
    try { await api.post(`/orders/${order.id}/cancel/`); showAlert('Order cancelled.', 'info'); setTimeout(loadOrder, 800); }
    catch { showAlert('Failed to cancel order.', 'error'); }
  });
  document.getElementById('confirmBtn')?.addEventListener('click', async () => {
    if (!confirm('Confirm delivery?')) return;
    try { await api.post(`/orders/${order.id}/confirm_delivery/`); showAlert('Delivery confirmed!', 'success'); setTimeout(loadOrder, 800); }
    catch { showAlert('Failed to confirm delivery.', 'error'); }
  });
  document.getElementById('refundBtn')?.addEventListener('click', async () => {
    const reason = prompt('Enter refund reason:');
    if (!reason?.trim()) return;
    try { await api.post(`/orders/${order.id}/refund_request/`, { reason }); showAlert('Refund request submitted.', 'info'); setTimeout(loadOrder, 800); }
    catch { showAlert('Failed to submit refund.', 'error'); }
  });
  document.getElementById('reviewBtn')?.addEventListener('click', async () => {
    const rating = parseInt(prompt('Rating (1-5):'));
    const comment = prompt('Your review:');
    if (!rating || rating < 1 || rating > 5 || !comment?.trim()) return;
    try {
      await api.post(`/orders/${order.id}/review/`, { reviews: order.items.map(i => ({ product: i.product.id, rating, comment })) });
      showAlert('Review submitted!', 'success');
    } catch { showAlert('Failed to submit review.', 'error'); }
  });
  document.getElementById('completeBtn')?.addEventListener('click', async () => {
    if (!confirm('Mark as completed?')) return;
    try { await api.post(`/orders/${order.id}/mark_completed/`); showAlert('Order completed!', 'success'); setTimeout(loadOrder, 800); }
    catch { showAlert('Failed to mark completed.', 'error'); }
  });
}

loadOrder();
