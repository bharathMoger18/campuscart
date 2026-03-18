// frontend/seller/js/order_detail.js
import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';
import * as storage from '../../js/core/storage.js';
import { API_BASE } from '../../js/core/config.js';

const orderId = new URLSearchParams(window.location.search).get('id');
const container = document.getElementById('orderDetailContainer');

function formatCurrency(v) {
  const n = Number(v ?? 0);
  if (Number.isNaN(n)) return '₹0.00';
  return `₹${n.toFixed(2)}`;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function statusToBadgeClass(status) {
  if (!status) return 'status-pending';
  const s = String(status).toLowerCase();
  if (s.includes('pending')) return 'status-pending';
  if (s.includes('paid')) return 'status-paid';
  if (s.includes('shipped')) return 'status-shipped';
  if (s.includes('delivered')) return 'status-delivered';
  if (s.includes('cancel')) return 'status-cancelled';
  if (s.includes('completed')) return 'status-delivered';
  return 'status-pending';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!orderId) {
    container.innerHTML = '<p style="color:red;">Order ID missing</p>';
    showAlert('Order ID missing', 'error');
    return;
  }

  try {
    const order = await api.get(`/orders/seller/orders/${orderId}/`);
    const refund = await fetchRefundStatus(orderId); // ✅ separate refund fetch
    renderOrderDetail(order, refund);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p style="color:red;">Failed to load order detail.</p>`;
    showAlert('Failed to load order detail', 'error');
  }
});

async function fetchRefundStatus(orderId) {
  try {
    const token = storage.getAccess();
    const res = await fetch(`${API_BASE}/orders/${orderId}/refund_status/`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('Refund status fetch failed', err);
    return null;
  }
}

function renderOrderDetail(order, refund = null) {
  if (!order) {
    container.innerHTML = `<p>No order data available.</p>`;
    return;
  }

  const status = escapeHtml(order.status || '-');
  const badgeClass = statusToBadgeClass(order.status);
  const items = Array.isArray(order.items) ? order.items : [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem;">
      <div>
        <h2 style="margin:0 0 0.2rem 0;">Order #${order.id}</h2>
        <div class="meta">Placed: ${
          order.created_at ? new Date(order.created_at).toLocaleString() : '-'
        }</div>
      </div>
      <div style="text-align:right;">
        <div class="status-badge ${badgeClass}">${status}</div>
        <div style="margin-top:0.5rem; font-weight:700; font-size:1.1rem;">
          ${formatCurrency(order.total_price ?? order.total ?? 0)}
        </div>
      </div>
    </div>

    <div class="order-grid" style="margin-top:1rem;">
      <section>
        <div style="margin-bottom:0.75rem;"><strong>Items</strong></div>
        <div class="order-items">
          ${items
            .map((it) => {
              const p = it.product || {};
              const img = p.image || '/assets/images/placeholder.png';
              const title = escapeHtml(
                p.title || it.product_title || 'Product'
              );
              const price = formatCurrency(it.price ?? p.price ?? 0);
              const qty = it.quantity ?? 1;
              return `
              <div class="order-item">
                <img src="${img}" alt="${title}" onerror="this.src='/assets/images/placeholder.png'">
                <div>
                  <div style="font-weight:700">${title}</div>
                  <div style="color:#6b7280; font-size:0.95rem;">${price} • Qty: ${qty}</div>
                </div>
              </div>`;
            })
            .join('')}
        </div>

        <div style="margin-top:1rem;">
          <h3 style="margin-bottom:0.4rem;">Buyer</h3>
          <div class="meta"><strong>Name:</strong> ${escapeHtml(
            order.buyer?.name || '-'
          )}</div>
          <div class="meta"><strong>Email:</strong> ${escapeHtml(
            order.buyer?.email || '-'
          )}</div>
          ${
            order.payment
              ? `<div class="meta"><strong>Payment:</strong> ${escapeHtml(
                  order.payment.method === 'COD' &&
                    order.payment.provider_payment_id?.startsWith('pi_')
                    ? 'Online Payment'
                    : order.payment.method ||
                        order.payment.provider ||
                        'Unknown'
                )} • ${formatCurrency(
                  order.payment.amount && order.payment.amount !== '0.00'
                    ? order.payment.amount
                    : order.total_price ?? 0
                )} (${escapeHtml(order.payment.status || '')})</div>`
              : ''
          }
        </div>
      </section>

      <aside>
        <div style="margin-bottom:0.6rem;"><strong>Order Actions</strong></div>
        <div class="actions">
          ${renderActionButtons(order.status)}
        </div>

        <div style="margin-top:1rem;">
          <h4 style="margin-bottom:0.4rem;">Refund</h4>
          <div id="refundBlock">${renderRefundBlock(refund)}</div>
        </div>
      </aside>
    </div>
  `;

  bindActions(order.id, order.status, refund);
}

function renderRefundBlock(refund) {
  console.log('Refund data:', refund);
  if (!refund) return `<div style="color:#6b7280;">No refund requested</div>`;

  let color = '#6b7280';
  if (refund.status && refund.status.toUpperCase() === 'PENDING')
    color = '#f59e0b';
  else if (refund.status === 'APPROVED') color = '#15803d';
  else if (refund.status === 'REJECTED') color = '#b91c1c';

  let content = `<div style="font-weight:700; color:${color}">Status: ${escapeHtml(
    refund.status
  )}</div>`;
  if (refund.reason)
    content += `<div class="meta">Reason: ${escapeHtml(refund.reason)}</div>`;
  if (refund.admin_note)
    content += `<div class="meta">Note: ${escapeHtml(refund.admin_note)}</div>`;

  if (refund.status === 'PENDING') {
    content += `
      <div style="margin-top:0.5rem;">
        <button id="approveRefund" class="btn btn-danger">Approve Refund</button>
        <button id="rejectRefund" class="btn btn-ghost">Reject Refund</button>
      </div>`;
  }

  return content;
}

function renderActionButtons(status) {
  switch (status) {
    case 'PENDING':
      return `<button id="markPaid" class="btn btn-primary">Mark as Paid</button>`;
    case 'PAID':
      return `<button id="markShipped" class="btn btn-primary">Mark as Shipped</button>`;
    case 'SHIPPED':
      return `<button id="markDelivered" class="btn btn-primary">Mark as Delivered</button>`;
    case 'DELIVERED':
      return `<button id="markCompleted" class="btn btn-success">Mark as Completed</button>`;
    default:
      return `<p style="color:#6b7280;">No actions available</p>`;
  }
}

function bindActions(orderId, status, refund) {
  const map = {
    markPaid: 'PAID',
    markShipped: 'SHIPPED',
    markDelivered: 'DELIVERED',
    markCompleted: 'COMPLETED',
  };

  Object.entries(map).forEach(([btnId, newStatus]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm(`Mark order ${orderId} as ${newStatus}?`)) return;
      try {
        await api.patch(`/orders/seller/orders/${orderId}/update-status/`, {
          status: newStatus,
        });
        showAlert(`Order updated to ${newStatus}`, 'success');
        const updatedOrder = await api.get(`/orders/seller/orders/${orderId}/`);
        const updatedRefund = await fetchRefundStatus(orderId);
        renderOrderDetail(updatedOrder, updatedRefund);
      } catch (err) {
        console.error(err);
        showAlert('Failed to update order status', 'error');
      }
    });
  });

  // Refund approve/reject logic
  const approveBtn = document.getElementById('approveRefund');
  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      if (!confirm('Approve refund for this order?')) return;
      await handleRefundDecision(orderId, 'APPROVE', 'Approved by seller.');
    });
  }

  const rejectBtn = document.getElementById('rejectRefund');
  if (rejectBtn) {
    rejectBtn.addEventListener('click', async () => {
      if (!confirm('Reject refund for this order?')) return;
      await handleRefundDecision(orderId, 'REJECT', 'Rejected by seller.');
    });
  }
}

async function handleRefundDecision(orderId, decision, note) {
  try {
    const token = storage.getAccess();
    const res = await fetch(`${API_BASE}/orders/${orderId}/refund_decision/`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ decision, note }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('refund_decision failed', res.status, text);
      showAlert('Failed to update refund', 'error');
      return;
    }
    showAlert(`Refund ${decision.toLowerCase()}d successfully`, 'success');
    const order = await api.get(`/orders/seller/orders/${orderId}/`);
    const refund = await fetchRefundStatus(orderId);
    renderOrderDetail(order, refund);
  } catch (err) {
    console.error('Refund decision error', err);
    showAlert('Error updating refund', 'error');
  }
}
