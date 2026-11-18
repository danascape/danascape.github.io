// Post reading extras (loaded on the post layout only):
//   1. "Continue where you left off" for long posts
//   2. Collapse long code blocks / logs
//   3. Glossary tooltips (terms from _data/glossary.yml)
//   4. Footnotes as popovers
(function () {
  'use strict';

  var content = document.querySelector('article[data-toc] .content');
  if (!content) return;

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ *
   * Shared popover (glossary + footnotes)
   * ------------------------------------------------------------------ */
  var pop = document.createElement('div');
  pop.className = 'post-pop';
  pop.id = 'post-pop';
  pop.setAttribute('role', 'tooltip');
  pop.hidden = true;
  document.body.appendChild(pop);
  var popOwner = null;
  var hideTimer = null;

  function place(anchor) {
    var r = anchor.getBoundingClientRect();
    var gap = 8;
    pop.style.left = '0px';
    pop.style.top = '0px';
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(gap, r.left + r.width / 2 - w / 2), window.innerWidth - w - gap);
    var below = r.bottom + gap;
    var top = (below + h > window.innerHeight && r.top - gap - h > 0) ? r.top - gap - h : below;
    pop.style.left = left + window.scrollX + 'px';
    pop.style.top = top + window.scrollY + 'px';
  }

  function showPop(anchor, build) {
    clearTimeout(hideTimer);
    if (popOwner && popOwner !== anchor) popOwner.setAttribute('aria-expanded', 'false');
    pop.textContent = '';
    build(pop);
    pop.hidden = false;
    popOwner = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    place(anchor);
  }

  function hidePop() {
    clearTimeout(hideTimer);
    if (popOwner) popOwner.setAttribute('aria-expanded', 'false');
    popOwner = null;
    pop.hidden = true;
  }

  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePop, 150);
  }

  pop.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
  pop.addEventListener('mouseleave', hideSoon);
  var suppressFocus = false;
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !popOwner) return;
    var o = popOwner;
    hidePop();
    if (document.activeElement !== o) {
      suppressFocus = true; // return focus without reopening the popover
      o.focus();
      suppressFocus = false;
    }
  });
  document.addEventListener('click', function (e) {
    if (popOwner && !pop.contains(e.target) && e.target !== popOwner && !popOwner.contains(e.target)) hidePop();
  });
  window.addEventListener('resize', function () { if (popOwner) place(popOwner); });

  /* ------------------------------------------------------------------ *
   * 2. Collapse long code blocks
   * ------------------------------------------------------------------ */
  var MAX_LINES = 35; // only collapse blocks well past one screen; ~19 lines stay visible
  // Chirpy-styled blocks, plus plain <pre> blocks for languages Rouge can't highlight (e.g. dts, asm)
  var blocks = [].slice.call(content.querySelectorAll('div.highlighter-rouge'));
  content.querySelectorAll('pre').forEach(function (pre) {
    if (!pre.closest('div.highlighter-rouge')) blocks.push(pre);
  });
  blocks.forEach(function (block) {
    var code = block.tagName === 'PRE' ? block : (block.querySelector('.rouge-code pre') || block.querySelector('pre'));
    if (!code) return;
    var lines = code.textContent.replace(/\n$/, '').split('\n').length;
    if (lines <= MAX_LINES) return;

    if (block.tagName === 'PRE') {
      // wrap the bare <pre> so the button can sit under it
      var wrap = document.createElement('div');
      wrap.className = 'code-plain';
      block.parentNode.insertBefore(wrap, block);
      wrap.appendChild(block);
      block = wrap;
    }
    block.classList.add('code-collapsed');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-expand';
    btn.setAttribute('aria-expanded', 'false');
    var label = 'Show all ' + lines + ' lines';
    btn.textContent = label;
    btn.addEventListener('click', function () {
      var open = block.classList.toggle('code-collapsed') === false;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Show less' : label;
      if (!open && block.getBoundingClientRect().top < 0) {
        block.scrollIntoView({ block: 'start' });
      }
    });
    block.appendChild(btn);
  });

  /* ------------------------------------------------------------------ *
   * 3. Glossary tooltips
   * ------------------------------------------------------------------ */
  var dataEl = document.getElementById('glossary-data');
  var glossary = null;
  try { glossary = dataEl ? JSON.parse(dataEl.textContent) : null; } catch (e) { glossary = null; }

  if (glossary) {
    var terms = Object.keys(glossary).sort(function (a, b) { return b.length - a.length; });
    var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var re = new RegExp('(^|[^\\w.-])(' + terms.map(esc).join('|') + ')(?![\\w-])');
    var skip = 'CODE,PRE,A,H1,H2,H3,H4,H5,H6,BUTTON,SCRIPT,STYLE,KBD,SAMP,ABBR';
    var used = {};

    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentElement.closest(skip.split(',').join(',') + ',.code-header')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
      var text = node.nodeValue;
      var m, offset = 0, frag = null, last = 0;
      var rest = text;
      while ((m = re.exec(rest))) {
        var term = m[2];
        var start = offset + m.index + m[1].length;
        var advance = m.index + m[0].length;
        if (!used[term]) {
          used[term] = true;
          frag = frag || document.createDocumentFragment();
          frag.appendChild(document.createTextNode(text.slice(last, start)));
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'gloss';
          b.textContent = term;
          b.setAttribute('data-term', term);
          b.setAttribute('aria-expanded', 'false');
          b.setAttribute('aria-describedby', 'post-pop');
          frag.appendChild(b);
          last = start + term.length;
        }
        offset += advance;
        rest = text.slice(offset);
      }
      if (frag) {
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    });

    var showGloss = function (b) {
      showPop(b, function (el) {
        el.setAttribute('role', 'tooltip');
        var t = document.createElement('strong');
        t.textContent = b.getAttribute('data-term');
        el.appendChild(t);
        el.appendChild(document.createTextNode(' ' + glossary[b.getAttribute('data-term')]));
      });
    };
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    content.querySelectorAll('button.gloss').forEach(function (b) {
      if (finePointer) {
        b.addEventListener('mouseenter', function () { showGloss(b); });
        b.addEventListener('mouseleave', hideSoon);
      }
      b.addEventListener('focus', function () { if (!suppressFocus && popOwner !== b) showGloss(b); });
      b.addEventListener('blur', hideSoon);
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (popOwner === b && !finePointer) hidePop();
        else showGloss(b);
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 4. Footnotes as popovers
   * ------------------------------------------------------------------ */
  content.querySelectorAll('a.footnote, sup[role="doc-noteref"] > a').forEach(function (a) {
    var id = decodeURIComponent((a.getAttribute('href') || '').slice(1));
    var note = id && document.getElementById(id);
    if (!note) return;
    a.setAttribute('aria-expanded', 'false');
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (popOwner === a) { hidePop(); return; }
      showPop(a, function (el) {
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Footnote ' + a.textContent);
        var clone = note.cloneNode(true);
        clone.querySelectorAll('.reversefootnote').forEach(function (r) { r.remove(); });
        while (clone.firstChild) el.appendChild(clone.firstChild);
        var jump = document.createElement('a');
        jump.href = '#' + id;
        jump.className = 'post-pop-jump';
        jump.textContent = 'Go to note ↓';
        jump.addEventListener('click', hidePop);
        el.appendChild(jump);
      });
    });
  });

  /* ------------------------------------------------------------------ *
   * 1. Continue where you left off
   * ------------------------------------------------------------------ */
  var words = (content.innerText || '').trim().split(/\s+/).length;
  if (words < 1500) return; // only for long reads

  var KEY = 'resume:' + location.pathname;
  var heads = [];
  var h2n = 0, h3n = 0;
  content.querySelectorAll('h2[id], h3[id]').forEach(function (h) {
    if (h.tagName === 'H2') { h2n++; h3n = 0; } else { h3n++; }
    var label = '§' + h2n + (h.tagName === 'H3' ? '.' + h3n : '');
    var text = (h.childNodes[0] && h.childNodes[0].nodeType === 3 ? h.childNodes[0].nodeValue : h.textContent).trim();
    heads.push({ el: h, id: h.id, label: label, text: text });
  });

  function ratio() {
    var r = content.getBoundingClientRect();
    var total = r.height - window.innerHeight * 0.5;
    return total > 0 ? Math.min(1, Math.max(0, (-r.top + window.innerHeight * 0.25) / total)) : 1;
  }

  function currentHead() {
    var line = window.innerHeight * 0.3, cur = null;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].el.getBoundingClientRect().top <= line) cur = heads[i]; else break;
    }
    return cur;
  }

  var saved = store(KEY);
  var toast = null;
  var maxAge = 60 * 24 * 3600 * 1000;
  if (saved && (Date.now() - saved.at > maxAge || saved.y < 0.08 || saved.y > 0.95)) { store(KEY, null); saved = null; }

  function closeToast() {
    if (!toast) return;
    toast.remove();
    toast = null;
    document.body.classList.remove('has-resume');
  }

  if (saved && !location.hash) {
    var target = null;
    for (var i = 0; i < heads.length; i++) if (heads[i].id === saved.id) target = heads[i];
    toast = document.createElement('div');
    toast.className = 'resume-toast';
    toast.setAttribute('role', 'status');
    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'resume-go';
    go.textContent = target ? 'Continue from ' + target.label + ' ' + target.text : 'Continue where you left off';
    go.addEventListener('click', function () {
      closeToast();
      // instant jump (Chirpy sets smooth scrolling on <html>)
      if (target) target.el.scrollIntoView({ block: 'start', behavior: 'instant' });
      else window.scrollTo({ top: saved.y * document.documentElement.scrollHeight, behavior: 'instant' });
    });
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'resume-close';
    x.setAttribute('aria-label', 'Dismiss');
    x.innerHTML = '<i class="fas fa-xmark"></i>';
    x.addEventListener('click', function () { closeToast(); store(KEY, null); });
    toast.appendChild(go);
    toast.appendChild(x);
    document.body.appendChild(toast);
    document.body.classList.add('has-resume');
  }

  var saveTimer = null;
  window.addEventListener('scroll', function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var y = ratio();
      if (toast) {
        if (y < 0.08) return;  // still near the top: keep the old position and the offer
        closeToast();          // reader chose to scroll on their own
      }
      if (y > 0.95) { store(KEY, null); return; }  // finished
      if (y < 0.08) return;
      var h = currentHead();
      store(KEY, { y: y, id: h ? h.id : null, at: Date.now() });
    }, 400);
  }, { passive: true });
})();
