require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();
const PORT = process.env.PORT || process.env.RAILWAY_PORT || 8080;
console.log("[DEBUG] process.env.PORT =", process.env.PORT);
console.log("[DEBUG] PORT final =", PORT);

const ENV        = process.env.WIP_ENV || 'prod';

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

async function sendOTPWhatsApp(telefono, nombre, code) {
  const msg = '🔐 *CL TIENE — Código de Verificación*\n\nHola ' + nombre + ', tu código de acceso es:\n\n*' + code + '*\n\nVálido por 5 minutos. No lo compartas con nadie.\n\n_MULTISERVICIOS CL TIENE_';
  const wa = await sendWA(telefono, msg);
  console.log('[OTP WA] Enviado a', telefono, '| ok:', wa.ok);
  return wa;
}

function getCfg(env) { return env === 'qa' ? QA : PROD; }

const COMPANY_ID = PROD.COMPANY_ID;
const USER_ID    = PROD.USER_ID;

app.use(express.json());

// ── HTML Routes ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.query.cedula) return res.sendFile(path.join(__dirname, 'wip-dashboard.html'));
  res.redirect('/auth');
});
app.get('/wip-dashboard.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'wip-dashboard.html'));
});
app.get('/auth', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'cltiene-auth.html'));
});
app.get('/cltiene-auth.html', (req, res) => res.sendFile(path.join(__dirname, 'cltiene-auth.html')));

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

// ── Supabase ──────────────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

async function sbGetPhone(documentId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const nodeFetch = (await import('node-fetch')).default;
    const res = await nodeFetch(SUPABASE_URL + '/rest/v1/customer_phones?document_id=eq.' + encodeURIComponent(documentId) + '&select=phone', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    });
    const data = await res.json();
    return (Array.isArray(data) && data.length > 0) ? data[0].phone : null;
  } catch(e) { console.error('[Supabase] sbGetPhone error:', e.message); return null; }
}

async function sbSavePhone(documentId, phone) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const nodeFetch = (await import('node-fetch')).default;
    const res = await nodeFetch(SUPABASE_URL + '/rest/v1/customer_phones', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ document_id: documentId, phone, updated_at: new Date().toISOString() })
    });
    console.log('[Supabase] sbSavePhone', documentId, phone, '→ status:', res.status);
    return res.ok;
  } catch(e) { console.error('[Supabase] sbSavePhone error:', e.message); return false; }
}

// ── Buscar cliente en todas las BUs ───────────────────────────────────────────
async function buscarClienteWIP(doc, env) {
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
  const vistos = new Map();
  resultados.forEach(function(r) {
    let items = [];
    if (Array.isArray(r)) items = r;
    else if (r && Array.isArray(r.data)) items = r.data;
    else if (r && r.id) items = [r];
    items.forEach(function(c) { if (c && c.id && !vistos.has(c.id)) vistos.set(c.id, c); });
  });
  const resultado = [...vistos.values()];
  console.log('[buscarClienteWIP] doc:', doc, '| suscripciones:', resultado.length);
  return resultado;
}

// ════ AUTH ════════════════════════════════════════════════════════════════════

