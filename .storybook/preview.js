// Toolbar: Theme (light / dark). It sets data-theme inside every fixture, exactly as napkin's own toggle does.
const PAGE = { light: '#e8eaee', dark: '#14161b' };
export default {
  globalTypes: {
    theme: { description: 'napkin chrome theme', toolbar: { title: 'Theme', icon: 'circlehollow', items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }], dynamicTitle: true } },
  },
  initialGlobals: { theme: 'light' },
  decorators: [(story, ctx) => { document.body.style.background = PAGE[ctx.globals.theme] || PAGE.light; return story(); }],
  parameters: {
    layout: 'fullscreen',
    options: { storySort: { order: ['1 Interface', '2 Panels', '3 Components'] } },
  },
};
