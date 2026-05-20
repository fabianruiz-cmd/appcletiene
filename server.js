require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();
const PORT = process.env.PORT || process.env.RAILWAY_PORT || 8080;
console.log("[DEBUG] process.env.PORT =", process.env.PORT);
console.log("[DEBUG] PORT final =", PORT);

// ── Configuración ─────────────────────────────────────────────────────────────
const ENV        = process.env.WIP_ENV || 'prod'; // 'prod' o 'qa'

const PROD = {
  BASE:       'https://api.wiptool.com',
  KEY:        process.env.WIP_API_KEY    || 'xWjGb5Zt84g4YEBEe4C8ZxNWkVswJg7ZRbkLwJeQ',
  COMPANY_ID: process.env.WIP_COMPANY_ID || '67379dff213b73f99523f061',
  USER_ID:    process.env.WIP_USER_ID    || '67a0dcadba440e5f0db90ccc',
  OWNER_ID:   process.env.WIP_OWNER_ID   || '67379dff213b73f99523f061',
  OWNER_NAME: process.env.WIP_OWNER_NAME || 'MULTISERVICIOS CL TIENE',
};

const QA = {
  BASE:       'https://qa.wiptool.com',
  KEY:        process.env.WIP_QA_KEY        || 'x1uTTQSjgy3St7ncMFN4dqp7fHE2dGg5UENHEXfR',
  COMPANY_ID: process.env.WIP_QA_COMPANY_ID || '672e63786550243020775186',
  USER_ID:    process.env.WIP_QA_USER_ID    || '69a74c1f2624f11af97b6283',
  OWNER_ID:   process.env.WIP_QA_OWNER_ID   || '672e63786550243020775186',
  OWNER_NAME: process.env.WIP_QA_OWNER_NAME || 'CL tiene',
};

const WA_URL   = process.env.WHAPI_URL   || 'https://gate.whapi.cloud';
const WA_TOKEN = process.env.WHAPI_TOKEN || 'WwW3UAz2x6iJ0nasEd7ar5WFoVsxnGpc';

function getCfg(env) { return env === 'qa' ? QA : PROD; }

app.use(express.json());

// ── HTML Routes ───────────────────────────────────────────────────────────────
app.get('/',                   (req, res) => res.sendFile(path.join(__dirname, 'wip-dashboard.html')));
app.get('/wip-dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'wip-dashboard.html')));
app.get('/auth',               (req, res) => res.sendFile(path.join(__dirname, 'cltiene-auth.html')));
app.get('/cltiene-auth.html',  (req, res) => res.sendFile(path.join(__dirname, 'cltiene-auth.html')));

// ── Helper WIP ────────────────────────────────────────────────────────────────
async function wipFetch(wipPath, method, body, env) {
  method = method || 'GET';
  env    = env    || 'prod';
  const cfg = getCfg(env);
  const nodeFetch = (await import('node-fetch')).default;
  const opts = {
    method,
    headers: { 'Authorization': cfg.KEY, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const url = cfg.BASE + wipPath;
  console.log('[WIP][' + env.toUpperCase() + ']', method, wipPath, body ? JSON.stringify(body).slice(0,100) : '');
  const res  = await nodeFetch(url, opts);
  const text = await res.text();
  console.log('[WIP] →', res.status, text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); } catch(e) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data: data };
}

// ── Helper WhatsApp ───────────────────────────────────────────────────────────
async function sendWA(tel, msg) {
  if (!tel) return { ok: false };
  try {
    const nodeFetch = (await import('node-fetch')).default;
    let num = tel.toString().replace(/[\s\-\+\(\)]/g, '');
    if (num.length === 10) num = '57' + num;
    if (!num.startsWith('57')) num = '57' + num;
    const res = await nodeFetch(WA_URL + '/messages/text', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + WA_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: num + '@s.whatsapp.net', body: msg })
    });
    const data = await res.json();
    console.log('[WA]', num, res.status);
    return { ok: res.ok, data: data };
  } catch(e) {
    console.error('[WA Error]', e.message);
    return { ok: false };
  }
}

// ── OTP Store ─────────────────────────────────────────────────────────────────
const otpStore = new Map();

