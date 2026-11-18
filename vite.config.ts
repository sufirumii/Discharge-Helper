import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Base is relative so the same build works on Render (/), Netlify (/),
// Vercel (/) and GitHub Pages (/<repo>/).
const base = process.env.VITE_BASE_PATH ?? "./";

// Same policy as render.yaml, minus frame-ancestors (not allowed in a meta
// tag). Putting it in the built page means static hosts that cannot set
// headers, such as GitHub Pages, enforce it too. Build only: the dev server
// needs inline scripts for hot reload.
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";

export default defineConfig({
  base,
  plugins: [
    react(),
    {
      name: "csp-meta",
      apply: "build",
      transformIndexHtml: (html: string) =>
        html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  resolve: {
    alias: [{ find: "@", replacement: resolve(import.meta.dirname, "src") }],
  },
  build: {
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
