# Fonts

Both typefaces are bundled here rather than loaded from the Google Fonts CDN.
Self-hosting keeps every visitor's IP address away from a third party (which
matters given the site's privacy policy), removes a render-blocking external
request, and means the interface still looks right offline.

Each file is a **variable font**, so a single file covers the whole weight
range the interface uses — 36 KB for the pair.

| File | Family | Used for | Weights |
|------|--------|----------|---------|
| `space-grotesk.woff2` | Space Grotesk | All interface and canvas text | 300–700 |
| `orbitron.woff2` | Orbitron | The `HELIURGE` wordmark and page headings only | 400–900 |

Both are the `latin` subset only, which is all this English-language interface
needs. To add more scripts, re-download the relevant subsets from Google Fonts
and extend the `@font-face` rules in `css/style.css` with matching
`unicode-range` descriptors.

## Licensing

Both families are released under the **SIL Open Font License, Version 1.1**,
which permits bundling and redistribution — including on a commercial,
ad-supported site — provided the fonts are not sold on their own and the
license notice travels with them. Hence this file.

- **Space Grotesk** — Copyright © Florian Karsten, with later contributions.
  Based on Space Mono by Colophon Foundry.
  <https://github.com/floriankarsten/space-grotesk>
- **Orbitron** — Copyright © Matt McInerney.
  <https://github.com/theleagueof/orbitron>

Full license text: <https://scripts.sil.org/OFL>

The OFL also asks that modified versions be renamed. These files are
unmodified subsets as distributed by Google Fonts, so the original names are
retained.
