// frontend/seller/js/orders.js
import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

const PAGE_SIZE = 10;

let allOrders = [];
let filteredOrders = [];
let currentPage = 1;

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
  if (s.includes('refund_requested')) return 'status-refund_requested';
  if (s.includes('refunded')) return 'status-refunded';
  return 'status-pending';
}

async function loadOrders() {
  try {
    const orders = await api.get('/orders/seller/orders/');
    if (!Array.isArray(orders)) {
      allOrders = [];
    } else {
      // normalize small bits for searching
      allOrders = orders.map((o) => {
        const productTitle =
          (o.items &&
            o.items[0] &&
            (o.items[0].product?.title || o.items[0].product_title)) ||
          '';
        const buyerName = o.buyer?.name || o.buyer_name || '';
        return { ...o, _productTitle: productTitle, _buyerName: buyerName };
      });
    }
    applyFiltersAndRender();
  } catch (err) {
    console.error('Failed to fetch orders', err);
    showAlert('Failed to load orders', 'error');
    document.getElementById(
      'ordersTableBody'
    ).innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1rem">Could not load orders</td></tr>`;
  }
}

function applyFiltersAndRender() {
  const status = document.getElementById('statusFilter').value.trim();
  const q = document.getElementById('searchInput').value.trim().toLowerCase();

  filteredOrders = allOrders.filter((o) => {
    if (status && String(o.status) !== status) return false;
    if (!q) return true;
    // match id, product, buyer, email
    if (String(o.id).includes(q)) return true;
    if ((o._productTitle || '').toLowerCase().includes(q)) return true;
    if ((o._buyerName || '').toLowerCase().includes(q)) return true;
    if ((o.buyer?.email || '').toLowerCase().includes(q)) return true;
    return false;
  });

  currentPage = 1;
  renderTablePage();
}

function renderTablePage() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;
  if (!Array.isArray(filteredOrders) || filteredOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1rem">No orders found</td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const total = filteredOrders.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredOrders.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageItems
    .map((o) => {
      const product = escapeHtml(o._productTitle || '-');
      const buyer = escapeHtml(o._buyerName || o.buyer?.email || '-');
      const status = o.status || '-';
      const badge = statusToBadgeClass(status);
      const totalPrice = formatCurrency(o.total_price ?? o.total ?? 0);
      const created = o.created_at
        ? new Date(o.created_at).toLocaleString()
        : o.date
        ? new Date(o.date).toLocaleString()
        : '-';
      return `
      <tr>
        <td><a href="./order_detail.html?id=${o.id}">${o.id}</a></td>
        <td>${buyer}</td>
        <td>${product}</td>
        <td><span class="status-badge ${badge}">${escapeHtml(
        status
      )}</span></td>
        <td style="font-weight:700">${totalPrice}</td>
        <td>${created}</td>
        <td class="actions">
          ${renderActionButtons(o)}
        </td>
      </tr>
    `;
    })
    .join('');

  renderPagination(pages);
  bindActionButtonsOnPage();
}

function renderActionButtons(order) {
  const state = order.status;
  const pm = (order.payment_method || '').toLowerCase();
  const isCOD = pm.includes('cod') || pm.includes('cash');

  let html = `<a class="btn btn-ghost btn-small" href="./order_detail.html?id=${order.id}">View</a>`;

  // PENDING stage
  if (state === 'PENDING') {
    if (isCOD) {
      // For COD orders → directly mark shipped (payment happens on delivery)
      html += `<button data-action="update-status" data-id="${order.id}" data-status="SHIPPED" class="btn btn-primary btn-small">Mark Shipped</button>`;
    } else {
      // Online payments → must mark paid first
      html += `<button data-action="update-status" data-id="${order.id}" data-status="PAID" class="btn btn-primary btn-small">Mark Paid</button>`;
    }

    // After payment done (online)
  } else if (state === 'PAID') {
    html += `<button data-action="update-status" data-id="${order.id}" data-status="SHIPPED" class="btn btn-primary btn-small">Mark Shipped</button>`;

    // After shipped (waiting buyer confirm)
  } else if (state === 'SHIPPED') {
    // No manual deliver button; wait for buyer confirm
    html += `<span class="status-badge status-shipped">Awaiting Buyer Confirmation</span>`;

    // Buyer confirmed delivery (auto changes to DELIVERED)
  } else if (state === 'DELIVERED') {
    // Seller can now mark it completed
    html += `<button data-action="update-status" data-id="${order.id}" data-status="COMPLETED" class="btn btn-success btn-small">Mark Completed</button>`;

    // Refund requests
  } else if (state === 'REFUND_REQUESTED') {
    html += `<button data-action="approve-refund" data-id="${order.id}" class="btn btn-danger btn-small">Approve Refund</button>`;
    html += `<button data-action="reject-refund" data-id="${order.id}" class="btn btn-ghost btn-small">Reject</button>`;
  }

  return html;
}

