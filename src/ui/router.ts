/**
 * Hash router — works on any static host and GitHub Pages (no history API).
 */

import { useEffect, useState } from "react";

export interface Route {
  path: string;
  params: Record<string, string>;
}

export function parseHash(hash: string): Route {
  const raw = (hash || "#/").replace(/^#/, "");
  const [pathPart, queryPart] = raw.split("?");
  const path = pathPart || "/";
  const params: Record<string, string> = {};
  if (queryPart) {
    for (const kv of queryPart.split("&")) {
      const [k, v = ""] = kv.split("=");
      params[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { path, params };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("#") ? path : `#${path}`;
}
