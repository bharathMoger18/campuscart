import { api } from '../../js/core/api.js';
import { showAlert } from '../../js/core/utils.js';

async function fetchProducts() {
  const container = document.getElementById('productListContainer');
  container.innerHTML = `<div class="loading">Loading your products...</div>`;

  try {
    const data = await api.get('/seller/products/');
    const products = data.results || data || [];

    if (!products.length) {
      container.innerHTML = '<div class="loading">No products found.</div>';
      return;
    }

    container.innerHTML = '';
    products.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'product-card';
      const imageSrc = p.image || '../assets/images/placeholder.png';

      card.innerHTML = `
        <img src="${imageSrc}" alt="${p.title}" />
        <div class="product-info">
          <h3>${p.title}</h3>
          <p>${p.category}</p>
          <p><strong>₹${p.price}</strong></p>
          <div class="product-actions">
            <button class="btn-edit" data-id="${p.id}">Edit</button>
            <button class="btn-delete" data-id="${p.id}">Delete</button>
          </div>
        </div>
      `;
      container.appendChild(card);
    });

    document.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.location.href = `../products/create.html?id=${btn.dataset.id}`;
      });
    });

    document.querySelectorAll('.btn-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Are you sure you want to delete this product?'))
          return;
        try {
          await api.delete(`/products/${btn.dataset.id}/`);
          showAlert('✅ Product deleted', 'success');
          fetchProducts();
        } catch (err) {
          console.error(err);
          showAlert('❌ Failed to delete product', 'error');
        }
      });
    });
  } catch (err) {
    console.error(err);
    showAlert('Failed to load products.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', fetchProducts);
