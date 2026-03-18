// js/orders.js
import { api } from './core/api.js';
import { showAlert } from './core/utils.js';

// Simple date formatter (fix for missing export)
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ordersContainer = document.getElementById('ordersContainer');

// Fetch and render seller orders
async function loadSellerOrders() {
  try {
    console.log('Fetching seller orders...');
    const res = await api.get('/orders/seller/orders/');
    console.log('🟢 /orders/seller/orders/ response:', res);

    const orders = Array.isArray(res) ? res : res.results || [];
    if (!orders.length) {
      ordersContainer.innerHTML = `<p style="color:#6b7280;">No orders found.</p>`;
      return;
    }

    // Sort orders by created_at (newest first)
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    ordersContainer.innerHTML = orders.map(renderOrderCard).join('');
  } catch (err) {
    console.error('🔴 Error loading seller orders:', err);
    showAlert('Failed to load seller orders.', 'error');
    ordersContainer.innerHTML = `<p class="error-text">Unable to load your orders.</p>`;
  }
}

function renderOrderCard(order) {
  const buyerName = order.buyer?.name || order.buyer?.email || 'Unknown Buyer';
  const date = formatDate(order.created_at);
  const status = order.status || 'PENDING';
  const paymentStatus = order.payment_status || 'PENDING';
  const total = Number(order.total_price || 0).toFixed(2);

  const itemsHtml = (order.items || [])
    .map((item) => {
      const img = item.product?.image || '/assets/images/placeholder.png';
      const title = item.product?.title || item.product_title || 'Product';
      return `
        <div class="order-item">
          <img src="${img}" alt="${title}" onerror="this.src='/assets/images/placeholder.png'">
          <div class="order-item-info">
            <div class="order-item-title">${title}</div>
            <div class="order-item-qty">Qty: ${item.quantity}</div>
          </div>
          <div class="order-item-price">₹${item.total_price}</div>
        </div>
      `;
    })
    .join('');

  // Map status to color classes
  const statusClass =
    {
      PENDING: 'status-pending',
      PAID: 'status-paid',
      COMPLETED: 'status-completed',
      CANCELLED: 'status-cancelled',
    }[status.toUpperCase()] || 'status-pending';

  const paymentClass =
    paymentStatus === 'SUCCESS' ? 'badge-success' : 'badge-pending';

  return `
    <div class="order-card">
      <div class="order-header">
        <div>
          <span class="order-id">#${order.id}</span>
          <span class="order-buyer">Buyer: ${buyerName}</span>
        </div>
        <span class="order-status ${statusClass}">${status}</span>
      </div>
      <div class="order-items">${itemsHtml}</div>
      <div class="order-summary">
        <div><strong>Total:</strong> ₹${total}</div>
        <div><strong>Payment:</strong> <span class="badge ${paymentClass}">${paymentStatus}</span></div>
        <div><strong>Date:</strong> ${date}</div>
      </div>
    </div>
  `;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadSellerOrders();
});
