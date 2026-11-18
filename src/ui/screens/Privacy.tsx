/**
 * Privacy (#/privacy) — the live network-request count (expected: 0 to other
 * sites), an honest description of what is stored (encrypted session in
 * IndexedDB with the key in a separate store), the current defaults, and the
 * one-tap erase button.
 */

import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Button, Card, Dialog } from "../components";
import { t, LANGS } from "@/i18n";
import { eraseEverything } from "@/storage/idb";
import { MAX_FILE_BYTES, MAX_PASTE_CHARS } from "../lib";

export function Privacy() {
  const { state } = useStore();
  const lang = state.options.language;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [crossOrigin, setCrossOrigin] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  // Live count of network requests since this page loaded. Only this page's
  // own files should ever appear; requests to other sites are counted
  // separately and are expected to be zero.
  useEffect(() => {
    const seen = new Set<string>();
    let cross = 0;
    let all = 0;
    const add = (entries: PerformanceResourceTiming[]) => {
      for (const e of entries) {
        const key = `${e.name}@${e.startTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all += 1;
        try {
          if (new URL(e.name).origin !== window.location.origin) cross += 1;
        } catch {
          cross += 1;
        }
      }
      setCrossOrigin(cross);
      setTotal(all);
    };
    try {
      const initial = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      add(initial);
      const po = new PerformanceObserver((list) => {
        add(list.getEntries() as PerformanceResourceTiming[]);
      });
      po.observe({ type: "resource", buffered: true });
      return () => po.disconnect();
    } catch {
      return;
    }
  }, []);

  const langLabel = LANGS.find((l) => l.code === state.options.language)?.label ?? state.options.language;
  const anchors = state.options.anchors;

  const erase = async () => {
    setErasing(true);
    await eraseEverything();
    window.location.reload();
  };

  return (
    <>
      <h1>{t("ui.privacy.title", lang)}</h1>
      <p>{t("ui.privacy.intro", lang)}</p>

      <Card tone="accent" title={t("ui.privacy.networkTitle", lang)} as="section">
        <p className="dh-network-count">
          <span className="dh-network-num">{crossOrigin === null ? "…" : crossOrigin}</span>
          {t("ui.privacy.network", lang)}
        </p>
        <p className="dh-hint">{t("ui.privacy.networkExpected", lang)}</p>
        <p className="dh-hint">
          {t("ui.privacy.networkTotal", lang, { count: total === null ? 0 : total })}
        </p>
      </Card>

      <Card title={t("ui.privacy.storedTitle", lang)} as="section">
        <p>{t("ui.privacy.storedBody", lang)}</p>
        <ul className="dh-privacy-list">
          <li>{t("ui.privacy.storedItem1", lang)}</li>
          <li>{t("ui.privacy.storedItem2", lang)}</li>
          <li>
            {t("ui.privacy.storedItem3", lang, {
              paste: MAX_PASTE_CHARS.toLocaleString("en-IN"),
              mb: Math.round(MAX_FILE_BYTES / (1024 * 1024)),
            })}
          </li>
        </ul>
      </Card>

      <Card title={t("ui.privacy.defaultsTitle", lang)} as="section">
        <dl className="dh-med-meta">
          <div>
            <dt>{t("ui.controls.language", lang)}</dt>
            <dd>{langLabel}</dd>
          </div>
          <div>
            <dt>{t("ui.day.anchors", lang)}</dt>
            <dd>
              {t("ui.day.anchor.morning", lang)} {anchors.morning} · {t("ui.day.anchor.midday", lang)} {anchors.midday} ·{" "}
              {t("ui.day.anchor.evening", lang)} {anchors.evening} · {t("ui.day.anchor.bedtime", lang)} {anchors.bedtime}
            </dd>
          </div>
          <div>
            <dt>{t("ui.day.days", lang)}</dt>
            <dd>
              {state.options.daysToBuyDefault} {t("ui.day.daysUnit", lang)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card tone="stopped" title={t("ui.privacy.eraseTitle", lang)} as="section">
        <p>{t("ui.privacy.eraseBody", lang)}</p>
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          {t("ui.privacy.erase", lang)}
        </Button>
      </Card>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t("ui.privacy.eraseConfirmTitle", lang)}>
        <p>{t("ui.privacy.eraseConfirm", lang)}</p>
        <div className="dh-dialog-actions">
          <Button variant="danger" loading={erasing} onClick={() => void erase()}>
            {t("ui.privacy.erase", lang)}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            {t("ui.privacy.eraseCancel", lang)}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
