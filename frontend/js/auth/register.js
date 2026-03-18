// js/auth/register.js
import { registerUser } from '../core/auth.js';
import {
  showAlert,
  showLoader,
  hideLoader,
  parseErrors,
  redirectTo,
} from '../core/utils.js';
import {
  isEmail,
  passwordStrength,
  passwordsMatch,
} from '../core/validator.js';

const form = document.getElementById('registerForm');
const submitBtn = document.getElementById('registerBtn');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const password2 = document.getElementById('password2').value;
  const campus = document.getElementById('campus').value.trim();
  const phone = document.getElementById('phone').value.trim();

  if (!name) return showAlert('Name is required', 'error');
  if (!isEmail(email)) return showAlert('Enter a valid email', 'error');

  const pwCheck = passwordStrength(password);
  if (!pwCheck.valid)
    return showAlert('Password weak: ' + pwCheck.reasons.join(' '), 'error');

  if (!passwordsMatch(password, password2))
    return showAlert("Passwords don't match", 'error');

  const payload = { name, email, password, password2 };
  if (campus) payload.campus = campus;
  if (phone) payload.phone = phone;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';
  showLoader(submitBtn);

  try {
    const res = await registerUser(payload); // expecting 201
    showAlert(
      'Registration successful! Check your email to verify your account.',
      'success'
    );
    redirectTo('login.html', 1800);
  } catch (err) {
    // err: { status, data }
    const message = err?.data ? parseErrors(err.data) : 'Registration failed';
    showAlert(message, 'error', { timeout: 6000 });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Register';
    hideLoader(submitBtn);
  }
});
