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

// ── Agentes disponibles para round robin (sin admin) ──────────────────────────
const AGENTS = [
  { id:1, name:'Agente 1', color:'#3b82f6' },
  { id:2, name:'Agente 2', color:'#f59e0b' },
  { id:3, name:'Agente 3', color:'#8b5cf6' },
  { id:4, name:'Agente 4', color:'#ec4899' },
  { id:5, name:'Agente 5', color:'#0d7a5f' },
];

// Índice del turno actual (persiste en memoria mientras el servidor esté activo)
let roundRobinIndex = 0;

function getNextAgent() {
  const agent = AGENTS[roundRobinIndex % AGENTS.length];
  roundRobinIndex++;
  return agent;
}

// ── HTML ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

// ── WhatsApp ──────────────────────────────────────────────────────────────────
async function waFetch(endpoint, method, body) {
  const nodeFetch = (await import('node-fetch')).default;
  const opts = {
    method: method || 'GET',
    headers: { 'Authorization': 'Bearer ' + WA_TOKEN, 'Content-Type': 'application/json' }
  };
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
    headers: {
      'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json', 'Prefer': 'return=representation'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await nodeFetch(SB_URL + '/rest/v1' + endpoint, opts);
  const data = await res.json().catch(() => []);
  return { ok: res.ok, rows: Array.isArray(data) ? data : [data] };
}

// ── Assignments ───────────────────────────────────────────────────────────────
app.get('/api/sb/assignments', async (req, res) => {
  try { res.json(await sbReq('/chat_assignments?select=*&order=updated_at.desc')); }
  catch(e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/sb/assignments', async (req, res) => {
  try {
    const { chat_id, agent_id, agent_name, agent_color, chat_name } = req.body;
    // Intentar insertar, si ya existe hacer PATCH
    const r = await sbReq('/chat_assignments', 'POST', {
      chat_id, agent_id, agent_name, agent_color,
      updated_at: new Date().toISOString()
    });
    if (!r.ok) {
      const r2 = await sbReq('/chat_assignments?chat_id=eq.' + encodeURIComponent(chat_id), 'PATCH', {
        agent_id, agent_name, agent_color, updated_at: new Date().toISOString()
      });
      return res.json(r2);
    }
    res.json(r);
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// ── Log ───────────────────────────────────────────────────────────────────────
app.get('/api/sb/log', async (req, res) => {
  try { res.json(await sbReq('/chat_log?select=*&order=created_at.desc&limit=200')); }
  catch(e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/sb/log', async (req, res) => {
  try {
    const { chat_id, chat_name, agent_id, agent_name, action } = req.body;
    res.json(await sbReq('/chat_log', 'POST', { chat_id, chat_name, agent_id, agent_name, action }));
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// ── Asignación automática round robin ─────────────────────────────────────────
// Se llama desde el frontend cuando llega un chat nuevo sin asignar,
// o puede llamarse desde un webhook de whapi
app.post('/api/auto-assign', async (req, res) => {
  const { chat_id, chat_name } = req.body;
  if (!chat_id) return res.status(400).json({ ok: false, error: 'chat_id requerido' });

  try {
    // Verificar si ya tiene asignación
    const existing = await sbReq('/chat_assignments?chat_id=eq.' + encodeURIComponent(chat_id));
    if (existing.ok && existing.rows.length > 0 && existing.rows[0].chat_id) {
      return res.json({ ok: true, already: true, assignment: existing.rows[0] });
    }

    // Asignar al siguiente agente en turno
    const agent = getNextAgent();

    // Guardar en Supabase
    await sbReq('/chat_assignments', 'POST', {
      chat_id,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_color: agent.color,
      updated_at: new Date().toISOString()
    });

    // Registrar en log
    await sbReq('/chat_log', 'POST', {
      chat_id,
      chat_name: chat_name || chat_id,
      agent_id: 0,
      agent_name: 'Sistema',
      action: 'Asignación automática → ' + agent.name
    });

    res.json({ ok: true, agent });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Webhook whapi (mensajes entrantes) ────────────────────────────────────────
// Configura en whapi: Settings → Webhooks → URL: https://tu-app.railway.app/webhook
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responder rápido a whapi

  try {
    const payload = req.body;
    const messages = payload.messages || [];

    for (const msg of messages) {
      // Solo mensajes entrantes (del cliente, no enviados por nosotros)
      if (msg.from_me) continue;

      const chat_id = msg.chat_id || msg.from;
      if (!chat_id) continue;

      // Verificar si ya está asignado
      const existing = await sbReq('/chat_assignments?chat_id=eq.' + encodeURIComponent(chat_id));
      const yaAsignado = existing.ok && existing.rows.length > 0 && existing.rows[0].chat_id;

      if (!yaAsignado) {
        // Asignar automáticamente
        const agent = getNextAgent();
        await sbReq('/chat_assignments', 'POST', {
          chat_id,
          agent_id: agent.id,
          agent_name: agent.name,
          agent_color: agent.color,
          updated_at: new Date().toISOString()
        });
        await sbReq('/chat_log', 'POST', {
          chat_id,
          chat_name: msg.chat_name || chat_id,
          agent_id: 0,
          agent_name: 'Sistema',
          action: 'Asignación automática por webhook → ' + agent.name
        });
        console.log('✅ Chat ' + chat_id + ' asignado automáticamente a ' + agent.name);
      }
    }
  } catch(e) {
    console.error('Webhook error:', e.message);
  }
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  ok: true,
  service: 'cltiene-chat-v3',
  uptime: process.uptime(),
  roundRobinIndex
}));

app.listen(PORT, '0.0.0.0', () => console.log('✅ CL TIENE Chat v3 en http://localhost:' + PORT));
