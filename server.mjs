import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyOperations, defaultState, validateState } from './shared/model.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const staticFiles = new Map([
  ['/', 'public/index.html'], ['/admin', 'public/admin.html'], ['/admin/', 'public/admin.html'],
  ['/assets/app.css', 'public/assets/app.css'], ['/assets/icon.svg', 'public/assets/icon.svg'],
  ...['client', 'plot', 'display', 'admin'].map((name) => ['/js/' + name + '.mjs', 'public/js/' + name + '.mjs']),
  ...['model', 'geometry'].map((name) => ['/shared/' + name + '.mjs', 'shared/' + name + '.mjs']),
]);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const error = (message, status) => Object.assign(new Error(message), { status });
const clientIdValid = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw error('请使用 application/json', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 32768) throw error('请求内容过大', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error('无效的 JSON 内容', 400); }
}
export async function createApp({ dataDir = process.env.DATA_DIR || path.join(root, 'data') } = {}) {
  await mkdir(dataDir, { recursive: true });
  const statePath = path.join(dataDir, 'state.json');
  let state;
  const save = async (next) => {
    const temporary = statePath + '.tmp';
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, statePath);
  };
  try { state = validateState(JSON.parse(await readFile(statePath, 'utf8'))); }
  catch (problem) {
    if (problem.code !== 'ENOENT') throw new Error('无法读取 data/state.json；请检查文件，原数据未被覆盖。', { cause: problem });
    state = defaultState();
    await save(state);
  }
  const clients = new Set();
  const seen = new Map();
  const envelope = (clientId) => ({ state, ackSeq: seen.get(clientId) || 0 });
  const sendEvent = (client) => {
    if (client.response.destroyed) { clients.delete(client); return; }
    // A stalled tab reconnects and receives a fresh snapshot instead of buffering forever.
    if (client.response.writableLength > 262144) { client.response.destroy(); clients.delete(client); return; }
    client.response.write('event: state\ndata: ' + JSON.stringify(envelope(client.id)) + '\n\n');
  };
  let pending = Promise.resolve();
  function serialize(work) {
    const result = pending.then(work);
    pending = result.catch(() => {});
    return result;
  }
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.response.destroyed) clients.delete(client);
      else client.response.write(': heartbeat\n\n');
    }
  }, 20000);
  heartbeat.unref();
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(request.url, 'http://localhost');
      const clientId = url.searchParams.get('client') || '';
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json(response, 200, { ok: true, project: 'TwoDimensional' });
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        return json(response, 200, envelope(clientId));
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        if (!clientIdValid(clientId)) throw error('无效的客户端标识', 400);
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        response.flushHeaders();
        const client = { response, id: clientId };
        clients.add(client);
        sendEvent(client);
        response.on('close', () => clients.delete(client));
        return;
      }
      if (request.method === 'PATCH' && url.pathname === '/api/state') {
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host) throw error('请求来源不匹配', 403);
        const body = await readJson(request);
        if (!body || !clientIdValid(body.clientId) || !Number.isSafeInteger(body.seq) || body.seq < 1) throw error('无效的请求标识', 400);
        const result = await serialize(async () => {
          if (body.seq <= (seen.get(body.clientId) || 0)) return envelope(body.clientId);
          const next = applyOperations(state, body.operations);
          next.revision = state.revision + 1;
          next.updatedAt = new Date().toISOString();
          await save(next);
          state = next;
          seen.delete(body.clientId);
          seen.set(body.clientId, body.seq);
          if (seen.size > 1024) seen.delete(seen.keys().next().value);
          for (const client of clients) sendEvent(client);
          return envelope(body.clientId);
        });
        return json(response, 200, result);
      }
      const relative = staticFiles.get(url.pathname);
      if ((request.method === 'GET' || request.method === 'HEAD') && relative) {
        const bytes = await readFile(path.join(root, relative));
        response.writeHead(200, {
          'Content-Type': mimeTypes[path.extname(relative)] || 'application/octet-stream',
          'Content-Length': bytes.length, 'Cache-Control': 'no-cache',
        });
        return response.end(request.method === 'HEAD' ? undefined : bytes);
      }
      if (url.pathname.startsWith('/api/')) return json(response, 404, { error: '接口不存在' });
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('页面不存在');
    } catch (problem) {
      const status = problem.status || 500;
      if (status === 500) console.error(problem);
      if (!response.headersSent) json(response, status, { error: status === 500 ? '保存失败，请检查服务器可用空间及数据目录' : problem.message });
      else response.end();
    }
  });
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const client of clients) client.response.end();
    clients.clear();
  });
  return { server, getState: () => state };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3005);
  const host = process.env.HOST || '127.0.0.1';
  const { server } = await createApp();
  server.listen(port, host, () => console.log('TwoDimensional listening on http://' + host + ':' + port));
  const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
