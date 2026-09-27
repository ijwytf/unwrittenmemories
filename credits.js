import { galleryRegions } from './gallery-data.js';

const toggle = document.querySelector('#credits-toggle');
const credits = document.querySelector('#credits');
const creditsContent = document.querySelector('#credits-content');
const galleryOpenButton = document.querySelector('#gallery-open');
const galleryCloseButton = document.querySelector('#gallery-close');
const galleryPanel = document.querySelector('#gallery-panel');
const galleryRegionsElement = document.querySelector('#gallery-regions');
const galleryMedia = document.querySelector('#gallery-media');
const galleryImage = document.querySelector('#gallery-image');
const galleryCounter = document.querySelector('#gallery-counter');
const galleryPrevious = document.querySelector('#gallery-previous');
const galleryNext = document.querySelector('#gallery-next');
const galleryMeta = document.querySelector('#gallery-meta');
const galleryTitle = document.querySelector('#gallery-title');
const galleryDescription = document.querySelector('#gallery-description');

let selectedRegion = 0;
let selectedPhoto = 0;
let galleryHasOpened = false;
let touchStart = null;

const regionButtons = galleryRegions.map((region, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gallery-region';
  button.textContent = region.name;
  button.setAttribute('role', 'tab');
  button.addEventListener('click', () => selectRegion(index));
  galleryRegionsElement.appendChild(button);
  return button;
});

galleryRegionsElement.setAttribute('role', 'tablist');

function renderPhoto() {
  const region = galleryRegions[selectedRegion];
  const item = region.photos[selectedPhoto];

  regionButtons.forEach((button, index) => {
    const selected = index === selectedRegion;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });

  galleryImage.classList.remove('is-loaded');
  galleryImage.alt = `${region.name} 사진 ${selectedPhoto + 1}`;
  galleryImage.src = item.src;
  galleryCounter.textContent = `${selectedPhoto + 1} / ${region.photos.length}`;

  galleryTitle.textContent = item.title;
  galleryDescription.textContent = item.description;
  galleryTitle.hidden = !item.title;
  galleryDescription.hidden = !item.description;
  galleryMeta.hidden = !item.title && !item.description;
}

function selectRegion(index) {
  selectedRegion = index;
  selectedPhoto = 0;
  renderPhoto();
}

function movePhoto(direction) {
  const total = galleryRegions[selectedRegion].photos.length;
  selectedPhoto = (selectedPhoto + direction + total) % total;
  renderPhoto();
}

function setGalleryOpen(open) {
  document.body.classList.toggle('gallery-open', open);
  creditsContent.setAttribute('aria-hidden', String(open));
  creditsContent.inert = open;
  galleryOpenButton.setAttribute('aria-hidden', String(open));
  galleryOpenButton.tabIndex = open ? -1 : 0;
  galleryPanel.setAttribute('aria-hidden', String(!open));
  galleryPanel.inert = !open;
  galleryCloseButton.setAttribute('aria-hidden', String(!open));
  galleryCloseButton.tabIndex = open ? 0 : -1;

  if (open) {
    if (!galleryHasOpened) {
      galleryHasOpened = true;
      selectedRegion = 0;
      selectedPhoto = 0;
      renderPhoto();
    }
    galleryPanel.scrollTop = 0;
    galleryCloseButton.focus({ preventScroll: true });
  } else if (document.body.classList.contains('credits-open')) {
    galleryOpenButton.focus({ preventScroll: true });
  }
}

function setCreditsOpen(open) {
  document.body.classList.toggle('credits-open', open);
  if (!open) setGalleryOpen(false);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Credits 닫기' : 'Credits 열기');
  credits.setAttribute('aria-hidden', String(!open));
  credits.inert = !open;
  if (open) credits.scrollTop = 0;
}

function stopSceneInput(event) {
  event.stopPropagation();
}

toggle.addEventListener('click', event => {
  stopSceneInput(event);
  setCreditsOpen(!document.body.classList.contains('credits-open'));
});
toggle.addEventListener('touchend', stopSceneInput, { passive: true });

galleryImage.addEventListener('load', () => galleryImage.classList.add('is-loaded'));
galleryOpenButton.addEventListener('click', () => setGalleryOpen(true));
galleryCloseButton.addEventListener('click', () => setGalleryOpen(false));
galleryPrevious.addEventListener('click', () => movePhoto(-1));
galleryNext.addEventListener('click', () => movePhoto(1));

galleryMedia.addEventListener('touchstart', event => {
  const touch = event.changedTouches[0];
  touchStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

galleryMedia.addEventListener('touchend', event => {
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - touchStart.x;
  const deltaY = touch.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(deltaX) < 45 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
  movePhoto(deltaX < 0 ? 1 : -1);
}, { passive: true });

// The microphone and scene listeners are attached to window. Stop all pointer
// interaction inside the overlay before it can reach those handlers.
credits.addEventListener('click', stopSceneInput);
credits.addEventListener('touchend', stopSceneInput, { passive: true });

document.addEventListener('keydown', event => {
  if (!document.body.classList.contains('credits-open')) return;
  if (document.body.classList.contains('gallery-open')) {
    if (event.key === 'ArrowLeft') movePhoto(-1);
    if (event.key === 'ArrowRight') movePhoto(1);
    if (event.key === 'Escape') setGalleryOpen(false);
    return;
  }
  if (event.key === 'Escape') {
    setCreditsOpen(false);
    toggle.focus();
  }
});

setGalleryOpen(false);
