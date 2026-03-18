// js/products.js
// Uses api wrapper: js/core/api.js -> exports { api }
// Uses utils.showAlert to show messages

import { api } from './core/api.js';
import { showAlert } from './core/utils.js';

const productGrid = document.getElementById('productGrid');
const filterBtn = document.getElementById('filterBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const searchInput = document.getElementById('searchInput');
const categorySelect = document.getElementById('categorySelect');
const sortSelect = document.getElementById('sortSelect');
const paginationEl = document.getElementById('pagination');

let currentPage = 1;
let lastPage = 1;
let lastQuery = {};

document.addEventListener('DOMContentLoaded', () => {
  // load initial
  loadProducts();

  filterBtn?.addEventListener('click', () => {
    currentPage = 1;
    loadProducts();
  });

  clearFiltersBtn?.addEventListener('click', () => {
    searchInput.value = '';
    categorySelect.value = '';
    sortSelect.value = '';
    currentPage = 1;
    loadProducts();
  });

  // enter key on search triggers filter
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      currentPage = 1;
      loadProducts();
    }
  });
});

async function loadProducts(page = 1) {
  const search = searchInput?.value.trim() || '';
  const category = categorySelect?.value || '';
  const ordering = sortSelect?.value || '';

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (category) params.append('category', category);
  if (ordering) params.append('ordering', ordering);
  params.append('page', page);

  // remember last query for pagination clicks
  lastQuery = { search, category, ordering };

  productGrid.innerHTML = `<div class="loader">Loading products...</div>`;
  paginationEl.innerHTML = '';

  try {
    const data = await api.get(`/products/?${params.toString()}`);
    // expected { count, next, previous, results }
    const items = data.results || [];
    lastPage = Math.ceil((data.count || items.length) / (items.length || 1));
    renderProducts(items);
    renderPagination(data);
  } catch (err) {
    console.error('Load products error', err);
    productGrid.innerHTML = '';
    showAlert('Failed to load products. Try again later.', 'error');
  }
}

function renderProducts(products) {
  productGrid.innerHTML = '';

  if (!products || products.length === 0) {
    productGrid.innerHTML = `<div class="empty">No products found for this search.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  products.forEach((p) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-media">
        <img loading="lazy" src="${
          p.image ?? '/assets/images/placeholder.png'
        }" alt="${escapeHtml(p.title)}" />
      </div>
      <div class="product-body">
        <h3 class="product-title">${escapeHtml(p.title)}</h3>
        <div class="product-meta">
          <div class="price">₹${p.price}</div>
          <div class="rating">⭐ ${p.average_rating ?? 0} (${
      p.total_reviews ?? 0
    })</div>
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      // product page in products/detail.html (located in products/ folder)
      window.location.href = `products/detail.html?id=${encodeURIComponent(
        p.id
      )}`;
    });
    fragment.appendChild(card);
  });

  productGrid.appendChild(fragment);
}

function renderPagination(data) {
  // Basic previous / page numbers / next
  const container = paginationEl;
  container.innerHTML = '';
  if (
    !data ||
    (!data.next &&
      !data.previous &&
      (data.count ?? 0) <= (data.results?.length || 0))
  )
    return;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-ghost';
  prevBtn.textContent = 'Prev';
  prevBtn.disabled = !data.previous;
  prevBtn.addEventListener('click', () => {
    if (data.previous) {
      currentPage = Math.max(1, currentPage - 1);
      loadProducts(currentPage);
    }
  });
  container.appendChild(prevBtn);

  // simple page indicator
  const pageInfo = document.createElement('span');
  pageInfo.className = 'page-info';
  pageInfo.textContent = `Page ${currentPage}`;
  container.appendChild(pageInfo);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-ghost';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = !data.next;
  nextBtn.addEventListener('click', () => {
    if (data.next) {
      currentPage = currentPage + 1;
      loadProducts(currentPage);
    }
  });
  container.appendChild(nextBtn);
}

/* helpers */
function escapeHtml(s) {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
