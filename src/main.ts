import '@fontsource-variable/manrope';
import './style.css';
import { profile, publications, researchInterests, resources, type Publication, type PublicationCategory } from './data';

type Page = 'about' | 'publications' | 'resources' | 'cv' | 'contact';
type Filter = 'all' | PublicationCategory;
const pageNames: Record<Page, string> = { about: 'About', publications: 'Publications', resources: 'Resources', cv: 'CV', contact: 'Contact' };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const icons = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external: '<path d="M7 17 17 7M7 7h10v10"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 6 9 7 9-7"/>',
  moon: '<path d="M20.5 14.4A8.5 8.5 0 1 1 9.6 3.5a7 7 0 0 0 10.9 10.9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
};
function icon(name: keyof typeof icons): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
function publicationRow(publication: Publication): string {
  return `<li class="publication" data-category="${publication.category}">
    <span class="publication-year">${publication.year}</span>
    <div class="publication-body"><p class="publication-journal">${escapeHtml(publication.journal)}<span>${publication.date}</span></p>
      <h3><a href="${escapeHtml(publication.doi)}" target="_blank" rel="noopener noreferrer">${escapeHtml(publication.title)}</a></h3>
      <div class="publication-links"><a href="${escapeHtml(publication.doi)}" target="_blank" rel="noopener noreferrer" aria-label="Publisher page: ${escapeHtml(publication.title)}">Read paper ${icon('external')}</a><a href="${escapeHtml(publication.pdf)}" target="_blank" rel="noopener noreferrer" aria-label="PDF: ${escapeHtml(publication.title)}">PDF ${icon('download')}</a></div>
    </div>
  </li>`;
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><div class="header-inner">
    <a class="brand" href="#about" aria-label="Hao Zhu, home"><span class="brand-symbol" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Hao Zhu<span class="brand-cn" lang="zh">朱昊</span></a>
    <nav aria-label="Primary navigation">${(Object.entries(pageNames) as [Page, string][]).map(([key, name]) => `<a href="#${key}" data-nav="${key}"${key === 'about' ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</nav>
    <button class="icon-button theme-toggle" type="button" aria-label="Switch to light theme" title="Switch theme"></button>
  </div></header>
  <main id="main" class="main" tabindex="-1">
    <article data-page="about" aria-labelledby="about-title">
      <section class="hero">
        <div class="hero-copy">
          <p class="role"><span aria-hidden="true"></span>${profile.role} at CUHK</p>
          <h1 id="about-title" tabindex="-1">Hao Zhu <span lang="zh">朱昊</span></h1>
          <p class="hero-statement">Exploring how the brain<br class="desktop-break"> turns thought into speech.</p>
          <p class="hero-description">I study the neural basis of speech and language, and the brain–computer interfaces that may help restore communication.</p>
          <div class="hero-actions"><a class="button button-primary" href="#publications">Explore my research ${icon('arrow')}</a><a class="text-link" href="${profile.cv}" target="_blank" rel="noopener">View CV ${icon('external')}</a></div>
        </div>
        <figure class="brain-scene" aria-labelledby="brain-caption">
          <canvas class="brain-canvas" role="img" tabindex="0" aria-label="A translucent three-dimensional brain showing the cortex, cerebellum, and brainstem, with illustrative glowing signals. Drag or use arrow keys to rotate. Tap or press Enter to send a signal.">A translucent brain with a folded cortex, cerebellum, brainstem, and illustrative neural signals.</canvas>
          <p class="brain-region-label" data-brain-region-label hidden>Explore the brain’s regions</p>
          <p class="brain-loading" role="status">Loading brain surface…</p>
          <figcaption id="brain-caption"><span>The brain, in motion</span><span class="brain-hint">Drag to rotate. Tap to activate.</span></figcaption>
          <div class="brain-controls">
            <button type="button" class="brain-pulse" data-brain-pulse disabled><span class="pulse-symbol" aria-hidden="true"></span>Send a signal</button>
            <button type="button" class="brain-expand" data-brain-expand aria-expanded="false" aria-controls="brain-regions" disabled><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l5 5m13-5-5 5M3 21l5-5m13 5-5-5"/></svg><span data-brain-expand-text>Explore regions</span></button>
            <button type="button" class="brain-toggle" data-brain-toggle aria-pressed="false" disabled>Pause motion</button>
          </div>
          <div class="brain-region-legend" id="brain-regions" data-brain-regions role="group" aria-label="Brain regions. Choose a region to send a signal." hidden></div>
          <output class="sr-only" data-brain-status aria-live="polite"></output>
        </figure>
      </section>
      <section class="about-section section-grid" aria-labelledby="research-heading">
        <div class="section-label"><h2 id="research-heading">Research Interests</h2><figure class="portrait"><div class="portrait-image"><img src="${profile.portrait}" alt="Portrait of Hao Zhu" width="704" height="939" loading="lazy"></div><figcaption>${icon('pin')} Hong Kong</figcaption></figure></div>
        <div class="about-prose"><p>I’m a postdoctoral fellow at the <strong>Brain and Mind Institute</strong>, in the Department of Linguistics and Modern Languages at <strong>The Chinese University of Hong Kong</strong>. I hold a B.S. and Ph.D. in Neuroscience from New York University.</p><p>My work asks how the brain builds and uses representations for language, and how motor and sensory systems work together to turn intention into speech. Using EEG, MEG, ECoG, and sEEG, I trace these processes across space and time.</p><p>I’m also interested in what these signals can tell us about brain–computer interfaces, and their potential to restore communication.</p>
        <div class="research-grid">${researchInterests.map((interest) => `<div class="research-interest"><img src="${interest.icon}" alt="" width="40" height="40" loading="lazy"><h3>${escapeHtml(interest.title)}</h3><p>${escapeHtml(interest.description)}</p></div>`).join('')}</div></div>
      </section>
      <section class="recent-section section-grid" aria-labelledby="recent-heading"><div class="section-label"><h2 id="recent-heading">Recent work</h2><a class="text-link" href="#publications">All publications ${icon('arrow')}</a></div><ol class="publication-list recent-publications">${publications.slice(0, 2).map(publicationRow).join('')}</ol></section>
      <div class="contact-callout"><div><h2>Good research starts with a conversation.</h2><p>For collaborations, academic enquiries, or a hello.</p></div><a class="button button-secondary" href="#contact">Get in touch ${icon('arrow')}</a></div>
    </article>
    <article data-page="publications" aria-labelledby="publications-title" hidden>
      <header class="page-heading"><p>Research & writing</p><h1 id="publications-title" tabindex="-1">Publications</h1><div class="page-description">Exploring speech, perception, and the signals that connect them.<br> Peer-reviewed research and open tools, from 2018 to 2026.</div></header>
      <div class="publication-toolbar"><div class="filters" role="group" aria-label="Filter publications by category">${(['all', 'research', 'clinical', 'toolbox'] as const).map((category) => `<button type="button" data-filter="${category}" aria-pressed="${category === 'all'}">${category === 'all' ? 'All work' : category[0]!.toUpperCase() + category.slice(1)}</button>`).join('')}</div><label class="search">${icon('search')}<span class="sr-only">Search publications</span><input type="search" placeholder="Search papers" aria-label="Search publications"></label></div>
      <p class="results-count" role="status" aria-live="polite"></p><ol class="publication-list" id="publication-results"></ol><div class="empty-state" hidden><h2>No matching papers</h2><p>Try another search or choose a different category.</p><button class="text-link" type="button" data-reset-filters>Clear filters ${icon('arrow')}</button></div>
    </article>
    <article data-page="resources" aria-labelledby="resources-title" hidden>
      <header class="page-heading"><p>Shared methods</p><h1 id="resources-title" tabindex="-1">Resources</h1><div class="page-description">Practical tools for working with neural data.<br> Tutorials and pipelines for students and collaborators.</div></header>
      <div class="resource-list">${resources.map((resource) => `<a class="resource" href="${resource.href}"><div class="resource-image"><img src="${resource.image}" alt="${resource.imageAlt}" loading="lazy"></div><div class="resource-copy"><p class="resource-meta">${resource.kind} <span>${resource.platform}</span><span>${resource.date}</span></p><h2>${resource.title}</h2><p>${resource.description}</p><span class="text-link">Open tutorial ${icon('arrow')}</span></div></a>`).join('')}</div>
      <p class="resource-note">Questions about a method or pipeline? <a href="${profile.emailHref}">Send me a note.</a></p>
    </article>
    <article data-page="cv" aria-labelledby="cv-title" hidden>
      <header class="page-heading cv-heading"><div><p>Background & experience</p><h1 id="cv-title" tabindex="-1">Curriculum vitae</h1><div class="page-description">Research, education, and academic experience.</div></div><a class="button button-primary" href="${profile.cv}" download>Download PDF ${icon('download')}</a></header>
      <p class="pdf-help">You can also <a href="${profile.cv}" target="_blank" rel="noopener">open the CV in a new tab</a>. The preview below requires your browser’s PDF viewer.</p><div class="cv-viewer"><iframe data-src="${profile.cv}" title="Hao Zhu’s curriculum vitae"></iframe></div>
    </article>
    <article data-page="contact" aria-labelledby="contact-title" hidden>
      <header class="page-heading"><p>Let’s connect</p><h1 id="contact-title" tabindex="-1">Start a conversation.</h1><div class="page-description">I welcome correspondence about research collaboration,<br> graduate training, and academic enquiries.</div></header>
      <div class="contact-grid"><div class="contact-details"><a class="contact-email" href="${profile.emailHref}">${profile.email} ${icon('external')}</a><dl><div><dt>Find me at</dt><dd>${profile.office.join('<br> ')}</dd></div><div><dt>Elsewhere</dt><dd class="social-links"><a href="${profile.github}" target="_blank" rel="noopener">GitHub ${icon('external')}</a><a href="${profile.x}" target="_blank" rel="noopener">X ${icon('external')}</a></dd></div></dl><details class="map-details"><summary>View campus location</summary><iframe data-src="${escapeHtml(profile.mapEmbedUrl)}" title="Campus map of the Chinese University of Hong Kong" loading="lazy"></iframe><a class="text-link map-link" href="${escapeHtml(profile.mapUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Maps ${icon('external')}</a></details></div>
      <form class="contact-form"><h2>Send a note</h2><p class="form-hint">This opens a draft in your email app.</p><div class="form-row"><label>Your name<input name="name" autocomplete="name" placeholder="Jane Doe" required maxlength="120"></label><label>Email address<input name="email" type="email" autocomplete="email" placeholder="jane@university.edu" required maxlength="254"></label></div><label>Message<textarea name="message" placeholder="What would you like to explore?" required rows="5" maxlength="4000"></textarea></label><button class="button button-primary" type="submit">Open email draft ${icon('mail')}</button><p class="form-status" role="status" aria-live="polite"></p></form></div>
    </article>
  </main>
  <footer class="site-footer"><div><a class="footer-name" href="#about">Hao Zhu <span lang="zh">朱昊</span></a><p>Neuroscience of speech & language</p></div><div class="footer-right"><a href="${profile.emailHref}">Email ${icon('external')}</a><a href="${profile.github}" target="_blank" rel="noopener">GitHub ${icon('external')}</a><span>© ${new Date().getFullYear()}</span><span class="visitor-count" hidden></span></div></footer>
`;

function syncTheme(): void {
  const dark = document.documentElement.dataset.theme === 'dark';
  const button = document.querySelector<HTMLButtonElement>('.theme-toggle')!;
  button.innerHTML = icon(dark ? 'sun' : 'moon');
  button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141e24' : '#fcfcfd');
}
document.querySelector('.theme-toggle')!.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch { /* The theme works without storage. */ }
  syncTheme();
});
syncTheme();

document.querySelector('.skip-link')!.addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector<HTMLElement>('#main')!.focus();
});

