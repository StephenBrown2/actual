export {};

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface merges with lib.dom Window
  interface Window {
    Actual: {
      setTheme(theme: string): void;
    };
  }
}
