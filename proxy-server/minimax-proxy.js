/**
 * Minimax API Proxy Server
 *
 * This server proxies requests to the Minimax API, keeping API keys secure.
 * In production, set MINIMAX_API_KEY environment variable.
 *
 * Usage:
 *   node minimax-proxy.js
 *   MINIMAX_API_KEY=your_key PORT=3001 node minimax-proxy.js
 */

const http = require('http');
const https = require('https');

const PORT = Number(process.env.PROXY_PORT || 3001);
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_BASE_URL = 'api.minimax.chat';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
  });
  res.end(JSON.stringify(payload));
};

const sendError = (res, statusCode, message) => {
  console.error(`[minimax-proxy] Error ${statusCode}: ${message}`);
  sendJson(res, statusCode, { error: message });
};

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });

const proxyRequest = (options, body) =>
  new Promise((resolve, reject) => {
    const protocol = options.protocol === 'https:' ? https : http;

    const proxyReq = protocol.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: proxyRes.statusCode,
          body: responseBody,
          headers: proxyRes.headers,
        });
      });
    });

    proxyReq.on('error', reject);
    proxyReq.setTimeout(30000, () => {
      proxyReq.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });

const handler = async (req, res) => {
  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = requestUrl;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Health check
  if (pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'minimax-proxy',
      configured: Boolean(MINIMAX_API_KEY),
    });
    return;
  }

  // ECG analysis proxy
  if (pathname === '/api/ecg/analyze' && req.method === 'POST') {
    if (!MINIMAX_API_KEY) {
      sendError(res, 500, 'Minimax API key not configured on server');
      return;
    }

    const body = await readRequestBody(req);
    if (!body) {
      sendError(res, 400, 'Request body is required');
      return;
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      sendError(res, 400, 'Invalid JSON body');
      return;
    }

    if (!parsedBody.signalData || !Array.isArray(parsedBody.signalData)) {
      sendError(res, 400, 'signalData array is required');
      return;
    }

    try {
      const apiResponse = await proxyRequest(
        {
          protocol: 'https:',
          hostname: MINIMAX_BASE_URL,
          port: 443,
          path: '/v1/text/chatcompletion_v2',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MINIMAX_API_KEY}`,
          },
        },
        JSON.stringify({
          model: parsedBody.model || 'abab6.5s-chat',
          messages: [
            {
              role: 'user',
              content: `You are a medical ECG analysis assistant. Analyze this ECG data and provide a diagnosis. Signal data: ${JSON.stringify(parsedBody.signalData.slice(0, 1000))}`,
            },
          ],
          temperature: 0.3,
        })
      );

      if (apiResponse.statusCode !== 200) {
        sendError(res, apiResponse.statusCode || 502, `Minimax API error: ${apiResponse.body}`);
        return;
      }

      let apiData;
      try {
        apiData = JSON.parse(apiResponse.body);
      } catch {
        sendError(res, 502, 'Invalid response from Minimax API');
        return;
      }

      // Parse the AI response and return structured results
      const content = apiData.choices?.[0]?.message?.content || '';
      const predictions = parseECGAnalysis(content);

      sendJson(res, 200, {
        predictions,
        inferenceTime: Date.now() - (parsedBody._startTime || Date.now()),
        raw: content,
      });
    } catch (error) {
      sendError(res, 502, `Proxy error: ${error.message}`);
    }
    return;
  }

  sendError(res, 404, 'Not found');
};

// Simple ECG analysis parser
function parseECGAnalysis(content) {
  const classes = ['正常', '房颤', '室上性心动过速', '室性心动过速', '停搏'];
  const lowerContent = content.toLowerCase();

  const scores = {};
  for (const cls of classes) {
    const classLower = cls.toLowerCase();
    if (lowerContent.includes(classLower)) {
      // Extract confidence if mentioned
      const match = content.match(new RegExp(`${cls}[^0-9]*([0-9.]+)`, 'i'));
      scores[cls] = match ? parseFloat(match[1]) / 100 : 0.7;
    } else {
      scores[cls] = 0.1;
    }
  }

  // Normalize to probabilities
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return classes.map((cls) => ({
    className: cls,
    probability: scores[cls] / total,
  })).sort((a, b) => b.probability - a.probability);
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error('[minimax-proxy] Unhandled error:', error);
    sendJson(res, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`[minimax-proxy] Listening on http://localhost:${PORT}`);
  console.log(`[minimax-proxy] Minimax API key configured: ${Boolean(MINIMAX_API_KEY)}`);
});
