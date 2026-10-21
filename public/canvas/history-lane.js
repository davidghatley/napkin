// Wires the history lane into the page: the drawer (Code, History, Inspect, Assets, Changes) and the tools in it.
// main.js calls initHistoryLane(ctx) once, after the stage exists.
import { createDrawer } from './drawer.js';
import { initCode } from './code.js';
import { initHistory } from './history.js';
import { initInspect } from './inspect.js';
import { initAssets } from './assets.js';
import { initChanges } from './changes.js';

export function initHistoryLane(ctx) {
  const drawer = createDrawer(ctx);
  ctx.drawer = drawer;
  initCode(ctx, drawer); initHistory(ctx, drawer); initInspect(ctx, drawer); initAssets(ctx, drawer); initChanges(ctx, drawer);
  return drawer;
}
