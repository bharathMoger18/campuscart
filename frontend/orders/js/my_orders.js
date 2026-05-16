import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

const list = document.getElementById('ordersList');

async function loadOrders() {
  try {
    const response = await api.get('/orders/');
    const orders = Array.isArray(response) ? response : response.results || [];

    if (!orders.length) {
      list.innerHTML = `
        <div class="empty-orders">
          <div class="empty-icon">📦</div>
          <h2>No orders yet</h2>
          <p>Your orders will appear here once you make a purchase</p>
          <a href="/index.html" class="btn btn-primary">Start Shopping</a>
        </div>`;
      return;
    }

    list.innerHTML = orders.map(order => `
      <div class="order-card">
        <div class="order-top">
          <span class="order-id">Order #${order.id}</span>
          <span class="order-status ${order.status.toLowerCase()}">${order.status}</span>
        </div>
        <div class="order-body">
          <div class="order-info">
            <div class="order-product-name">${order.items?.[0]?.product?.title || 'No Product Title'}${order.items?.length > 1 ? ` +${order.items.length - 1} more` : ''}</div>
            <div class="order-meta">${order.items?.length || 0} item(s) &nbsp;•&nbsp; ${new Date(order.created_at || order.date_joined).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}</div>
            <div class="order-meta">Seller: ${order.seller?.email || 'N/A'}</div>
          </div>
          <div class="order-price">&#8377;${order.total_price}</div>
        </div>
        <div class="order-actions">
          <button class="btn btn-primary view-btn" data-id="${order.id}">View Details</button>
          <button class="btn btn-ghost track-btn" data-id="${order.id}">Track</button>
          ${order.status === 'Pending' ? `<button class="btn btn-danger cancel-btn" data-id="${order.id}">Cancel</button>` : ''}
          ${order.status === 'Shipped' ? `<button class="btn btn-primary confirm-btn" data-id="${order.id}">Confirm Delivery</button>` : ''}
          ${order.status === 'Delivered' ? `<button class="btn btn-ghost refund-btn" data-id="${order.id}">Request Refund</button><button class="btn btn-ghost review-btn" data-id="${order.id}">Add Review</button>` : ''}
        </div>
      </div>`).join('');

    bindOrderActions(orders);
  } catch (err) {
    if (err.status === 401) {
      showAlert('Please login to view your orders.', 'error');
      window.location.href = '/login.html';
    } else {
      list.innerHTML = `<div class="empty-orders"><div class="empty-icon">⚠️</div><h2>Failed to load orders</h2><p>Please try again later</p></div>`;
    }
  }
}

function bindOrderActions(orders) {
  list.querySelectorAll('.view-btn').forEach(btn =>
    btn.addEventListener('click', () => location.href = `order_detail.html?id=${btn.dataset.id}`)
  );
  list.querySelectorAll('.track-btn').forEach(btn =>
    btn.addEventListener('click', () => location.href = `track.html?id=${btn.dataset.id}`)
  );
  list.querySelectorAll('.cancel-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this order?')) return;
      try { await api.post(`/orders/${btn.dataset.id}/cancel/`); showAlert('Order cancelled.', 'info'); loadOrders(); }
      catch { showAlert('Failed to cancel order.', 'error'); }
    })
  );
  list.querySelectorAll('.confirm-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      if (!confirm('Confirm delivery?')) return;
      try { await api.post(`/orders/${btn.dataset.id}/confirm_delivery/`); showAlert('Order marked as delivered!', 'success'); loadOrders(); }
      catch { showAlert('Failed to confirm delivery.', 'error'); }
    })
  );
  list.querySelectorAll('.refund-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      const reason = prompt('Enter refund reason:');
      if (!reason) return;
      try { await api.post(`/orders/${btn.dataset.id}/refund_request/`, { reason }); showAlert('Refund request submitted.', 'info'); loadOrders(); }
      catch { showAlert('Failed to request refund.', 'error'); }
    })
  );
  list.querySelectorAll('.review-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      const rating = prompt('Rating (1-5):');
      const comment = prompt('Your review:');
      if (!rating || !comment) return;
      try { await api.post(`/orders/${btn.dataset.id}/review/`, { reviews: [{ rating: parseInt(rating), comment }] }); showAlert('Review submitted!', 'success'); loadOrders(); }
      catch { showAlert('Failed to submit review.', 'error'); }
    })
  );
}

loadOrders();
