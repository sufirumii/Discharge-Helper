/**
 * About (#/about) — what the app is, the India evidence with sources, the
 * honest limits, the methods it is built on, the build target and licence.
 */

import { useStore } from "../store";
import { Card } from "../components";
import { t } from "@/i18n";
import { METHOD_SOURCES, STATISTICS } from "@/domain/statistics";

export function About() {
  const { state } = useStore();
  const lang = state.options.language;

  return (
    <>
      <h1>{t("ui.about.title", lang)}</h1>
      <p className="dh-about-tagline">{t("ui.app.tagline", lang)}</p>

      <Card title={t("ui.about.evidence", lang)} tone="accent" as="section">
        <p className="dh-hint">{t("ui.about.evidenceNote", lang)}</p>
        {STATISTICS.map((s) => (
          <blockquote className="dh-quote" key={s.id}>
            {s.display}
            <cite>
              {s.source} — {s.dataYear} —{" "}
              <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                {t("ui.home.source", lang)}
              </a>{" "}
              ({s.status === "verified-at-url" ? "verified at URL" : "kept from project research, not re-verified in this build"})
            </cite>
          </blockquote>
        ))}
      </Card>

      <Card title={t("ui.about.limits", lang)} as="section">
        <ul className="dh-limits-list">
          <li>{t("ui.about.limit.handwriting", lang)}</li>
          <li>{t("ui.about.limit.photo", lang)}</li>
          <li>{t("ui.about.limit.lexicon", lang)}</li>
          <li>{t("ui.about.limit.translation", lang)}</li>
        </ul>
      </Card>

      <Card title={t("ui.about.methods", lang)} as="section">
        <ul className="dh-privacy-list">
          {METHOD_SOURCES.map((m) => (
            <li key={m.id}>
              <a href={m.url} target="_blank" rel="noreferrer">
                {m.name}
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section">
        <p>{t("ui.about.builtFor", lang)}</p>
        <p className="dh-hint">
          {t("ui.about.licence", lang)} · Apache-2.0
        </p>
      </Card>
    </>
  );
}
