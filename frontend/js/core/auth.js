// js/core/auth.js
import { api } from './api.js';
import * as storage from './storage.js';
import { LOGIN_ENDPOINT } from './config.js';

const BASE = ''; // endpoints are used relative to /api/v1 already inside API_BASE usage

export async function registerUser(payload) {
  // endpoint: POST /api/v1/auth/register/
  return api.post('/auth/register/', payload);
}

export async function verifyEmail(uidb64, token) {
  return api.get(
    `/auth/verify/${encodeURIComponent(uidb64)}/${encodeURIComponent(token)}/`
  );
}

export async function loginUser(credentials) {
  // endpoint: POST /api/v1/auth/token/
  const res = await api.post(LOGIN_ENDPOINT, credentials);
  // expect { access, refresh }
  if (res.access)
    storage.setTokens({ access: res.access, refresh: res.refresh });
  return res;
}

export async function logout() {
  storage.clearTokens();
  // optionally inform backend
}

export async function requestPasswordReset(email) {
  return api.post('/auth/password_reset/', { email });
}

export async function confirmPasswordReset(uidb64, token, passwords) {
  // POST /auth/password_reset_confirm/<uid>/<token>/
  return api.post(
    `/auth/password_reset_confirm/${encodeURIComponent(
      uidb64
    )}/${encodeURIComponent(token)}/`,
    passwords
  );
}

export async function getProfile() {
  return api.get('/users/me/');
}
