import { createReadStream, statSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kinds, registerKind } from './registry.js';
import { ItemError } from './items.js';
import { explainError } from '../errors.js';
import { execFile } from 'node:child_process';
const posters = new Map(),
  waiting = [];
let encoding = 0;
// A small still of a video for its canvas card. At most two run at once; the last 400 are kept.
function poster(file, key, at = 0.1) {
  if (posters.has(key)) return Promise.resolve(posters.get(key));
  return new Promise((resolve) => {
    const run = () => {
      encoding++;
      execFile(
        'ffmpeg',
        ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', '-f', 'mjpeg', 'pipe:1'],
        { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 8000 },
        (error, out) => {
          encoding--;
          const next = waiting.shift();
          if (next) next();
          if (error || !out.length) return resolve(null);
          posters.set(key, out);
          while (posters.size > 400) posters.delete(posters.keys().next().value);
          resolve(out);
        },
      );
    };
    if (encoding < 2) run();
    else waiting.push(run);
  });
}
export async function loadKindPlugins(paths) {
  for (const file of paths) {
    const plugin = await import(pathToFileURL(file).href);
    if (typeof plugin.default !== 'function')
      throw new Error('Kind plugins export a default registration function');
    await plugin.default({ registerKind });
  }
}
export function createKindRoutes(
  items,
  { identify, permission = () => 'write', hasComponent = () => true } = {},
) {
  const json = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
  };
  async function body(req) {
    if (req.napkinBody === undefined) {
      let b = '',
        length = 0;
      for await (const c of req) {
        length += c.length;
        if (length > 2 * 1024 * 1024) throw new ItemError('Request exceeds 2 MiB. Next: check the request against /api/kinds and retry.', 413);
        b += c;
      }
      req.napkinBody = b;
    }
    try {
      return JSON.parse(req.napkinBody);
    } catch {
      throw new ItemError('Send valid JSON');
    }
  }
  function who(req) {
    const by = identify?.(/^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1]);
    if (!by)
      throw new ItemError(
        'Identity required. Next: POST /api/session { as } and send the bearer token.',
        401,
      );
    if (permission(by) !== 'write')
      throw new ItemError('This caller does not have write permission. Next: check the request against /api/kinds and retry.', 403);
    return by;
  }
  return async (req, res, url) => {
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/api/items') {
        json(res, 200, { items: items.items() });
        return true;
      }
      if (req.method === 'GET' && path === '/api/kinds') {
        json(res, 200, {
          kinds: kinds().map(({ id, mime, family, extensions }) => ({
            id,
            mime,
            family,
            extensions,
          })),
        });
        return true;
      }
      if (path === '/api/item-layout') {
        if (req.method === 'GET') json(res, 200, { frames: items.layout() });
        else {
          const m = await body(req);
          who(req);
          json(res, 200, items.setLayout(m.item, m));
        }
        return true;
      }
      if (req.method === 'GET' && path.startsWith('/api/controls/')) {
        json(res, 200, items.controls(decodeURIComponent(path.slice(14))));
        return true;
      }
      if (req.method === 'POST' && path === '/api/control') {
        const m = await body(req),
          by = who(req);
        json(res, 200, items.control(m.item, m.control, m.value, m.baseRevision, by));
        return true;
      }
      if (req.method === 'POST' && path === '/api/undo') {
        const m = await body(req);
        if (m.item !== undefined) {
          json(res, 200, items.undo(m.item, who(req)));
          return true;
        }
        return false;
      }
      if (req.method === 'GET' && path.startsWith('/api/poster/')) {
        const x = items.get(decodeURIComponent(path.slice(12)));
        if (x.definition.family !== 'video') throw new ItemError('Posters exist for video items. Next: request a video item.', 404);
        const img = await poster(x.file, x.id + x.key);
        if (!img) throw new ItemError('This video could not be decoded for a poster. Next: open it in a player.', 422);
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300' });
        res.end(img);
        return true;
      }
      if (req.method === 'GET' && path.startsWith('/api/item-data/')) {
        const ctx = items.context(decodeURIComponent(path.slice(15)));
        ctx.resolveRelative = (p) =>
          items.abs(posix.normalize(posix.join(posix.dirname(ctx.path), p)));
        const data = await ctx.definition.preview?.(ctx, url.searchParams);
        json(res, 200, data ?? {});
        return true;
      }
      if (req.method === 'GET' && path.startsWith('/view/')) {
        const id = decodeURIComponent(path.slice(6));
        let item;
        try {
          item = items.get(id);
        } catch (e) {
          if (id.includes('#')) return false;
          throw e;
        }
        if (item.definition.family === 'component' && hasComponent(id)) return false;
        const ctx = items.context(id),
          html = await item.definition.viewer(ctx);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(html);
        return true;
      }
      if (
        ['GET', 'HEAD'].includes(req.method) &&
        (path.startsWith('/file/') || path.startsWith('/raw/'))
      ) {
        const isRaw = path.startsWith('/raw/'),
          id = decodeURIComponent(path.slice(isRaw ? 5 : 6));
        let item;
        try {
          item = items.get(id);
        } catch (e) {
          throw e;
        }
        const size = item.bytes,
          range = req.headers.range;
        let start = 0,
          end = size - 1,
          status = 200;
        const asked = String(req.url || '')
          .split(/[?#]/)[0]
          .split('/')
          .slice(2)
          .flatMap((part) => decodeURIComponent(part).split(/[\\/]/));
        if (asked.some((part) => part.startsWith('.')))
          throw new ItemError('No file at that path. Next: check the request against /api/kinds and retry.', 404);
        const headers = {
          'content-type': item.mime,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          // The native PDF viewer needs its browser extension context to paint the page.
          ...(!isRaw && item.kind !== 'pdf' ? { 'content-security-policy': 'sandbox' } : {}),
        };
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!m || (!m[1] && !m[2])) {
            res.writeHead(416, { 'content-range': `bytes */${size}` });
            res.end();
            return true;
          }
          if (!m[1]) start = Math.max(0, size - Number(m[2]));
          else {
            start = Number(m[1]);
            if (m[2]) end = Math.min(end, Number(m[2]));
          }
          if (
            start >= size ||
            start > end ||
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end)
          ) {
            res.writeHead(416, { 'content-range': `bytes */${size}` });
            res.end();
            return true;
          }
          status = 206;
          headers['content-range'] = `bytes ${start}-${end}/${size}`;
        }
        headers['content-length'] = Math.max(0, end - start + 1);
        res.writeHead(status, headers);
        if (req.method === 'HEAD' || !size) res.end();
        else {
          const stream = createReadStream(item.file, { start, end });
          stream.on('error', () => res.destroy());
          res.on('close', () => stream.destroy());
          stream.pipe(res);
        }
        return true;
      }
    } catch (e) {
      json(res, e.status || 400, { ok: false, error: explainError(e) });
      return true;
    }
    return false;
  };
}
