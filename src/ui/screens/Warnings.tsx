/**
 * Warning signs (#/warnings) — the 112 emergency line always at the top, then
 * the signs from the papers in two groups (go to hospital now / call your
 * doctor), then the general guidance clearly labelled as NOT from the papers.
 * Also holds the Ask Your Doctor screen (#/ask).
 */

import { useState } from "react";
import { useStore } from "../store";
import { Button, Card, Dialog, EmptyState } from "../components";
import { t } from "@/i18n";
import type { QuestionReason } from "@/engine/types";
import { copyText } from "../lib";
import { GENERAL_GUIDANCE } from "@/engine/warnings";
import { EMERGENCY_112, EMERGENCY_NOTE } from "@/domain/statistics";

export function Warnings() {
  const { state } = useStore();
  const lang = state.options.language;
  const result = state.result;

  if (!result) return <EmptyState />;

  const er = result.warnings.filter((w) => w.severity === "er");
  const call = result.warnings.filter((w) => w.severity === "call");

  return (
    <>
      <h1>{t("ui.warnings.title", lang)}</h1>

      <Card tone="stopped" as="section" aria-labelledby="dh-er-112">
        <h2 id="dh-er-112" className="dh-card-title">
          <span aria-hidden>🚨</span> 112
        </h2>
        <p className="dh-emergency-line">{EMERGENCY_NOTE}</p>
        <p className="dh-hint">
          <a href={EMERGENCY_112.sourceUrl} target="_blank" rel="noreferrer">
            {EMERGENCY_112.source}
          </a>
        </p>
      </Card>

      <section aria-labelledby="dh-er-title">
        <h2 id="dh-er-title">{t("ui.warnings.er", lang)}</h2>
        {er.length === 0 ? (
          <p className="dh-hint">{t("ui.warnings.noneGroup", lang)}</p>
        ) : (
          <ul className="dh-warning-list">
            {er.map((w, i) => (
              <li key={i} className="dh-warning dh-warning-er">
                <span aria-hidden>🏥</span> {w.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dh-call-title">
        <h2 id="dh-call-title">{t("ui.warnings.call", lang)}</h2>
        {call.length === 0 ? (
          <p className="dh-hint">{t("ui.warnings.noneGroup", lang)}</p>
        ) : (
          <ul className="dh-warning-list">
            {call.map((w, i) => (
              <li key={i} className="dh-warning dh-warning-call">
                <span aria-hidden>📞</span> {w.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      {er.length === 0 && call.length === 0 ? <p>{t("ui.warnings.none", lang)}</p> : null}

      <section aria-labelledby="dh-general-title">
        <h2 id="dh-general-title">{t("ui.warnings.general", lang)}</h2>
        <p className="dh-hint">{t("ui.warnings.generalNote", lang)}</p>
        <ul className="dh-warning-list">
          {GENERAL_GUIDANCE.map((g) => (
            <li key={g.id} className="dh-warning dh-warning-general">
              {g.text}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const REASONS: QuestionReason[] = ["contradiction", "look-alike", "duplicate", "missing-info", "unclear", "unreadable"];

const REASON_GLYPHS: Record<QuestionReason, string> = {
  contradiction: "⇄",
  "look-alike": "◐",
  duplicate: "⇉",
  "missing-info": "…",
  unclear: "?",
  unreadable: "✗",
};

export function Ask() {
  const { state, toast } = useStore();
  const lang = state.options.language;
  const result = state.result;
  const [manualOpen, setManualOpen] = useState(false);

  if (!result) return <EmptyState />;

  const allText = result.questions.map((q, i) => `${i + 1}. ${q.text}`).join("\n");

  const copyAll = async () => {
    const ok = await copyText(allText);
    if (ok) {
      toast("success", t("ui.ask.copied", lang));
    } else {
      setManualOpen(true);
    }
  };

  const groups = REASONS.map((reason) => ({
    reason,
    items: result.questions.filter((q) => q.reason === reason),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <h1>{t("ui.ask.title", lang)}</h1>
      <p>{t("ui.ask.intro", lang)}</p>

      <div className="dh-ask-actions">
        <Button onClick={() => void copyAll()} disabled={result.questions.length === 0}>
          {t("ui.ask.copy", lang)}
        </Button>
      </div>

      {result.questions.length === 0 ? (
        <Card tone="accent">{t("ui.ask.none", lang)}</Card>
      ) : (
        groups.map((g) => (
          <section key={g.reason} aria-labelledby={`dh-reason-${g.reason}`} className="dh-group">
            <h2 id={`dh-reason-${g.reason}`} className="dh-group-title">
              <span aria-hidden>{REASON_GLYPHS[g.reason]}</span>{" "}
              {t(`ui.ask.reason.${g.reason}`, lang)}
              <span className="dh-group-count">
                {t("ui.changes.count", lang, { count: g.items.length })}
              </span>
            </h2>
            <ol className="dh-question-list">
              {g.items.map((q) => (
                <li key={q.id} className="dh-question">
                  {q.text}
                </li>
              ))}
            </ol>
          </section>
        ))
      )}

      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} title={t("ui.ask.manualTitle", lang)}>
        <p className="dh-hint">{t("ui.ask.manualHint", lang)}</p>
        <textarea className="dh-textarea" readOnly value={allText} aria-label={t("ui.ask.title", lang)} />
      </Dialog>
    </>
  );
}
