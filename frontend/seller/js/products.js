import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

async function fetchProducts() {
  const container = document.getElementById('productListContainer');
  container.innerHTML = `<div class="loading">Loading your products...</div>`;

  try {
    const data = await api.get('/seller/products/');
    const products = data.results || data || [];

    if (!products.length) {
      container.innerHTML = `
        <div class="empty-products">
          <div class="empty-icon">📦</div>
          <h2>No products yet</h2>
          <p>Add your first product to start selling</p>
          <a href="/products/create.html" class="btn btn-primary">+ Add Product</a>
        </div>`;
      return;
    }

    container.innerHTML = '';
    products.forEach(p => {
      const card = document.createElement('div');
      card.className = 'seller-product-card';
      const imageSrc = p.image || '/assets/images/placeholder.png';
      card.innerHTML = `
        <img src="${imageSrc}" alt="${escapeHtml(p.title)}" onerror="this.src='/assets/images/placeholder.png'" />
        <div class="seller-product-info">
          <h3>${escapeHtml(p.title)}</h3>
          <div class="category">${escapeHtml(p.category)}</div>
          <div class="price">&#8377;${p.price}</div>
          <span class="avail ${p.is_available ? 'yes' : 'no'}">${p.is_available ? '✅ Available' : '❌ Unavailable'}</span>
        </div>
        <div class="seller-product-actions">
          <button class="btn-edit-p" data-id="${p.id}">✏️ Edit</button>
          <button class="btn-delete-p" data-id="${p.id}">🗑️ Delete</button>
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll('.btn-edit-p').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.href = `/products/create.html?id=${btn.dataset.id}`;
      });
    });

    container.querySelectorAll('.btn-delete-p').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this product?')) return;
        btn.disabled = true;
        btn.textContent = 'Deleting...';
        try {
          await api.delete(`/products/${btn.dataset.id}/`);
          showAlert('Product deleted successfully.', 'success');
          fetchProducts();
        } catch {
          showAlert('Failed to delete product.', 'error');
          btn.disabled = false;
          btn.textContent = '🗑️ Delete';
        }
      });
    });

  } catch {
    showAlert('Failed to load products.', 'error');
    container.innerHTML = `
      <div class="empty-products">
        <div class="empty-icon">⚠️</div>
        <h2>Failed to load</h2>
        <p>Please try again later</p>
      </div>`;
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

document.addEventListener('DOMContentLoaded', fetchProducts);
