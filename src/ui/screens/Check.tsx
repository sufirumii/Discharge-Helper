/**
 * Check yourself (#/check) — teach-back, one question at a time. A wrong
 * answer re-explains from the same reviewed template and lets the patient try
 * again; a correct answer moves on. Progress is announced ("2 of 5") and the
 * feedback region is aria-live for screen readers.
 */

import { useState } from "react";
import { useStore } from "../store";
import { Button, Card, EmptyState } from "../components";
import { t } from "@/i18n";
import type { TeachBackItem } from "@/engine/types";

type QuizMode = "answering" | "correct" | "wrong";

export function Check() {
  const { state } = useStore();
  const lang = state.options.language;
  const result = state.result;

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<QuizMode>("answering");
  const [done, setDone] = useState(false);

  if (!result) return <EmptyState />;

  const items: TeachBackItem[] = result.teachBack;

  if (items.length === 0) {
    return (
      <>
        <h1>{t("ui.check.title", lang)}</h1>
        <Card tone="accent">{t("ui.check.none", lang)}</Card>
      </>
    );
  }

  if (done) {
    return (
      <>
        <h1>{t("ui.check.title", lang)}</h1>
        <Card tone="accent" title={t("ui.check.finishTitle", lang, { total: items.length })}>
          <p>{t("ui.check.finishBody", lang)}</p>
          <Button
            onClick={() => {
              setIndex(0);
              setSelected(null);
              setMode("answering");
              setDone(false);
            }}
          >
            {t("ui.check.again", lang)}
          </Button>
        </Card>
      </>
    );
  }

  const item = items[index];
  const isLast = index === items.length - 1;

  const submit = () => {
    if (!selected) return;
    setMode(selected === item.correctId ? "correct" : "wrong");
  };

  const next = () => {
    if (isLast) {
      setDone(true);
      return;
    }
    setIndex(index + 1);
    setSelected(null);
    setMode("answering");
  };

  const retry = () => {
    setSelected(null);
    setMode("answering");
  };

  return (
    <>
      <h1>{t("ui.check.title", lang)}</h1>
      <p>{t("ui.check.intro", lang)}</p>

      <p className="dh-check-progress" aria-live="polite">
        {t("ui.check.progress", lang, { current: index + 1, total: items.length })}
      </p>

      <Card as="section" aria-labelledby={`dh-check-q-${item.id}`}>
        <fieldset className="dh-check-fieldset" disabled={mode !== "answering"}>
          <legend id={`dh-check-q-${item.id}`} className="dh-check-question">
            {item.question}
          </legend>
          <div className="dh-check-options" role="radiogroup" aria-labelledby={`dh-check-q-${item.id}`}>
            {item.options.map((o) => {
              const id = `dh-opt-${item.id}-${o.id}`;
              const chosen = selected === o.id;
              return (
                <label key={o.id} htmlFor={id} className={`dh-check-option ${chosen ? "dh-check-chosen" : ""}`}>
                  <input
                    type="radio"
                    id={id}
                    name={`dh-check-${item.id}`}
                    value={o.id}
                    checked={chosen}
                    onChange={() => setSelected(o.id)}
                  />
                  <span className="dh-check-option-text">{o.text}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="dh-check-feedback" aria-live="polite">
          {mode === "answering" ? (
            <Button onClick={submit} disabled={selected === null}>
              {t("ui.check.submit", lang)}
            </Button>
          ) : null}
          {mode === "correct" ? (
            <div className="dh-check-result dh-check-ok">
              <p>
                <span aria-hidden>✓</span> <strong>{t("ui.check.correct", lang)}</strong>
              </p>
              <Button onClick={next}>{isLast ? t("ui.check.finishBtn", lang) : t("ui.check.next", lang)}</Button>
            </div>
          ) : null}
          {mode === "wrong" ? (
            <div className="dh-check-result dh-check-bad">
              <p>
                <span aria-hidden>↺</span> <strong>{t("ui.check.wrong", lang)}</strong>
              </p>
              <p className="dh-check-explain">{item.explain}</p>
              <Button variant="secondary" onClick={retry}>
                {t("ui.check.retry", lang)}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </>
  );
}
