/**
 * Chemist sheet (#/sheet and #/sheet/<payload>) — the builder shows the sheet
 * from the latest result with print / copy / WhatsApp / QR / link actions.
 * The shared route decodes the payload from the link fragment and renders the
 * same table read-only. The sheet stays in English on purpose (chemists read
 * English and salt names); a small note in the patient's language says so.
 */

import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useRoute } from "../router";
import { Button, Card, Dialog, DeviceReadChip, EmptyState } from "../components";
import { t } from "@/i18n";
import QRCode from "qrcode";
import { MAX_PAYLOAD_CHARS, decodeSheetPayload, encodeSheetPayload, payloadToSheet, sheetFragmentUrl, whatsappText, whatsappUrl } from "@/share/payload";
import type { ChemistSheet } from "@/engine/types";
import { copyText } from "../lib";

export function Sheet() {
  const route = useRoute();
  const enc = route.path.startsWith("/sheet/") ? route.path.slice("/sheet/".length) : null;
  if (enc) return <SharedSheet enc={decodeURIComponent(enc)} />;
  return <SheetBuilder />;
}

// ────────────────────────────────────────────────────────────────────────────
// Builder (needs a result)

function SheetBuilder() {
  const { state, toast } = useStore();
  const lang = state.options.language;
  const result = state.result;

  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  if (!result) return <EmptyState />;
  const sheet = result.sheet;

  const ensureLink = async (): Promise<string> => {
    if (link) return link;
    const enc = await encodeSheetPayload(sheet);
    const url = sheetFragmentUrl(enc);
    setLink(url);
    return url;
  };

  const copySheetText = async () => {
    const ok = await copyText(whatsappText(sheet));
    toast(ok ? "success" : "error", ok ? t("ui.sheet.copied", lang) : t("ui.sheet.copyFailed", lang));
  };

  const copyLink = async () => {
    try {
      const url = await ensureLink();
      const ok = await copyText(url);
      toast(ok ? "success" : "error", ok ? t("ui.sheet.linkCopied", lang) : t("ui.sheet.copyFailed", lang));
    } catch {
      toast("error", t("ui.sheet.linkFailed", lang));
    }
  };

  const openQr = async () => {
    setQrOpen(true);
    setQrDataUrl(null);
    setQrError(null);
    try {
      const url = await ensureLink();
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "L" });
      setQrDataUrl(dataUrl);
    } catch {
      setQrError(t("ui.sheet.qrTooLong", lang));
    }
  };

  return (
    <>
      <h1 className="dh-no-print">{t("ui.sheet.title", lang)}</h1>
      <p className="dh-hint dh-no-print">{t("ui.sheet.englishNote", lang)}</p>
      <p className="dh-device-row dh-no-print">
        <DeviceReadChip />
      </p>

      <div className="dh-print-only">
        <p className="dh-print-title">Discharge Helper — chemist sheet</p>
      </div>

      <SheetTable sheet={sheet} />

      <div className="dh-sheet-actions dh-no-print">
        <Button onClick={() => window.print()}>{t("ui.sheet.print", lang)}</Button>
        <Button variant="secondary" onClick={() => void copySheetText()}>
          {t("ui.sheet.copy", lang)}
        </Button>
        <a
          className="dh-btn dh-btn-secondary"
          href={whatsappUrl(whatsappText(sheet))}
          target="_blank"
          rel="noreferrer"
        >
          {t("ui.sheet.whatsapp", lang)}
        </a>
        <Button variant="secondary" onClick={() => void openQr()}>
          {t("ui.sheet.qr", lang)}
        </Button>
        <Button variant="secondary" onClick={() => void copyLink()}>
          {t("ui.sheet.copyLink", lang)}
        </Button>
      </div>

      <p className="dh-hint dh-no-print">{t("tpl.sheet.note", lang)}</p>

      <blockquote className="dh-sheet-footer">{sheet.footer}</blockquote>

      <Dialog open={qrOpen} onClose={() => setQrOpen(false)} title={t("ui.sheet.qr", lang)}>
        {qrDataUrl ? (
          <p className="dh-qr">
            <img src={qrDataUrl} alt={t("ui.sheet.qrAlt", lang)} width={320} height={320} />
          </p>
        ) : qrError ? (
          <p className="dh-warn-line">{qrError}</p>
        ) : (
          <p className="dh-busy-row" role="status" aria-live="polite">
            <span className="dh-spinner" aria-hidden>
              <span className="dh-spinner-dot" />
            </span>
            <span>{t("ui.sheet.qrWorking", lang)}</span>
          </p>
        )}
        <p className="dh-hint">{t("tpl.sheet.note", lang)}</p>
        {link ? (
          <p className="dh-qr-link">
            <span className="dh-qr-link-text">{link.length > MAX_PAYLOAD_CHARS ? link.slice(0, 120) + "…" : link}</span>
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared sheet (read-only, from a link fragment)

function SharedSheet({ enc }: { enc: string }) {
  const { state } = useStore();
  const lang = state.options.language;
  const [sheet, setSheet] = useState<ChemistSheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const payload = await decodeSheetPayload(enc);
        if (alive) setSheet(payloadToSheet(payload));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [enc]);

  if (error) {
    return (
      <>
        <h1>{t("ui.sheet.title", lang)}</h1>
        <Card tone="changed" title={t("ui.sheet.invalid", lang)}>
          <p>{error}</p>
          <p>
            <a href="#/">{t("ui.sheet.backHome", lang)}</a>
          </p>
        </Card>
      </>
    );
  }

  if (!sheet) {
    return (
      <>
        <h1>{t("ui.sheet.title", lang)}</h1>
        <p className="dh-busy-row" role="status" aria-live="polite">
          <span className="dh-spinner" aria-hidden>
            <span className="dh-spinner-dot" />
          </span>
          <span>{t("ui.sheet.opening", lang)}</span>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{t("ui.sheet.title", lang)}</h1>
      <p className="dh-readonly-banner" role="note">
        🔒 {t("ui.sheet.readonly", lang)}
      </p>
      <div className="dh-print-only">
        <p className="dh-print-title">Discharge Helper — chemist sheet</p>
      </div>
      <SheetTable sheet={sheet} />
      <blockquote className="dh-sheet-footer">{sheet.footer}</blockquote>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// The table itself (English by design)

function SheetTable({ sheet }: { sheet: ChemistSheet }) {
  return (
    <div className="dh-sheet">
      <p className="dh-sheet-dates">
        <strong>Prepared:</strong> {sheet.date}
        {sheet.dischargeDate ? (
          <>
            <span aria-hidden> · </span>
            <strong>Discharge date:</strong> {sheet.dischargeDate}
          </>
        ) : null}
      </p>
      <div className="dh-tablewrap dh-sheet-tablewrap" tabIndex={0}>
        <table className="dh-table dh-sheet-table">
          <thead>
            <tr>
              <th scope="col">Salt</th>
              <th scope="col">Brand as written</th>
              <th scope="col">Strength</th>
              <th scope="col">Form</th>
              <th scope="col">Dose</th>
              <th scope="col">Frequency</th>
              <th scope="col">Days</th>
              <th scope="col">Units needed</th>
              <th scope="col">Notes / Flags</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r) => (
              <tr key={r.medId}>
                <td>{r.salt}</td>
                <td>
                  <strong>{r.brandAsWritten}</strong>
                </td>
                <td>{r.strength}</td>
                <td>{r.form}</td>
                <td>{r.dose}</td>
                <td>{r.frequency}</td>
                <td>{r.days}</td>
                <td>{r.unitsNeeded}</td>
                <td>
                  {r.notes ? <p className="dh-sheet-note">{r.notes}</p> : null}
                  {r.flags.length > 0 ? (
                    <ul className="dh-sheet-flags">
                      {r.flags.map((f, i) => (
                        <li key={i} className="dh-chip dh-chip-warn">
                          {f}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
