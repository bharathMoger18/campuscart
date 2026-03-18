// js/auth/password_reset_confirm.js
import { confirmPasswordReset } from '../core/auth.js';
import { showAlert, redirectTo } from '../core/utils.js';
import { passwordStrength, passwordsMatch } from '../core/validator.js';

const form = document.getElementById('passwordResetConfirmForm');
const btn = document.getElementById('passwordResetConfirmBtn');

async function run() {
  // read uid/token from URL query params
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid') || params.get('uidb64');
  const token = params.get('token');
  if (!uid || !token) {
    showAlert('Invalid reset link.', 'error');
    return;
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const password2 = document.getElementById('password2').value;

    const pwCheck = passwordStrength(password);
    if (!pwCheck.valid)
      return showAlert('Password weak: ' + pwCheck.reasons.join(' '), 'error');
    if (!passwordsMatch(password, password2))
      return showAlert("Passwords don't match", 'error');

    btn.disabled = true;
    btn.textContent = 'Processing...';
    try {
      const res = await confirmPasswordReset(uid, token, {
        password,
        password2,
      });
      showAlert(
        res?.detail || 'Password reset successful. You can now log in.',
        'success'
      );
      redirectTo('login.html', 1500);
    } catch (err) {
      showAlert(err?.data?.detail || 'Invalid or expired link.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Set New Password';
    }
  });
}

document.addEventListener('DOMContentLoaded', run);
