import { api } from './core/api.js';
import { showAlert } from './core/utils.js';
import * as storage from './core/storage.js';
import { connectChat } from './core/socket.js';
import { getUnreadCount } from './core/notifications.js';

const params = new URLSearchParams(window.location.search);
const conversationIdParam = params.get('conversation') || params.get('conv') || params.get('id');
const productParam = params.get('product');
const otherUserParam = params.get('other_user');

const messagesEl = document.getElementById('messages');
const convTitle = document.getElementById('convTitle');
const convMeta = document.getElementById('convMeta');
const infoList = document.getElementById('infoList');
const sendForm = document.getElementById('sendForm');
const messageInput = document.getElementById('messageInput');
const statusBadge = document.getElementById('statusBadge');

let conversation = null;
let socketInstance = null;
let currentUser = null;
let lastSentText = null;
let reconnectTimeout = null;

async function init() {
  try { currentUser = await api.get('/users/me/'); } catch { currentUser = null; }

  if (conversationIdParam) {
    await loadConversation(conversationIdParam);
  } else if (productParam && otherUserParam) {
    await createConversation(productParam, otherUserParam);
  } else {
    messagesEl.innerHTML = `<div class="empty">No conversation specified.</div>`;
    sendForm.style.display = 'none';
    return;
  }

  connectSocket();
  sendForm.addEventListener('submit', handleSend);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendForm.requestSubmit(); }
  });
}

async function loadConversation(id) {
  try {
    conversation = await api.get(`/conversations/${id}/`);
    renderConversation(conversation);
  } catch { showAlert('Failed to load conversation.', 'error'); }
}

async function createConversation(product, other_user) {
  try {
    conversation = await api.post('/conversations/', { product: parseInt(product, 10), other_user: parseInt(other_user, 10) });
    renderConversation(conversation);
  } catch { showAlert('Failed to create conversation.', 'error'); }
}

function renderConversation(conv) {
  convTitle.textContent = `Conversation #${conv.id}`;
  convMeta.textContent = conv.participants?.map(p => p.name || p.email).join(' & ') || '';

  const participants = conv.participants || [];
  infoList.innerHTML = `
    <div class="info-item">
      <span class="info-label">Participants</span>
      <div style="display:flex;flex-direction:column;gap:.4rem;margin-top:.4rem">
        ${participants.map(p => `
          <div class="participant-chip">
            <div class="participant-avatar">${(p.name || p.email || '?')[0].toUpperCase()}</div>
            <span>${p.name || p.email}</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="info-item" style="margin-top:.75rem">
      <span class="info-label">Started</span>
      <span class="info-value">${new Date(conv.created_at).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}</span>
    </div>
  `;

  renderMessages(conv.messages || []);
}

function renderMessages(messages) {
  messagesEl.innerHTML = '';
  if (!messages.length) {
    messagesEl.innerHTML = '<div class="empty">No messages yet — say hello 👋</div>';
    return;
  }
  messages.forEach(m => appendMessage(m, false));
  scrollToBottom();
}

function appendMessage(m, scroll = true) {
  const meId = currentUser?.id;
  const isMe = meId && String(m.sender_id) === String(meId);
  const text = m.text ?? m.message ?? m.body ?? m.message_text ?? '';
  const time = new Date(m.timestamp || m.created_at || Date.now()).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'});
  const name = m.sender_name || m.sender || (isMe ? 'You' : 'User');

  const wrapper = document.createElement('div');
  wrapper.className = `message ${isMe ? 'msg-outgoing' : 'msg-incoming'}${m._optimistic ? ' optimistic' : ''}`;
  wrapper.innerHTML = `
    <div class="message-bubble">${escapeHtml(text)}</div>
    <div class="msg-meta">${escapeHtml(name)} · ${time}</div>
  `;
  messagesEl.appendChild(wrapper);
  if (scroll) scrollToBottom();
}

function scrollToBottom() {
  setTimeout(() => (messagesEl.scrollTop = messagesEl.scrollHeight), 30);
}

function setStatus(text, type = 'connected') {
  statusBadge.textContent = text;
  statusBadge.className = `status-dot ${type}`;
}

function connectSocket() {
  if (!conversation) return;
  setStatus('Connecting...', 'connecting');

  socketInstance = connectChat(conversation.id, {
    onOpen: () => { clearTimeout(reconnectTimeout); setStatus('Connected', 'connected'); },
    onMessage: handleSocketMessage,
    onClose: () => { setStatus('Disconnected', 'disconnected'); reconnectTimeout = setTimeout(connectSocket, 4000); },
    onError: () => setStatus('Error', 'disconnected'),
  });
}

async function handleSocketMessage(payload) {
  if (!payload || payload.message === 'Connected successfully.') return;
  const msgText = payload.text || payload.message || payload.body || payload.message_text;
  const meId = currentUser?.id;
  const isEcho = payload.sender_id && meId && String(payload.sender_id) === String(meId) && lastSentText && msgText?.trim() === lastSentText.trim();

  if (isEcho) {
    const opt = messagesEl.querySelector('.message.optimistic');
    if (opt) {
      opt.classList.remove('optimistic');
      opt.querySelector('.message-bubble').style.opacity = '1';
    }
    return;
  }

  if (payload.id && payload.conversation_id) {
    appendMessage(payload, true);
    try {
      const cnt = await getUnreadCount();
      window.dispatchEvent(new CustomEvent('notifCountUpdated', { detail: { count: cnt } }));
    } catch { /* ignore */ }
  }
}

async function handleSend(e) {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !socketInstance) return;

  lastSentText = text;
  socketInstance.send({ message: text });
  appendMessage({ sender_name: currentUser?.name || currentUser?.email || 'You', sender_id: currentUser?.id, text, timestamp: new Date().toISOString(), _optimistic: true }, true);
  messageInput.value = '';
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

document.addEventListener('DOMContentLoaded', init);
