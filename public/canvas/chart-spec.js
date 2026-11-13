// The small chart shapes napkin has always accepted become the same specification the interpreter runs.
export function chartSpec(j) {
  if (j.mark || j.layer || j.hconcat || j.vconcat || j.concat || j.facet || j.repeat) return j;
  const flat = (v) => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : []);
  const series = Array.isArray(j.series) ? j.series : null;
  let rows = [];
  const named = series && series.length && series.every((x) => x && typeof x === 'object' && (Array.isArray(x.values) || Array.isArray(x.data)));
  if (named) series.forEach((x, k) => flat(x.values ?? x.data).forEach((v, i) => rows.push(typeof v === 'object' ? { series: x.name ?? 'Series ' + (k + 1), ...v } : { x: i + 1, y: v, series: x.name ?? 'Series ' + (k + 1) })));
  else rows = flat(series || j.data || j.values).map((v, i) => (v && typeof v === 'object' ? { ...v } : { x: i + 1, y: v }));
  const sample = rows[0] && typeof rows[0] === 'object' ? rows[0] : {};
  const xf = typeof j.x === 'string' ? j.x : j.encoding?.x?.field || (sample.x !== undefined ? 'x' : Object.keys(sample)[0]);
  const yf = typeof j.y === 'string' ? j.y : j.encoding?.y?.field || (sample.y !== undefined ? 'y' : Object.keys(sample).find((k) => k !== xf && typeof sample[k] === 'number'));
  const mark = typeof j.type === 'string' ? j.type : 'bar';
  const continuous = rows.length > 0 && rows.every((r) => typeof r[xf] === 'number') && mark !== 'bar';
  return {
    title: j.title,
    data: { values: rows },
    mark: mark === 'scatter' ? 'point' : mark === 'pie' ? 'arc' : mark,
    encoding:
      mark === 'pie'
        ? { theta: { field: yf, type: 'quantitative' }, color: { field: xf, type: 'nominal' } }
        : {
            x: { field: xf, type: continuous ? 'quantitative' : 'nominal' },
            y: { field: yf, type: 'quantitative' },
            ...(named ? { color: { field: 'series', type: 'nominal' } } : {}),
          },
  };
}
