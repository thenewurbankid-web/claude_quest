// Touch controls for phones and tablets: a D-pad, A/B, and Start/Map/Lumi. Each button presses the same keys the
// keyboard does, so every screen works unchanged. Shown only on touch devices (or with ?touch in the URL).
(function () {
  const touch = matchMedia('(pointer: coarse)').matches || /[?&]touch\b/.test(location.search);
  if (!touch) return;
  document.documentElement.classList.add('touch');

  const pad = document.createElement('div');
  pad.id = 'pad';
  pad.innerHTML = `
    <div class="dpad" aria-label="Move">
      <b data-key="ArrowUp" class="up" aria-label="Up"></b><b data-key="ArrowLeft" class="left" aria-label="Left"></b>
      <b data-key="ArrowRight" class="right" aria-label="Right"></b><b data-key="ArrowDown" class="down" aria-label="Down"></b><i></i>
    </div>
    <div class="mid">
      <button data-tap="Enter">START</button><button data-tap="m">MAP</button><button data-tap="l">LUMI</button>
    </div>
    <div class="ab">
      <button data-tap="x" class="b" aria-label="B, back">B</button><button data-tap="z" class="a" aria-label="A, talk or confirm">A</button>
    </div>`;
  document.body.appendChild(pad);

  const send = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
  // The D-pad: the direction under the finger is held; sliding to another arm switches direction.
  let held = null;
  const hold = key => {
    if (key === held) return;
    if (held) send('keyup', held);
    held = key;
    if (key) send('keydown', key);
    for (const b of pad.querySelectorAll('.dpad b')) b.classList.toggle('on', b.dataset.key === key);
  };
  const dpad = pad.querySelector('.dpad');
  const under = e => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.dpad b')?.dataset.key || null;
  dpad.addEventListener('pointerdown', e => { dpad.setPointerCapture(e.pointerId); hold(under(e)); e.preventDefault(); });
  dpad.addEventListener('pointermove', e => { if (held !== null || e.buttons) hold(under(e)); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) dpad.addEventListener(t, () => hold(null));

  // Menus move one step per tap, so repeated taps on the D-pad also work in lists.
  for (const b of pad.querySelectorAll('[data-tap]')) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('on'); send('keydown', b.dataset.tap); navigator.vibrate?.(8); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, () => { b.classList.remove('on'); send('keyup', b.dataset.tap); });
  }
  // No double-tap zoom or page scrolling while playing.
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (!e.target.closest('#plist, #choices, #itext, #dtext')) e.preventDefault(); }, { passive: false });
})();
