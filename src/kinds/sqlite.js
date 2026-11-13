// Select a bounded projection; a single large BLOB must never become a JavaScript buffer.
export function sqliteRows(db, name, count, offset = 0) {
  const quote = (text) => '"' + text.replaceAll('"', '""') + '"';
  const columns = db
    .prepare('PRAGMA table_info(' + quote(name) + ')')
    .all()
    .slice(0, 64);
  if (!columns.length) return [];
  const projection = columns
    .map(({ name }) => {
      const column = quote(name);
      return `CASE WHEN typeof(${column}) = 'blob' THEN '[blob ' || length(${column}) || ' bytes]' WHEN typeof(${column}) = 'text' THEN substr(${column},1,2048) ELSE ${column} END AS ${column}`;
    })
    .join(',');
  return db.prepare(`SELECT ${projection} FROM ${quote(name)} LIMIT ? OFFSET ?`).all(count, offset);
}
