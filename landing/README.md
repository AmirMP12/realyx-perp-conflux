# Realyx — Landing Page

The marketing site for **Realyx**, a decentralized perpetual futures DEX for Real-World Assets (RWA) on Conflux eSpace. Trade Crypto, Equities, and Commodities — non-custodial, zero KYC, MEV-resistant, powered by Pyth Network oracles.

> **This repo is the landing page only.** The protocol, smart contracts, keeper, and app live in [`realyx-perp-conflux`](https://github.com/AmirMP12/realyx-perp-conflux).

🔗 **Live:** [realyx.example](https://realyx.example/)

---

## Stack

A deliberately tiny, dependency-free static site:

- **HTML5** (semantic, accessible)
- **CSS3** (custom properties, mobile-first responsive, no framework)
- **Vanilla JS** (theme toggle, mobile menu, copy-to-clipboard, scroll animations)
- **Inter** + **JetBrains Mono** via Google Fonts

No build step. No bundler. No npm.

---

## Project Structure

```
Realyx-landing/
├── assets/
│   └── logo.png         # Brand mark (also used as favicon + OG image)
├── index.html           # All page sections (header, hero, features, …, footer)
├── styles.css           # Theme tokens, layout, components, responsive rules
├── main.js              # Mobile menu, theme toggle, copy buttons, scroll FX
└── README.md
```

### Page sections (in order)

1. **Header** — sticky nav with logo, links, theme toggle, GitHub, Launch App, mobile hamburger
2. **Hero** — value prop + Solidity code window
3. **Trust strip** — Conflux, Pyth, OpenZeppelin, Hardhat, Wagmi, RainbowKit
4. **Trade with Confidence** — feature grid
5. **Earn** — vault / liquidity provider info
6. **How It Works** — three-step MEV-resistant execution flow
7. **Security** — two-phase commit, oracle validation, parametric safety
8. **Contracts** — deployed addresses on Conflux eSpace Testnet (Chain ID 71)
9. **Demo + API** — app mockup and REST/WebSocket endpoints
10. **Roadmap**
11. **FAQ**
12. **Community**
13. **Footer** — CTA band, brand column, link columns, bottom bar

---

## Run Locally

Because it's a static site, any local server works.

**Python**

```bash
python -m http.server 5173
```

**Node (no install)**

```bash
npx serve .
```

**VS Code** — install the *Live Server* extension, then right-click `index.html` → *Open with Live Server*.

Then open `http://localhost:5173`.

> Don't open `index.html` via `file://` — Google Fonts and some CSS features require an `http(s)://` origin.

---

## Customizing

### Theme tokens

All colors, radii, shadows, and fonts are CSS variables defined at the top of `styles.css`:

```css
:root {
  --bg:      #0d0e17;
  --accent:  #2d42fc;
  --green:   #30e0a1;
  --red:     #fa3c58;
  --txt:     #ffffff;
  --radius:  10px;
  --hh:      64px;   /* header height */
  ...
}
```

A `[data-theme="light"]` override block sits right below for light mode. The toggle is wired in `main.js` and persists to `localStorage` under `rx-theme`.

### Updating contract addresses

Addresses are hard-coded in two places in `index.html`:

- The **contracts table** (search for `0xc8A6585d...`)
- The **footer "On-Chain" column**

Each row also has a `data-copy` attribute on the copy button — keep that in sync with the displayed address.

### Adding a new section

1. Add the markup inside `<main>` in `index.html`. Reuse `class="section-block"` (or `section-block--alt` for the muted background) and wrap content in `<div class="container">`.
2. Add styles to `styles.css` near related components.
3. Add the section's anchor to the header nav links if it should be navigable.
4. If new cards/items should fade-in on scroll, add their selector to the `IntersectionObserver` query in `main.js`.

---

## Responsive Breakpoints

Mobile-first. Layout shifts happen at:

| Breakpoint | What changes |
|---|---|
| `< 380px` | Compact header: brand text and GitHub icon hidden |
| `< 768px` | Single-column layouts, tightened header/topbar, smaller chips |
| `≥ 480px` | Hero CTAs stop wrapping |
| `≥ 600px` | 2-col earn cards + community grid |
| `≥ 768px` | 2-col features, security 3-up, footer nav 2-col |
| `≥ 1024px` | Desktop nav visible, hero 2-col, steps row, footer 4-col |
| `≥ 1280px` | 3-col features grid |

Test the header at `375px` and `360px` widths — that's the tightest constraint.

---

## Accessibility

- Semantic landmarks (`header`, `main`, `nav`, `footer`) and labeled regions
- Skip-to-main-content link
- All interactive controls have `aria-label`
- Focus styles via `:focus-visible`
- `prefers-reduced-motion` respected for animations
- Color contrast meets WCAG AA in both themes for body text

> Full WCAG conformance requires manual screen-reader testing and expert review beyond what's covered here.

---

## Deploy

The site is a static project — no build command, no output directory. Deploy it to any static host (Railway, Netlify, Cloudflare Pages, GitHub Pages, S3 + CloudFront) by uploading the three files plus the `assets/` folder. There is nothing to compile.

### SEO / OG

Update these `<meta>` tags in `index.html` if you fork or rebrand:

- `<title>`, `<meta name="description">`
- `og:title`, `og:description`, `og:url`, `og:image`
- `twitter:title`, `twitter:description`, `twitter:image`
- `<link rel="canonical">`

---

## Browser Support

Tested on the latest two versions of Chrome, Firefox, Safari, and Edge. Uses `backdrop-filter`, CSS Grid, custom properties, and `IntersectionObserver` — all baseline in modern browsers.

---

## License

MIT — see the protocol repo for the full text.

## Links

- App: [app.realyx.example](https://app.realyx.example/)
- Protocol & docs: [github.com/AmirMP12/realyx-perp-conflux](https://github.com/AmirMP12/realyx-perp-conflux)
- X: [@Realyx_Perp](https://x.com/Realyx_Perp)
- Telegram channel: [t.me/Real_yx](https://t.me/Real_yx)
- Telegram group: [t.me/realyx_perp](https://t.me/realyx_perp)