// ════════════════════════════════════════════════════════════════════════════
// AUTH — OTP por WhatsApp
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/validate-document', async (req, res) => {
  const doc = req.body.documento;
  const env = req.body.env || 'prod';
  if (!doc) return res.status(400).json({ success: false, message: 'Documento requerido' });
  try {
    const cfg = getCfg(env);
    const buRes = await wipFetch('/business/api/v1/BusinessUnit/company/' + cfg.COMPANY_ID + '/business-units/services', 'GET', null, env);
    const buIds = (buRes.data.businessUnits || []).map(function(b) { return b.id; });
    const nodeFetch = (await import('node-fetch')).default;
    const promesas = buIds.map(function(buId) {
      return nodeFetch(cfg.BASE + '/Customer/api/v1/Customer/Subscription?companyId=' + cfg.COMPANY_ID + '&businessUnitId=' + buId + '&searchTerm=' + encodeURIComponent(doc), {
        headers: { 'Authorization': cfg.KEY, 'Content-Type': 'application/json' }
      }).then(function(r) { return r.json(); }).catch(function() { return null; });
    });
    const resultados = await Promise.all(promesas);
    const clientes = [];
    resultados.forEach(function(r) {
      const items = Array.isArray(r) ? r : (r && r.id ? [r] : []);
      items.forEach(function(c) { if (!clientes.find(function(x) { return x.id === c.id; })) clientes.push(c); });
    });
    if (!clientes.length) return res.status(404).json({ success: false, message: 'Documento no encontrado en el sistema.' });
    const cliente = clientes[0];
    const tel = cliente.phone || '';
    const masked = tel ? tel.replace(/\d(?=\d{4})/g, '*') : null;
    res.json({ success: true, user: { nombre: cliente.name, telefono: masked, tieneWhatsApp: !!tel } });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/auth/send-code', async (req, res) => {
  const doc = req.body.documento;
  const env = req.body.env || 'prod';
  if (!doc) return res.status(400).json({ success: false, message: 'Documento requerido' });
  const existing = otpStore.get(doc);
  if (existing && Date.now() < existing.expires - 90000) {
    return res.status(429).json({ success: false, message: 'Espera antes de solicitar otro código.' });
  }
  try {
    const cfg = getCfg(env);
    const buRes = await wipFetch('/business/api/v1/BusinessUnit/company/' + cfg.COMPANY_ID + '/business-units/services', 'GET', null, env);
    const buIds = (buRes.data.businessUnits || []).map(function(b) { return b.id; });
    const nodeFetch = (await import('node-fetch')).default;
    const promesas = buIds.map(function(buId) {
      return nodeFetch(cfg.BASE + '/Customer/api/v1/Customer/Subscription?companyId=' + cfg.COMPANY_ID + '&businessUnitId=' + buId + '&searchTerm=' + encodeURIComponent(doc), {
        headers: { 'Authorization': cfg.KEY, 'Content-Type': 'application/json' }
      }).then(function(r) { return r.json(); }).catch(function() { return null; });
    });
    const resultados = await Promise.all(promesas);
    let telefono = '', nombre = '';
    resultados.forEach(function(r) {
      const items = Array.isArray(r) ? r : (r && r.id ? [r] : []);
      items.forEach(function(c) { if (!telefono && c.phone) { telefono = c.phone; nombre = c.name; } });
    });
    if (!telefono) return res.status(404).json({ success: false, message: 'No hay número WhatsApp registrado para este documento.' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(doc, { code: code, expires: Date.now() + 120000, attempts: 0, telefono: telefono, nombre: nombre });
    const msg = '🔐 *CL TIENE — Código de Verificación*\n\nHola ' + nombre + ', tu código de acceso es:\n\n*' + code + '*\n\nVálido por 2 minutos. No lo compartas con nadie.\n\n_MULTISERVICIOS CL TIENE_';
    const wa = await sendWA(telefono, msg);
    console.log('[OTP] Enviado a', telefono, '| WA ok:', wa.ok);
    res.json({ success: true, message: wa.ok ? 'Código enviado por WhatsApp.' : 'Código generado (WhatsApp no disponible).', demo: !wa.ok });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/auth/verify-code', async (req, res) => {
  const doc = req.body.documento, codigo = req.body.codigo;
  const stored = otpStore.get(doc);
  if (!stored) return res.status(400).json({ success: false, message: 'No hay código activo. Solicita uno nuevo.' });
  if (Date.now() > stored.expires) { otpStore.delete(doc); return res.status(400).json({ success: false, message: 'El código expiró. Solicita uno nuevo.' }); }
  if (stored.attempts >= 3) { otpStore.delete(doc); return res.status(429).json({ success: false, message: 'Demasiados intentos fallidos.' }); }
  if (stored.code !== String(codigo).trim()) {
    stored.attempts++;
    return res.status(400).json({ success: false, message: 'Código incorrecto. Te quedan ' + (3 - stored.attempts) + ' intentos.' });
  }
  otpStore.delete(doc);
  sendWA(stored.telefono, '✅ *CL TIENE*\n\nHola ' + stored.nombre + ', tu identidad fue verificada exitosamente.\n\n_MULTISERVICIOS CL TIENE_');
  res.json({ success: true, message: 'Autenticación exitosa.', user: { nombre: stored.nombre } });
});

// ════════════════════════════════════════════════════════════════════════════
// WIP PROXY — Todos los endpoints
// ════════════════════════════════════════════════════════════════════════════

// 1. Unidades de negocio
app.get('/wip/business-units', async (req, res) => {
  const env = req.query.env || 'prod';
  const cfg = getCfg(env);
  try {
    const r = await wipFetch('/business/api/v1/BusinessUnit/company/' + cfg.COMPANY_ID + '/business-units/services', 'GET', null, env);
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// 2. Buscar servicios — page empieza en 1 (doc WIP v2.3)
app.post('/wip/services/search', async (req, res) => {
  const env = req.body.env || 'prod';
  const cfg = getCfg(env);
  try {
    const subject        = req.body.subject        || '';
    const businessUnitId = req.body.businessUnitId || '';
    const pageSize       = req.body.pageSize       || 50;
    const page           = req.body.page           || 1; // ⚠️ WIP usa page 1-indexed
    const sort           = req.body.sort           || 'scheduledDate';
    const sortDirection  = req.body.sortDirection  || 'Desc';

    // Obtener todos los BUs (businessUnitId es obligatorio)
    let buIds = [];
    if (businessUnitId) {
      buIds = [businessUnitId];
    } else {
      const buRes = await wipFetch('/business/api/v1/BusinessUnit/company/' + cfg.COMPANY_ID + '/business-units/services', 'GET', null, env);
      buIds = (buRes.data.businessUnits || []).map(function(b) { return b.id; });
    }

    console.log('[SEARCH] BUs:', buIds.length, '| subject:', subject, '| page:', page);

    // Buscar en paralelo en cada BU
    const promesas = buIds.map(function(buId) {
      const body = {
        pageSize: pageSize,
        page: page,
        sort: sort,
        sortDirection: sortDirection,
        companyId: cfg.COMPANY_ID,
        userId: cfg.USER_ID,
        businessUnitId: buId,
        subject: subject
      };
      return wipFetch('/service/api/v1/Service/search', 'POST', body, env)
        .then(function(r) { return (r.data && r.data.data) ? r.data.data : []; })
        .catch(function() { return []; });
    });

    const resultados = await Promise.all(promesas);

    // Combinar y deduplicar
    const seen = new Set();
    const data = [];
    resultados.forEach(function(arr) {
      arr.forEach(function(s) {
        if (s && s.id && !seen.has(s.id)) { seen.add(s.id); data.push(s); }
      });
    });
    data.sort(function(a,b) { return new Date(b.scheduledDate||0) - new Date(a.scheduledDate||0); });
    console.log('[SEARCH] Total:', data.length);
    res.json({ data: data, totalRows: data.length });
  } catch(e) {
    console.error('[SEARCH]', e.message);
    res.status(500).json({ message: e.message });
  }
});

// 3. Crear servicio + notificación WhatsApp
app.post('/wip/services/create', async (req, res) => {
  const env = req.body.env || 'prod';
  const cfg = getCfg(env);
  try {
    const body = Object.assign({}, req.body);
    delete body.env;
    // Asegurar owner y buOwner con los IDs correctos
    body.owner    = body.owner    || { id: cfg.OWNER_ID, name: cfg.OWNER_NAME, type: 'Owner' };
    body.buOwner  = body.buOwner  || { id: cfg.OWNER_ID, name: cfg.OWNER_NAME, type: 'BuOwner' };
    body.creatorUser = body.creatorUser || { id: cfg.USER_ID, name: cfg.OWNER_NAME };

    const r = await wipFetch('/service/api/v2/Service/' + cfg.COMPANY_ID + '/service/' + cfg.USER_ID, 'POST', body, env);
    if (r.ok) {
      const tel    = body.userClientePhone || body.userPhone || '';
      const nombre = body.finalClientName  || body.userName  || 'Cliente';
      const tipo   = body.type || 'Servicio';
      const exp    = r.data.wipExpedient   || r.data.id      || '';
      const fecha  = body.scheduledDate ? new Date(body.scheduledDate).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }) : '';
      if (tel) {
        sendWA(tel, '✅ *CL TIENE — Servicio Registrado*\n\nHola ' + nombre + ',\n\n📋 *Expediente:* ' + exp + '\n🔧 *Servicio:* ' + tipo + '\n📅 *Fecha:* ' + fecha + '\n\nNuestro equipo se pondrá en contacto contigo pronto.\n\n_MULTISERVICIOS CL TIENE_');
      }
    }
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// 4. Buscar servicio por ID
app.get('/wip/services/:id', async (req, res) => {
  const env = req.query.env || 'prod';
  try {
    const r = await wipFetch('/service/api/v1/Service/' + req.params.id, 'GET', null, env);
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// 5. Suscripciones por documento o placa
app.get('/wip/subscriptions', async (req, res) => {
  const env  = req.query.env || 'prod';
  const cfg  = getCfg(env);
  const buId = req.query.businessUnitId || '';
  const term = req.query.searchTerm     || '';
  try {
    const r = await wipFetch('/Customer/api/v1/Customer/Subscription?companyId=' + cfg.COMPANY_ID + '&businessUnitId=' + buId + '&searchTerm=' + encodeURIComponent(term), 'GET', null, env);
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// 6. Detalle de suscripción
app.post('/wip/subscriptions/detail', async (req, res) => {
  const env = req.body.env || 'prod';
  const cfg = getCfg(env);
  try {
    const r = await wipFetch('/Customer/api/v1/Customer/Subscription/Consumption', 'POST', {
      customerId:     req.body.customerId,
      businessUnitId: req.body.businessUnitId,
      timeZone:       'America/Bogota',
      companyId:      cfg.COMPANY_ID
    }, env);
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// 7. WebHook actualización de estado + WhatsApp
app.post('/wip/webhook', async (req, res) => {
  const env = req.body.env || 'prod';
  try {
    const body = Object.assign({}, req.body);
    delete body.env;
    const r = await wipFetch('/status', 'POST', body, env);
    const tel = body.userClientePhone || '';
    if (tel) {
      const statusMap = {
        Pending:    '🕐 *Pendiente* — Tu servicio está en espera de asignación.',
        InProgress: '🔧 *En Progreso* — Un técnico está atendiendo tu solicitud.',
        Done:       '✅ *Finalizado* — Tu servicio ha sido completado exitosamente.',
        Cancelled:  '❌ *Cancelado* — Tu servicio fue cancelado.'
      };
      sendWA(tel, '📡 *CL TIENE — Actualización*\n\n' + (statusMap[body.status] || body.status) + '\n\nExpediente: ' + (body.wipExpedient || body.id || '') + '\n\n_MULTISERVICIOS CL TIENE_');
    }
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// 8. ⭐ NUEVO — Crear o actualizar customer
app.post('/wip/customers', async (req, res) => {
  const env = req.body.env || 'prod';
  const cfg = getCfg(env);
  try {
    const body = Object.assign({}, req.body);
    delete body.env;
    body.companyId = body.companyId || cfg.COMPANY_ID;
    const r = await wipFetch('/api/v1/Customer', 'POST', body, env);
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// 9. ⭐ NUEVO — Eliminar customer
app.delete('/wip/customers/:id', async (req, res) => {
  const env = req.query.env || 'prod';
  try {
    const r = await wipFetch('/api/v1/Customer/' + req.params.id, 'POST', null, env);
    res.status(r.status).json(r.data || { success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', uptime: process.uptime(), env: ENV, prod_base: PROD.BASE, qa_base: QA.BASE });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('✅ CLTIENE WIP Dashboard en http://localhost:' + PORT);
  console.log('   Entorno activo: ' + ENV.toUpperCase());
  console.log('   PROD: ' + PROD.BASE + ' | QA: ' + QA.BASE);
});

module.exports = app;
