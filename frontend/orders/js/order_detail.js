import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

const target = document.getElementById('orderDetail');
const params = new URLSearchParams(location.search);
const id = params.get('id');

if (!id) {
  target.innerHTML = `<p class="empty">Invalid order ID.</p>`;
  throw new Error('❌ Order ID missing from URL');
}

console.log('🟢 order_detail.js loaded, order ID =', id);

async function loadOrder() {
  try {
    console.log('⏳ Loading order...');
    target.classList.add('loading');
    target.innerHTML = `<p>Loading order...</p>`;

    const order = await api.get(`/orders/${id}/`);
    console.log('✅ Order fetched:', order);

    target.classList.remove('loading');
    const status = order.status?.toUpperCase() || 'UNKNOWN';
    console.log('📦 Order status:', status);

    const itemsHTML = order.items?.length
      ? order.items
          .map(
            (i) => `
          <div class="cart-row">
            <div class="cart-product">
              <img src="${i.product.image}" alt="${i.product.title}" />
              <span>${i.product.title}</span>
            </div>
            <div>x${i.quantity}</div>
            <div class="price">₹${i.total_price}</div>
          </div>`
          )
          .join('')
      : '<p class="empty">No items in this order.</p>';

    const actions = [];

    const currentUserEmail = localStorage.getItem('user_email') || '';
    console.log('👤 Current user:', currentUserEmail);
    console.log('🛒 Seller email:', order.seller?.email);
    const isSeller = order.seller?.email === currentUserEmail;
    console.log('🔍 isSeller?', isSeller);

    switch (status) {
      case 'PENDING':
        actions.push(
          `<button class="btn btn-danger" id="cancelBtn">Cancel Order</button>`
        );
        break;

      case 'PAID':
        actions.push(
          `<button class="btn btn-ghost" id="refundBtn">Request Refund</button>`
        );
        break;

      case 'SHIPPED':
        if (!isSeller) {
          actions.push(
            `<button class="btn btn-primary" id="confirmBtn">Confirm Delivery</button>`
          );
        } else {
          actions.push(`<span class="note">Awaiting Buyer Confirmation</span>`);
        }
        break;

      case 'DELIVERED':
        if (isSeller) {
          actions.push(
            `<button class="btn btn-success" id="completeBtn">Mark Completed</button>`
          );
        } else {
          actions.push(`<span class="note">Awaiting Seller Completion</span>`);
        }
        break;

      case 'COMPLETED':
        if (!isSeller) {
          actions.push(
            `<button class="btn btn-success" id="reviewBtn">Add Review</button>`
          );
        } else {
          actions.push(`<span class="note">Order Completed</span>`);
        }
        break;

      default:
        console.warn('⚠️ Unhandled status:', status);
        break;
    }

    target.innerHTML = `
      <h1>Order #${order.id}</h1>
      <div class="order-meta">
        <p>Status: <span class="status ${status.toLowerCase()}">${status}</span></p>
        <p>Seller: ${order.seller?.email || 'N/A'}</p>
        <p>Placed on: ${new Date(order.created_at).toLocaleString()}</p>
        <p><strong>Total: ₹${order.total_price}</strong></p>
      </div>

      <h2>Items</h2>
      <div class="cart-table">${itemsHTML}</div>

      ${
        actions.length
          ? `<div class="order-actions">${actions.join(' ')}</div>`
          : `<p class="empty">No actions available for this order.</p>`
      }

      <div class="track-link">
        <a href="track.html?id=${
          order.id
        }" class="btn btn-ghost">View Tracking</a>
      </div>
    `;

    console.log('🧩 UI rendered. Binding buttons...');
    bindActions(order);
  } catch (err) {
    console.error('❌ Error loading order:', err);
    target.innerHTML = `<p class="empty">⚠️ Failed to load order details. Please try again later.</p>`;
  }
}

function bindActions(order) {
  console.log('🪄 Binding action buttons...');
  const cancelBtn = document.getElementById('cancelBtn');
  const confirmBtn = document.getElementById('confirmBtn');
  const refundBtn = document.getElementById('refundBtn');
  const reviewBtn = document.getElementById('reviewBtn');
  const completeBtn = document.getElementById('completeBtn');

  if (!cancelBtn && !confirmBtn && !refundBtn && !reviewBtn && !completeBtn) {
    console.warn('⚠️ No buttons found for this status.');
  }

  // Cancel order
  cancelBtn?.addEventListener('click', async () => {
    console.log('🟥 Cancel order clicked');
    if (!confirm('Are you sure you want to cancel this order?')) return;
    try {
      await api.post(`/orders/${order.id}/cancel/`);
      showAlert('Order cancelled successfully.', 'info');
      await reloadAfterAction();
    } catch (err) {
      console.error('❌ Cancel failed:', err);
      showAlert('Failed to cancel order.', 'error');
    }
  });

  // Confirm delivery
  confirmBtn?.addEventListener('click', async () => {
    console.log('🟦 Confirm delivery clicked');
    if (!confirm('Confirm that you received this order?')) return;
    try {
      await api.post(`/orders/${order.id}/confirm_delivery/`);
      showAlert('Delivery confirmed! Seller will verify soon.', 'success');
      await reloadAfterAction();
    } catch (err) {
      console.error('❌ Confirm delivery failed:', err);
      showAlert('Failed to confirm delivery.', 'error');
    }
  });

  // Request refund
  refundBtn?.addEventListener('click', async () => {
    console.log('🟨 Refund request clicked');
    const reason = prompt('Please enter your refund reason:');
    if (!reason || reason.trim().length < 3) {
      showAlert('Refund reason must be at least 3 characters.', 'warning');
      return;
    }
    try {
      await api.post(`/orders/${order.id}/refund_request/`, { reason });
      showAlert('Refund request submitted.', 'info');
      await reloadAfterAction();
    } catch (err) {
      console.error('❌ Refund request failed:', err);
      showAlert('Failed to submit refund request.', 'error');
    }
  });

  // Add review
  reviewBtn?.addEventListener('click', async () => {
    console.log('🟩 Add review clicked');
    const rating = parseInt(prompt('Enter rating (1-5):'));
    const comment = prompt('Enter your review comment:');
    if (!rating || rating < 1 || rating > 5) {
      showAlert('Rating must be between 1 and 5.', 'warning');
      return;
    }
    if (!comment || comment.trim().length < 3) {
      showAlert('Please write a meaningful comment.', 'warning');
      return;
    }

    try {
      await api.post(`/orders/${order.id}/review/`, {
        reviews: order.items.map((i) => ({
          product: i.product.id,
          rating,
          comment,
        })),
      });
      showAlert('Thanks for your feedback!', 'success');
      await reloadAfterAction();
    } catch (err) {
      console.error('❌ Review submission failed:', err);
      showAlert('Failed to submit review.', 'error');
    }
  });

  // Seller: Mark completed
  completeBtn?.addEventListener('click', async () => {
    console.log('🟪 Mark completed clicked');
    if (!confirm('Mark this order as completed?')) return;
    try {
      await api.post(`/orders/${order.id}/mark_completed/`);
      showAlert('Order marked as completed.', 'success');
      await reloadAfterAction();
    } catch (err) {
      console.error('❌ Mark completed failed:', err);
      showAlert('Failed to mark order completed.', 'error');
    }
  });
}

async function reloadAfterAction() {
  console.log('🔁 Reloading order after action...');
  target.classList.add('loading');
  target.innerHTML = `<p>Refreshing order details...</p>`;
  setTimeout(loadOrder, 1000);
}

loadOrder();
