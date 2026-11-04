/**
 * dsh-pet-android —— 精简版：只做两件事
 *
 *   1) GET /dsh-pet-android/desktop/*   把上游 dsh-pet 的桌面渲染器页面（index.html + 5 个 JS + shim）
 *                                      同源地发出来，给安卓壳（com.dsh.petframe）加载。
 *                                      同源很重要：页面要 fetch /dsh-pet-7340/*，跨源会被 WebView 拦。
 *
 *   2) GET /dsh-pet-android/state       /dsh-pet-7340/state 的**不压缩代理**。
 *                                      上游这个长轮询接口一旦被压缩中间件处理就会断连（浏览器侧表现为
 *                                      Failed to fetch），渲染器因此拿不到工作状态/余额/气泡文案。
 *                                      这里用 identity 取回原文，再以 no-transform 发出去。
 *
 * 旧的 v1/v3 宿主协议（文件通道 pet-overlay.json、/status、/health、/windows、/host-state、
 * 3090 文本悬浮条……）已经全部删除：那是给「dsh-pet 安卓容器」用的，本机已改用自建壳。
 */
import { createReadStream, existsSync, fstatSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-pet-android';
export const inject = ['webServer'];

const ROUTE_PREFIX = '/dsh-pet-android';
const OVERLAY_ROOT = fileURLToPath(new URL('./overlay/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** 防穿越：只允许 overlay 静态根下的实体 */
function resolveStatic(rel) {
  if (!rel) return undefined;
  const root = normalize(OVERLAY_ROOT);
  const file = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (file !== root && !file.startsWith(rootWithSep)) return undefined;
  return file;
}

function sendText(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function sendFile(res, file) {
  const ext = file.slice(file.lastIndexOf('.'));
  const stream = createReadStream(file);
  stream.once('open', (fd) => {
    if (res.destroyed || res.writableEnded) {
      stream.destroy();
      return;
    }
    try {
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        // 长度取自正在读的这个 fd，避免「先 stat 再开流」被替换后长度对不上、响应永不结束
        'content-length': fstatSync(fd).size,
        'cache-control': 'no-cache',
      });
    } catch {
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    }
    stream.pipe(res);
  });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
}

export function apply(ctx) {
  const port = () => (typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 0);

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const rest = url.pathname.startsWith(ROUTE_PREFIX)
      ? url.pathname.slice(ROUTE_PREFIX.length)
      : url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // ---- 桌面渲染器静态页 ----
    if (method === 'GET' && (rest === '/desktop' || rest === '/desktop/' || rest === '/desktop/index.html')) {
      const page = resolveStatic('desktop/index.html');
      return page && existsSync(page) ? sendFile(res, page) : sendText(res, 404, 'desktop page missing');
    }
    if (method === 'GET' && rest.startsWith('/desktop/')) {
      const asset = rest.slice('/desktop/'.length);
      if (/^[A-Za-z0-9._-]+\.(js|css)$/.test(asset)) {
        const file = resolveStatic('desktop/' + asset);
        if (file && existsSync(file)) return sendFile(res, file);
      }
      return sendText(res, 404, 'desktop asset not found');
    }

    // ---- /state 不压缩代理 ----
    if (method === 'GET' && rest === '/state') {
      const p = port();
      if (!p) return sendText(res, 503, 'web server port not ready');
      try {
        const r = await fetch(`http://127.0.0.1:${p}/dsh-pet-7340/state${url.search || ''}`, {
          headers: { 'accept-encoding': 'identity' },
        });
        const body = await r.text();
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          // no-transform：告诉压缩中间件别碰这个响应
          'cache-control': 'no-store, no-transform',
          'content-length': Buffer.byteLength(body),
        });
        return res.end(body);
      } catch (e) {
        return sendText(res, 502, 'state proxy failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    }

    return sendText(res, 404, 'dsh-pet-android: not found');
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
          handle(req, res).catch((e) => {
            try {
              sendText(res, 500, 'dsh-pet-android: ' + (e instanceof Error ? e.message : String(e)));
            } catch {
              /* 响应已结束 */
            }
          });
        },
      }),
    'dsh-pet-android: routes',
  );
}