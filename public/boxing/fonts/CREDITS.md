# Fonts

Self-hosted, downloaded 2026-10-04 from Google Fonts (static TTF). Both are licensed under the SIL Open Font License 1.1 (https://openfontlicense.org), free for any use including embedding.

| File | Family | Author | Use |
|---|---|---|---|
| BarlowCondensed-500.ttf, -700.ttf | Barlow Condensed | Jeremy Tribby | Body text, numbers, and (700, as `Barlow Display`) buttons, titles and banners |

## Logo build (not shipped)

`img/logo-ruckus-*.webp` is built by `scripts/build-logo.mjs` from Sedgwick Ave Display (Kevin Burke, OFL 1.1, from Google Fonts) as a letter-shape base, with every glyph placed, tilted and scaled individually, then treated with overspray, drips and the CC0 brick photo in `textures/brick_dirty_diff.webp` (Poly Haven, see `textures/CREDITS.md`). The game no longer loads the font; the TTF is kept only in `scripts/fonts/` for the build. The OFL permits using it to make artwork.
