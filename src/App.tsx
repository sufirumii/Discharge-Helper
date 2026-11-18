/**
 * App — providers and the route switch (hash routing, static-host friendly).
 * Every route renders inside AppShell so the emergency line is always
 * visible; guarded screens show an empty state until papers have been read.
 */

import type { ReactNode } from "react";
import { StoreProvider, useStore } from "./ui/store";
import { ThemeProvider } from "./ui/components";
import { AppShell } from "./ui/AppShell";
import { useRoute, navigate } from "./ui/router";
import { t } from "./i18n";
import { Home } from "./ui/screens/Home";
import { Add } from "./ui/screens/Add";
import { Changes } from "./ui/screens/Changes";
import { Day } from "./ui/screens/Day";
import { Sheet } from "./ui/screens/Sheet";
import { Warnings, Ask } from "./ui/screens/Warnings";
import { Check } from "./ui/screens/Check";
import { Trace } from "./ui/screens/Trace";
import { Privacy } from "./ui/screens/Privacy";
import { About } from "./ui/screens/About";

function NotFound() {
  const { state } = useStore();
  const lang = state.options.language;
  return (
    <section className="dh-empty">
      <h2>{t("ui.notfound.title", lang)}</h2>
      <p>
        <button type="button" className="dh-btn dh-btn-primary" onClick={() => navigate("/")}>
          {t("ui.notfound.home", lang)}
        </button>
      </p>
    </section>
  );
}

function Routes() {
  const route = useRoute();
  let screen: ReactNode;
  switch (route.path) {
    case "/":
      screen = <Home />;
      break;
    case "/add":
      screen = <Add />;
      break;
    case "/changes":
      screen = <Changes />;
      break;
    case "/day":
      screen = <Day />;
      break;
    case "/sheet":
      screen = <Sheet />;
      break;
    case "/warnings":
      screen = <Warnings />;
      break;
    case "/ask":
      screen = <Ask />;
      break;
    case "/check":
      screen = <Check />;
      break;
    case "/trace":
      screen = <Trace />;
      break;
    case "/privacy":
      screen = <Privacy />;
      break;
    case "/about":
      screen = <About />;
      break;
    default:
      if (route.path.startsWith("/sheet/")) {
        screen = <Sheet />;
        break;
      }
      screen = <NotFound />;
  }
  return <AppShell>{screen}</AppShell>;
}

export default function App() {
  return (
    <StoreProvider>
      <ThemeProvider>
        <Routes />
      </ThemeProvider>
    </StoreProvider>
  );
}
