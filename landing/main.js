/**
 * Realyx Landing — main.js
 * Mobile menu · Theme toggle · Copy buttons · Scroll header · Scroll animations
 */
(function () {
  'use strict';

  const header     = document.getElementById('header');
  const menuToggle = document.getElementById('menu-toggle');
  const themeBtn   = document.getElementById('theme-toggle');
  const copyBtns   = document.querySelectorAll('.copy-btn, .ct-copy');

  /* ── Mobile menu ─────────────────────────────────────────── */
  if (menuToggle) {
    const closeMenu = () => {
      if (header.classList.contains('header--open')) {
        header.classList.remove('header--open');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    };

    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = header.classList.toggle('header--open');
      menuToggle.setAttribute('aria-expanded', open);
    });
    document.querySelectorAll('.header__links a, .header__nav-cta a').forEach(a => {
      a.addEventListener('click', closeMenu);
    });
    /* Close on outside click */
    document.addEventListener('click', (e) => {
      if (!header.contains(e.target)) closeMenu();
    });
    /* Close on Escape */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
    /* Close on resize to desktop */
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) closeMenu();
    });
  }

  /* ── Theme ───────────────────────────────────────────────── */
  function getTheme() {
    return localStorage.getItem('rx-theme') ||
      (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('rx-theme', t);
  }
  applyTheme(getTheme());
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  /* ── Copy to clipboard ───────────────────────────────────── */
  copyBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const raw = btn.getAttribute('data-copy');
      if (!raw) return;
      const text = raw.replace(/&#10;/g, '\n');
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      btn.classList.add('copied');
      btn.setAttribute('aria-label', 'Copied!');
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.setAttribute('aria-label', 'Copy');
      }, 2000);
    });
  });

  /* ── Scroll: header border ───────────────────────────────── */
  window.addEventListener('scroll', () => {
    header.classList.toggle('header--scrolled', window.scrollY > 10);
  }, { passive: true });

  /* ── Intersection Observer: fade-in-up ───────────────────── */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll(
    '.conf-card, .step-card, .install-step, .earn-card, ' +
    '.contract-row, .stack-card, .comm-card, .demo-step, .roadmap-phase, .api-row, .trust-logo, ' +
    '.security-card, .faq-item'
  ).forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = `opacity .5s ease ${(i % 8) * 0.06}s, transform .5s ease ${(i % 8) * 0.06}s`;
    io.observe(el);
  });

  document.querySelectorAll('.contracts-table tbody tr').forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = `opacity .5s ease ${i * 0.06}s, transform .5s ease ${i * 0.06}s`;
    io.observe(el);
  });

  /* ── Scroll-to-top button ────────────────────────────────── */
  const scrollTopBtn = document.getElementById('scroll-top');
  if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('scroll-top--visible', window.scrollY > 400);
    }, { passive: true });
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

})();
