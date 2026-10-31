// Storybook for napkin's interface. Dev-only: nothing in the product imports any of this.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { mergeConfig } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEEDBACK = join(HERE, '..', 'storybook', 'feedback', 'feedback.json');
const DECISIONS = new Set(['keep', 'change', 'drop', '']);

// The one thing this server writes: storybook/feedback/feedback.json, keyed by story id.
function feedbackPlugin() {
  const read = () => { try { return JSON.parse(readFileSync(FEEDBACK, 'utf8')); } catch { return {}; } };
  return {
    name: 'napkin-feedback',
    configureServer(server) {
      server.middlewares.use('/__feedback', (req, res) => {
        const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(403, { ok: false, error: 'cross-origin' });
        if (req.method === 'GET') return send(200, read());
        if (req.method !== 'POST') return send(405, { ok: false });
        let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
        req.on('end', () => {
          let m; try { m = JSON.parse(raw); } catch { return send(400, { ok: false, error: 'bad json' }); }
          if (typeof m.id !== 'string' || !/^[a-z0-9-]{1,200}$/.test(m.id)) return send(400, { ok: false, error: 'bad story id' });
          const all = read();
          if (m.remove) delete all[m.id];
          else {
            const note = String(m.note ?? '').slice(0, 20000), decision = String(m.decision ?? '');
            if (!DECISIONS.has(decision)) return send(400, { ok: false, error: 'bad decision' });
            all[m.id] = { note, decision, at: new Date().toISOString() };
          }
          mkdirSync(dirname(FEEDBACK), { recursive: true });
          writeFileSync(FEEDBACK, JSON.stringify(all, null, 2) + '\n');
          send(200, { ok: true, saved: all[m.id] ?? null, all });
        });
      });
    },
  };
}

export default {
  stories: ['../storybook/stories/**/*.stories.js'],
  framework: '@storybook/html-vite',
  addons: [],
  // the app's REAL stylesheets and fonts are served straight from public/; the captured fixtures from storybook/fixtures
  staticDirs: [
    { from: '../storybook/fixtures', to: '/fixtures' },
    { from: '../public/canvas', to: '/canvas' },
    { from: '../public/fonts', to: '/fonts' },
    { from: '../public/brand', to: '/brand' },
  ],
  features: { sidebarOnboardingChecklist: false, changeDetection: false },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true, enableCrashReports: false },
  viteFinal: (config) => mergeConfig(config, { server: { host: '127.0.0.1' }, plugins: [feedbackPlugin()] }),
};
