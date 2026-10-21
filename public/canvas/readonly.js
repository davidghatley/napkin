// Long refusal reasons belong in a tooltip, not across neighbouring frame titles.
// Full build errors remain visible in the frame header; no source or rendering changes.
export function initReadOnly(ctx) {
  const style = document.createElement('style');
  style.textContent = '.cmp .badge:not([hidden]) { display:inline-block; max-width:260px; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; white-space:nowrap } .cmp:has(.build-error:not(:empty)) .frame { min-width:420px; min-height:110px }';
  document.head.append(style);
  const update = () => {
    for (const badge of document.querySelectorAll('.cmp .badge:not([hidden])')) if (badge.title !== badge.textContent) badge.title = badge.textContent;
    // Failed builds return before stage.render measures a matrix. Reserve a readable
    // frame for that error so initial packing and quick-open focus use its real size.
    for (const sec of ctx.stage.sections.values()) if (sec.el.querySelector('.build-error')?.textContent) {
      sec.size = { w: sec.frame.offsetWidth, h: sec.frame.offsetHeight };
      sec.el.style.setProperty('--w', `${sec.size.w}px`); sec.el.style.setProperty('--h', `${sec.size.h}px`);
    }
  };
  new MutationObserver(update).observe(document.querySelector('#world'), { childList: true, subtree: true, characterData: true });
  update();
}
