// js/core/notifications.js
// Helpers for push/notification REST endpoints and a poller that emits `notifCountUpdated` events.

import { api } from './api.js';
import { showAlert, parseErrors } from './utils.js';

export async function fetchNotifications(page = 1) {
  // returns the paginated results object from backend
  try {
    const data = await api.get(`/push/notifications/?page=${page}`);
    return data;
  } catch (err) {
    console.error('fetchNotifications error', err);
    throw err;
  }
}

export async function getUnreadCount() {
  try {
    const data = await fetchNotifications(1);
    const results = data.results || [];
    const unread = results.filter((n) => !n.read).length;
    return unread;
  } catch (err) {
    console.error('getUnreadCount', err);
    return 0;
  }
}

export async function markAsRead(id) {
  try {
    const res = await api.post(`/push/notifications/${id}/mark-read/`);
    return res;
  } catch (err) {
    console.error('markAsRead error', err);
    throw err;
  }
}

export async function markAllRead() {
  try {
    const res = await api.post(`/push/notifications/mark-all-read/`);
    return res;
  } catch (err) {
    console.error('markAllRead error', err);
    throw err;
  }
}

let _pollInterval = null;

/**
 * startPolling - polls unread count periodically and emits a global event
 * event: window.dispatchEvent(new CustomEvent('notifCountUpdated', { detail: { count: N } }))
 */
export function startPolling(intervalMs = 20000) {
  // one-off immediate update
  async function updateOnce() {
    try {
      const cnt = await getUnreadCount();
      window.dispatchEvent(
        new CustomEvent('notifCountUpdated', { detail: { count: cnt } })
      );
    } catch (err) {
      console.error('notifications poll error', err);
    }
  }

  updateOnce();

  if (_pollInterval) clearInterval(_pollInterval);
  _pollInterval = setInterval(updateOnce, intervalMs);
}

export function stopPolling() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}
