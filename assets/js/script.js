'use strict';

/* =========================================================
   HAO ZHU — interactions
   nav · filters · form · scroll reveals
   ========================================================= */

(function () {

  /* ---------- PAGE NAVIGATION --------------------------- */
  const navLinks = document.querySelectorAll('[data-nav-link]');
  const pages    = document.querySelectorAll('[data-page]');
  const hero     = document.querySelector('.hero');

  navLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      const target = link.dataset.target;
      navLinks.forEach(function (l) { l.classList.toggle('active', l === link); });
      pages.forEach(function (p)    { p.classList.toggle('active', p.dataset.page === target); });
      if (hero) hero.style.display = target === 'about' ? '' : 'none';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  /* ---------- PUBLICATION FILTERS ----------------------- */
  const filterBtns  = document.querySelectorAll('[data-filter-btn]');
  const filterItems = document.querySelectorAll('[data-filter-item]');
  const filterCount = document.querySelector('[data-filter-count]');
  const totalCount  = filterItems.length;

  function applyFilter(value) {
    let shown = 0;
    filterItems.forEach(function (item) {
      const match = value === 'all' || item.dataset.category === value;
      item.classList.toggle('active', match);
      if (match) shown++;
    });
    if (filterCount) filterCount.textContent = shown + ' of ' + totalCount;
  }

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      applyFilter(btn.textContent.trim().toLowerCase());
    });
  });

  /* ---------- CONTACT FORM VALIDATION ------------------- */
  const form       = document.querySelector('[data-form]');
  const formInputs = document.querySelectorAll('[data-form-input]');
  const formBtn    = document.querySelector('[data-form-btn]');

  formInputs.forEach(function (inp) {
    inp.addEventListener('input', function () {
      if (form && form.checkValidity()) formBtn.removeAttribute('disabled');
      else if (formBtn)                 formBtn.setAttribute('disabled', '');
    });
  });

  /* ---------- THEME TOGGLE ------------------------------ */
  const themeBtn = document.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  /* ---------- IN-VIEW REVEAL ---------------------------- */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    document.querySelectorAll('.work, .tool, .interest').forEach(function (el) {
      const r = el.getBoundingClientRect();
      const inViewNow = r.top < window.innerHeight && r.bottom > 0 && r.width > 0;
      if (inViewNow) return;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

})();
