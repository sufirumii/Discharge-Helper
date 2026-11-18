/**
 * ics — deterministic iCalendar generation for the day plan, refill dates,
 * follow-up appointments and the 48-hour check-in event. Validated by unit
 * tests. Every event carries the "not a substitute for your care team" line.
 */

import type { DayPlan, FollowupItem } from "@/engine/types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function icsDate(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  // RFC 5545: lines longer than 75 octets fold with CRLF + space.
  if (line.length <= 73) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    parts.push(rest.slice(0, 73));
    rest = " " + rest.slice(73);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export interface IcsEvent {
  uid: string;
  /** Local day the event belongs to. */
  day: Date;
  /** "08:00" 24h local time. */
  startHHMM: string;
  durationMinutes: number;
  title: string;
  description: string;
}

export function buildIcs(events: IcsEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Discharge Helper//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const e of events) {
    const [h, m] = e.startHHMM.split(":").map(Number);
    const start = new Date(e.day.getFullYear(), e.day.getMonth(), e.day.getDate(), h || 0, m || 0);
    const end = new Date(start.getTime() + e.durationMinutes * 60_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const FORTY_EIGHT_HOUR_CHECKIN = {
  title: "48-hour check-in: how is the plan going?",
  description:
    "Two days after discharge: look at your medicine plan, note anything confusing or new, and write down questions for your pharmacist or doctor. If any warning sign from your papers appeared, follow the papers' instructions.",
};

export interface IcsOptions {
  /** Day the timetable starts (defaults to tomorrow). */
  fromDay: Date;
  /** How many days of the timetable to emit (default 2). */
  days?: number;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Build the downloadable calendar: timetable days, refills, follow-ups, 48h check-in. */
export function planToIcs(
  plan: DayPlan,
  followups: FollowupItem[],
  opts: IcsOptions,
): string {
  const events: IcsEvent[] = [];
  const days = opts.days ?? 2;

  for (let d = 0; d < days; d++) {
    const day = addDays(opts.fromDay, d);
    for (const s of plan.slots) {
      if (!/^\d{2}:\d{2}$/.test(s.time)) continue; // "when needed" is not a clock event
      events.push({
        uid: `dose-${s.medId}-${s.time}-${day.getTime()}@discharge-helper`,
        day,
        startHHMM: s.time,
        durationMinutes: 15,
        title: `Take ${s.medName}${s.doseText ? ` (${s.doseText})` : ""}`,
        description:
          `From your discharge papers: ${s.doseText}.` +
          (s.withFood ? " Take with food." : "") +
          (s.prn ? " Only if needed." : "") +
          " Discharge Helper: not a substitute for your care team.",
      });
    }
  }

  for (const r of plan.refills) {
    if (!r.refillDate) continue;
    const day = parseISODate(r.refillDate);
    if (!day) continue;
    events.push({
      uid: `refill-${r.medId}-${r.refillDate}@discharge-helper`,
      day,
      startHHMM: "10:00",
      durationMinutes: 15,
      title: `Buy more ${r.medName} (about ${r.days} days)`,
      description: `Your papers cover about ${r.days} days. Buy the next supply a few days before it runs out. Not a substitute for your care team.`,
    });
  }

  for (const f of followups) {
    if (!f.date) continue;
    const day = parseISODate(f.date.iso);
    if (!day) continue;
    events.push({
      uid: `followup-${f.kind}-${f.date.iso}@discharge-helper`,
      day,
      startHHMM: "10:00",
      durationMinutes: 30,
      title: f.kind === "test" ? "Pending test from your papers" : "Follow-up visit from your papers",
      description: `${f.text}${f.date.ambiguous ? " (Date read as day-first — please confirm.)" : ""} Not a substitute for your care team.`,
    });
  }

  const checkinDay = addDays(opts.fromDay, 1);
  events.push({
    uid: `checkin-48h-${checkinDay.getTime()}@discharge-helper`,
    day: checkinDay,
    startHHMM: "10:00",
    durationMinutes: 20,
    title: FORTY_EIGHT_HOUR_CHECKIN.title,
    description: FORTY_EIGHT_HOUR_CHECKIN.description,
  });

  return buildIcs(events);
}

/** Filename-safe label. */
export function icsFilename(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${s || "plan"}.ics`;
}
