const languageOf = character => /[가-힣]/u.test(character) ? 'ko' : /[a-z]/i.test(character) ? 'en' : null;
// Includes unfinished modern/compatibility/extended Hangul, not just syllables.
const hasHangul = value => /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7ff]/u.test(value);

export function sanitizeSearch(value, preferredMode = null) {
  let mode = preferredMode;
  let result = '';
  for (const character of value) {
    const language = languageOf(character);
    if (character === ' ') { result += character; continue; }
    if (!language) continue;
    if (!mode) mode = language;
    if (language === mode) result += character;
  }
  result = result.slice(0, mode === 'ko' ? 5 : 8);
  if (!Array.from(result).some(languageOf)) mode = null;
  return { value: result, mode };
}

export function createSearchInput(onSearch) {
  const form = document.createElement('form');
  form.id = 'point-search';
  form.setAttribute('role', 'search');
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'point-search-input';
  input.placeholder = 'SEARCH';
  input.enterKeyHint = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('aria-label', 'Point Cloud 검색: 한글 5자 또는 영어 8자. 빈 입력으로 원래 형태 복귀');
  input.disabled = true;
  form.appendChild(input);
  document.body.appendChild(form);
  let composing = false, mode = null, hangulEditing = false;
  const normalize = () => {
    const caret = input.selectionStart ?? input.value.length;
    const prefix = sanitizeSearch(input.value.slice(0, caret), mode).value;
    const sanitized = sanitizeSearch(input.value, mode);
    if (input.value !== sanitized.value) {
      input.value = sanitized.value;
      input.setSelectionRange(Math.min(prefix.length, input.value.length), Math.min(prefix.length, input.value.length));
    }
    mode = sanitized.mode;
  };
  input.addEventListener('beforeinput', () => {
    // Selecting/replacing the whole query starts a fresh language choice.
    if (!composing && input.selectionStart === 0 && input.selectionEnd === input.value.length) {
      mode = null;
      hangulEditing = false;
    }
  });
  input.addEventListener('compositionstart', () => {
    if (input.selectionStart === 0 && input.selectionEnd === input.value.length) mode = null;
    composing = true;
    hangulEditing = true;
  });
  input.addEventListener('compositionupdate', () => { hangulEditing = true; });
  input.addEventListener('compositionend', () => {
    composing = false;
    // Do not rewrite the DOM at syllable boundaries: a following input may still
    // belong to the keyboard's ongoing word edit. Validate on submit/blur instead.
    if (document.activeElement !== input) normalize();
  });
  input.addEventListener('input', event => {
    if (composing || event.isComposing || /Composition/i.test(event.inputType || '')
      || hasHangul(input.value) || hasHangul(event.data || '')) hangulEditing = true;
    // Some keyboard edits carry neither composition events nor isComposing.
    // Preserve their Hangul/jamo and caret until an explicit commit boundary.
    if (!composing && !event.isComposing && !hangulEditing) normalize();
    if (!input.value && !composing && !event.isComposing) {
      mode = null;
      hangulEditing = false;
    }
  });
  input.addEventListener('blur', () => {
    if (!composing) { normalize(); hangulEditing = false; }
  });
  // Keep input gestures away from scene/microphone shortcuts without blocking IME.
  for (const type of ['click', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'keydown', 'keyup']) {
    form.addEventListener(type, event => event.stopPropagation());
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    event.stopPropagation();
    // A composing Enter confirms an IME candidate. It must not submit partial text.
    if (composing || input.disabled) return;
    normalize();
    hangulEditing = false;
    input.value = input.value.trim();
    if (!input.value) mode = null;
    onSearch(input.value);
    input.blur();
  });
  const place = () => {
    const viewport = window.visualViewport;
    const inset = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
    form.style.setProperty('--keyboard-inset', `${inset}px`);
  };
  window.visualViewport?.addEventListener('resize', place);
  window.visualViewport?.addEventListener('scroll', place);
  window.addEventListener('resize', place);
  place();
  return input;
}
