/**
 * My day (#/day) — the large-print daily timetable grouped by time, the
 * "when needed" bucket, reducing courses as dated steps, holds, refills with
 * the "assumed days" badge, editable meal anchors (re-reads the papers) and
 * the .ics calendar download.
 */

import { useState } from "react";
import { useStore } from "../store";
import { Button, Card, EmptyState } from "../components";
import { t } from "@/i18n";
import { planToIcs, icsFilename } from "@/domain/ics";
import type { DoseSlot, MealAnchors } from "@/engine/types";
import { downloadTextFile, tomorrow } from "../lib";

export function Day() {
  const { state, runAnalysis, toast } = useStore();
  const lang = state.options.language;
  const result = state.result;

  const [anchors, setAnchors] = useState<MealAnchors>(state.options.anchors);
  const [days, setDays] = useState<number>(state.options.daysToBuyDefault);

  if (!result) return <EmptyState />;

  const plan = result.plan;
  const clockSlots = plan.slots.filter((s) => s.time !== "when needed");
  const prnSlots = plan.slots.filter((s) => s.time === "when needed");

  // Group the timed slots by their time string (already sorted by the engine).
  const byTime: { time: string; slots: DoseSlot[] }[] = [];
  for (const s of clockSlots) {
    const last = byTime[byTime.length - 1];
    if (last && last.time === s.time) last.slots.push(s);
    else byTime.push({ time: s.time, slots: [s] });
  }

  const saveTimes = () => {
    const cleaned: MealAnchors = {
      morning: anchors.morning || "08:00",
      midday: anchors.midday || "13:00",
      evening: anchors.evening || "20:00",
      bedtime: anchors.bedtime || "22:00",
    };
    const daysToBuyDefault = Number.isFinite(days) && days > 0 && days <= 365 ? Math.round(days) : 14;
    setAnchors(cleaned);
    setDays(daysToBuyDefault);
    toast("info", t("ui.day.rerunNote", lang));
    void runAnalysis({ options: { anchors: cleaned, daysToBuyDefault }, navigateTo: false });
  };

  const downloadIcs = () => {
    const ics = planToIcs(plan, result.followups, { fromDay: tomorrow(), days: 14 });
    downloadTextFile(icsFilename("discharge-plan"), ics, "text/calendar");
    toast("success", t("ui.day.icsDone", lang));
  };

  return (
    <>
      <h1>{t("ui.day.title", lang)}</h1>
      <p>{t("ui.day.intro", lang)}</p>

      <section aria-labelledby="dh-timetable-title" className="dh-timetable">
        <h2 id="dh-timetable-title">{t("ui.day.timetable", lang)}</h2>
        {byTime.length === 0 && prnSlots.length === 0 ? <p>{t("ui.day.noSlots", lang)}</p> : null}
        <ul className="dh-timeline">
          {byTime.map((g) => (
            <li key={g.time}>
              <span className="dh-timeline-time">{g.time}</span>
              <ul className="dh-timeline-meds">
                {g.slots.map((s) => (
                  <li key={`${s.medId}-${s.time}`} className="dh-dose">
                    <strong className="dh-dose-name">{s.medName}</strong>
                    <span className="dh-dose-text">{s.doseText}</span>
                    {s.withFood ? <span className="dh-chip dh-chip-food">{t("ui.day.withFood", lang)}</span> : null}
                    {s.prn ? <span className="dh-chip dh-chip-warn">{t("ui.day.prn", lang)}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {prnSlots.length > 0 ? (
          <Card title={t("ui.day.whenNeeded", lang)} tone="plain">
            <ul className="dh-timeline-meds">
              {prnSlots.map((s) => (
                <li key={`${s.medId}-prn`} className="dh-dose">
                  <strong className="dh-dose-name">{s.medName}</strong>
                  <span className="dh-dose-text">{s.doseText}</span>
                  {s.withFood ? <span className="dh-chip dh-chip-food">{t("ui.day.withFood", lang)}</span> : null}
                </li>
              ))}
            </ul>
            <p className="dh-hint">{t("ui.day.prnHint", lang)}</p>
          </Card>
        ) : null}
      </section>

      {plan.tapers.length > 0 ? (
        <section aria-labelledby="dh-tapers-title">
          <h2 id="dh-tapers-title">{t("ui.day.tapers", lang)}</h2>
          {plan.tapers.map((tp) => (
            <Card key={tp.medId} title={tp.medName} as="article">
              <ol className="dh-taper-steps">
                {tp.steps.map((st, i) => (
                  <li key={i}>
                    <span className="dh-taper-days">
                      {t("ui.day.taperDays", lang, { from: st.fromDay, to: st.toDay })}:
                    </span>{" "}
                    <strong>{st.doseText}</strong>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </section>
      ) : null}

      {plan.holds.length > 0 ? (
        <section aria-labelledby="dh-holds-title">
          <h2 id="dh-holds-title">{t("ui.day.holds", lang)}</h2>
          {plan.holds.map((h) => (
            <Card key={h.medId} title={h.medName} tone="changed" as="article">
              <p>{h.description}</p>
              <p className="dh-hint">{t("ui.day.holdsHint", lang)}</p>
            </Card>
          ))}
        </section>
      ) : null}

      {plan.refills.length > 0 ? (
        <section aria-labelledby="dh-refills-title">
          <h2 id="dh-refills-title">{t("ui.day.refills", lang)}</h2>
          <div className="dh-tablewrap" tabIndex={0}>
            <table className="dh-table dh-refill-table">
              <thead>
                <tr>
                  <th scope="col">{t("ui.day.refillMed", lang)}</th>
                  <th scope="col">{t("ui.day.refillBuyBy", lang)}</th>
                  <th scope="col">{t("ui.day.refillDays", lang)}</th>
                  <th scope="col">{t("ui.day.refillUnits", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {plan.refills.map((r) => (
                  <tr key={r.medId}>
                    <td>
                      <strong>{r.medName}</strong>
                      {r.assumedDays ? (
                        <span className="dh-chip dh-chip-warn dh-refill-assumed">{t("ui.day.assumedDays", lang)}</span>
                      ) : null}
                    </td>
                    <td>{r.refillDate ?? "—"}</td>
                    <td>{r.days > 0 ? r.days : "—"}</td>
                    <td>{r.unitsToBuy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dh-hint">{t("ui.day.refillHint", lang)}</p>
        </section>
      ) : null}

      {plan.ambiguous.length > 0 ? (
        <section aria-labelledby="dh-ambiguous-title">
          <h2 id="dh-ambiguous-title">{t("ui.day.ambiguous", lang)}</h2>
          <ul className="dh-flags">
            {plan.ambiguous.map((a, i) => (
              <li key={i} className="dh-flag">
                <span aria-hidden>?</span> <strong>{a.medName}</strong> — {a.rawFrequency}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="dh-anchors-title" className="dh-anchors">
        <h2 id="dh-anchors-title">{t("ui.day.anchors", lang)}</h2>
        <p className="dh-hint">{t("ui.day.anchorsHint", lang)}</p>
        <div className="dh-anchor-grid">
          {(["morning", "midday", "evening", "bedtime"] as const).map((k) => (
            <label key={k} className="dh-anchor">
              {t(`ui.day.anchor.${k}`, lang)}
              <input
                type="time"
                value={anchors[k]}
                onChange={(e) => setAnchors({ ...anchors, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="dh-anchor">
            {t("ui.day.days", lang)}
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="dh-day-actions">
          <Button onClick={saveTimes}>{t("ui.day.rerun", lang)}</Button>
          <Button variant="secondary" onClick={downloadIcs}>
            {t("ui.day.ics", lang)}
          </Button>
        </div>
        <p className="dh-hint">{t("ui.day.icsHint", lang)}</p>
      </section>
    </>
  );
}
