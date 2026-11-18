import "@testing-library/jest-dom";

// jsdom doesn't implement object URLs; provide no-op defaults so tests can spy.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:test";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

// jsdom's Blob has no arrayBuffer() (every current browser has it): the same, through FileReader.
if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function" && typeof FileReader !== "undefined") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// Server-side tests run in Node, where there is no window to mock.
if (typeof window !== "undefined") {
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
}