function renderPagination(pages) {
  const container = document.getElementById('pagination');
  if (!container) return;
  if (pages <= 1) {
    container.innerHTML = `<div style="color:#6b7280">Showing ${filteredOrders.length} orders</div>`;
    return;
  }

  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  const nextDisabled = currentPage >= pages ? 'disabled' : '';
  let pagesHtml = `<button class="btn btn-ghost btn-small" ${prevDisabled} data-pg="prev">Prev</button>`;
  // show up to 7 page buttons (smart window)
  const windowSize = 7;
  let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
  let end = Math.min(pages, start + windowSize - 1);
  if (end - start < windowSize - 1) {
    start = Math.max(1, end - windowSize + 1);
  }
  for (let i = start; i <= end; i++) {
    pagesHtml += `<button class="btn btn-ghost btn-small ${
      i === currentPage ? 'active' : ''
    }" data-pg="${i}">${i}</button>`;
  }
  pagesHtml += `<button class="btn btn-ghost btn-small" ${nextDisabled} data-pg="next">Next</button>`;
  container.innerHTML = pagesHtml;
  // attach handlers
  container.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const v = btn.getAttribute('data-pg');
      if (!v) return;
      if (v === 'prev') currentPage = Math.max(1, currentPage - 1);
      else if (v === 'next') currentPage = Math.min(pages, currentPage + 1);
      else currentPage = Number(v);
      renderTablePage();
    });
  });
}

function bindActionButtonsOnPage() {
  // update-status buttons
  document.querySelectorAll('[data-action="update-status"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const status = btn.getAttribute('data-status');
      if (!confirm(`Change order ${id} status to ${status}?`)) return;
      try {
        // keep using api.post to update-status (consistent with existing code)
        await updateOrderStatus(id, status);

        showAlert(`Order ${id} updated to ${status}`, 'success');
        await loadOrders();
      } catch (err) {
        console.error(err);
        showAlert('Failed to update order status', 'error');
      }
    });
  });

  // refund approve
  document.querySelectorAll('[data-action="approve-refund"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (
        !confirm(
          `Approve refund for order ${id}? This will mark it as refunded.`
        )
      )
        return;
      try {
        // backend endpoint expects PATCH /api/v1/orders/<id>/refund_decision/ with {decision:"APPROVE", note:""}
        // our api wrapper has no patch method so do direct fetch using API_BASE + tokens
        // do it safely and then refresh
        const res = await patchRefundDecision(
          id,
          'APPROVE',
          'Approved by seller'
        );
        if (res) {
          showAlert(`Refund approved for order ${id}`, 'success');
          await loadOrders();
        } else {
          showAlert('Failed to approve refund', 'error');
        }
      } catch (err) {
        console.error(err);
        showAlert('Error approving refund', 'error');
      }
    });
  });

  // refund reject
  document.querySelectorAll('[data-action="reject-refund"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!confirm(`Reject refund for order ${id}?`)) return;
      try {
        const res = await updateOrderStatus(id, status);
        if (res) {
          showAlert(`Order ${id} updated to ${status}`, 'success');
          await loadOrders();
        }
      } catch (err) {
        console.error(err);
        showAlert('Failed to update order status', 'error');
      }
    });
  });
}

async function patchRefundDecision(orderId, decision, note = '') {
  // Use direct fetch to send PATCH as api wrapper doesn't expose patch
  try {
    // import API_BASE and storage dynamically so bundling works in current structure
    const mod = await import('../../js/core/config.js');
    const storage = await import('../../js/core/storage.js');
    const API_BASE = mod.API_BASE;
    const token = storage.getAccess();
    const url = `${API_BASE}/orders/${orderId}/refund_decision/`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ decision, note }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error('refund_decision failed', res.status, txt);
      return null;
    }
    const json = await res.json();
    return json;
  } catch (err) {
    console.error('patchRefundDecision error', err);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document
    .getElementById('statusFilter')
    .addEventListener('change', applyFiltersAndRender);
  const searchInput = document.getElementById('searchInput');
  let timer = null;
  searchInput.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => applyFiltersAndRender(), 350);
  });

  loadOrders();
});

async function updateOrderStatus(orderId, status, note = '') {
  try {
    // Import config and token
    const mod = await import('../../js/core/config.js');
    const storage = await import('../../js/core/storage.js');
    const API_BASE = mod.API_BASE;
    const token = storage.getAccess();

    const url = `${API_BASE}/orders/${orderId}/update_status/`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ status, note }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('update_status failed:', res.status, text);
      showAlert('Failed to update order status', 'error');
      return null;
    }

    const json = await res.json();
    return json;
  } catch (err) {
    console.error('updateOrderStatus error', err);
    showAlert('Error updating order status', 'error');
    return null;
  }
}
