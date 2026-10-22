# Hao Zhu — personal website

A minimal, responsive portfolio built with TypeScript and CSS. Vite provides local development and production builds; a small Node.js / Express server serves the finished site.

## Requirements

- Node.js 22.12 or newer
- npm

## Run locally

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Changes to the source refresh automatically.

## Build and run with Node.js

```sh
npm run build
npm start
```

Open http://127.0.0.1:3000. The build checks TypeScript, creates the frontend in `dist/`, compiles the server into `dist-server/`, and copies the original public assets, sample page, and custom-domain `CNAME` into `dist/`.

Set `PORT` to choose another port, or `HOST=0.0.0.0` when the server must accept connections from outside the local computer:

```sh
HOST=0.0.0.0 PORT=8080 npm start
```

`npm run preview` serves the frontend build at http://127.0.0.1:4173. `npm run typecheck` checks frontend and server types without creating a build.

## Edit the site

- `src/data.ts`: profile/contact details, research interests, publications, and tutorials.
- `src/main.ts`: page markup and interactions.
- `src/style.css`: layout, typography, colors, and animations.
- `src/brain-animation.ts`: the interactive translucent Three.js brain and illustrative signal propagation.
- `src/brain-network.ts`: connected surface graph and signal path planning. Run `npm test` for propagation regression checks against the real anatomical assets.
- `src/assets/brain-fsaverage5.json`: locally bundled cortical geometry and sulcal depth; provenance is in `src/assets/README.md`.
- `src/assets/brain-subcortical.json`: matching cerebellum and brainstem surfaces extracted from the fsaverage segmentation.
- `index.html`: page title, metadata, and application entry point.
- `assets/`: original images, documents, and other public files. Existing `/assets/...` URLs are preserved.
- `server.ts`: Node.js production server.

The interface includes shareable section links, searchable publication categories, and a persistent light/dark theme. Dark is the default; an explicitly saved light preference is honored. Fonts are hosted locally with the build.

The hero renders a translucent FreeSurfer fsaverage5 cortex with shaded folds, together with the cerebellum and brainstem from the matching fsaverage segmentation. Drag or use arrow keys to rotate, and tap, press Enter, or choose “Send a signal” to animate an impulse. Signals branch across the cerebral hemispheres, cerebellum, and brainstem; tapping a structure chooses the starting point. Motion can be paused and respects reduced-motion preferences. Rendering stops when the scene is offscreen or the tab is hidden. The geometry is an anatomical template; the glowing signals and connections between surfaces are artistic illustrations, not experimental recordings or measured neural tracts. The larger portrait in the biography is static.

The converted brain geometry is a modified version of the FreeSurfer fsaverage5 data distributed by Nilearn and the fsaverage segmentation distributed by FreeSurfer. All or portions of this licensed product (such portions are the “Software”) have been obtained under license from The General Hospital Corporation “MGH” and are subject to the terms and conditions in [the included FreeSurfer license](assets/licenses/FREESURFER-LICENSE.txt). The [Nilearn license](assets/licenses/NILEARN-LICENSE.txt) is also included. These notices accompany production builds under `assets/licenses/`.

The contact form validates input and opens a prefilled draft in the visitor’s email app; it does not send or store messages on the server. The CV uses the browser’s PDF viewer, with direct open/download links as a fallback. The existing visitor counter runs only on the `hao-zhu.com` domain, not in local previews. The original CSS and JavaScript remain under `assets/` for legacy pages; the redesigned site uses `src/`.

## Static hosting

The contents of `dist/` can also be served by a static host without Node.js at runtime. Build before publishing, and publish `dist/` as the site root. `CNAME` is retained for the existing custom domain, and `.nojekyll` ensures GitHub Pages serves the generated `_app/` bundles.

The included `.github/workflows/site.yml` runs the tests and build for pull requests and development branches. Pushes to `main` in `HaoZ94/haosite` also publish `dist/` to GitHub Pages. Before merging the TypeScript migration, a repository administrator must set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, keeping the existing custom domain. Serving the repository root directly will not build the TypeScript application. Forks run validation without publishing the site.

Navigation uses section anchors, so no server rewrite rules are required. Missing files correctly return HTTP 404 from the Node server. No deployment is performed by the build.
