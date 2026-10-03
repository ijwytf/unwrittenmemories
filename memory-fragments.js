import { loadRecordData } from './record-data.js';
import { getRecordNote } from './record-note.js';
import { selectQuality } from './quality.js';

function shuffleKeywords(words) {
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words;
}

export class MemoryFragments {
  constructor(panel) {
    this.panel = panel;
    this.rows = panel.querySelector('#fragment-rows');
    this.status = panel.querySelector('#fragments-status');
    this.visible = new Set();
    this.tinted = new Set();
    this.opened = false;
    this.mobile = selectQuality().name === 'mobile';
    this.desktopWidth = matchMedia('(min-width: 601px)');
    this.desktopWidth.addEventListener('change', () => { if (this.opened) this.renderRows(); });
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.visible.add(entry.target);
        else this.visible.delete(entry.target);
      }
    }, { root: panel, rootMargin: '90px 0px' });
    this.resizeObserver = new ResizeObserver(() => {
      if (this.opened && this.rows.clientWidth !== this.width) this.renderRows();
    });
    this.resizeObserver.observe(this.rows);
    panel.addEventListener('click', event => {
      const button = event.target.closest('.fragment-keyword');
      if (!button || !this.library) return;
      const record = button.dataset.region
        ? this.library.selectRecordForRegion(button.dataset.region)
        : this.library.selectRecordForSearch(button.dataset.keyword);
      if (!record) return;
      const note = this.getNote();
      note.element.dataset.context = 'fragments';
      this.trigger = button;
      this.resetProximity();
      note.open(record, () => {
        const rect = this.trigger.getBoundingClientRect(), bounds = this.panel.getBoundingClientRect();
        const left = Math.max(rect.left, bounds.left), right = Math.min(rect.right, bounds.right);
        const top = Math.max(rect.top, bounds.top), bottom = Math.min(rect.bottom, bounds.bottom);
        return left < right && top < bottom ? { x: (left + right) / 2, y: (top + bottom) / 2 } : null;
      }, button);
    });
    panel.addEventListener('pointermove', event => {
      if (!this.opened || event.pointerType !== 'mouse' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      this.pointer = { x: event.clientX, y: event.clientY };
      if (!this.frame) this.frame = requestAnimationFrame(() => this.updateProximity());
    });
    panel.addEventListener('pointerleave', () => this.resetProximity());
    panel.addEventListener('scroll', () => this.resetProximity(), { passive: true });
  }

  getNote() {
    return this.note ||= getRecordNote({ mobile: selectQuality().name === 'mobile' });
  }

  async open() {
    this.opened = true;
    this.status.hidden = true;
    try {
      this.library ||= await loadRecordData();
      if (!this.keywords) {
        // The existing index already trims/removes empty and duplicate keywords.
        this.keywords = shuffleKeywords([...this.library.index.keys()]);
        this.displayKeywords = [...this.keywords, ...shuffleKeywords([...this.keywords])];
      }
      if (this.opened && (!this.rows.childElementCount || this.rows.clientWidth !== this.width)) this.renderRows();
    } catch (error) {
      if (!this.opened) return;
      this.status.textContent = '기억의 조각들을 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
      this.status.hidden = false;
      console.warn('기억의 조각들 데이터를 불러오지 못했습니다.', error);
    }
  }

  close() {
    this.opened = false;
    this.resetProximity();
    this.note?.dismiss();
    if (this.note) delete this.note.element.dataset.context;
  }

  renderRows() {
    if (!this.keywords?.length || !this.rows.clientWidth) return;
    const cloud = this.mobile || this.desktopWidth.matches;
    this.panel.classList.toggle('is-cloud', cloud);
    this.panel.classList.toggle('is-mobile-directory', this.mobile);
    this.width = this.rows.clientWidth;
    this.resetProximity();
    this.observer.disconnect();
    this.visible.clear();
    const focusedSlot = document.activeElement?.dataset.slot;
    const fragment = document.createDocumentFragment();
    const makeButton = (index, copy = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fragment-keyword';
      button.dataset.keyword = this.displayKeywords[index];
      button.dataset.slot = String(index);
      button.textContent = this.displayKeywords[index];
      button.setAttribute('aria-controls', 'record-note');
      button.setAttribute('aria-expanded', 'false');
      if (copy) {
        // Edge continuations remain tappable; assistive tech visits each word once.
        button.dataset.copy = 'true';
        button.tabIndex = -1;
        button.setAttribute('aria-hidden', 'true');
      }
      return button;
    };
    if (cloud) {
      this.renderDesktop(fragment, makeButton);
      this.finishLayout(fragment, focusedSlot);
      return;
    }
    const style = getComputedStyle(this.panel);
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const gap = parseFloat(getComputedStyle(this.rows).getPropertyValue('--fragment-gap'));
    const widths = this.displayKeywords.map(word => measure.measureText(word).width);
    const count = this.displayKeywords.length;
    let cursor = 0, rowIndex = 0;
    while (cursor < count) {
      const inset = [4, 12, 8, 16][rowIndex++ % 4];
      const start = cursor;
      let used = 0;
      while (cursor < count) {
        const next = widths[cursor] + (cursor > start ? gap : 0);
        if (cursor > start && used + next > this.width - inset - 12) break;
        used += next;
        cursor++;
      }
      const line = document.createElement('div');
      line.className = 'fragment-line';
      const row = document.createElement('div');
      row.className = 'fragment-row';
      const leading = [(start + count - 2) % count, (start + count - 1) % count];
      const leadingWidth = leading.reduce((sum, i) => sum + widths[i] + gap, 0);
      row.style.transform = `translateX(${inset - leadingWidth}px)`;
      for (const index of leading) row.appendChild(makeButton(index, true));
      for (let index = start; index < cursor; index++) row.appendChild(makeButton(index));
      let right = inset + used, tail = cursor;
      while (right < this.width + 120) {
        const index = tail++ % count;
        row.appendChild(makeButton(index, true));
        right += widths[index] + gap;
      }
      line.appendChild(row);
      fragment.appendChild(line);
    }
    this.finishLayout(fragment, focusedSlot);
  }

  renderDesktop(fragment, makeButton) {
    const regions = document.createElement('div');
    regions.className = 'fragment-regions';
    for (const region of ['괴산', '옥천', '보은', '단양']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fragment-keyword';
      button.dataset.region = region;
      button.dataset.slot = `region-${region}`;
      button.textContent = region;
      button.setAttribute('aria-controls', 'record-note');
      button.setAttribute('aria-expanded', 'false');
      regions.appendChild(button);
    }
    fragment.appendChild(regions);
    const words = document.createElement('div');
    words.className = 'fragment-keywords';
    const panelStyle = getComputedStyle(this.panel);
    const bounds = getComputedStyle(this.rows);
    const available = this.width - parseFloat(bounds.paddingLeft) - parseFloat(bounds.paddingRight);
    const gap = this.mobile ? 6 : parseFloat(bounds.getPropertyValue('--fragment-gap'));
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `${panelStyle.fontWeight} ${panelStyle.fontSize} ${panelStyle.fontFamily}`;
    let row = document.createElement('div');
    row.className = 'fragment-keyword-row';
    let used = 0;
    this.keywords.forEach((word, index) => {
      const width = Math.max(this.mobile ? 44 : 0, measure.measureText(word).width + (this.mobile ? 12 : 0));
      const next = width + (used ? gap : 0);
      if (used && used + next > available) {
        if (row.childElementCount < 3) row.classList.add('is-last');
        words.appendChild(row);
        row = document.createElement('div');
        row.className = 'fragment-keyword-row';
        used = 0;
      }
      row.appendChild(makeButton(index));
      used += width + (used ? gap : 0);
    });
    row.classList.add('is-last');
    words.appendChild(row);
    fragment.appendChild(words);
  }

  finishLayout(fragment, focusedSlot) {
    this.rows.replaceChildren(fragment);
    this.rows.querySelectorAll('button').forEach(button => this.observer.observe(button));
    const primary = slot => this.rows.querySelector(`button:not([data-copy])[data-slot="${slot}"]`);
    if (this.trigger) {
      this.trigger = primary(this.trigger.dataset.slot);
      if (!this.trigger) this.note?.dismiss();
      if (this.note?.element.dataset.context === 'fragments' && !this.note.element.hidden) {
        this.note.trigger = this.trigger;
        this.trigger.setAttribute('aria-expanded', 'true');
      }
    }
    if (focusedSlot) primary(focusedSlot)?.focus({ preventScroll: true });
  }

  updateProximity() {
    this.frame = null;
    if (!this.opened || !this.pointer) return;
    const next = new Set();
    for (const button of this.visible) {
      const rect = button.getBoundingClientRect();
      const dx = Math.max(rect.left - this.pointer.x, 0, this.pointer.x - rect.right);
      const dy = Math.max(rect.top - this.pointer.y, 0, this.pointer.y - rect.bottom);
      const distance = Math.hypot(dx, dy);
      if (distance >= 90) continue;
      const value = Math.round(90 + 165 * (1 - distance / 90));
      button.style.setProperty('--keyword-color', `rgb(${value}, ${value}, ${value})`);
      next.add(button);
    }
    for (const button of this.tinted) if (!next.has(button)) button.style.removeProperty('--keyword-color');
    this.tinted = next;
  }

  resetProximity() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pointer = null;
    for (const button of this.tinted) button.style.removeProperty('--keyword-color');
    this.tinted.clear();
  }
}
