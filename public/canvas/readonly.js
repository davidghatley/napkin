// Refresh existing siblings when streaming discovery reveals a duplicate name.
export function initReadOnly(ctx) {
  const update = ({ component }) => {
    const c = ctx.state.components.get(component);
    if (c) for (const sibling of ctx.named(c.name)) ctx.stage.header(sibling.component);
  };
  ctx.on('added', update); ctx.on('change', update);
}
