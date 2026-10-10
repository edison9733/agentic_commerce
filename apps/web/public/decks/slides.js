(function () {
  if (window.__tesseraSlides) return;
  window.__tesseraSlides = true;
  var fallback = document.getElementById('fallback');
  if (fallback) fallback.remove();
  var stage = document.getElementById('stage');
  var slides = Array.prototype.slice.call(stage.querySelectorAll('section'));
  var progress = document.getElementById('progress');
  var notes = document.getElementById('notes');
  var hint = document.getElementById('hint');

  // What animates: a slide's direct children, and the items of every row, column and terminal.
  slides.forEach(function (s) {
    s.querySelectorAll(':scope > *:not(.source), .row > *, .col > *, .term > div, .anim').forEach(function (el) { el.classList.add('a'); });
    var marked = s.querySelectorAll('.a');
    marked.forEach(function (el, i) { el.style.setProperty('--i', i); });
    s.querySelectorAll('.source').forEach(function (el) { el.classList.add('a'); el.style.setProperty('--i', marked.length); });
  });

  function fit() {
    var k = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'scale(' + k + ') translate(-50%, -50%)';
  }
  addEventListener('resize', fit);
  fit();

  var gen = 0;
  function count(s, g) {
    s.querySelectorAll('[data-count]').forEach(function (el) {
      var to = Number(el.dataset.count), t0 = performance.now(), dur = 1500, delay = 400;
      var fmt = function (v) { return el.dataset.format === 'comma' ? Math.round(v).toLocaleString('en-US') : String(Math.round(v)); };
      el.textContent = fmt(0);
      var step = function (now) {
        if (g !== gen) return;
        var p = Math.min(1, Math.max(0, (now - t0 - delay) / dur));
        el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  var at = -1;
  function show(n) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (n === at) return; // the first or last slide: nothing to replay
    at = n;
    gen += 1;
    slides.forEach(function (s) { s.classList.remove('active'); });
    void stage.offsetWidth; // restart the animations
    slides[at].classList.add('active');
    count(slides[at], gen);
    progress.style.width = ((at + 1) / slides.length) * 100 + '%';
    notes.textContent = slides[at].dataset.speakerNotes || '';
    try { history.replaceState(null, '', '#' + (at + 1)); } catch (e) { /* rate-limited: the slide still changed */ }
  }
  function fromHash() {
    var n = parseInt(location.hash.slice(1), 10);
    return isFinite(n) ? n - 1 : 0;
  }

  function fullscreen() {
    var d = document, el = d.documentElement;
    var current = d.fullscreenElement || d.webkitFullscreenElement;
    if (current) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    var request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (request) Promise.resolve(request.call(el)).catch(function () {});
  }

  addEventListener('click', function () { show(at + 1); });
  addEventListener('contextmenu', function (e) { if (e.shiftKey) return; e.preventDefault(); show(at - 1); });
  addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ' && e.shiftKey) { e.preventDefault(); show(at - 1); }
    else if (['ArrowRight', ' ', 'PageDown', 'Enter'].indexOf(k) > -1) { e.preventDefault(); show(at + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].indexOf(k) > -1) { e.preventDefault(); show(at - 1); }
    else if (k === 'Home') show(0);
    else if (k === 'End') show(slides.length - 1);
    else if (k === 'f') fullscreen();
    else if (k === 'n') notes.classList.toggle('on');
  });
  addEventListener('hashchange', function () { show(fromHash()); });

  // A swipe on a phone or tablet: left for the next slide, right to go back.
  var x0 = null, y0 = null;
  addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); show(dx < 0 ? at + 1 : at - 1); }
  });

  hint.style.display = 'block';
  setTimeout(function () { hint.style.opacity = 0; }, 4000);
  show(fromHash());
})();
