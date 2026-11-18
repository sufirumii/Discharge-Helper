/**
 * Home (#/) — hero with the tagline, the two entry buttons, the privacy
 * promise, "Why this matters" (India evidence first, every claim with its
 * source and verification label) and the three-step how-it-works.
 */

import { useStore } from "../store";
import { navigate } from "../router";
import { Button, Card } from "../components";
import { STATISTICS } from "@/domain/statistics";
import { SAMPLES } from "@/sample";
import { t } from "@/i18n";

export function Home() {
  const { state, loadSample } = useStore();
  const lang = state.options.language;

  const trySample = () => {
    if (SAMPLES.length > 0) loadSample(SAMPLES[0].id);
    navigate("/add");
  };

  return (
    <>
      <section className="dh-hero">
        <h1>{t("ui.app.name", lang)}</h1>
        <p className="dh-hero-lead">{t("ui.app.tagline", lang)}</p>
        <div className="dh-hero-actions">
          <Button size="lg" onClick={trySample}>
            {t("ui.home.trySample", lang)}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate("/add")}>
            {t("ui.home.addPapers", lang)}
          </Button>
        </div>
        <p className="dh-privacy-promise">🔒 {t("ui.home.privacyPromise", lang)}</p>
      </section>

      <h2>{t("ui.home.how", lang)}</h2>
      <div className="dh-steps">
        <Card title={t("ui.home.step1.t", lang)}>
          <p>{t("ui.home.step1.b", lang)}</p>
        </Card>
        <Card title={t("ui.home.step2.t", lang)}>
          <p>{t("ui.home.step2.b", lang)}</p>
        </Card>
        <Card title={t("ui.home.step3.t", lang)}>
          <p>{t("ui.home.step3.b", lang)}</p>
        </Card>
      </div>

      <Card title={t("ui.home.why", lang)} tone="accent" as="section">
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
    </>
  );
}
