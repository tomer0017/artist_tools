import "@testing-library/jest-dom";

// jsdom doesn't implement object URLs; provide no-op defaults so tests can spy.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:test";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
