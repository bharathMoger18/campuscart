// js/auth/verify_email.js
import { verifyEmail } from '../core/auth.js';
import { showAlert, redirectTo } from '../core/utils.js';

async function run() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid') || params.get('uidb64') || null;
  const token = params.get('token') || null;

  if (!uid || !token) {
    showAlert('Invalid verification link.', 'error');
    return;
  }

  try {
    const res = await verifyEmail(uid, token);
    showAlert(
      res?.detail || 'Email verified successfully! You can now log in.',
      'success'
    );
    redirectTo('login.html', 1500);
  } catch (err) {
    const d = err?.data || {};
    showAlert(d?.detail || 'Invalid or expired verification link.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', run);
