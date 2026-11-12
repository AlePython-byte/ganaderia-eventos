import http from 'node:http';

// Servidor HTTP mínimo (sin framework) para mantener el esqueleto liviano y fácil de leer.
export function readRawBody(req, limitBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Payload demasiado grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

// routes: [{ method, path, handler(req, res, ctx) }] — path puede ser string o RegExp.
export function serve({ name, port, routes, log }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = typeof r.path === 'string' ? (url.pathname === r.path ? [] : null) : url.pathname.match(r.path);
        if (match) return await r.handler(req, res, { url, match });
      }
      sendJson(res, 404, { error: 'NOT_FOUND' });
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) log.error('http.error', { path: url.pathname, error: err.message });
      if (!res.headersSent) sendJson(res, status, { error: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR' });
    }
  });
  server.listen(port, () => log.info('http.listening', { service: name, port }));
  return server;
}
