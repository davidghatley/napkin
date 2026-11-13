// Select a bounded projection; a single large BLOB must never become a JavaScript buffer.
// Rows come back as arrays (a view may repeat a column name) and integers as BigInt, so a 19-digit id keeps every digit.
export function sqliteRows(db, name, count, offset = 0) {
  const quote = (text) => '"' + text.replaceAll('"', '""') + '"';
  const columns = db
    .prepare('PRAGMA table_info(' + quote(name) + ')')
    .all()
    .slice(0, 64);
  if (!columns.length) return { names: [], declared: [], rows: [] };
  const projection = columns
    .map(({ name }) => {
      const column = quote(name);
      return `CASE WHEN typeof(${column}) = 'blob' THEN '[blob ' || length(${column}) || ' bytes]' WHEN typeof(${column}) = 'text' THEN substr(${column},1,2048) ELSE ${column} END`;
    })
    .join(',');
  const statement = db.prepare(`SELECT ${projection} FROM ${quote(name)} LIMIT ? OFFSET ?`);
  statement.setReturnArrays(true);
  statement.setReadBigInts(true);
  return {
    names: columns.map((c) => c.name),
    declared: columns.map((c) => String(c.type || '')),
    rows: statement.all(count, offset),
  };
}
