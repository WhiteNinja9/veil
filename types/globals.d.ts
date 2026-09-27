/** Compile-time constants injected by scripts/build.mjs (and vitest.config.ts). */
declare const __BROWSER__: 'chrome' | 'firefox';
declare const __DEV__: boolean;
declare const __TEST_MODEL__: boolean;
declare const __VERSION__: string;

declare module '*.svg' {
  const markup: string;
  export default markup;
}
