/**
 * @boardui/demo-shared: the parts of the boardui demo that don't depend on the UI framework,
 * used by every demo app (`packages/demo-<framework>`): the samples, opening files and boards
 * (`DemoSession`), what the panels show, formatting, and the stats overlay's numbers. The page's
 * styles are `@boardui/demo-shared/style.css`, the sample sizes `@boardui/demo-shared/sizes`,
 * and the build helpers `@boardui/demo-shared/build` (Vite: `@boardui/demo-shared/vite`).
 */
export * from './board.js';
export * from './files.js';
export * from './format.js';
export * from './frameworks.js';
export * from './names.js';
export * from './samples.js';
export * from './session.js';
export * from './stats.js';
