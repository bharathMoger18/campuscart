// js/auth/password_reset.js
import { requestPasswordReset } from '../core/auth.js';
import { showAlert, redirectTo } from '../core/utils.js';

const form = document.getElementById('passwordResetForm');
const btn = document.getElementById('passwordResetBtn');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    await requestPasswordReset(email);
    showAlert(
      "If your email is registered, you'll receive a reset link shortly.",
      'info'
    );
    redirectTo('login.html', 1600);
  } catch (err) {
    showAlert('Could not process request. Try again later.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Reset Link';
  }
});
