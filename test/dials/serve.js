import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname, sep } from "node:path";
const root = resolve(fileURLToPath(new URL("../../public/", import.meta.url)));
export async function serve({ api } = {}) {
  const server = createServer(async (req, res) => {
    try {
      if (api && (await api(req, res))) return;
      const path = resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      if (!path.startsWith(root + sep) && path !== root) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(path);
      res.writeHead(200, {
        "content-type":
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".woff2": "font/woff2",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          }[extname(path)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/dials/demo.html`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const s = await serve();
  console.log(s.url);
  process.on("SIGTERM", async () => {
    await s.close();
    process.exit();
  });
}
