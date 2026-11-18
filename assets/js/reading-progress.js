// Reading progress for posts: a thin bar at the top and a "~N min left" note.
// Uses the same 180 words-per-minute as Chirpy's read-time.
(function () {
  'use strict';
  var WPM = 180;

  function init() {
    var content = document.querySelector('article[data-toc] .content');
    if (!content) return;

    var words = (content.innerText || '').trim().split(/\s+/).length;
    if (words < 400) return; // short posts don't need it

    var bar = document.createElement('div');
    bar.className = 'reading-progress';
    bar.setAttribute('aria-hidden', 'true');
    var fill = document.createElement('div');
    bar.appendChild(fill);

    var left = document.createElement('div');
    left.className = 'reading-left';
    left.setAttribute('aria-hidden', 'true');

    document.body.appendChild(bar);
    document.body.appendChild(left);

    var ticking = false;
    function update() {
      ticking = false;
      var rect = content.getBoundingClientRect();
      var total = rect.height - window.innerHeight * 0.5;
      var read = -rect.top + window.innerHeight * 0.25;
      var p = total > 0 ? Math.min(1, Math.max(0, read / total)) : 1;
      fill.style.transform = 'scaleX(' + p + ')';

      var mins = Math.ceil((words * (1 - p)) / WPM);
      var started = rect.top < 0;
      var done = p >= 0.98;
      left.textContent = done ? 'done' : '~' + mins + ' min left';
      left.classList.toggle('show', started && !done);
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
