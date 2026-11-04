// pet-proxy.mjs —— 把 127.0.0.1:3080 上的 /dsh-pet-7340/* 代理到 127.0.0.1:38019 同路径
// 解决：肥鱼窗 App(com.dsh.petframe) 硬编码连 3080，而 dsh-pet 集成服务实际挂在 38019。
//
// 为什么不用 fetch/undici：
//   POST /chat 走 undici 一律 "other side closed"（DSH 的响应让 undici 提前判定连接断了），
//   换成 node:http 原样转发就正常。所以这里全程用 http.request + 管道流式转发。
// 为什么 /state 要 identity：
//   它是长轮询接口，压缩中间件一旦介入就会断连（浏览器侧表现为 Failed to fetch）。
import { createServer, request as httpRequest } from 'node:http';
import { appendFileSync } from 'node:fs';

const LISTEN_PORT = 3080;
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 38019;
const LOG = '/tmp/pet-proxy.log';

// 逐跳头：不能原样转发，交给各自的连接管理
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length',
]);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG, line); } catch { /* 忽略 */ }
  process.stdout.write(line);
}

const server = createServer((req, res) => {
  const u = req.url || '/';
  log(`${req.method} ${u}`);
  const isState = (u.split('?')[0] || '').endsWith('/state');

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    headers[k] = v;
  }
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  // 一律强制 identity：DSH 的压缩中间件遇到 gzip/br 就会在长一点的响应上把连接掐掉
  // （实测：带 Accept-Encoding 时直连 38019 也是 000/21s，identity 就 200/5s）。
  // /state 长轮询同样受害，早就在单独处理；现在全路径统一。
  headers['accept-encoding'] = 'identity';

  const up = httpRequest({
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: u,
    method: req.method,
    headers,
  }, (upRes) => {
    const outHeaders = {};
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      outHeaders[k] = v;
    }
    outHeaders['cache-control'] = 'no-store, no-transform';
    res.writeHead(upRes.statusCode || 502, outHeaders);
    upRes.pipe(res);
    upRes.on('end', () => log(`  <- ${upRes.statusCode}${isState ? ' (state)' : ''}`));
  });

  up.setTimeout(120000, () => {
    log('  <- ERR upstream timeout');
    up.destroy(new Error('upstream timeout'));
  });

  up.on('error', (e) => {
    log(`  <- ERR ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('pet-proxy: ' + e.message);
    } else {
      res.destroy();
    }
  });

  req.pipe(up);
  req.on('aborted', () => up.destroy());
});

server.listen(LISTEN_PORT, UPSTREAM_HOST, () => {
  log(`pet-proxy listening on ${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});