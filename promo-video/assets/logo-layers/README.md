# Logo pixel layers

This directory stores the geometry used to extract pixel-preserving layers from the canonical 512×512 app icon.

Generated PNG files are intentionally ignored by Git:

- `ribbon-main.png`: original icon pixels inside the ribbon silhouette;
- `residual-detail.png`: the remaining source pixels, useful for later compositing checks.

Run `npm run assets:logo` from `promo-video/` to regenerate them in both `assets/logo-layers/` and `public/logo-layers/`.

The first proof only validates the ribbon. Orbit, light and background layers stay out of the mainline until the ribbon deformation and final-frame comparison pass.
