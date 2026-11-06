// A tiny HTTP gateway on a random port in front of one napkin server, so a test can swap the server behind it
// (a restart), or cut a reply after the upstream has acted on a request (an edit that landed whose answer was lost).
//   const g = await gateway(upstreamUrl);  g.url  g.setUpstream(url)  g.dropReplies(predicate)  g.close()
// Host and Origin are rewritten to the upstream's, which is what napkin's loopback guard checks.
import { createServer, request } from 'node:http';

export async function gateway(upstream) {
  let target = new URL(upstream), drop = null, sockets = new Set();
  const server = createServer((req, res) => {
    const headers = { ...req.headers, host: target.host };
    if (headers.origin) headers.origin = `http://${target.host}`;
    const up = request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers }, (ures) => {
      if (drop && drop(req)) { ures.resume(); ures.on('end', () => req.socket.destroy()); return; }
      res.writeHead(ures.statusCode, ures.headers);
      ures.pipe(res);
      ures.on('error', () => res.destroy());
    });
    up.on('error', () => req.socket.destroy());
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  return {
    url,
    setUpstream(u) { target = new URL(u); },
    dropReplies(predicate) { drop = predicate; },
    close() { for (const s of sockets) s.destroy(); return new Promise((r) => server.close(r)); },
  };
}
