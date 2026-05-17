import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

async function fetchDashboard() {
  const res = await api.get('/orders/seller/dashboard/');
  return res;
}

async function fetchSellerOrders() {
  try { return await api.get('/orders/seller/orders/'); }
  catch { return []; }
}

async function fetchSellerProducts() {
  try { return await api.get('/seller/products/'); }
  catch { return []; }
}

function formatCurrency(v) {
  const n = Number(v ?? 0);
  return isNaN(n) ? '₹0.00' : `₹${n.toFixed(2)}`;
}

function statusToBadgeClass(status) {
  if (!status) return 'status-pending';
  const s = String(status).toLowerCase();
  if (s.includes('paid')) return 'status-paid';
  if (s.includes('shipped')) return 'status-shipped';
  if (s.includes('delivered')) return 'status-delivered';
  if (s.includes('cancel')) return 'status-cancelled';
  if (s.includes('refund')) return 'status-refund_requested';
  return 'status-pending';
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function renderTopProducts(list) {
  const container = document.getElementById('topProducts');
  if (!container) return;
  if (!Array.isArray(list) || !list.length) {
    container.innerHTML = `<div style="color:var(--text-3);font-size:.85rem">No top products yet</div>`;
    return;
  }
  container.innerHTML = list.slice(0, 5).map(p => {
    const img = p.image || '/assets/images/placeholder.png';
    const title = escapeHtml(p.title || p.product_title || 'Product');
    const revenue = Number(p.total_revenue ?? 0);
    const qty = Number(p.total_quantity ?? 0);
    return `
      <div class="top-product">
        <img src="${img}" alt="${title}" onerror="this.src='/assets/images/placeholder.png'">
        <div class="top-product-info">
          <div class="top-product-title">${title}</div>
          <div class="top-product-meta">Qty: ${qty} • ${formatCurrency(revenue)}</div>
        </div>
      </div>`;
  }).join('');
}

function renderRefundsSummary(refunds) {
  const el = document.getElementById('refundsSummary');
  if (!el) return;
  if (!refunds) { el.innerHTML = '<div style="color:var(--text-3)">No refund data</div>'; return; }
  el.innerHTML = `
    <div class="refund-row"><span>Total requests</span><span>${refunds.total_requests ?? 0}</span></div>
    <div class="refund-row"><span>Approved</span><span>${refunds.approved ?? 0}</span></div>
    <div class="refund-row"><span>Rejected</span><span>${refunds.rejected ?? 0}</span></div>
    <div class="refund-row"><span>Refunded amount</span><span>${formatCurrency(refunds.refunded_amount ?? 0)}</span></div>
    <div class="refund-row"><span>Refund rate</span><span>${(refunds.refund_rate ?? 0).toFixed(2)}%</span></div>
  `;
}

function renderSummaryCards(stats = {}, productsCount) {
  document.getElementById('totalProducts').textContent = productsCount ?? stats.total_products ?? 0;
  document.getElementById('totalOrders').textContent = stats.total_orders ?? 0;
  document.getElementById('totalRevenue').textContent = formatCurrency(stats.total_revenue ?? 0);
}

function renderRecentOrders(orders) {
  const tbody = document.getElementById('recentOrdersTable');
  if (!tbody) return;
  if (!Array.isArray(orders) || !orders.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-3)">No recent orders</td></tr>`;
    return;
  }
  tbody.innerHTML = orders.slice(0, 10).map(o => {
    const prod = o.items?.[0]?.product?.title || o.items?.[0]?.product_title || '-';
    const status = o.status ?? 'N/A';
    const date = o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '-';
    return `
      <tr>
        <td><a href="./order_detail.html?id=${o.id}">#${o.id}</a></td>
        <td>${escapeHtml(prod)}</td>
        <td><span class="status-badge ${statusToBadgeClass(status)}">${escapeHtml(status)}</span></td>
        <td style="font-weight:700;color:var(--primary-light)">${formatCurrency(o.total_price ?? 0)}</td>
        <td>${date}</td>
      </tr>`;
  }).join('');
}