let activePage: Page | undefined;
function navigate(): void {
  const hash = window.location.hash.slice(1);
  const page: Page = Object.hasOwn(pageNames, hash) ? hash as Page : 'about';
  if (page === activePage) return;
  const isInitial = activePage === undefined;
  document.querySelectorAll<HTMLElement>('[data-page]').forEach((panel) => { panel.hidden = panel.dataset.page !== page; });
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((link) => {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const panel = document.querySelector<HTMLElement>(`[data-page="${page}"]`)!;
  if (page === 'cv') {
    const frame = panel.querySelector<HTMLIFrameElement>('iframe')!;
    if (!frame.hasAttribute('src')) frame.src = frame.dataset.src!;
  }
  document.title = page === 'about' ? 'Hao Zhu · 朱昊 — Neuroscience of speech & language' : `${pageNames[page]} — Hao Zhu · 朱昊`;
  if (!isInitial) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    panel.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    if (!reducedMotion.matches) panel.animate([{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: 'ease-out' });
  }
  activePage = page;
}
window.addEventListener('hashchange', navigate);
navigate();

let currentFilter: Filter = 'all';
const searchInput = document.querySelector<HTMLInputElement>('.search input')!;
function filterPublications(): void {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const matches = publications.filter((paper) => (currentFilter === 'all' || paper.category === currentFilter) && `${paper.title} ${paper.journal} ${paper.date} ${paper.category}`.toLocaleLowerCase().includes(query));
  document.querySelector('#publication-results')!.innerHTML = matches.map(publicationRow).join('');
  document.querySelector('.results-count')!.textContent = `${matches.length} of ${publications.length} publications`;
  document.querySelector<HTMLElement>('.empty-state')!.hidden = matches.length > 0;
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === currentFilter)));
}
document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  currentFilter = button.dataset.filter as Filter;
  filterPublications();
}));
searchInput.addEventListener('input', filterPublications);
document.querySelector('[data-reset-filters]')!.addEventListener('click', () => { currentFilter = 'all'; searchInput.value = ''; filterPublications(); searchInput.focus(); });
filterPublications();

