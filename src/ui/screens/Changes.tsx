/**
 * What changed (#/changes) — the discharge medicines grouped by status:
 * New / Changed / Stopped / Same / Check this. Each card shows the resolved
 * salt, the strength, dose, frequency, duration, a plain sentence, every flag,
 * and a disclosure with the exact sentence in the normalised papers (the
 * source span highlighted).
 */

import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { Card, DeviceReadChip, Disclosure, ReadAloud, StatusPill, VerifiedChip, EmptyState } from "../components";
import { t } from "@/i18n";
import { plainMedSentence } from "@/engine/plain";
import type { Lang, MedStatus, Span, StructuredMed } from "@/engine/types";

const GROUP_ORDER: MedStatus[] = ["new", "changed", "stopped", "same", "unclear"];

export function Changes() {
  const { state } = useStore();
  const lang = state.options.language;
  const result = state.result;

  if (!result) return <EmptyState />;

  const groups = GROUP_ORDER.map((status) => ({
    status,
    meds: result.medications.filter((m) => m.status === status),
  })).filter((g) => g.meds.length > 0);

  return (
    <>
      <h1>{t("ui.changes.title", lang)}</h1>
      <p>{t("ui.changes.intro", lang)}</p>
      <p className="dh-device-row">
        <DeviceReadChip />
      </p>

      <Card tone="accent" title={t("ui.changes.plainTitle", lang)}>
        <p className="dh-plain-summary">{result.plainSummary}</p>
        <ReadAloud text={result.plainSummary} voiceLang={lang} />
      </Card>

      {groups.map((g) => (
        <section key={g.status} aria-labelledby={`dh-group-${g.status}`} className="dh-group">
          <h2 id={`dh-group-${g.status}`} className="dh-group-title">
            <StatusPill status={g.status} lang={lang} />
            <span>{t(`ui.changes.group.${g.status}`, lang)}</span>
            <span className="dh-group-count">
              {t("ui.changes.count", lang, { count: g.meds.length })}
            </span>
          </h2>
          {g.meds.map((med) => (
            <MedCard key={med.id} med={med} lang={lang} normalisedText={result.normalisedText} />
          ))}
        </section>
      ))}

      {groups.length === 0 ? <p>{t("ui.changes.none", lang)}</p> : null}
    </>
  );
}

function MedCard({
  med,
  lang,
  normalisedText,
}: {
  med: StructuredMed;
  lang: Lang;
  normalisedText: string;
}) {
  const salt =
    med.resolved.ingredients.length > 0
      ? med.resolved.ingredients
          .map((i) => (i.strength ? `${i.name} ${i.strength}` : i.name))
          .join(" + ")
      : null;

  const beforeOnly = med.span.start < 0;
  const plain = plainSentenceFor(med, lang);

  return (
    <Card tone={med.status} as="article" className="dh-med-card">
      <h3 className="dh-med-name">
        {med.nameAsWritten}
        {med.strength ? <span className="dh-med-strength"> {med.strength}</span> : null}
        {med.formAsWritten ? <span className="dh-med-form"> ({med.formAsWritten})</span> : null}
      </h3>

      {salt ? (
        <p className="dh-med-salt">
          <span className="dh-med-k">{t("ui.changes.salt", lang)}:</span> {salt}
        </p>
      ) : (
        <p className="dh-med-salt dh-med-unknown">{t("tpl.unknown-name", lang)}</p>
      )}

      {plain ? <p className="dh-med-plain">{plain}</p> : null}

      <dl className="dh-med-meta">
        {med.doseText ? (
          <div>
            <dt>{t("ui.changes.dose", lang)}</dt>
            <dd>{med.doseText}</dd>
          </div>
        ) : null}
        {med.frequencyText ?? med.frequency ? (
          <div>
            <dt>{t("ui.changes.freq", lang)}</dt>
            <dd>{med.frequencyText ?? med.frequency?.raw}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("ui.changes.duration", lang)}</dt>
          <dd>{durationText(med, lang)}</dd>
        </div>
        {med.note ? (
          <div>
            <dt>{t("ui.changes.note", lang)}</dt>
            <dd>{med.note}</dd>
          </div>
        ) : null}
      </dl>

      {med.flags.length > 0 ? (
        <ul className="dh-flags">
          {med.flags.map((f, i) => (
            <li key={i} className="dh-flag">
              <span aria-hidden>⚠</span> {f.message}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="dh-chips">
        <VerifiedChip verified={med.spanVerified} lang={lang} />
        {med.confidence === "review" ? (
          <span className="dh-chip dh-chip-warn">{t("ui.changes.review", lang)}</span>
        ) : null}
      </p>

      <Disclosure summary={t("ui.changes.source", lang)}>
        <blockquote className="dh-raw-line">“{med.raw}”</blockquote>
        {beforeOnly ? (
          <p className="dh-hint">{t("ui.changes.beforeOnly", lang)}</p>
        ) : (
          <NormalisedWithSpan text={normalisedText} span={med.span} lang={lang} />
        )}
      </Disclosure>
    </Card>
  );
}

/** The plain sentence — same templates the engine composes with. */
function plainSentenceFor(med: StructuredMed, lang: Lang): string | null {
  if (med.status === "stopped") return t("ui.changes.stoppedAs", lang);
  if (med.course === "hold") return t("ui.changes.holdAs", lang);
  if (beforeOnlyMed(med)) return null;
  if (!med.frequency && !med.doseText && med.dose === undefined) return null;
  return plainMedSentence(med, lang);
}

function beforeOnlyMed(med: StructuredMed): boolean {
  return med.span.start < 0 && med.flags.some((f) => f.kind === "missing-info");
}

function durationText(med: StructuredMed, lang: Lang): string {
  const d = med.duration;
  switch (d.kind) {
    case "fixed":
      return d.days !== undefined ? t("tpl.duration.days", lang, { days: d.days }) : d.text || "—";
    case "continue":
      return t("tpl.duration.continue", lang);
    case "till-review":
      return t("tpl.duration.till-review", lang);
    case "lifelong":
      return t("tpl.duration.lifelong", lang);
    default:
      return t("tpl.duration.missing", lang);
  }
}

/** The full normalised text with the medicine's source span highlighted. */
function NormalisedWithSpan({ text, span, lang }: { text: string; span: Span; lang: Lang }) {
  const markRef = useRef<HTMLElement>(null);
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, []);
  const start = Math.max(0, Math.min(span.start, text.length));
  const end = Math.max(start, Math.min(span.end, text.length));
  return (
    <div className="dh-source-pane" tabIndex={0} aria-label={t("ui.changes.sourcePane", lang)}>
      {text.slice(0, start)}
      <mark className="span-highlight" ref={markRef}>
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </div>
  );
}
