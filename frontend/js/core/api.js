// js/core/api.js
import { API_BASE, REFRESH_ENDPOINT } from './config.js';
import * as storage from './storage.js';

let isRefreshing = false;
let refreshPromise = null;

async function request(
  path,
  { method = 'GET', body = null, headers = {} } = {},
  retry = true
) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const init = { method, headers: { ...headers } };

  // ✅ Handle FormData (don’t set Content-Type manually)
  const isForm = body instanceof FormData;
  if (!isForm) init.headers['Content-Type'] = 'application/json';

  // ✅ Attach access token
  const access = storage.getAccess();
  if (access) init.headers['Authorization'] = `Bearer ${access}`;

  // ✅ Body handling
  if (body) init.body = isForm ? body : JSON.stringify(body);

  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw { status: 0, data: { detail: 'Network error or server offline' } };
  }

  // ✅ Parse JSON safely
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  // ✅ Success
  if (response.ok) return data;

  // 🔄 Try token refresh
  if (response.status === 401 && retry && storage.getRefresh()) {
    try {
      await handleRefresh();
      return await request(path, { method, body, headers }, false);
    } catch {
      storage.clearTokens();
      throw { status: 401, data: { detail: 'Unauthorized (refresh failed)' } };
    }
  }

  // ❌ Error
  throw {
    status: response.status,
    data: data ?? { detail: response.statusText },
  };
}

async function handleRefresh() {
  if (isRefreshing) return refreshPromise;

  const refresh = storage.getRefresh();
  if (!refresh) throw new Error('No refresh token');

  isRefreshing = true;
  const url = `${API_BASE}${REFRESH_ENDPOINT}`;

  refreshPromise = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  })
    .then(async (res) => {
      isRefreshing = false;
      refreshPromise = null;
      if (!res.ok) throw new Error('Refresh failed');
      const json = await res.json();
      storage.setTokens({
        access: json.access,
        refresh: json.refresh ?? refresh,
      });
      return json;
    })
    .catch((err) => {
      isRefreshing = false;
      refreshPromise = null;
      storage.clearTokens();
      throw err;
    });

  return refreshPromise;
}

export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
