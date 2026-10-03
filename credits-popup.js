// Credits has its own content, but follows the existing paper animation language.
export function createCreditsPopup() {
  const dialog = document.querySelector('#credits-dialog');
  const paper = document.querySelector('#credits-paper');
  const content = document.querySelector('#credits-content');
  const trigger = document.querySelector('#credits-open');
  const closeButton = document.querySelector('#credits-close');
  const intro = document.querySelector('#intro-content');
  const mainToggle = document.querySelector('#credits-toggle');
  let timer;

  function placeOrigin() {
    const a = trigger.getBoundingClientRect();
    // Paper's untransformed center is the center of the fixed dialog.
    const box = dialog.getBoundingClientRect();
    const left = box.left + (box.width - paper.offsetWidth) / 2;
    const top = box.top + (box.height - paper.offsetHeight) / 2;
    paper.style.transformOrigin = `${a.left + a.width / 2 - left}px ${a.top + a.height / 2 - top}px`;
  }

  function dismiss() {
    clearTimeout(timer);
    dialog.hidden = true;
    dialog.inert = true;
    dialog.classList.remove('is-open', 'is-closing');
    document.body.classList.remove('credits-popup-open');
    trigger.setAttribute('aria-expanded', 'false');
    intro.inert = document.body.classList.contains('gallery-open') || document.body.classList.contains('fragments-open');
    mainToggle.inert = document.body.classList.contains('fragments-open');
  }

  function close() {
    if (!dialog.classList.contains('is-open')) return;
    placeOrigin();
    dialog.classList.remove('is-open');
    dialog.classList.add('is-closing');
    dialog.inert = true;
    intro.inert = false;
    mainToggle.inert = false;
    trigger.focus({ preventScroll: true });
    timer = setTimeout(dismiss, 700);
  }

  trigger.addEventListener('click', () => {
    dismiss();
    dialog.hidden = false;
    dialog.inert = false;
    content.scrollTop = 0;
    placeOrigin();
    void dialog.offsetWidth;
    dialog.classList.add('is-open');
    document.body.classList.add('credits-popup-open');
    trigger.setAttribute('aria-expanded', 'true');
    intro.inert = true;
    mainToggle.inert = true;
    closeButton.focus({ preventScroll: true });
  });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      // Two focusable elements: close control and the scrollable Credits text.
      event.preventDefault();
      (document.activeElement === closeButton ? content : closeButton).focus({ preventScroll: true });
    }
  });
  window.addEventListener('resize', () => { if (!dialog.hidden) placeOrigin(); });
  return { dismiss, close };
}
