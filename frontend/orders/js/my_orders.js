import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

const list = document.getElementById('ordersList');

async function loadOrders() {
  try {
    const response = await api.get('/orders/');
    list.classList.remove('loading');

    const orders = Array.isArray(response) ? response : response.results || [];

    if (!orders.length) {
      list.innerHTML = `<p class="empty">You have no orders yet.</p>`;
      return;
    }

    list.innerHTML = orders
      .map(
        (order) => `
        <div class="order-card">
          <div class="order-header">
            <span>Order #${order.id}</span>
            <span class="status ${order.status.toLowerCase()}">${
          order.status
        }</span>
          </div>
          <div class="order-body">
            <span>${
              order.items?.[0]?.product?.title || 'No Product Title'
            }</span>
            <p><strong>${order.items?.length || 0}</strong> items • <strong>₹${
          order.total_price
        }</strong></p>
            <p><small>${new Date(
              order.created_at || order.date_joined
            ).toLocaleString()}</small></p>
            <p><small>Seller: ${order.seller?.email || 'N/A'}</small></p>
          </div>
          <div class="order-actions">
            ${renderActions(order)}
          </div>
        </div>`
      )
      .join('');

    bindOrderActions(orders);
  } catch (err) {
    if (err.status === 401) {
      showAlert('Please login to view your orders.', 'error');
      window.location.href = '/../login.html';
    } else {
      list.innerHTML = `<p class="empty">Failed to load orders.</p>`;
    }
  }
}

function renderActions(order) {
  const actions = [];
  actions.push(
    `<button class="btn btn-primary view-btn" data-id="${order.id}">View</button>`
  );
  actions.push(
    `<button class="btn btn-ghost track-btn" data-id="${order.id}">Track</button>`
  );

  if (order.status === 'Pending')
    actions.push(
      `<button class="btn btn-danger cancel-btn" data-id="${order.id}">Cancel</button>`
    );
  if (order.status === 'Shipped')
    actions.push(
      `<button class="btn btn-primary confirm-btn" data-id="${order.id}">Confirm</button>`
    );
  if (order.status === 'Delivered') {
    actions.push(
      `<button class="btn btn-ghost refund-btn" data-id="${order.id}">Refund</button>`
    );
    actions.push(
      `<button class="btn btn-success review-btn" data-id="${order.id}">Add Review</button>`
    );
  }

  return actions.join(' ');
}

function bindOrderActions(orders) {
  list.querySelectorAll('.view-btn').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      location.href = `order_detail.html?id=${id}`;
    })
  );

  list.querySelectorAll('.track-btn').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      location.href = `track.html?id=${id}`;
    })
  );

  list.querySelectorAll('.cancel-btn').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (!confirm('Cancel this order?')) return;
      try {
        await api.post(`/orders/${id}/cancel/`);
        showAlert('Order cancelled successfully.', 'info');
        loadOrders();
      } catch {
        showAlert('Failed to cancel order.', 'error');
      }
    })
  );

  list.querySelectorAll('.confirm-btn').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (!confirm('Confirm delivery?')) return;
      try {
        await api.post(`/orders/${id}/confirm_delivery/`);
        showAlert('Order marked as delivered!', 'success');
        loadOrders();
      } catch {
        showAlert('Failed to confirm delivery.', 'error');
      }
    })
  );

  list.querySelectorAll('.refund-btn').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      const reason = prompt('Enter refund reason:');
      if (!reason) return;
      try {
        await api.post(`/orders/${id}/refund_request/`, { reason });
        showAlert('Refund request submitted.', 'info');
        loadOrders();
      } catch {
        showAlert('Failed to request refund.', 'error');
      }
    })
  );

  list.querySelectorAll('.review-btn').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      const rating = prompt('Enter rating (1-5):');
      const comment = prompt('Enter your review comment:');
      if (!rating || !comment) return;
      try {
        await api.post(`/orders/${id}/review/`, {
          reviews: [{ rating: parseInt(rating), comment }],
        });
        showAlert('Thanks for your feedback!', 'success');
        loadOrders();
      } catch {
        showAlert('Failed to submit review.', 'error');
      }
    })
  );
}

loadOrders();
