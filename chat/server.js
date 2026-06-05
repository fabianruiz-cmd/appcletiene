require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 8080;

const WA_URL   = process.env.WHAPI_URL   || 'https://gate.whapi.cloud';
const WA_TOKEN = process.env.WHAPI_TOKEN || 'WwW3UAz2x6iJ0nasEd7ar5WFoVsxnGpc';
const SB_URL   = process.env.SUPABASE_URL || '';
const SB_KEY   = process.env.SUPABASE_ANON_KEY || '';

app.use(express.json());

// ── HTML ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

// ── WhatsApp ──────────────────────────────────────────────────────────────────
async function waFetch(endpoint, method, body) {
  const nodeFetch = (await import('node-fetch')).default;
  const opts = { method: method || 'GET', headers: { 'Authorization': 'Bearer ' + WA_TOKEN, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await nodeFetch(WA_URL + endpoint, opts);
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

app.get('/api/chats', async (req, res) => {
  try {
    const r = await waFetch('/chats?count=' + (req.query.count || 50));
    res.json({ ok: true, chats: r.data.chats || r.data || [] });
  } catch(e) { res.json({ ok: false, error: e.message, chats: [] }); }
});

app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const r = await waFetch('/messages/list/' + encodeURIComponent(req.params.chatId) + '?count=50');
    const msgs = r.data.messages || [];
    msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    res.json({ ok: true, messages: msgs });
  } catch(e) { res.json({ ok: false, error: e.message, messages: [] }); }
});

app.post('/api/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ ok: false, error: 'to y message requeridos' });
  try {
    let num = to.replace('@s.whatsapp.net','').replace(/[\s\-\+\(\)]/g,'');
    if (num.length === 10) num = '57' + num;
    if (!num.startsWith('57')) num = '57' + num;
    const r = await waFetch('/messages/text', 'POST', { to: num + '@s.whatsapp.net', body: message });
    res.json({ ok: r.ok, data: r.data });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// ── Supabase ──────────────────────────────────────────────────────────────────
async function sbReq(endpoint, method, body) {
  if (!SB_URL || !SB_KEY) return { ok: false, error: 'Supabase no configurado' };
  const nodeFetch = (await import('node-fetch')).default;
  const opts = {
    method: method || 'GET',
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await nodeFetch(SB_URL + '/rest/v1' + endpoint, opts);
  const data = await res.json().catch(() => []);
  return { ok: res.ok, rows: Array.isArray(data) ? data : [data] };
}

// Assignments
app.get('/api/sb/assignments', async (req, res) => {
  try { res.json(await sbReq('/chat_assignments?select=*&order=updated_at.desc')); }
  catch(e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/sb/assignments', async (req, res) => {
  try {
    const { chat_id, agent_id, agent_name, agent_color, chat_name } = req.body;
    const r = await sbReq('/chat_assignments', 'POST', {
      chat_id, agent_id, agent_name, agent_color,
      updated_at: new Date().toISOString()
    });
    // Upsert si ya existe
    if (!r.ok) {
      const r2 = await sbReq('/chat_assignments?chat_id=eq.' + encodeURIComponent(chat_id), 'PATCH', {
        agent_id, agent_name, agent_color, updated_at: new Date().toISOString()
      });
      return res.json(r2);
    }
    res.json(r);
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// Log
app.get('/api/sb/log', async (req, res) => {
  try { res.json(await sbReq('/chat_log?select=*&order=created_at.desc&limit=100')); }
  catch(e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/sb/log', async (req, res) => {
  try {
    const { chat_id, chat_name, agent_id, agent_name, action } = req.body;
    res.json(await sbReq('/chat_log', 'POST', { chat_id, chat_name, agent_id, agent_name, action }));
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'cltiene-chat-v2', uptime: process.uptime() }));

app.listen(PORT, '0.0.0.0', () => console.log('✅ CL TIENE Chat v2 en http://localhost:' + PORT));
