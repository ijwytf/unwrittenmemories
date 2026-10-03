// Both entry points share this paper; record selection stays in RecordLibrary.
let sharedNote;
export function getRecordNote(options) {
  return sharedNote ||= new RecordNote(options);
}

// A non-modal paper: the surrounding artwork/search remain available.
export class RecordNote {
  constructor({ mobile = false } = {}) {
    this.mobile = mobile;
    this.element = document.createElement('section');
    this.element.id = 'record-note';
    this.element.hidden = true;
    this.element.inert = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-labelledby', 'record-title');
    this.element.innerHTML = `
      <button id="record-close" type="button" aria-label="기록 닫기"></button>
      <div class="record-scroll" tabindex="0">
        <p class="record-region"></p>
        <h2 id="record-title"></h2>
        <div class="record-content"></div>
      </div>`;
    document.body.appendChild(this.element);
    this.closeButton = this.element.querySelector('button');
    this.scroll = this.element.querySelector('.record-scroll');
    this.closeButton.addEventListener('click', () => this.close());
    for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'keyup']) {
      this.element.addEventListener(type, event => event.stopPropagation());
    }
    this.element.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    });
    this.resize = () => { if (!this.element.hidden) this.layout(); };
    window.addEventListener('resize', this.resize);
    window.visualViewport?.addEventListener('resize', this.resize);
    window.visualViewport?.addEventListener('scroll', this.resize);
  }

  layout() {
    const viewport = window.visualViewport;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const narrow = this.mobile || width <= 640;
    this.element.style.width = `${Math.min(width - 32, narrow ? width * 0.86 : Math.max(280, width * 0.36))}px`;
    this.element.style.maxHeight = `${height * 0.68}px`;
    // offsetWidth/Height ignore the opening scale transform.
    const w = this.element.offsetWidth, h = this.element.offsetHeight;
    const point = this.getPosition() || this.origin;
    const x = narrow ? left + (width - w) / 2 : point.x - w * 0.48;
    const y = narrow ? top + (height - h) / 2 : point.y - h * 0.42;
    this.left = Math.max(left + 16, Math.min(left + width - w - 16, x));
    this.top = Math.max(top + 16, Math.min(top + height - h - 16, y));
    this.element.style.left = `${this.left}px`;
    this.element.style.top = `${this.top}px`;
    this.setOrigin(point);
  }

  setOrigin(point) {
    this.element.style.transformOrigin = `${point.x - this.left}px ${point.y - this.top}px`;
  }

  open(record, getPosition, trigger) {
    this.dismiss();
    this.getPosition = getPosition;
    this.origin = getPosition();
    if (!this.origin) return;
    this.trigger = trigger;
    this.element.querySelector('.record-region').textContent = record.region;
    this.element.querySelector('h2').textContent = record.title;
    const content = this.element.querySelector('.record-content');
    content.replaceChildren(...record.content.split(/\r\n|\r|\n/).map(text => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      return paragraph;
    }));
    this.element.hidden = false;
    this.element.inert = false;
    this.scroll.scrollTop = 0;
    this.layout();
    // Commit the small initial paper before starting the transition.
    void this.element.offsetWidth;
    this.element.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    this.closeButton.focus({ preventScroll: true });
  }

  close() {
    if (this.element.hidden || !this.element.classList.contains('is-open')) return;
    this.setOrigin(this.getPosition() || this.origin);
    this.element.classList.remove('is-open');
    this.element.classList.add('is-closing');
    const restoreFocus = this.element.contains(document.activeElement);
    this.element.inert = true;
    this.trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !this.trigger?.hidden) {
      this.trigger?.focus({ preventScroll: true });
    }
    this.timer = setTimeout(() => this.dismiss(), 700);
  }

  dismiss() {
    clearTimeout(this.timer);
    if (this.element.contains(document.activeElement)) document.activeElement.blur();
    this.element.hidden = true;
    this.element.inert = true;
    this.element.classList.remove('is-open', 'is-closing');
    this.trigger?.setAttribute('aria-expanded', 'false');
  }
}
