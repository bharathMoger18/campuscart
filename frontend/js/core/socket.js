// js/core/socket.js
// WebSocket helper for chat connections with reconnect logic.
// Usage: const s = connectChat(convId, { onOpen, onMessage, onClose, onError });
// then s.send({ message: "hi" }); s.close();

import { API_BASE } from './config.js';
import * as storage from './storage.js';
import { showAlert } from './utils.js';

function buildWsHost() {
  try {
    const u = new URL(API_BASE);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}`;
  } catch (e) {
    return 'ws://127.0.0.1:8000';
  }
}

const WS_HOST = buildWsHost();

export function connectChat(conversationId, handlers = {}) {
  if (!conversationId) throw new Error('conversationId required');

  const {
    onOpen = () => {},
    onMessage = () => {},
    onClose = () => {},
    onError = () => {},
  } = handlers;

  let ws = null;
  let closedByUser = false;
  let reconnectAttempts = 0;

  function getUrl() {
    const token = storage.getAccess();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${WS_HOST}/ws/chat/${conversationId}/${qs}`;
  }

  function createSocket() {
    const url = getUrl();
    ws = new WebSocket(url);

    ws.addEventListener('open', (ev) => {
      reconnectAttempts = 0;
      onOpen(ev);
    });

    ws.addEventListener('message', (ev) => {
      let parsed = null;
      try {
        parsed = JSON.parse(ev.data);
      } catch (e) {
        console.warn('WS message not JSON', ev.data);
        parsed = { raw: ev.data };
      }
      onMessage(parsed, ev);
    });

    ws.addEventListener('error', (ev) => {
      onError(ev);
    });

    ws.addEventListener('close', (ev) => {
      onClose(ev);
      if (!closedByUser) {
        scheduleReconnect();
      }
    });
  }

  function scheduleReconnect() {
    reconnectAttempts += 1;
    const wait = Math.min(
      30000,
      1000 * Math.pow(1.6, Math.min(10, reconnectAttempts))
    );
    console.warn(`WebSocket closed — reconnecting in ${Math.round(wait)}ms`);
    setTimeout(() => {
      try {
        createSocket();
      } catch (e) {
        console.error('Reconnect failed', e);
        scheduleReconnect();
      }
    }, wait);
  }

  createSocket();

  return {
    send: (obj) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket is not open');
      }
      const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
      ws.send(payload);
    },
    close: () => {
      closedByUser = true;
      if (ws) ws.close();
    },
    rawSocket: () => ws,
  };
}