app.post('/api/auth/validate-document', async (req, res) => {
  const doc = req.body.documento, env = req.body.env || 'prod';
  if (!doc) return res.status(400).json({ success: false, message: 'Documento requerido' });
  try {
    const clientes = await buscarClienteWIP(doc, env);
    if (!clientes.length) return res.status(404).json({ success: false, message: 'Documento no encontrado en el sistema.' });
    let telefono = '', nombre = '';
    clientes.forEach(function(c) {
      if (!telefono && c.phone) telefono = c.phone;
      if (!nombre && c.name) nombre = c.name;
    });
    if (!telefono) telefono = await sbGetPhone(doc) || '';
    const telMasked = telefono ? telefono.replace(/\d(?=\d{4})/g, '*') : null;
    res.json({ success: true, user: { nombre, tieneTelefono: !!telefono, telefonoMasked: telMasked } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/auth/update-phone', async (req, res) => {
  const { documento, telefono, env } = req.body;
  if (!documento || !telefono) return res.status(400).json({ success: false, message: 'Documento y teléfono requeridos' });
  try {
    const clientes = await buscarClienteWIP(documento, env || 'prod');
    if (!clientes.length) return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
    const cfg = getCfg(env || 'prod');
    const nodeFetch = (await import('node-fetch')).default;
    const actualizaciones = await Promise.all(clientes.map(async function(c) {
      const body = {
        companyId: cfg.COMPANY_ID,
        documentId: c.documentId || documento,
        name: c.name || '',
        phone: telefono,
        email: c.email || null,
        plate: c.plate || null,
        address1: c.address1 || null,
        location1: c.location1 || null,
        address2: c.address2 || null,
        location2: c.location2 || null,
        businessUnitIds: c.businessUnitIds || [],
        additionalData: c.additionalData || {}
      };
      const r = await nodeFetch(cfg.BASE + '/Customer/api/v1/Customer/' + c.id, {
        method: 'PUT',
        headers: { 'Authorization': cfg.KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(() => ({}));
      return { id: c.id, status: r.status, data: d };
    }));
    const sbOk = await sbSavePhone(documento, telefono);
    console.log('[update-phone] Supabase guardado:', sbOk);
    res.json({ success: true, message: 'Teléfono registrado correctamente.' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/auth/send-code', async (req, res) => {
  const doc = req.body.documento, env = req.body.env || 'prod';
  const telefonoManual = req.body.telefonoManual || null;
  if (!doc) return res.status(400).json({ success: false, message: 'Documento requerido' });
  const existing = otpStore.get(doc);
  if (existing && Date.now() < existing.expires - 180000)
    return res.status(429).json({ success: false, message: '⚠️ Por seguridad, solo puedes solicitar un código cada 3 minutos.' });
  try {
    const clientes = await buscarClienteWIP(doc, env);
    if (!clientes.length) return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
    let nombre = '', telefono = '';
    clientes.forEach(function(c) {
      if (!nombre && c.name) nombre = c.name;
      if (!telefono && c.phone) telefono = c.phone;
    });
    if (!telefono) telefono = await sbGetPhone(doc) || '';
    if (!telefono && telefonoManual) telefono = telefonoManual;
    if (!telefono) return res.status(404).json({ success: false, message: 'No hay número de WhatsApp registrado para este documento.' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(doc, { code, expires: Date.now() + 300000, attempts: 0, telefono, nombre });
    const resultado = await sendOTPWhatsApp(telefono, nombre, code);
    if (!resultado.ok) return res.status(500).json({ success: false, message: 'Error al enviar WhatsApp.' });
    res.json({ success: true, message: 'Código enviado por WhatsApp' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/auth/verify-code', async (req, res) => {
  const doc = req.body.documento, codigo = req.body.codigo;
  const stored = otpStore.get(doc);
  if (!stored) return res.status(400).json({ success: false, message: 'No hay código activo. Solicita uno nuevo.' });
  if (Date.now() > stored.expires) { otpStore.delete(doc); return res.status(400).json({ success: false, message: 'El código expiró.' }); }
  if (stored.attempts >= 3) { otpStore.delete(doc); return res.status(429).json({ success: false, message: 'Demasiados intentos fallidos.' }); }
  if (stored.code !== String(codigo).trim()) {
    stored.attempts++;
    return res.status(400).json({ success: false, message: 'Código incorrecto. Te quedan ' + (3 - stored.attempts) + ' intentos.' });
  }
  otpStore.delete(doc);
  res.json({ success: true, message: 'Verificación exitosa.', user: { nombre: stored.nombre } });
});

// ════ WIP PROXY ═══════════════════════════════════════════════════════════════

app.get('/wip/business-units', async (req, res) => {
  const env = req.query.env || 'prod';
  const cfg = getCfg(env);
  try {
    const r = await wipFetch('/business/api/v1/BusinessUnit/company/' + cfg.COMPANY_ID + '/business-units/services', 'GET', null, env);
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/wip/services/search', async (req, res) => {
  const env = req.body.env || 'prod';
  const cfg = getCfg(env);
  try {
    const subject        = req.body.subject        || '';
    const businessUnitId = req.body.businessUnitId || '';
    const pageSize       = req.body.pageSize       || 50;
    const page           = req.body.page           || 1;
    const sort           = req.body.sort           || 'scheduledDate';
    const sortDirection  = req.body.sortDirection  || 'Desc';

    let buIds = [];
    if (businessUnitId) {
      buIds = [businessUnitId];
    } else {
      const buRes = await wipFetch('/business/api/v1/BusinessUnit/company/' + cfg.COMPANY_ID + '/business-units/services', 'GET', null, env);
      buIds = (buRes.data.businessUnits || []).map(function(b) { return b.id; });
    }

    const promesas = buIds.map(function(buId) {
      const body = { pageSize, page, sort, sortDirection, companyId: cfg.COMPANY_ID, userId: cfg.USER_ID, businessUnitId: buId, subject };
      return wipFetch('/service/api/v1/Service/search', 'POST', body, env)
        .then(function(r) { return (r.data && r.data.data) ? r.data.data : []; })
        .catch(function() { return []; });
    });

    const resultados = await Promise.all(promesas);
    const seen = new Set();
    const data = [];
    resultados.forEach(function(arr) {
      arr.forEach(function(s) {
        if (s && s.id && !seen.has(s.id)) { seen.add(s.id); data.push(s); }
      });
    });
    data.sort(function(a,b) { return new Date(b.scheduledDate||0) - new Date(a.scheduledDate||0); });
    res.json({ data, totalRows: data.length });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/wip/services/create', async (req, res) => {
  const env = req.body.env || 'prod';
  const cfg = getCfg(env);
  try {
    const body = Object.assign({}, req.body);
    delete body.env;
    body.owner       = body.owner       || { id: cfg.OWNER_ID, name: cfg.OWNER_NAME, type: 'Owner' };
    body.buOwner     = body.buOwner     || { id: cfg.OWNER_ID, name: cfg.OWNER_NAME, type: 'BuOwner' };
    body.creatorUser = body.creatorUser || { id: cfg.USER_ID, name: cfg.OWNER_NAME };
    console.log('[CREATE] fromWhere:', JSON.stringify(body.fromWhere));
    console.log('[CREATE] whereTo:', JSON.stringify(body.whereTo));
    console.log('[CREATE] body completo:', JSON.stringify(body).slice(0, 500));
    const r = await wipFetch('/service/api/v2/Service/' + cfg.COMPANY_ID + '/service/' + cfg.USER_ID, 'POST', body, env);
    if (r.ok) {
      const tel    = body.userClientePhone || body.userPhone || '';
      const nombre = body.finalClientName  || body.userName  || 'Cliente';
      const tipo   = body.type || 'Servicio';
      const exp    = r.data.wipExpedient || r.data.id || '';
      const fecha  = body.scheduledDate ? new Date(body.scheduledDate).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }) : '';
      if (tel) sendWA(tel, '✅ *CL TIENE — Servicio Registrado*\n\nHola ' + nombre + ',\n\n📋 *Expediente:* ' + exp + '\n🔧 *Servicio:* ' + tipo + '\n📅 *Fecha:* ' + fecha + '\n\nNuestro equipo se pondrá en contacto contigo pronto.\n\n_MULTISERVICIOS CL TIENE_');
    }
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/wip/services/:id', async (req, res) => {
  const env = req.query.env || 'prod';
  try {
    const r = await wipFetch('/service/api/v1/Service/' + req.params.id, 'GET', null, env);
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

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

// ══ FIX: /wip/subscriptions/detail — devuelve la respuesta con más tipos ══
app.post('/wip/subscriptions/detail', async (req, res) => {
  const env = req.body.env || 'prod';
  const cfg = getCfg(env);
  const wipBody = {
    customerId:     req.body.customerId,
    businessUnitId: req.body.businessUnitId,
    timeZone:       'America/Bogota',
    companyId:      cfg.COMPANY_ID
  };

  try {
    // Llamada inmediata
    const r1 = await wipFetch('/Customer/api/v1/Customer/Subscription/Consumption', 'POST', wipBody, env);
    const n1 = (r1.data.typeServices || []).length;
    console.log('[DETAIL] Llamada 1: ' + n1 + ' tipos');

    // Segunda llamada después de 3s
    await new Promise(resolve => setTimeout(resolve, 3000));
    const r2 = await wipFetch('/Customer/api/v1/Customer/Subscription/Consumption', 'POST', wipBody, env);
    const n2 = (r2.data.typeServices || []).length;
    console.log('[DETAIL] Llamada 2: ' + n2 + ' tipos');

    // Tercera llamada inmediata después
    const r3 = await wipFetch('/Customer/api/v1/Customer/Subscription/Consumption', 'POST', wipBody, env);
    const n3 = (r3.data.typeServices || []).length;
    console.log('[DETAIL] Llamada 3: ' + n3 + ' tipos');

    // Unir todos los tipos únicos de las 3 respuestas
    const tiposMap = new Map();
    [r1, r2, r3].forEach(r => {
      // Incluir todos los habilitados, incluyendo serviceLimit = 0
      (r.data.typeServices || []).filter(t => t.enabled).forEach(t => {
        if (!tiposMap.has(t.id)) tiposMap.set(t.id, t);
      });
    });

    // Usar r2 como base (caché caliente) con tipos completos
    const baseData = r2.data;
    baseData.typeServices = Array.from(tiposMap.values());
    console.log('[DETAIL] Total tipos únicos: ' + baseData.typeServices.length);

    res.status(200).json(baseData);
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

// ══ Precalentar caché WIP para todas las BUs de un cliente ══
app.post('/wip/subscriptions/warmup', async (req, res) => {
  const env = req.body.env || 'prod';
  const cfg = getCfg(env);
  const { customerId, businessUnitIds } = req.body;
  if (!customerId || !businessUnitIds) return res.json({ ok: true });

  // Fire and forget — no esperamos respuesta
  businessUnitIds.forEach(buId => {
    wipFetch('/Customer/api/v1/Customer/Subscription/Consumption', 'POST', {
      customerId, businessUnitId: buId, timeZone: 'America/Bogota', companyId: cfg.COMPANY_ID
    }, env).catch(() => {});
  });

  res.json({ ok: true, warming: businessUnitIds.length });
});

app.post('/wip/webhook', async (req, res) => {
  const env = req.body.env || 'prod';
  try {
    const body = Object.assign({}, req.body);
    delete body.env;
    const r = await wipFetch('/status', 'POST', body, env);
    const tel = body.userClientePhone || '';
    if (tel) {
      const statusMap = { Pending: '🕐 *Pendiente*', InProgress: '🔧 *En Progreso*', Done: '✅ *Finalizado*', Cancelled: '❌ *Cancelado*' };
      sendWA(tel, '📡 *CL TIENE — Actualización*\n\n' + (statusMap[body.status] || body.status) + '\n\nExpediente: ' + (body.wipExpedient || body.id || '') + '\n\n_MULTISERVICIOS CL TIENE_');
    }
    res.status(r.status).json(r.data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

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

app.delete('/wip/customers/:id', async (req, res) => {
  const env = req.query.env || 'prod';
  try {
    const r = await wipFetch('/api/v1/Customer/' + req.params.id, 'POST', null, env);
    res.status(r.status).json(r.data || { success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/wip/subscriptions/all', async (req, res) => {
  try {
    const cfg = getCfg('prod');
    const buRes = await wipFetch('/business/api/v1/BusinessUnit/company/' + cfg.COMPANY_ID + '/business-units/services', 'GET', null, 'prod');
    const buList = (buRes.data.businessUnits || []).map(b => ({ id: b.id, name: b.name }));
    const documentos = new Set();
    const servicePromesas = [];
    for (const bu of buList) {
      for (let page = 1; page <= 15; page++) {
        servicePromesas.push(
          wipFetch('/service/api/v1/Service/search', 'POST', {
            pageSize: 50, page, sort: 'scheduledDate', sortDirection: 'Desc',
            companyId: cfg.COMPANY_ID, userId: cfg.USER_ID, businessUnitId: bu.id, subject: ''
          }, 'prod').then(r => {
            const rows = (r.data && r.data.data) ? r.data.data : [];
            rows.forEach(s => { if (s.customerDocument) documentos.add(s.customerDocument.trim()); });
            return rows.length;
          }).catch(() => 0)
        );
      }
    }
    await Promise.all(servicePromesas);
    const seen = new Set();
    const subs = [];
    const docArray = Array.from(documentos);
    const subPromesas = docArray.flatMap(doc =>
      buList.map(bu =>
        wipFetch('/Customer/api/v1/Customer/Subscription?companyId=' + cfg.COMPANY_ID + '&businessUnitId=' + bu.id + '&searchTerm=' + encodeURIComponent(doc), 'GET', null, 'prod')
          .then(r => {
            const items = Array.isArray(r.data) ? r.data : (r.data && r.data.id ? [r.data] : []);
            items.forEach(s => {
              const key = (s.documentId || s.id) + bu.id;
              if (!seen.has(key)) { seen.add(key); subs.push({ ...s, buId: bu.id, buName: bu.name }); }
            });
          }).catch(() => {})
      )
    );
    await Promise.all(subPromesas);
    res.json({ total: subs.length, data: subs });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

app.get('/api/bus', async (req, res) => {
  try {
    const r = await wipFetch('/business/api/v1/BusinessUnit/company/' + PROD.COMPANY_ID + '/business-units/services');
    const bus = (r.data.businessUnits || []).map(b => ({ id: b.id, name: b.name, tipos: (b.serviceTypes||[]).map(s=>s.name) }));
    res.json(bus);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/usuarios', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.json({ ok: false, error: 'Supabase no configurado' });
  try {
    const nodeFetch = (await import('node-fetch')).default;
    const r = await nodeFetch(SUPABASE_URL + '/rest/v1/customer_phones?select=document_id,phone,created_at&order=created_at.desc', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    });
    const data = await r.json();
    res.json({ ok: true, total: Array.isArray(data) ? data.length : 0, usuarios: data });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/suscriptores/total', async (req, res) => {
  try {
    const cfg = getCfg('prod');
    const buRes = await wipFetch('/business/api/v1/BusinessUnit/company/' + cfg.COMPANY_ID + '/business-units/services', 'GET', null, 'prod');
    const bus = buRes.data.businessUnits || [];
    const nodeFetch = (await import('node-fetch')).default;
    const seen = new Set();
    const terminos = ['0','1','2','3','4','5','6','7','8','9'];
    const promesas = [];
    for (const bu of bus) {
      for (const term of terminos) {
        promesas.push(
          nodeFetch(cfg.BASE + '/Customer/api/v1/Customer/Subscription?companyId=' + cfg.COMPANY_ID + '&businessUnitId=' + bu.id + '&searchTerm=' + term, {
            headers: { 'Authorization': cfg.KEY }
          }).then(r => r.json()).then(data => {
            const items = Array.isArray(data) ? data : (data && data.id ? [data] : []);
            items.forEach(c => { if (c.documentId) seen.add(c.documentId); });
          }).catch(() => {})
        );
      }
    }
    await Promise.all(promesas);
    res.json({ ok: true, total_suscriptores: seen.size, nota: 'Total de documentos únicos con suscripción en WIP' });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// ══ DIAGNÓSTICO TEMPORAL: ver tipos de servicio crudos de WIP ══
app.get('/api/diag/tipos/:customerId/:buId', async (req, res) => {
  try {
    const cfg = getCfg('prod');
    const wipBody = {
      customerId: req.params.customerId,
      businessUnitId: req.params.buId,
      timeZone: 'America/Bogota',
      companyId: cfg.COMPANY_ID
    };
    const r = await wipFetch('/Customer/api/v1/Customer/Subscription/Consumption', 'POST', wipBody, 'prod');
    const todos = (r.data.typeServices || []);
    const activos = todos.filter(t => t.availability && t.enabled && t.serviceLimit > 0);
    const habilitados = todos.filter(t => t.enabled); // todos habilitados incluyendo límite 0
    res.json({
      customerId: req.params.customerId,
      buId: req.params.buId,
      total_tipos: todos.length,
      activos: activos.length,
      tipos_activos: activos.map(t => ({ id: t.id, name: t.name, limit: t.serviceLimit, used: t.consumption })),
      raw_first3: todos.slice(0, 3)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', uptime: process.uptime(), env: ENV, prod_base: PROD.BASE, qa_base: QA.BASE });
});

app.get('/api/diag/supabase', async (req, res) => {
  const url = SUPABASE_URL, key = SUPABASE_ANON_KEY;
  if (!url || !key) return res.json({ ok: false, error: 'Variables no configuradas' });
  try {
    const nodeFetch = (await import('node-fetch')).default;
    const r = await nodeFetch(url + '/auth/v1/settings', { headers: { 'apikey': key } });
    const data = await r.json();
    res.json({ ok: r.ok, status: r.status, url, data });
  } catch(e) { res.json({ ok: false, error: e.message, url }); }
});

app.get('/api/diag/customer/:doc', async (req, res) => {
  try {
    const doc = req.params.doc;
    const buRes = await wipFetch('/business/api/v1/BusinessUnit/company/' + PROD.COMPANY_ID + '/business-units/services', 'GET', null, 'prod');
    const bus = buRes.data.businessUnits || [];
    const nodeFetch = (await import('node-fetch')).default;
    const resultados = await Promise.all(bus.map(bu =>
      nodeFetch(PROD.BASE + '/Customer/api/v1/Customer/Subscription?companyId=' + PROD.COMPANY_ID + '&businessUnitId=' + bu.id + '&searchTerm=' + encodeURIComponent(doc), {
        headers: { 'Authorization': PROD.KEY, 'Content-Type': 'application/json' }
      }).then(r => r.json()).then(data => ({
        buId: bu.id, buName: bu.name,
        resultado: Array.isArray(data) ? data : (data && data.id ? [data] : []),
        raw: data
      })).catch(e => ({ buId: bu.id, buName: bu.name, error: e.message }))
    ));
    res.json({ documento: doc, total_bus: bus.length, resultados });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('✅ CLTIENE WIP Dashboard en http://localhost:' + PORT);
  console.log('   Entorno activo: ' + ENV.toUpperCase());
});

module.exports = app;
