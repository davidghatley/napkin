// The one place napkin deletes anything (lead ruling for the film strip, 2026-10-30): files inside napkin's own state dir
// (outside every opened folder), never in the folder itself. Refuses any path that is not inside the state dir.
import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export function removeInState(stateDir, path) {
  const root = resolve(stateDir), target = resolve(path);
  if (!target.startsWith(root + sep)) throw new Error(`refusing to delete ${path}: it is not inside napkin's state folder. Next: only napkin's own state files can be removed`);
  rmSync(target, { recursive: true, force: true });
}