document.querySelector<HTMLFormElement>('.contact-form')!.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  const email = String(data.get('email') ?? '').trim();
  const message = String(data.get('message') ?? '').trim();
  if (!name || !message) {
    document.querySelector('.form-status')!.textContent = 'Please add your name and a message.';
    return;
  }
  const subject = encodeURIComponent(`Website enquiry from ${name}`);
  const body = encodeURIComponent(`${message}\n\n${name}\n${email}`);
  window.location.href = `${profile.emailHref}?subject=${subject}&body=${body}`;
  document.querySelector('.form-status')!.textContent = `Your email app should open with a draft. You can also write directly to ${profile.email}.`;
});
document.querySelector<HTMLDetailsElement>('.map-details')!.addEventListener('toggle', (event) => {
  const details = event.currentTarget as HTMLDetailsElement;
  const frame = details.querySelector<HTMLIFrameElement>('iframe')!;
  if (details.open && !frame.hasAttribute('src')) frame.src = frame.dataset.src!;
});
// Keep the portfolio available while the 3D renderer loads in its own chunk.
const brainScene = document.querySelector<HTMLElement>('.brain-scene')!;
void import('./brain-animation').then(({ initBrainAnimation }) => initBrainAnimation(brainScene)).catch(() => {
  brainScene.dataset.brainError = 'true';
  brainScene.querySelector<HTMLElement>('.brain-loading')!.textContent = 'The brain preview could not load. Refresh to try again.';
  brainScene.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
  const canvas = brainScene.querySelector('canvas')!;
  canvas.removeAttribute('tabindex');
  canvas.setAttribute('aria-label', 'The interactive brain preview is unavailable.');
});

// Keep the existing public visitor counter out of local development and previews.
if (window.location.hostname === 'www.hao-zhu.com' || window.location.hostname === 'hao-zhu.com') {
  void fetch(profile.visitorCountUrl, { signal: AbortSignal.timeout(4000) }).then((response) => response.ok ? response.json() as Promise<{ value?: number }> : undefined).then((data) => {
    if (data && typeof data.value === 'number' && Number.isFinite(data.value)) {
      const counter = document.querySelector<HTMLElement>('.visitor-count')!;
      counter.textContent = `${data.value.toLocaleString()} visits`;
      counter.hidden = false;
    }
  }).catch(() => { /* An unavailable counter never interrupts the site. */ });
}
