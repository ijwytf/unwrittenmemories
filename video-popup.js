const previewUrl = 'https://drive.google.com/file/d/1PSBwgsz3wVAITA3f-IFo7tqXlQnHwEFl/preview';

export function createVideoPopup() {
  const trigger = document.querySelector('#video-open');
  const dialog = document.querySelector('#video-dialog');
  const player = document.querySelector('#video-player');
  const closeButton = document.querySelector('#video-close');
  const intro = document.querySelector('#intro-content');

  function close() {
    if (dialog.hidden) return;
    player.replaceChildren(); // Removing the iframe stops video and audio playback.
    dialog.hidden = true;
    dialog.inert = true;
    document.body.classList.remove('video-open');
    intro.inert = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', event => {
    event.stopPropagation();
    if (!dialog.hidden) return;
    const iframe = document.createElement('iframe');
    iframe.src = previewUrl;
    iframe.title = '영상 재생';
    iframe.allow = 'autoplay; fullscreen';
    iframe.allowFullscreen = true;
    player.appendChild(iframe);
    dialog.hidden = false;
    dialog.inert = false;
    document.body.classList.add('video-open');
    intro.inert = true;
    trigger.setAttribute('aria-expanded', 'true');
    closeButton.focus({ preventScroll: true });
  });

  closeButton.addEventListener('click', close);
  dialog.addEventListener('click', event => {
    event.stopPropagation();
    if (event.target === dialog && matchMedia('(hover: hover) and (pointer: fine)').matches) close();
  });
  dialog.addEventListener('touchend', event => event.stopPropagation(), { passive: true });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      closeButton.focus({ preventScroll: true });
    }
  });
}
