(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var desktop = window.matchMedia('(min-width: 1200px)');

  /* ------------------------------------------------------------------
     Custom cursor — an orange dot glued to the pointer.
     The position is written straight from the pointer event (no spring,
     no easing, no waiting for the next frame), so it never trails.
     ------------------------------------------------------------------ */
  (function cursor() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var dot = document.createElement('div');
    dot.className = 'cursor-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.appendChild(document.createElement('i'));
    document.body.appendChild(dot);

    // every click, anywhere, flips the dot between orange and purple
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      dot.classList.toggle('is-alt');
    }, { passive: true });

    // over anything clickable the dot grows, morphs into a rounded square and gains an outer line
    var clickable = 'a, button, [role="button"], [role="slider"], .video, .sticker';
    document.addEventListener('pointerover', function (e) {
      var hit = e.target && e.target.closest && e.target.closest(clickable);
      dot.classList.toggle('is-hover', !!hit && !hit.disabled);
    }, { passive: true });
    document.documentElement.classList.add('has-cursor');

    function move(e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      dot.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
      dot.classList.add('is-visible');
    }
    function hide() { dot.classList.remove('is-visible'); }

    // pointerrawupdate fires ahead of pointermove at the device's full rate where supported
    var evt = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
    window.addEventListener(evt, move, { passive: true });
    if (evt !== 'pointermove') window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', move, { passive: true });
    document.addEventListener('mouseleave', hide);
    window.addEventListener('blur', hide);
    // the pointer disappears into embedded video players; don't leave a frozen dot behind
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) hide(); });
    document.querySelectorAll('.video').forEach(function (v) { v.addEventListener('mouseleave', hide); });
  })();

  // every click or tap anywhere swaps the accent colour (the word "cool" follows it)
  window.addEventListener('pointerdown', function () {
    document.documentElement.classList.toggle('is-alt');
  }, { passive: true });

  /* ------------------------------------------------------------------
     Spring helpers (same physics as the original: stiffness / damping / mass)
     ------------------------------------------------------------------ */
  function springKeyframes(stiffness, damping, mass, from, to) {
    // sample an analytically-stepped spring into keyframes for the Web Animations API
    var frames = [], x = 0, v = 0, dt = 1 / 240, t = 0, duration = 0;
    var samples = [];
    while (t < 4) {
      var a = (-stiffness * (x - 1) - damping * v) / mass;
      v += a * dt; x += v * dt; t += dt;
      samples.push(x);
      if (Math.abs(1 - x) < 0.0005 && Math.abs(v) < 0.005) break;
    }
    duration = t;
    var n = 40;
    for (var i = 0; i <= n; i++) {
      var p = i === 0 ? 0 : samples[Math.min(samples.length - 1, Math.round((i / n) * (samples.length - 1)))];
      if (i === n) p = 1;
      frames.push(from(p));
    }
    return { frames: frames, duration: duration * 1000 };
  }

  /* ------------------------------------------------------------------
     Appear on scroll: fade up 30px, spring(180, 40), once
     ------------------------------------------------------------------ */
  (function appear() {
    var els = [].slice.call(document.querySelectorAll('[data-appear]'));
    if (!els.length) return;
    if (reduceMotion || !('IntersectionObserver' in window) || !Element.prototype.animate) {
      els.forEach(function (el) { el.style.opacity = 1; el.style.transform = 'none'; });
      return;
    }
    var spring = springKeyframes(180, 40, 1, function (p) {
      return { opacity: p, transform: 'translateY(' + (30 * (1 - p)).toFixed(3) + 'px)' };
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var enough = entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= window.innerHeight * 0.35;
        if (!enough) return;
        io.unobserve(el);
        var anim = el.animate(spring.frames, { duration: spring.duration, easing: 'linear', fill: 'forwards' });
        anim.onfinish = function () { el.style.opacity = 1; el.style.transform = 'none'; el.style.willChange = 'auto'; anim.cancel(); };
      });
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    els.forEach(function (el) { io.observe(el); });
  })();

  /* ------------------------------------------------------------------
     YouTube embeds: poster + play button, swapped for the player on click.
     The first video autoplays muted on desktop, as on the original.
     ------------------------------------------------------------------ */
  (function videos() {
    var base = '?iv_load_policy=3&rel=0&modestbranding=1&playsinline=1';
    document.querySelectorAll('.video[data-youtube]').forEach(function (el) {
      var id = el.getAttribute('data-youtube');
      function load(muted) {
        if (el.querySelector('iframe')) return;
        var f = document.createElement('iframe');
        f.title = 'YouTube video';
        f.allow = 'presentation; fullscreen; accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
        f.allowFullscreen = true;
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        f.src = 'https://www.youtube.com/embed/' + id + base + '&autoplay=1' + (muted ? '&mute=1' : '');
        el.appendChild(f);
        var btn = el.querySelector('.video-play'); if (btn) btn.remove();
        var img = el.querySelector('img'); if (img) img.remove();
      }
      if (el.hasAttribute('data-autoplay-desktop') && desktop.matches && location.protocol !== 'file:') load(true);
      else el.addEventListener('click', function () { load(false); });
    });
  })();

  /* ------------------------------------------------------------------
     Draggable stickers that snap back to where they started
     ------------------------------------------------------------------ */
  (function stickers() {
    document.querySelectorAll('.sticker').forEach(function (el) {
      var k = parseFloat(el.getAttribute('data-stiffness')) || 400;
      var c = parseFloat(el.getAttribute('data-damping')) || 30;
      var momentum = el.hasAttribute('data-momentum');
      var x = 0, y = 0, vx = 0, vy = 0, raf = 0, dragging = false, sx = 0, sy = 0, lastT = 0, lx = 0, ly = 0;

      function paint() { el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)'; }
      function settle(prev) {
        raf = requestAnimationFrame(function (now) {
          var dt = Math.min(0.032, (now - prev) / 1000) || 0.016, steps = 4, h = dt / steps;
          for (var i = 0; i < steps; i++) {
            vx += (-k * x - c * vx) * h; x += vx * h;
            vy += (-k * y - c * vy) * h; y += vy * h;
          }
          if (Math.abs(x) < 0.1 && Math.abs(y) < 0.1 && Math.abs(vx) < 1 && Math.abs(vy) < 1) { x = y = vx = vy = 0; el.style.transform = ''; return; }
          paint(); settle(now);
        });
      }
      el.addEventListener('pointerdown', function (e) {
        if (e.button) return;
        e.preventDefault();
        cancelAnimationFrame(raf);
        dragging = true; sx = e.clientX - x; sy = e.clientY - y; lx = e.clientX; ly = e.clientY; lastT = e.timeStamp; vx = vy = 0;
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var dt = (e.timeStamp - lastT) / 1000;
        if (dt > 0) { vx = (e.clientX - lx) / dt; vy = (e.clientY - ly) / dt; }
        lx = e.clientX; ly = e.clientY; lastT = e.timeStamp;
        x = e.clientX - sx; y = e.clientY - sy; paint();
      });
      function end(e) {
        if (!dragging) return;
        dragging = false;
        if (!momentum || e.timeStamp - lastT > 80) { vx = vy = 0; }
        if (reduceMotion) { x = y = 0; el.style.transform = ''; return; }
        settle(performance.now());
      }
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('dragstart', function (e) { e.preventDefault(); });
    });
  })();

  /* ------------------------------------------------------------------
     Gradient glow on the X shape and the word "cool": off by default,
     fades in while the element is in focus and fades out after.
     With a mouse "in focus" = hovered; on touch screens = centred on screen.
     ------------------------------------------------------------------ */
  (function glow() {
    // light rays sit behind each glowing element
    document.querySelectorAll('[data-glow], .cv-btn, .connect').forEach(function (el) {
      var r = document.createElement('span');
      r.className = 'rays';
      r.setAttribute('aria-hidden', 'true');
      el.insertBefore(r, el.firstChild);
    });
    // footer links light up solid orange or purple, picked at random each time
    document.querySelectorAll('.socials a').forEach(function (a) {
      function pick() { a.style.setProperty('--link-hover', Math.random() < 0.5 ? '#ff7a18' : '#a855f7'); }
      a.addEventListener('pointerenter', pick);
      a.addEventListener('focus', pick);
    });
    var els = [].slice.call(document.querySelectorAll('[data-glow]'));
    if (!els.length) return;
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      els.forEach(function (el) {
        el.addEventListener('pointerenter', function () { el.classList.add('is-lit'); });
        el.addEventListener('pointerleave', function () { el.classList.remove('is-lit'); });
      });
    } else if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { en.target.classList.toggle('is-lit', en.isIntersecting); });
      }, { rootMargin: '-38% 0px -38% 0px' });
      els.forEach(function (el) { io.observe(el); });
    }
  })();

  /* ------------------------------------------------------------------
     Collapsible project details (small screens)
     ------------------------------------------------------------------ */
  document.querySelectorAll('.project-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.closest('.project').classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.querySelector('span').textContent = open ? 'Hide details' : 'Project details';
    });
  });

  /* ------------------------------------------------------------------
     Project carousels
     ------------------------------------------------------------------ */
  (function carousels() {
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    document.querySelectorAll('.carousel').forEach(function (root) {
      var track = root.querySelector('.carousel-track');
      var items = [].slice.call(track.children);
      var prev = root.querySelector('.prev'), next = root.querySelector('.next');
      var count = root.querySelector('.carousel-count');
      var total = items.length, index = 0, ticking = false;

      function maxScroll() { return track.scrollWidth - track.clientWidth; }
      function offsetOf(i) { return Math.min(items[i].offsetLeft - track.offsetLeft, maxScroll()); }
      function current() {
        var s = track.scrollLeft, best = 0, bd = Infinity;
        if (s >= maxScroll() - 2) {
          // at the very end: report the last image
          return total - 1;
        }
        for (var i = 0; i < total; i++) { var d = Math.abs(items[i].offsetLeft - track.offsetLeft - s); if (d < bd) { bd = d; best = i; } }
        return best;
      }
      function update() {
        ticking = false;
        index = current();
        count.textContent = pad(index + 1) + ' / ' + pad(total);
        prev.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft >= maxScroll() - 2;
        paintThumb();
      }

      // scrubber: a bar sized like the visible share of the strip; drag it or click the line
      var scrub = root.querySelector('.carousel-scrub'), thumb = root.querySelector('.carousel-thumb');
      function thumbWidth() { return Math.max(56, scrub.clientWidth * Math.min(1, track.clientWidth / track.scrollWidth)); }
      function paintThumb() {
        if (!scrub) return;
        var tw = thumbWidth(), room = scrub.clientWidth - tw, m = maxScroll();
        var p = m > 0 ? track.scrollLeft / m : 0;
        thumb.style.width = tw + 'px';
        thumb.style.transform = 'translate3d(' + (room * p).toFixed(1) + 'px,0,0)';
        scrub.setAttribute('aria-valuenow', Math.round(p * 100));
      }
      if (scrub) {
        var scrubbing = false, grab = 0;
        function scrubTo(clientX) {
          var r = scrub.getBoundingClientRect(), tw = thumbWidth(), room = r.width - tw;
          var p = room > 0 ? Math.min(1, Math.max(0, (clientX - r.left - grab) / room)) : 0;
          track.scrollLeft = p * maxScroll();
        }
        scrub.addEventListener('pointerdown', function (e) {
          if (e.button) return;
          e.preventDefault();
          var tr = thumb.getBoundingClientRect();
          // grabbing the bar keeps it under the pointer; clicking the line centres the bar there
          grab = (e.clientX >= tr.left && e.clientX <= tr.right) ? e.clientX - tr.left : tr.width / 2;
          scrubbing = true;
          scrub.classList.add('is-dragging'); track.classList.add('is-dragging');
          scrub.setPointerCapture(e.pointerId);
          scrubTo(e.clientX);
        });
        scrub.addEventListener('pointermove', function (e) { if (scrubbing) scrubTo(e.clientX); });
        function scrubEnd() {
          if (!scrubbing) return;
          scrubbing = false;
          scrub.classList.remove('is-dragging'); track.classList.remove('is-dragging');
        }
        scrub.addEventListener('pointerup', scrubEnd);
        scrub.addEventListener('pointercancel', scrubEnd);
        scrub.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
          if (e.key === 'Home') { e.preventDefault(); track.scrollTo({ left: 0 }); }
          if (e.key === 'End') { e.preventDefault(); track.scrollTo({ left: maxScroll() }); }
        });
      }
      function go(dir) {
        var s = track.scrollLeft, target;
        if (dir > 0) {
          target = maxScroll();
          for (var i = 0; i < total; i++) { var o = offsetOf(i); if (o > s + 4) { target = o; break; } }
        } else {
          target = 0;
          for (var j = total - 1; j >= 0; j--) { var p = offsetOf(j); if (p < s - 4) { target = p; break; } }
        }
        track.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
      prev.addEventListener('click', function () { go(-1); });
      next.addEventListener('click', function () { go(1); });
      track.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
      window.addEventListener('resize', update);
      track.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      });

      // click-and-drag with a mouse (touch and trackpads scroll natively)
      var down = false, startX = 0, startScroll = 0, moved = false;
      track.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'mouse' || e.button) return;
        down = true; moved = false; startX = e.clientX; startScroll = track.scrollLeft;
      });
      window.addEventListener('pointermove', function (e) {
        if (!down) return;
        var dx = e.clientX - startX;
        if (!moved && Math.abs(dx) > 4) { moved = true; track.classList.add('is-dragging'); }
        if (moved) track.scrollLeft = startScroll - dx;
      });
      function release() {
        if (!down) return;
        down = false;
        // no snapping: the strip stays exactly where the drag ended
        if (moved) track.classList.remove('is-dragging');
      }
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);

      update();
    });
  })();
})();
