/**
 * AppShell — header (brand + scrollable nav), the slim controls bar (language,
 * theme, contrast, text size), the live busy bar, main content and the
 * emergency footer that is visible on every screen. The root is a
 * min-height-100vh flex column so short pages keep the footer at the bottom.
 */

import type { ReactNode } from "react";
import { useStore } from "./store";
import { useRoute } from "./router";
import { ToastRegion, useTheme } from "./components";
import { LANGS, t } from "@/i18n";
import type { Lang } from "@/engine/types";

const NAV = [
  { href: "#/", key: "ui.nav.home", match: (p: string) => p === "/" },
  { href: "#/add", key: "ui.nav.add", match: (p: string) => p === "/add" },
  { href: "#/changes", key: "ui.nav.changes", match: (p: string) => p === "/changes" },
  { href: "#/day", key: "ui.nav.day", match: (p: string) => p === "/day" },
  { href: "#/sheet", key: "ui.nav.sheet", match: (p: string) => p === "/sheet" || p.startsWith("/sheet/") },
  { href: "#/warnings", key: "ui.nav.warnings", match: (p: string) => p === "/warnings" },
  { href: "#/ask", key: "ui.nav.ask", match: (p: string) => p === "/ask" },
  { href: "#/check", key: "ui.nav.check", match: (p: string) => p === "/check" },
  { href: "#/trace", key: "ui.nav.trace", match: (p: string) => p === "/trace" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { state, setOptions } = useStore();
  const route = useRoute();
  const { theme, setTheme, contrast, setContrast, textSize, setTextSize } = useTheme();
  const lang = state.options.language;

  return (
    <div className="dh-app">
      <a className="dh-skip-link" href="#main">
        {t("ui.a11y.skip", lang)}
      </a>

      <header className="dh-header">
        <div className="dh-header-row">
          <a className="dh-brand" href="#/">
            <span className="dh-brand-mark" aria-hidden>
              D
            </span>
            {t("ui.app.name", lang)}
          </a>
          <nav className="dh-nav" aria-label={t("ui.nav.label", lang)}>
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                aria-current={n.match(route.path) ? "page" : undefined}
              >
                {t(n.key, lang)}
              </a>
            ))}
          </nav>
        </div>

        <div className="dh-controls dh-no-print">
          <label className="dh-control">
            <span className="dh-control-label">{t("ui.controls.language", lang)}</span>
            <select
              value={lang}
              onChange={(e) => setOptions({ language: e.target.value as Lang })}
              aria-label={t("ui.controls.language", lang)}
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dh-control">
            <span className="dh-control-label">{t("ui.controls.theme", lang)}</span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "light" | "dark")}
              aria-label={t("ui.controls.theme", lang)}
            >
              <option value="light">{t("ui.controls.theme.light", lang)}</option>
              <option value="dark">{t("ui.controls.theme.dark", lang)}</option>
            </select>
          </label>
          <label className="dh-control">
            <span className="dh-control-label">{t("ui.controls.contrast", lang)}</span>
            <select
              value={contrast}
              onChange={(e) => setContrast(e.target.value as "normal" | "high")}
              aria-label={t("ui.controls.contrast", lang)}
            >
              <option value="normal">{t("ui.controls.contrast.normal", lang)}</option>
              <option value="high">{t("ui.controls.contrast.high", lang)}</option>
            </select>
          </label>
          <label className="dh-control">
            <span className="dh-control-label">{t("ui.controls.textsize", lang)}</span>
            <select
              value={textSize}
              onChange={(e) => setTextSize(e.target.value as "normal" | "large" | "xlarge")}
              aria-label={t("ui.controls.textsize", lang)}
            >
              <option value="normal">{t("ui.controls.textsize.normal", lang)}</option>
              <option value="large">{t("ui.controls.textsize.large", lang)}</option>
              <option value="xlarge">{t("ui.controls.textsize.xlarge", lang)}</option>
            </select>
          </label>
        </div>
      </header>

      {state.busy ? (
        <div className="dh-busybar" role="status" aria-live="polite">
          <span className="dh-spinner" aria-hidden>
            <span className="dh-spinner-dot" />
          </span>
          <span>{state.progressLabel}</span>
        </div>
      ) : null}

      <main className="dh-main" id="main">
        {children}
      </main>

      <footer className="dh-footer">
        <div className="dh-footer-inner">
          <strong className="dh-emergency">{t("ui.emergency", lang)}</strong>
          <p className="dh-footer-line">{t("ui.footer.notSubstitute", lang)}</p>
          <p className="dh-footer-links">
            <a href="#/privacy">{t("ui.nav.privacy", lang)}</a>
            <span aria-hidden> · </span>
            <a href="#/about">{t("ui.nav.about", lang)}</a>
          </p>
        </div>
      </footer>

      <ToastRegion toasts={state.toasts} />
    </div>
  );
}
