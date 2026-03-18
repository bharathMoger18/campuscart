import { api } from '../../js/core/api.js';
import { showAlert, parseErrors } from '../../js/core/utils.js';

const params = new URLSearchParams(location.search);
const orderId = params.get('id');

const timelineContainer = document.getElementById('timelineContainer');
const progressContainer = document.getElementById('progressContainer');
const reviewContainer = document.getElementById('reviewContainer');

// Define the order lifecycle steps (adjust to your backend)
const STATUS_STEPS = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED'];

async function loadTracking() {
  if (!orderId) {
    timelineContainer.innerHTML = `<p class="empty">Invalid order ID.</p>`;
    return;
  }

  try {
    const data = await api.get(`/orders/${orderId}/track/`);
    renderTracking(data);
  } catch (err) {
    console.error(err);
    timelineContainer.innerHTML = `<p class="empty">Failed to load tracking info.</p>`;
  }
}

function renderTracking(data) {
  const { current_status, timeline, items } = data;

  // --- Render progress tracker ---
  const currentIndex = STATUS_STEPS.indexOf(current_status);
  progressContainer.innerHTML = `
    <div class="status-progress">
      ${STATUS_STEPS.map((status, i) => {
        const state =
          i < currentIndex ? 'completed' : i === currentIndex ? 'active' : '';
        return `
          <div class="status-step ${state}">
            <div class="dot"></div>
            <label>${status}</label>
          </div>`;
      }).join('')}
    </div>
  `;

  // --- Render timeline ---
  if (!timeline || !timeline.length) {
    timelineContainer.innerHTML = `<p class="empty">No tracking data available.</p>`;
    return;
  }

  const timelineHTML = timeline
    .map(
      (t) => `
    <div class="timeline-step ${t.to_status === current_status ? 'done' : ''}">
      <div class="content">
        <h4>${t.to_status}</h4>
        <p>${t.note || ''}</p>
        <small>
          ${t.actor ? `${t.actor.name} (${t.actor.email})` : 'System update'}
          — ${new Date(t.timestamp).toLocaleString()}
        </small>
      </div>
    </div>`
    )
    .join('');

  timelineContainer.innerHTML = `<div class="timeline">${timelineHTML}</div>`;

  // --- Show review form if completed ---
  if (current_status === 'COMPLETED') {
    loadOrderProductsForReview(orderId);
  }
}

// ✅ Load order details to show each product review form
async function loadOrderProductsForReview(orderId) {
  try {
    const orderDetail = await api.get(`/orders/${orderId}/`);
    const products = orderDetail.items || [];

    if (!products.length) {
      reviewContainer.innerHTML = `<p class="empty">No products found in this order.</p>`;
      return;
    }

    const formsHTML = products
      .map(
        (p) => `
      <form class="review-form" data-product-id="${p.product.id}">
        <h3>Review for ${p.product.title}</h3>
        <label>Rating (1–5):</label><br/>
        <input type="number" min="1" max="5" required /><br/>
        <label>Comment:</label><br/>
        <textarea placeholder="Share your experience..." required></textarea><br/>
        <button type="submit" class="btn">Submit Review</button>
      </form>
    `
      )
      .join('');

    reviewContainer.innerHTML = formsHTML;

    // attach handlers to each form
    document.querySelectorAll('.review-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const productId = form.getAttribute('data-product-id');
        const rating = parseInt(form.querySelector('input').value);
        const comment = form.querySelector('textarea').value.trim();

        if (!rating || rating < 1 || rating > 5) {
          showAlert('Please select a rating between 1 and 5.', 'warning');
          return;
        }

        try {
          const res = await api.post(`/reviews/`, {
            product: parseInt(productId),
            rating,
            comment,
          });
          showAlert('Review submitted successfully!', 'success');
          form.reset();
        } catch (err) {
          console.error(err);
          showAlert(parseErrors(err.data), 'error');
        }
      });
    });
  } catch (err) {
    console.error(err);
    reviewContainer.innerHTML = `<p class="empty">Failed to load products for review.</p>`;
  }
}

// --- Load the data ---
loadTracking();
