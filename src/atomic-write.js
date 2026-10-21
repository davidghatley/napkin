// The name the merge lead asked for: writeFileAtomic(path, text) = temp file in the same folder, fsync, rename (REL-01).
// The implementation is src/atomic.js (it also has the exclusive-create form and the stale-temp cleanup).
import { writeAtomic } from './atomic.js';
export const writeFileAtomic = (path, text) => writeAtomic(path, text);
