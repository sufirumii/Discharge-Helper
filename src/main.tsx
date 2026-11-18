/**
 * Entry — fonts, theme, render, PWA registration.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/lora/600.css";
import "@fontsource/lora/700.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./ui/app.css";
import App from "./App";

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// PWA (production only — the service worker precaches the app shell and,
// after first use, the local text-recogniser files).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support is progressive enhancement; registration failure is non-fatal */
    });
  });
}
