# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

The user selected the Figma design as the visual direction and prefers an open-source map without a paid API key at the pilot stage. Keep archaeological measurements source-backed: label demo coordinates and imagery, compute only supported metrics, and display missing data explicitly.

On 2026-10-02 the user requested an operational sidebar and separate work pages, more defensible environmental factors, GitHub-based open-source research, and Gaussian Splatting integration. Active UI entry is now `src/WorkspaceApp.jsx` with `src/workspace.css`; the former one-page prototype is retained but not imported. Keep the restrained green identity with neutral workspace backgrounds. Separate historical siting research from present-day conservation. Never claim the synthetic splat calibration asset is a surveyed ancient building, and never imply a photo-training backend is connected until it is actually implemented and tested.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
