import { api } from './core/api.js';
import { showAlert, parseErrors } from './core/utils.js';

const reviewsSection = document.getElementById('reviewsSection');
const paginationContainer = document.getElementById('paginationContainer');
const sortSelect = document.getElementById('sortSelect');

let currentPage = 1;
let currentSort = '-created_at';
const pageSize = 5;

// ---------- Load Reviews ----------
async function loadReviews(page = 1, ordering = currentSort) {
  reviewsSection.innerHTML = `<div class="loading">Loading reviews...</div>`;
  try {
    const data = await api.get(
      `/reviews/?page=${page}&page_size=${pageSize}&ordering=${ordering}`
    );
    renderReviews(data.results || data);
    renderPagination(data);
  } catch (err) {
    console.error(err);
    reviewsSection.innerHTML = `<p class="empty">Failed to load reviews.</p>`;
  }
}

// ---------- Render Reviews ----------
function renderReviews(reviews) {
  if (!reviews || !reviews.length) {
    reviewsSection.innerHTML = `<p class="empty">You haven’t posted any reviews yet.</p>`;
    return;
  }

  const html = reviews
    .map(
      (r) => `
      <div class="review-card fade-in" data-id="${r.id}" data-product="${
        r.product
      }">
        <div class="review-header">
          <h3>${r.product_title}</h3>
          <div class="review-actions">
            <a href="../products/detail.html?id=${
              r.product
            }" class="btn btn-link">View Product</a>
            <button class="btn btn-outline btn-edit">✏️ Edit</button>
            <button class="btn btn-danger btn-delete">🗑 Delete</button>
          </div>
        </div>
        <div class="review-meta">
          ${r.user_email} • ${new Date(r.updated_at).toLocaleString()}
        </div>
        <div class="rating-stars">${'★'.repeat(r.rating)}${'☆'.repeat(
        5 - r.rating
      )}</div>
        <p class="review-comment">${r.comment}</p>

        <form class="edit-form hidden">
          <label>Rating (1–5):</label><br/>
          <input type="number" min="1" max="5" value="${
            r.rating
          }" required /><br/>
          <label>Comment:</label><br/>
          <textarea required>${r.comment}</textarea><br/>
          <div class="edit-actions">
            <button type="submit" class="btn btn-primary">💾 Save</button>
            <button type="button" class="btn btn-secondary btn-cancel">✖ Cancel</button>
          </div>
        </form>
      </div>
    `
    )
    .join('');

  reviewsSection.innerHTML = html;

  // Event bindings
  document
    .querySelectorAll('.btn-edit')
    .forEach((btn) => btn.addEventListener('click', handleEditClick));
  document
    .querySelectorAll('.btn-delete')
    .forEach((btn) => btn.addEventListener('click', handleDeleteClick));
}

// ---------- Pagination ----------
function renderPagination(data) {
  if (!data || !data.count) {
    paginationContainer.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(data.count / pageSize);
  let html = '';

  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="page-btn ${
      i === currentPage ? 'active' : ''
    }" data-page="${i}">${i}</button>`;
  }

  paginationContainer.innerHTML = html;

  paginationContainer.querySelectorAll('button').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      currentPage = parseInt(e.target.dataset.page);
      loadReviews(currentPage, currentSort);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
  );
}

// ---------- Edit Review ----------
function handleEditClick(e) {
  const card = e.target.closest('.review-card');
  const form = card.querySelector('.edit-form');
  const comment = card.querySelector('.review-comment');

  // Hide all other edit forms
  document
    .querySelectorAll('.edit-form')
    .forEach((f) => f.classList.add('hidden'));
  document
    .querySelectorAll('.review-comment')
    .forEach((c) => c.classList.remove('hidden'));

  // Show only this one
  form.classList.remove('hidden');
  comment.classList.add('hidden');

  const cancelBtn = form.querySelector('.btn-cancel');
  cancelBtn.onclick = () => {
    form.classList.add('hidden');
    comment.classList.remove('hidden');
  };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const rating = parseInt(form.querySelector('input').value);
    const commentText = form.querySelector('textarea').value.trim();
    const id = card.dataset.id;
    const productId = parseInt(card.dataset.product);

    try {
      await api.put(`/reviews/${id}/`, {
        product: productId,
        rating,
        comment: commentText,
      });
      showAlert('✅ Review updated successfully!', 'success');
      await loadReviews(currentPage, currentSort);
    } catch (err) {
      console.error(err);
      showAlert(
        parseErrors(err.data) || '❌ Failed to update review.',
        'error'
      );
    }
  };
}

// ---------- Delete Review ----------

async function handleDeleteClick(e) {
  const card = e.target.closest('.review-card');
  const id = card.dataset.id;

  if (
    !confirm(
      '🗑 Are you sure you want to delete this review? This action cannot be undone.'
    )
  )
    return;

  try {
    await api.delete(`/reviews/${id}/`);
    showAlert('✅ Review deleted successfully!', 'success');
    await loadReviews(currentPage, currentSort);
  } catch (err) {
    console.error(err);
    showAlert(parseErrors(err.data) || '❌ Failed to delete review.', 'error');
  }
}

// ---------- Confirmation Modal ----------
function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'confirm-modal';
    modal.innerHTML = `
      <div class="confirm-box fade-in">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn btn-danger" id="confirmYes">Yes</button>
          <button class="btn btn-secondary" id="confirmNo">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#confirmYes').addEventListener('click', () => {
      modal.remove();
      resolve(true);
    });
    modal.querySelector('#confirmNo').addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });
  });
}

// ---------- Sorting ----------
sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  loadReviews(1, currentSort);
});

// ---------- Init ----------
loadReviews();
