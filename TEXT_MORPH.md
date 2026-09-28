# Point Cloud text search

## Local preview

Open http://localhost:8000 while the local server is running. After the model loads,
type in the bottom-center SEARCH input and press Enter. Submit another word to
morph directly between words. Clear the input and press Enter to return to 3D.
The temporary TEXT TEST button has been removed. Start the microphone through
the existing controls. No keyword information or Gallery integration is included.

## Search input

`search-input.js` owns validation and the form. Complete Korean syllables allow
up to 5 characters, English A–Z/a–z up to 8, including spaces. The first actual
letter chooses the language; other scripts, digits and symbols are filtered.
The language resets after clearing or replacing the entire query. Leading and
trailing spaces are trimmed on submit; an empty/space-only query returns to 3D.

Composition updates are left untouched. Filtering happens on compositionend and
ordinary input events, with caret adjustment. A composing submit is ignored, while
the next non-composing Enter submits through the form's single submit handler.
No native maxlength is applied during composition.
Input clicks/touches/keys do not bubble into scene/microphone handlers.

The form uses a thin underline with a 44px input hit area, 16px text to avoid iOS
focus zoom, safe-area spacing and VisualViewport resize/scroll offsets for the
keyboard. Submit blurs once. Credits/Gallery hides the form through CSS without
changing either UI. Actual OS keyboard/IME behavior still requires device testing.

## Existing rendering structure

- GLTF mesh surfaces are sampled with MeshSurfaceSampler into 18 separate Points
  geometries. Each retains its mesh transform, texture/UVs and material.
- Desktop uses 305,068 points; the mobile quality profile uses 91,718 points.
- Each geometry's mutable position attribute is separate from the existing
  `userData.originalPositions` copy. The original array is never changed by morphing.
- The normal animation derives positions from those originals every update:
  sinusoidal movement plus per-point scatter direction times microphone strength.
  Audio attack/release smooths the microphone response; Afterimage supplies visual
  trails. Bloom and saturation remain postprocessing passes.
- The parent model continues rotating. Desktop normally updates positions every
  second rendered frame; mobile renders and updates at up to 30 FPS.
- Existing mobile GLB, texture sizes, point cap, pixel budget, antialiasing and Bloom
  resolution settings are unchanged.

## Added implementation

`text-morph.js` exports `TextMorph` and `TEXT_MORPH_CONFIG`. Edit the configuration
for text, duration (seconds), easing, font, glyph spacing, screen width/height
fractions, normalized x/y offsets, shallow depth, noise and audio scale.

`createTextTargets(text)` draws system-font Korean or English glyphs onto an offscreen canvas,
samples opaque pixels, and produces one normalized Float32Array per existing
cloud. Subpixel jitter and shallow depth distribute all existing points across
the letters. No new points, TextGeometry, visible canvas or external fonts are
added. An LRU cache retains at most two words; cache hits reuse their arrays.
Changing viewport size only changes the camera-relative layout, not the samples.
Text height is the smaller of the configured viewport height fraction and the
viewport width fraction divided by the measured ink aspect ratio. Long words fit
without changing camera position or FOV.

`search(text)` is the public search entry point. It preserves the original/text
blend and adds interpolation between the current and next text target sets. A
submission during a transition flattens the current text interpolation into one
snapshot, avoiding jumps or an accumulating chain of prior targets. This snapshot
does not sample or modify original geometry. Noise amplitude interpolates too.

Every active frame converts camera-relative text coordinates into each cloud's
local space using inverse world matrices. The camera and original transforms are
not modified. Original motion continues behind the transition. Smoothstep blends
the ordinary animated positions with the text positions over two seconds.
Reversing midway starts from the current blend. Reaching zero bypasses morph math
and restores the exact original animation formula, including continuing rotation,
noise and microphone response. It does not rewind the animation clock.

All 18 clouds participate and retain ownership of their own points. Frustum
culling is temporarily disabled during morph/text because their original bounding
spheres no longer enclose the letters; original culling flags return afterward.

Text reuses the existing sine phases, scatter directions and smoothed audio level,
with displacement scaled to letter height. Quiet letters have subtle motion;
sound disperses the letters and the existing release gradually reforms them.
Postprocessing settings are untouched.

`main.js` connects the input/controller and hooks into the existing
position update. `index.html` adds styles for the form, with a 44px touch height
and safe-area offsets. It is hidden from interaction while Credits/Gallery is open.
Credits and Gallery code, content and layout are unchanged.

## Cost and limitations

- Cached target buffers add approximately 3.49 MiB desktop / 1.05 MiB mobile for
  each word, plus temporary canvas/pixel sampling memory during first generation.
  Two cached words plus active transition/snapshot buffers remain bounded; they
  do not accumulate with search history. Snapshot allocation occurs only on a
  new submission during an unfinished word transition, never on every frame.
- Morph/text adds affine coordinate calculations per point. Desktop position
  updates run every rendered frame while active so the letters remain stationary
  despite parent rotation. Returning restores the old update cadence. Mobile
  retains its existing 30 FPS cap and point count.
- First-time target generation is synchronous and may briefly pause on slow
  devices. It is not repeated per frame or per toggle.
- System font availability affects glyph appearance. Fonts are not downloaded;
  a device without Korean glyph support can display missing-glyph boxes.
- Existing point textures/color/size and Bloom remain, so letters have textured,
  luminous edges rather than flat typography. Strong audio can obscure legibility.
- Browser tests use Edge and mobile viewport/device emulation, not physical iOS
  Safari or Android GPU/memory measurements.
- First-time generation and rapid interrupted searches may briefly allocate more
  memory until garbage collection. Incremental/worker sampling could be considered
  after profiling on slower physical devices.

## Verification

`node --test tests/*.test.mjs` checks search validation and existing quality,
GLB and gallery data invariants. `tests/browser.cjs` requires Playwright, installed
Edge and CDN access. It compares desktop camera/transforms/sampled originals,
effects and static pixels against HEAD, exercises Credits/Gallery and microphone
lifecycle, and checks repeated morph/return, mid-transition reversal, all-cloud
targets, finite coordinates, cached targets, original arrays, restored culling,
and exact Float32 equality with the original animation formula for every point.
It also captures desktop, mobile landscape and mobile portrait text screenshots.