function renderSalesChart(data) {
  const ctx = document.getElementById('salesChart');
  if (!ctx) return;
  if (!Array.isArray(data) || !data.length) {
    ctx.parentElement.innerHTML += '<div style="text-align:center;color:var(--text-3);padding:2rem;font-size:.9rem">No sales data yet</div>';
    return;
  }

  const labels = data.map(d => d.month || d.label || '');
  const values = data.map(d => Number(d.revenue ?? d.amount ?? 0));

  // Draw chart using Canvas API directly — no external library needed
  const parent = ctx.parentNode;
  ctx.width = parent.offsetWidth - 48;
  ctx.height = 260;

  const c = ctx.getContext('2d');
  const W = ctx.width, H = ctx.height;
  const pad = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const maxVal = Math.max(...values, 1);
  const barW = Math.min(chartW / labels.length * 0.6, 50);
  const gap = chartW / labels.length;

  // Background
  c.fillStyle = 'transparent';
  c.fillRect(0, 0, W, H);

  // Grid lines
  c.strokeStyle = 'rgba(255,255,255,0.06)';
  c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    c.beginPath(); c.moveTo(pad.left, y); c.lineTo(W - pad.right, y); c.stroke();
    const val = Math.round(maxVal - (maxVal / 4) * i);
    c.fillStyle = 'rgba(160,160,184,0.6)';
    c.font = '11px DM Sans, sans-serif';
    c.textAlign = 'right';
    c.fillText(`₹${val}`, pad.left - 8, y + 4);
  }

  // Bars
  values.forEach((val, i) => {
    const x = pad.left + gap * i + (gap - barW) / 2;
    const barH = (val / maxVal) * chartH;
    const y = pad.top + chartH - barH;

    // Gradient
    const grad = c.createLinearGradient(x, y, x, y + barH);
    grad.addColorStop(0, 'rgba(108,99,255,0.9)');
    grad.addColorStop(1, 'rgba(108,99,255,0.3)');
    c.fillStyle = grad;
    c.beginPath();
    c.roundRect(x, y, barW, barH, 4);
    c.fill();

    // Label
    c.fillStyle = 'rgba(160,160,184,0.8)';
    c.font = '11px DM Sans, sans-serif';
    c.textAlign = 'center';
    c.fillText(labels[i], x + barW / 2, H - 10);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const dashboard = await fetchDashboard();
    const stats = dashboard.stats || {};
    const monthly = dashboard.monthly_sales || [];
    const topProducts = dashboard.top_products || [];
    const refunds = dashboard.refunds || {};
    const recentFromDash = dashboard.recent_orders ?? null;

    const [sellerProducts, sellerOrders] = await Promise.all([
      fetchSellerProducts(),
      fetchSellerOrders(),
    ]);

    let productsCount = 0;
    if (sellerProducts) {
      if (Array.isArray(sellerProducts)) productsCount = sellerProducts.length;
      else if (sellerProducts.results) productsCount = sellerProducts.count ?? sellerProducts.results.length;
    }

    renderSummaryCards(stats, productsCount);
    renderRefundsSummary(refunds);

    if (Array.isArray(topProducts) && topProducts.length) renderTopProducts(topProducts);
    else if (Array.isArray(sellerProducts) && sellerProducts.length) {
      renderTopProducts(sellerProducts.slice(0, 5).map(p => ({ ...p, total_revenue: 0, total_quantity: 0 })));
    } else if (sellerProducts?.results) {
      renderTopProducts(sellerProducts.results.slice(0, 5).map(p => ({ ...p, total_revenue: 0, total_quantity: 0 })));
    }

    const recentOrders = Array.isArray(recentFromDash) ? recentFromDash : Array.isArray(sellerOrders) ? sellerOrders : [];
    renderRecentOrders(recentOrders);
    renderSalesChart(monthly);
  } catch (err) {
    console.error('Dashboard error:', err);
    showAlert('Failed to load dashboard data', 'error');
  }
});
