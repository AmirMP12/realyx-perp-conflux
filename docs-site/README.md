# Realyx Docs

Official documentation site for [Realyx](https://app.realyx.example/) — a decentralized perpetual futures exchange for Real World Assets, built on Conflux eSpace.

A lightweight, fully static single-page docs app. No build step, no framework, no dependencies. Just HTML, CSS, and vanilla JavaScript.

## Features

- Single-page navigation with hash-based routing
- Dark and light themes (preference persisted to `localStorage`)
- Client-side search across all pages with `⌘K` / `Ctrl+K` shortcut
- Auto-generated table of contents per page
- Copy-to-clipboard buttons on code blocks
- Responsive layout for desktop, tablet, and mobile
- Accessible: skip link, ARIA labels, keyboard navigation

## Project structure

```
realyx-docs/
├── index.html      # Shell: topbar, sidebar, content area, search modal
├── styles.css      # Design tokens, theming, layout, responsive rules
├── app.js          # Page content, router, search, TOC, theme toggle
├── assets/
│   └── logo.png
└── README.md
```

All page content lives in `app.js` inside the `PAGES` object — each key is a route slug and each value is a function returning HTML.

## Running locally

The site is fully static, so any static file server works.

```bash
# Python
python -m http.server 8080

# Node (npx)
npx serve .

# PHP
php -S localhost:8080
```

Then open `http://localhost:8080`.

Opening `index.html` directly via `file://` also works for most features, though some browsers restrict `localStorage` and `fetch` on the file protocol.

## Adding a new page

1. Add a new entry to the `PAGES` object in `app.js`:

   ```js
   PAGES['my-new-page'] = () => `
     <div class="page-header">
       <div class="page-header__eyebrow">Section Name</div>
       <h1 class="page-header__title">My New Page</h1>
       <p class="page-header__desc">Short description.</p>
     </div>
     <h2>Section heading</h2>
     <p>Content here.</p>
   `;
   ```

2. Add a sidebar entry in `index.html` under the appropriate section:

   ```html
   <div class="sidebar__item" data-page="my-new-page">
     <svg>...</svg>
     My New Page
   </div>
   ```

3. The router, search index, and TOC pick up the new page automatically.

## Available components

Use these CSS classes when authoring page content for a consistent look:

- `.page-header` with `.page-header__eyebrow`, `.page-header__title`, `.page-header__desc`
- `.callout` with modifiers `--info`, `--warning`, `--danger`, `--success`
- `.badge` with modifiers `--purple`, `--green`, `--yellow`, `--red`, `--blue`
- `.card-grid` and `.card` for tile layouts
- `.steps` and `.step-item` for numbered walkthroughs
- `.stats-row` and `.stat-card` for KPI displays
- Standard tables, `<pre><code>` blocks, and blockquotes are styled out of the box

## Deployment

The site can be deployed to any static host. Some options:

- **Railway:** connect the repo and deploy as a static service
- **Netlify:** same, no build command
- **GitHub Pages:** push to `gh-pages` or enable Pages on `main`
- **Cloudflare Pages:** point at the repo, leave build command empty

## Browser support

Modern evergreen browsers (Chrome, Firefox, Safari, Edge). Uses CSS custom properties, `backdrop-filter`, and ES2017+ JavaScript.

## Links

- App: https://app.realyx.example/
- Source: https://github.com/AmirMP12/realyx-perp-conflux
- X: https://x.com/Realyx_Perp
- Telegram: https://t.me/Real_yx
