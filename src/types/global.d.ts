declare global {
  /**
   * Garbage collection function - available when Node.js is run with --expose-gc flag
   * Usage: npm run dev:memory
   */
  var gc: (() => void) | undefined;
}

export {};
