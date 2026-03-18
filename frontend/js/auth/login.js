// js/auth/login.js
import { loginUser, getProfile } from '../core/auth.js';
import { showAlert, redirectTo } from '../core/utils.js';

const form = document.getElementById('loginForm');
const btn = document.getElementById('loginBtn');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const res = await loginUser({ email, password });
    showAlert('Login successful! Redirecting...', 'success');

    // ✅ Get user profile
    let profile = null;
    try {
      profile = await getProfile();
    } catch (e) {
      console.warn('Failed to fetch profile', e);
    }

    // ✅ Redirect based on role
    if (profile?.is_superuser || profile?.is_staff) {
      // Admin or staff → Django admin
      window.location.href = 'http://localhost:8000/admin/';
    } else {
      // Normal user → Home page
      redirectTo('index.html', 800);
    }
  } catch (err) {
    const data = err?.data || {};
    const msg =
      data?.detail ||
      (data?.non_field_errors ? data.non_field_errors.join(' ') : null);
    showAlert(msg || 'Invalid email or password.', 'error', { timeout: 5000 });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
});
