// Wires the agents lane into the page: presence (outlines, tags, trail, avatar stack), the proposals tray with ghost cells,
// the Activity tab and the clash chip. main.js calls initAgentsLane(ctx) once, after initHistoryLane (the drawer must exist).
import { initPresence } from './presence.js';
import { initProposals } from './proposals.js';
import { initActivity } from './activity.js';
import { initClash } from './clash.js';

export function initAgentsLane(ctx) {
  initPresence(ctx);
  initProposals(ctx);
  initActivity(ctx, ctx.drawer);
  initClash(ctx);
}
