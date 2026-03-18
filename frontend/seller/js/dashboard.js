// frontend/seller/js/dashboard.js
import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

async function fetchDashboard() {
  const res = await api.get('/orders/seller/dashboard/');
  console.log('🟢 /orders/seller/dashboard/ response:', res);
  return res;
}

async function fetchSellerOrders() {
  try {
    const res = await api.get('/orders/seller/orders/');
    console.log('🟢 /orders/seller/orders/ response:', res);
    return res;
  } catch (e) {
    console.error('🔴 Error fetching seller orders:', e);
    return [];
  }
}

async function fetchSellerProducts() {
  try {
    const res = await api.get('/seller/products/');
    console.log('🟢 /seller/products/ response:', res);
    return res;
  } catch (e) {
    console.error('🔴 Error fetching seller products:', e);
    return [];
  }
}

function formatCurrency(v) {
  const n = Number(v ?? 0);
  if (Number.isNaN(n)) return '₹0.00';
  return `₹${n.toFixed(2)}`;
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

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderTopProducts(list) {
  const container = document.getElementById('topProducts');
  if (!container) return;
  if (!Array.isArray(list) || !list.length) {
    container.innerHTML = `<div style="color:#6b7280">No top products</div>`;
    return;
  }
  container.innerHTML = list
    .slice(0, 6)
    .map((p) => {
      const img = p.image ? p.image : '/assets/images/placeholder.png';
      const revenue = Number(p.total_revenue ?? p.totalRevenue ?? 0);
      const qty = Number(p.total_quantity ?? p.totalQuantity ?? 0);
      const title = escapeHtml(p.title || p.product_title || 'Product');
      return `
        <div class="top-product">
          <img src="${img}" alt="${title}" onerror="this.src='/assets/images/placeholder.png'">
          <div>
            <div style="font-weight:700">${title}</div>
            <div style="font-size:0.9rem; color:#6b7280;">Qty: ${qty} • ${formatCurrency(
        revenue
      )}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderRefundsSummary(refunds) {
  const el = document.getElementById('refundsSummary');
  if (!el) return;
  if (!refunds) {
    el.textContent = 'No refund data';
    return;
  }
  el.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:0.35rem;">
      <div><strong>Total requests:</strong> ${refunds.total_requests ?? 0}</div>
      <div><strong>Approved:</strong> ${refunds.approved ?? 0}</div>
      <div><strong>Rejected:</strong> ${refunds.rejected ?? 0}</div>
      <div><strong>Refunded amount:</strong> ${formatCurrency(
        refunds.refunded_amount ?? 0
      )}</div>
      <div><strong>Refund rate:</strong> ${(refunds.refund_rate ?? 0).toFixed(
        2
      )}%</div>
    </div>
  `;
}

function renderSummaryCards(stats = {}, productsCount) {
  const totalProducts = productsCount ?? stats.total_products ?? 0;
  document.getElementById('totalProducts').textContent = totalProducts;
  document.getElementById('totalOrders').textContent = stats.total_orders ?? 0;
  document.getElementById('totalRevenue').textContent = formatCurrency(
    stats.total_revenue ?? 0
  );
}

function renderRecentOrders(orders) {
  const tbody = document.getElementById('recentOrdersTable');
  if (!tbody) return;
  if (!Array.isArray(orders) || orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1rem;">No recent orders</td></tr>`;
    return;
  }

  tbody.innerHTML = orders
    .slice(0, 10)
    .map((o) => {
      const prod =
        (o.items &&
          o.items[0] &&
          (o.items[0].product?.title || o.items[0].product_title)) ||
        '-';
      const status = o.status ?? 'N/A';
      const total = o.total_price ?? o.total ?? '0';
      const created = o.created_at ?? o.date ?? o.created;
      const date = created ? new Date(created).toLocaleString() : '-';
      const badgeClass = statusToBadgeClass(status);
      return `
        <tr>
          <td><a href="./order_detail.html?id=${o.id}">${o.id}</a></td>
          <td>${escapeHtml(prod)}</td>
          <td><span class="status-badge ${badgeClass}">${escapeHtml(
        status
      )}</span></td>
          <td style="font-weight:700">${formatCurrency(total)}</td>
          <td>${date}</td>
        </tr>
      `;
    })
    .join('');
}

function renderSalesChart(data) {
  const ctx = document.getElementById('salesChart');
  if (!ctx) return;

  const labels = (data || []).map((d) => d.month || d.label || '');
  const values = (data || []).map((d) =>
    Number(d.revenue ?? d.amount ?? d.value ?? 0)
  );

  console.log('📊 Chart data prepared:', { labels, values });

  // ✅ Using the UMD build ensures Chart is global
  import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js')
    .then((mod) => {
      console.log('🧩 Chart.js module loaded:', mod);
      console.log('🔍 typeof mod:', typeof mod);
      console.log('🔍 window.Chart:', window.Chart);

      const ChartLib = mod.Chart || window.Chart;
      console.log('✅ ChartLib selected:', ChartLib);

      if (typeof ChartLib !== 'function') {
        console.error('🚨 ChartLib is not a constructor. Received:', ChartLib);
        return;
      }

      // Replace canvas to avoid duplicate charts
      const parent = ctx.parentNode;
      const newCanvas = document.createElement('canvas');
      newCanvas.id = ctx.id;
      parent.replaceChild(newCanvas, ctx);

      console.log('🖌️ Creating chart now...');
      new ChartLib(newCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Revenue',
              data: values,
              backgroundColor: 'rgba(14, 165, 164, 0.7)',
            },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: (val) => `₹${val}` },
            },
          },
        },
      });

      console.log('✅ Chart successfully rendered.');
    })
    .catch((err) => {
      console.error('❌ Failed to load Chart.js or render chart:', err);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const dashboard = await fetchDashboard();
    const stats = dashboard.stats || {};
    const monthly = dashboard.monthly_sales || [];
    const topProducts = dashboard.top_products || [];
    const refunds = dashboard.refunds || {};
    const recentOrdersFromDashboard = dashboard.recent_orders ?? null;

    const [sellerProducts, sellerOrders] = await Promise.all([
      fetchSellerProducts(),
      fetchSellerOrders(),
    ]);

    // Handle paginated structure from API
    let productsCount = 0;
    if (sellerProducts) {
      if (Array.isArray(sellerProducts)) {
        productsCount = sellerProducts.length;
      } else if (
        sellerProducts.results &&
        Array.isArray(sellerProducts.results)
      ) {
        productsCount = sellerProducts.count ?? sellerProducts.results.length;
      }
    }

    renderSummaryCards(stats, productsCount);
    renderRefundsSummary(refunds);

    if (Array.isArray(topProducts) && topProducts.length)
      renderTopProducts(topProducts);
    else if (Array.isArray(sellerProducts) && sellerProducts.length) {
      const fallback = sellerProducts.slice(0, 6).map((p) => ({
        id: p.id,
        title: p.title,
        image: p.image,
        total_revenue: 0,
        total_quantity: 0,
      }));
      renderTopProducts(fallback);
    } else renderTopProducts([]);

    const recentOrders = Array.isArray(recentOrdersFromDashboard)
      ? recentOrdersFromDashboard
      : Array.isArray(sellerOrders)
      ? sellerOrders
      : [];
    renderRecentOrders(recentOrders);
    renderSalesChart(monthly);
  } catch (err) {
    console.error('Error loading seller dashboard:', err);
    showAlert('Failed to load seller dashboard data', 'error');
    renderRecentOrders([]);
    renderTopProducts([]);
    renderRefundsSummary(null);
  }
});
