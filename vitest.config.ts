import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `@/*` alias explicitly (not via vite-tsconfig-paths) so it keeps
  // working even though tsconfig excludes *.test.ts from the Next build.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Transform JSX with esbuild's automatic runtime (no Babel — avoids the
  // shadcn/@babel peer conflict that @vitejs/plugin-react would introduce).
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
