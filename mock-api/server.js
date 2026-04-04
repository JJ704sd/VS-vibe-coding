const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.MOCK_API_PORT || 4000);
const DB_PATH = path.join(__dirname, 'database.json');
const ECG_TEMPLATE = [
  0.0, 0.02, 0.05, 0.08, 0.12, 0.08, 0.03, 0.0, -0.02, -0.03, -0.01, 0.0, 0.0, 0.02, 0.05,
  0.12, 0.28, 0.65, 1.0, 0.35, -0.22, -0.45, -0.2, 0.0, 0.02, 0.04, 0.08, 0.12, 0.14, 0.12,
  0.08, 0.03, 0.0, -0.01, 0.0, 0.0,
];

const readDatabase = () => JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

const writeDatabase = (db) => {
  fs.writeFileSync(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
};

let database = readDatabase();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
  });
  res.end(JSON.stringify(payload));
};

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve('');
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });

const buildLead = ({ name, scale, phase, baseline }) => ({
  name,
  data: Array.from({ length: 1000 }, (_, index) => {
    const cycleLength = ECG_TEMPLATE.length;
    const templateIndex = (index + phase) % cycleLength;
    const slowDrift = Math.sin(index * 0.004) * 0.03;
    const tinyNoise = Math.sin(index * 0.13) * 0.004;
    return ECG_TEMPLATE[templateIndex] * scale + baseline + slowDrift + tinyNoise;
  }),
  samplingRate: 500,
});

const expandRecord = (record) => {
  if (!record) {
    return null;
  }

  const { leadSet = [], ...rest } = record;

  return {
    ...rest,
    leads: leadSet.map(buildLead),
  };
};

const composePatient = (patient) => {
  const record = expandRecord(patient.record);
  const records = record ? [record] : [];

  return {
    id: patient.id,
    name: patient.name,
    age: patient.age,
    gender: patient.gender,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
    records,
  };
};

const listPatients = () => database.patients.map(composePatient);

const getPatientBundle = (patientId) => {
  const patient = database.patients.find((item) => item.id === patientId);
  if (!patient) {
    return null;
  }

  const record = expandRecord(patient.record);
  return {
    patient: composePatient(patient),
    record,
  };
};

const buildDashboardSummary = () => {
  const patients = listPatients();
  const totalCases = patients.length;
  const totalRecords = patients.reduce((sum, patient) => sum + patient.records.length, 0);
  const annotated = patients.reduce(
    (sum, patient) =>
      sum + patient.records.filter((record) => (record.annotations || []).length > 0).length,
    0
  );

  return {
    sourceLabel: '本地 mock API',
    metrics: [
      {
        title: '总病例数',
        value: totalCases,
        note: '本地服务实时返回',
        accent: 'metric-card--blue',
      },
      {
        title: '总心电图数',
        value: totalRecords,
        note: '已展开可用记录',
        accent: 'metric-card--teal',
      },
      {
        title: '已标注',
        value: annotated,
        note: '已完成结构化标注',
        accent: 'metric-card--amber',
      },
      {
        title: '待处理',
        value: Math.max(totalRecords - annotated, 0),
        note: '仍可继续处理的记录',
        accent: 'metric-card--rose',
      },
    ],
    recentActivities: database.dashboard.recentActivities,
    diagnosisStats: database.dashboard.diagnosisStats,
  };
};

const nextPatientId = () => {
  const maxNumber = database.patients.reduce((max, patient) => {
    const numeric = Number(String(patient.id).replace(/\D+/g, ''));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  return `P${String(maxNumber + 1).padStart(3, '0')}`;
};

const createPatient = async (payload) => {
  const now = new Date().toISOString();
  const patient = {
    id: nextPatientId(),
    name: String(payload.name || '未命名患者'),
    age: Number.isFinite(Number(payload.age)) ? Number(payload.age) : 0,
    gender: payload.gender === 'F' ? 'F' : 'M',
    createdAt: now,
    updatedAt: now,
    record: null,
  };

  database.patients.unshift(patient);
  writeDatabase(database);

  return composePatient(patient);
};

const updatePatient = (patientId, patch) => {
  const index = database.patients.findIndex((item) => item.id === patientId);
  if (index === -1) {
    return null;
  }

  const nextPatient = {
    ...database.patients[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  database.patients[index] = nextPatient;
  writeDatabase(database);

  return composePatient(nextPatient);
};

const deletePatient = (patientId) => {
  const before = database.patients.length;
  database.patients = database.patients.filter((item) => item.id !== patientId);
  const removed = before !== database.patients.length;

  if (removed) {
    writeDatabase(database);
  }

  return removed;
};

const parseJsonBody = async (req) => {
  const raw = await readRequestBody(req);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const handler = async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = requestUrl;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, source: 'local-mock-api', port: PORT });
    return;
  }

  if (pathname === '/api/dashboard' && req.method === 'GET') {
    sendJson(res, 200, buildDashboardSummary());
    return;
  }

  if (pathname === '/api/patients' && req.method === 'GET') {
    sendJson(res, 200, { sourceLabel: '本地 mock API', patients: listPatients() });
    return;
  }

  if (pathname === '/api/patients' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    if (!body || typeof body !== 'object') {
      sendJson(res, 400, { error: 'Invalid request body' });
      return;
    }

    const patient = await createPatient(body);
    sendJson(res, 201, { sourceLabel: '本地 mock API', patient });
    return;
  }

  const patientMatch = pathname.match(/^\/api\/patients\/([^/]+)$/);
  if (patientMatch) {
    const patientId = decodeURIComponent(patientMatch[1]);

    if (req.method === 'GET') {
      const bundle = getPatientBundle(patientId);
      if (!bundle) {
        sendJson(res, 404, { error: 'Patient not found' });
        return;
      }

      sendJson(res, 200, { sourceLabel: '本地 mock API', ...bundle });
      return;
    }

    if (req.method === 'PUT') {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        sendJson(res, 400, { error: 'Invalid request body' });
        return;
      }

      const updated = updatePatient(patientId, body);
      if (!updated) {
        sendJson(res, 404, { error: 'Patient not found' });
        return;
      }

      sendJson(res, 200, { sourceLabel: '本地 mock API', patient: updated });
      return;
    }

    if (req.method === 'DELETE') {
      const removed = deletePatient(patientId);
      if (!removed) {
        sendJson(res, 404, { error: 'Patient not found' });
        return;
      }

      sendJson(res, 200, { ok: true });
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found' });
};

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error('[mock-api] request failed', error);
    sendJson(res, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`[mock-api] listening on http://localhost:${PORT}`);
});
