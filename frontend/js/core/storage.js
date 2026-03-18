// js/core/storage.js
// Simple wrapper around localStorage for tokens + safe helpers

const ACCESS_KEY = 'cc_access';
const REFRESH_KEY = 'cc_refresh';
const USER_KEY = 'cc_user'; // optional cached user profile

export function setTokens({ access, refresh }) {
  if (access) localStorage.setItem(ACCESS_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

export function getAccess() {
  return localStorage.getItem(ACCESS_KEY);
}
export function getRefresh() {
  return localStorage.getItem(REFRESH_KEY);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function setUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
