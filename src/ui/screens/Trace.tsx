/**
 * How I read this (#/trace) — the agent trace made visible: the coverage
 * summary, the strategy notes, every step grouped by stage, the lines that
 * could not be read, and the line-by-line coverage table.
 */

import { useStore } from "../store";
import { DeviceReadChip, EmptyState } from "../components";
import { t } from "@/i18n";
import type { Lang, TraceStage } from "@/engine/types";

const STAGES: TraceStage[] = ["perceive", "plan", "act", "verify", "reflect", "escalate"];

const STAGE_GLYPHS: Record<TraceStage, string> = {
  perceive: "👀",
  plan: "🗺",
  act: "🔧",
  verify: "🔍",
  reflect: "🔄",
  escalate: "🙋",
};

export function Trace() {
  const { state } = useStore();
  const lang = state.options.language;
  const result = state.result;

  if (!result) return <EmptyState />;

  const { coverage, trace } = result;
  const unreadable = coverage.lines.filter((l) => l.outcome === "could-not-read");

  return (
    <>
      <h1>{t("ui.trace.title", lang)}</h1>
      <p>{t("ui.trace.intro", lang)}</p>
      <p className="dh-device-row">
        <DeviceReadChip />
      </p>

      <section aria-labelledby="dh-coverage-title" className="dh-coverage">
        <h2 id="dh-coverage-title">{t("ui.trace.coverage", lang)}</h2>
        <div className="dh-coverage-big">
          <span className="dh-coverage-pct">{coverage.coveragePct}%</span>
          <span className="dh-coverage-counts">
            {t("ui.trace.coverageDetail", lang, {
              captured: coverage.captured,
              notMedicine: coverage.notMedicine,
              unreadable: coverage.unreadable,
            })}
          </span>
        </div>
      </section>

      {trace.strategyNotes.length > 0 ? (
        <section aria-labelledby="dh-strategy-title">
          <h2 id="dh-strategy-title">{t("ui.trace.strategy", lang)}</h2>
          <ul className="dh-strategy-notes">
            {trace.strategyNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="dh-steps-title">
        <h2 id="dh-steps-title">{t("ui.trace.steps", lang)}</h2>
        {STAGES.filter((s) => trace.steps.some((st) => st.stage === s)).map((stage) => (
          <div key={stage} className="dh-trace-stage">
            <h3 className="dh-trace-stage-title">
              <span aria-hidden>{STAGE_GLYPHS[stage]}</span> {t(`ui.trace.stage.${stage}`, lang)}
            </h3>
            <ol className="dh-trace-steps">
              {trace.steps
                .filter((st) => st.stage === stage)
                .map((st) => (
                  <li key={st.id} className="dh-trace-step">
                    <span className="dh-trace-label">{st.label}</span>
                    {st.detail ? <span className="dh-trace-detail">{st.detail}</span> : null}
                    {st.reason ? <span className="dh-trace-detail">{st.reason}</span> : null}
                    {st.confidence === "review" ? <span className="dh-chip dh-chip-warn">{t("ui.trace.review", lang)}</span> : null}
                  </li>
                ))}
            </ol>
          </div>
        ))}
      </section>

      {unreadable.length > 0 ? (
        <section aria-labelledby="dh-unreadable-title">
          <h2 id="dh-unreadable-title">{t("ui.trace.couldNotRead", lang)}</h2>
          <ul className="dh-flags">
            {unreadable.map((l, i) => (
              <li key={i} className="dh-flag dh-unreadable-line">
                <span aria-hidden>✗</span> {l.line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="dh-lines-title">
        <h2 id="dh-lines-title">{t("ui.trace.lines", lang)}</h2>
        <div className="dh-tablewrap dh-coverage-tablewrap" tabIndex={0}>
          <table className="dh-table dh-coverage-table">
            <thead>
              <tr>
                <th scope="col">{t("ui.trace.line", lang)}</th>
                <th scope="col">{t("ui.trace.outcome", lang)}</th>
                <th scope="col">{t("ui.trace.why", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {coverage.lines.map((l, i) => (
                <tr key={i} className={`dh-line-${l.outcome}`}>
                  <td>{l.line}</td>
                  <td>
                    <span className={`dh-chip dh-line-chip-${l.outcome}`}>{lineLabel(l.outcome, lang)}</span>
                  </td>
                  <td>{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function lineLabel(outcome: "captured" | "not-medicine" | "could-not-read", lang: Lang): string {
  switch (outcome) {
    case "captured":
      return t("ui.trace.line.captured", lang);
    case "not-medicine":
      return t("ui.trace.line.not-medicine", lang);
    default:
      return t("ui.trace.line.could-not-read", lang);
  }
}
