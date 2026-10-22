// A recognisable big text: every line says which payload it belongs to, so a torn file is easy to tell from a whole one.
export const payload = (tag, kb) => Array.from({ length: Math.ceil((kb * 1024) / 20) }, (_, i) => `${tag}${String(i).padStart(8, '0')}-${tag}\n`).join('');
