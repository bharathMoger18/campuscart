import { api } from '../../js/core/api.js';
import { showAlert, parseErrors } from '../../js/core/utils.js';

const params = new URLSearchParams(location.search);
const orderId = params.get('id');
const timelineContainer = document.getElementById('timelineContainer');
const progressContainer = document.getElementById('progressContainer');
const reviewContainer = document.getElementById('reviewContainer');
const STATUS_STEPS = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED'];

async function loadTracking() {
  if (!orderId) { timelineContainer.innerHTML = `<div class="empty">Invalid order ID.</div>`; return; }
  try {
    const data = await api.get(`/orders/${orderId}/track/`);
    renderTracking(data);
  } catch {
    timelineContainer.innerHTML = `<div class="empty">Failed to load tracking info.</div>`;
  }
}

function renderTracking(data) {
  const { current_status, timeline } = data;
  const currentIndex = STATUS_STEPS.indexOf(current_status);

  progressContainer.innerHTML = STATUS_STEPS.map((status, i) => {
    const state = i < currentIndex ? 'completed' : i === currentIndex ? 'active' : '';
    return `
      <div class="status-step ${state}">
        <div class="dot"></div>
        <label>${status}</label>
      </div>`;
  }).join('');

  if (!timeline?.length) {
    timelineContainer.innerHTML = `<div class="empty">No tracking data yet.</div>`;
    return;
  }

  timelineContainer.innerHTML = timeline.map(t => `
    <div class="timeline-step ${t.to_status === current_status ? 'done' : ''}">
      <div class="content">
        <h4>${t.to_status}</h4>
        <p>${t.note || 'Order placed'}</p>
        <small>${t.actor ? `${t.actor.name} (${t.actor.email})` : 'System update'} — ${new Date(t.timestamp).toLocaleString('en-IN')}</small>
      </div>
    </div>`).join('');

  if (current_status === 'COMPLETED') loadReviewForms(orderId);
}

async function loadReviewForms(orderId) {
  try {
    const order = await api.get(`/orders/${orderId}/`);
    const products = order.items || [];
    if (!products.length) return;

    reviewContainer.innerHTML = `
      <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border)">
        <h3 style="font-family:var(--font-display);font-size:1rem;font-weight:700;color:var(--text);margin-bottom:1rem">Leave a Review</h3>
        ${products.map(p => `
          <form class="review-form" data-product-id="${p.product.id}" style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:1rem">
            <h4 style="color:var(--text);font-size:.95rem;margin-bottom:1rem">&#11088; Review for ${escapeHtml(p.product.title)}</h4>
            <div class="form-group">
              <label>Rating (1-5)</label>
              <input type="number" min="1" max="5" placeholder="5" required style="width:100px" />
            </div>
            <div class="form-group">
              <label>Comment</label>
              <textarea placeholder="Share your experience..." required rows="3"></textarea>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Submit Review</button>
          </form>`).join('')}
      </div>`;

    document.querySelectorAll('.review-form').forEach(form => {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const productId = form.getAttribute('data-product-id');
        const rating = parseInt(form.querySelector('input').value);
        const comment = form.querySelector('textarea').value.trim();
        if (!rating || rating < 1 || rating > 5) { showAlert('Rating must be 1-5.', 'error'); return; }
        try {
          await api.post('/reviews/', { product: parseInt(productId), rating, comment });
          showAlert('Review submitted!', 'success');
          form.reset();
        } catch (err) { showAlert(parseErrors(err.data) || 'Failed to submit.', 'error'); }
      });
    });
  } catch { /* ignore */ }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

loadTracking();
