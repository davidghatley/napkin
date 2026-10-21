// Tools (stub for M4): the drawing tools (frame, text, image slot, new component) plug in here.
// M2 only has the select tool, and selecting itself is done by stage.js (click an element).
export function initTools(ctx) {
  const tools = new Map([['select', { id: 'select', activate() {}, deactivate() {} }]]);
  ctx.state.tool = 'select';
  return {
    tools,
    use(id) {
      if (!tools.has(id) || id === ctx.state.tool) return;
      tools.get(ctx.state.tool)?.deactivate(ctx);
      ctx.state.tool = id;
      tools.get(id).activate(ctx);
      ctx.emit('tool', { tool: id });
    },
  };
}
