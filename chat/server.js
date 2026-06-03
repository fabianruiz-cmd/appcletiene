require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 8080;

const WA_URL   = process.env.WHAPI_URL   || 'https://gate.whapi.cloud';
const WA_TOKEN = process.env.WHAPI_TOKEN || 'WwW3UAz2x6iJ0nasEd7ar5WFoVsxnGpc';

app.use(express.json());

// ── Servir el HTML del chat ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'chat.html'));
});

// ── Helper WhatsApp ───────────────────────────────────────────────────────────
async function waFetch(endpoint, method, body) {
  const nodeFetch = (await import('node-fetch')).default;
  const opts = {
    method: method || 'GET',
    headers: { 'Authorization': 'Bearer ' + WA_TOKEN, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await nodeFetch(WA_URL + endpoint, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── GET /api/chats — Lista de chats ──────────────────────────────────────────
app.get('/api/chats', async (req, res) => {
  try {
    const count = req.query.count || 50;
    const r = await waFetch('/chats?count=' + count);
    const chats = r.data.chats || r.data || [];
    res.json({ ok: true, chats });
  } catch(e) {
    res.json({ ok: false, error: e.message, chats: [] });
  }
});

// ── GET /api/messages/:chatId — Mensajes de un chat ──────────────────────────
app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const count  = req.query.count || 50;
    const r = await waFetch('/messages/list/' + encodeURIComponent(chatId) + '?count=' + count);
    const messages = r.data.messages || [];
    messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    res.json({ ok: true, messages });
  } catch(e) {
    res.json({ ok: false, error: e.message, messages: [] });
  }
});

// ── POST /api/send — Enviar mensaje ──────────────────────────────────────────
app.post('/api/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ ok: false, error: 'to y message requeridos' });
  try {
    let num = to.toString().replace(/[\s\-\+\(\)]/g, '').replace('@s.whatsapp.net','');
    if (num.length === 10) num = '57' + num;
    if (!num.startsWith('57')) num = '57' + num;
    const r = await waFetch('/messages/text', 'POST', {
      to: num + '@s.whatsapp.net',
      body: message
    });
    res.json({ ok: r.ok, data: r.data });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── GET /api/contact/:contactId — Info de contacto ───────────────────────────
app.get('/api/contact/:contactId', async (req, res) => {
  try {
    const r = await waFetch('/contacts/' + encodeURIComponent(req.params.contactId));
    res.json({ ok: r.ok, contact: r.data });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── GET /api/health ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'cltiene-chat', uptime: process.uptime() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ CL TIENE Chat en http://localhost:' + PORT);
});
