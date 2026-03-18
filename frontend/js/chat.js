// js/chat.js
// Chat page logic: create/get conversation, connect WS, render messages, send messages.

import { api } from './core/api.js';
import { showAlert } from './core/utils.js';
import * as storage from './core/storage.js';
import { connectChat } from './core/socket.js';
import { getUnreadCount } from './core/notifications.js';

// --- URL Params ---
const params = new URLSearchParams(window.location.search);
const conversationIdParam =
  params.get('conversation') || params.get('conv') || params.get('id');
const productParam = params.get('product');
const otherUserParam = params.get('other_user');

// --- DOM Elements ---
const messagesEl = document.getElementById('messages');
const convTitle = document.getElementById('convTitle');
const convMeta = document.getElementById('convMeta');
const infoList = document.getElementById('infoList');
const sendForm = document.getElementById('sendForm');
const messageInput = document.getElementById('messageInput');
const statusBadge = document.getElementById('statusBadge');

// --- Globals ---
let conversation = null;
let socketInstance = null;
let currentUser = null;
let lastSentText = null; // ✅ Tracks last message sent for echo prevention
let reconnectTimeout = null;

// === INIT ===
async function init() {
  try {
    currentUser = await api.get('/users/me/');
  } catch (e) {
    console.warn('Failed to fetch current user', e);
    currentUser = null;
  }

  // Determine conversation source
  if (conversationIdParam) {
    await loadConversation(conversationIdParam);
  } else if (productParam && otherUserParam) {
    await createConversation(productParam, otherUserParam);
  } else {
    messagesEl.innerHTML = `<div class="empty">No conversation specified. Use ?conversation=<id> or provide product & other_user</div>`;
    sendForm.style.display = 'none';
    return;
  }

  connectSocket();

  // Message send form
  sendForm.addEventListener('submit', handleSend);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendForm.requestSubmit();
    }
  });
}

// === LOAD EXISTING CONVERSATION ===
async function loadConversation(id) {
  try {
    const conv = await api.get(`/conversations/${id}/`);
    conversation = conv;
    renderConversation(conv);
  } catch (err) {
    console.error('loadConversation error', err);
    showAlert('Failed to load conversation.', 'error');
  }
}

// === CREATE NEW CONVERSATION ===
async function createConversation(product, other_user) {
  try {
    const conv = await api.post('/conversations/', {
      product: parseInt(product, 10),
      other_user: parseInt(other_user, 10),
    });
    conversation = conv;
    renderConversation(conv);
  } catch (err) {
    console.error('createConversation err', err);
    showAlert('Failed to create conversation.', 'error');
  }
}

// === RENDER CONVERSATION INFO ===
function renderConversation(conv) {
  convTitle.textContent = `Conversation #${conv.id}`;
  convMeta.textContent = `Product: ${conv.product || 'N/A'} • Participants: ${
    conv.participants?.map((p) => p.name || p.email).join(', ') || 'N/A'
  }`;

  infoList.innerHTML = `
    <div class="meta"><strong>Participants</strong></div>
    <ul>
      ${(conv.participants || [])
        .map((p) => `<li>${p.name || p.email} (${p.email})</li>`)
        .join('')}
    </ul>
    <div style="margin-top:0.6rem;" class="meta">
      <strong>Created</strong>
      <div>${new Date(conv.created_at).toLocaleString()}</div>
    </div>
  `;

  const msgs = conv.messages || [];
  renderMessages(msgs);
}

// === RENDER ALL MESSAGES ===
function renderMessages(messages) {
  messagesEl.innerHTML = '';
  if (!messages || messages.length === 0) {
    messagesEl.innerHTML =
      '<div class="empty">No messages yet — say hello 👋</div>';
    return;
  }
  messages.forEach((m) => appendMessage(m, false));
  scrollToBottom();
}

// === APPEND MESSAGE TO LIST ===
function appendMessage(m, scroll = true) {
  const meId = currentUser?.id;
  const isMe =
    meId && (m.sender_id === meId || String(m.sender_id) === String(meId));
  const wrapper = document.createElement('div');
  wrapper.className = `message ${isMe ? 'msg-outgoing' : 'msg-incoming'}`;
  if (m._optimistic) wrapper.classList.add('optimistic');

  const text = m.text ?? m.message ?? m.body ?? m.message_text ?? '';
  wrapper.innerHTML = `
    <div>${escapeHtml(text)}</div>
    <div class="msg-meta">${escapeHtml(
      m.sender_name || m.sender || (isMe ? 'You' : 'User')
    )} • ${new Date(
    m.timestamp || m.created_at || Date.now()
  ).toLocaleString()}</div>
  `;
  messagesEl.appendChild(wrapper);

  if (scroll) scrollToBottom();
}

function scrollToBottom() {
  setTimeout(() => (messagesEl.scrollTop = messagesEl.scrollHeight), 30);
}

// === SOCKET CONNECTION ===
function connectSocket() {
  if (!conversation) return;
  statusBadge.textContent = 'Connecting...';

  socketInstance = connectChat(conversation.id, {
    onOpen: () => {
      clearTimeout(reconnectTimeout);
      statusBadge.textContent = 'Connected';
    },
    onMessage: handleSocketMessage,
    onClose: () => {
      statusBadge.textContent = 'Disconnected';
      reconnectTimeout = setTimeout(connectSocket, 4000); // 🔁 Auto-reconnect
    },
    onError: (e) => {
      console.error('Socket error', e);
      statusBadge.textContent = 'Error';
    },
  });
}

// === HANDLE WS MESSAGE ===
async function handleSocketMessage(payload) {
  if (!payload) return;

  if (payload.message === 'Connected successfully.') return;

  const msgText =
    payload.text || payload.message || payload.body || payload.message_text;
  const meId = currentUser?.id;

  // 🔹 Echo detection (avoid duplicate rendering)
  const isEcho =
    payload.sender_id &&
    meId &&
    String(payload.sender_id) === String(meId) &&
    lastSentText &&
    msgText &&
    msgText.trim() === lastSentText.trim();

  if (isEcho) {
    const optimistic = messagesEl.querySelector('.message.optimistic');
    if (optimistic) {
      optimistic.classList.remove('optimistic');
      optimistic.innerHTML = `
        <div>${escapeHtml(msgText)}</div>
        <div class="msg-meta">${escapeHtml(
          payload.sender_name || 'You'
        )} • ${new Date(
        payload.timestamp || payload.created_at || Date.now()
      ).toLocaleString()}</div>
      `;
    }
    return;
  }

  if (payload.id && payload.conversation_id) {
    appendMessage(payload, true);
    try {
      const cnt = await getUnreadCount();
      window.dispatchEvent(
        new CustomEvent('notifCountUpdated', { detail: { count: cnt } })
      );
    } catch (e) {
      console.warn('Unread count fetch failed', e);
    }
  } else {
    console.debug('WS payload (ignored)', payload);
  }
}

// === SEND MESSAGE ===
async function handleSend(e) {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  if (!socketInstance) {
    showAlert('Not connected to chat', 'error');
    return;
  }

  try {
    lastSentText = text;
    socketInstance.send({ message: text });

    appendMessage(
      {
        sender_name:
          (currentUser && (currentUser.name || currentUser.email)) || 'You',
        sender_id: currentUser?.id,
        text,
        timestamp: new Date().toISOString(),
        _optimistic: true,
      },
      true
    );

    messageInput.value = '';
  } catch (err) {
    console.error('Send failed', err);
    showAlert('Send failed', 'error');
  }
}

// === UTIL ===
function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// === INIT CALL ===
document.addEventListener('DOMContentLoaded', init);
