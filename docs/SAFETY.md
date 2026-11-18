# Safety

## What this is

Discharge Helper explains the user's own hospital discharge papers. It reads
what the user pastes, uploads as a PDF or photographs, shows the text for
correction first, and then produces: what changed in the medicines, a daily
timetable, a chemist sheet, the warning signs written in the papers, questions
for the doctor and a self-check quiz. Every output is traceable to a sentence
in the user's own papers.

## What this is not

- It does not diagnose anything.
- It does not recommend a medicine and does not advise a dose.
- It does not tell anyone to start or stop a medicine.
- It does not interpret an unclear line — an unclear line becomes a question.
- It is not a substitute for the user's care team.

## The safety checks it performs

All checks are deterministic rules, run by the safety auditor
(`src/engine/audit.ts`). None of them involve a model, a score or a judgement
call.

- **Look-alike / sound-alike names.** 12 pairs (for example
  hydrALAZINE/hydrOXYzine, predniSONE/prednisoLONE, clonazePAM/cloNIDine),
  each sourced from the FDA Name Differentiation Project and the ISMP List of
  Confused Drug Names, with the source URL recorded on every pair
  (`data/sources/reference.csv`, table `lasa`). Pairs are matched against both the name as
  written and the resolved ingredient, so a brand is flagged through its
  ingredient (Glycomet → metformin ↔ metronidazole), and a bounded near-prefix
  rule catches names that share their first five characters with a pair
  member. A match is shown to the user as "looks or sounds like … please
  confirm the exact medicine written for me".
- **Duplicate ingredient detection.** Two medicines under different brand
  names that contain the same ingredient (for example Dolo and Combiflam both
  containing paracetamol) produce the question: "Should I be taking both?"
- **ISMP error-prone abbreviations.** `QD`, `U`, `IU`, the trailing zero
  (`1.0 mg`), the missing leading zero (`.5 mg`) and `MSO4`, each with the
  action "ask to have this rewritten". Source: the ISMP List of Error-Prone
  Abbreviations, URL recorded on every entry.
- **High-alert double-check notes.** 14 classes from the ISMP high-alert list
  that appear on Indian discharge summaries (insulin, warfarin, heparin,
  enoxaparin, apixaban, rivaroxaban, dabigatran, clopidogrel, ticagrelor,
  morphine, methotrexate, potassium chloride, digoxin, theophylline). Each
  carries "double-check the dose with the pharmacist".
- **Missing detail questions.** A line with no frequency, no strength or no
  duration becomes a plain question ("the papers do not say how long to take
  it. How many days should I take it?").
- **Contradiction questions.** The same ingredient started and stopped, or two
  doses on one line, becomes a question.
- **Digit-checked names, strengths and numbers.** Drug names, strengths and
  numbers are copied from the papers as written. Digit repair happens only
  inside numbers (a letter `O` between digits becomes `0`), never inside a
  medicine name, and script digits (Devanagari, Telugu and others) are
  converted one-for-one.
- **Day-first dates.** Dates are parsed day-first, the Indian convention. When
  day and month could be swapped (both are 12 or less), the date is marked
  "please confirm" and never silently re-interpreted.

What it deliberately does not do: **no interaction checking and no dose-range
checking.** Those need a clinical knowledge service, not a rule set, and they
are listed as limits everywhere the product is described.

## The emergency line

The footer of every screen says: "In an emergency, call 112 right away — this
app is not a substitute for your care team."

112 is India's national emergency number, verified at the Ministry of Home
Affairs Emergency Response Support System page:
<https://www.mha.gov.in/en/divisionofmha/erss-0>. It is also listed as the
national emergency number for India at
<https://www.gov.uk/foreign-travel-advice/india/safety-and-security>.

## Privacy

- **No server receives the document.** Everything runs in the browser. The
  content security policy is strict (`connect-src 'self'`) so the app cannot
  call another site even by mistake, and the end-to-end suite asserts zero
  non-local requests. The Privacy screen shows the count of cross-origin
  requests live; the expected number is always 0.
- **Storage is encrypted at rest.** The working session (papers, before-list,
  settings) is stored in the browser's IndexedDB encrypted with Web Crypto
  AES-GCM. The key is auto-generated on the device and kept in a separate
  store, so a casual dump of the record store shows ciphertext, not a medicine
  list. This does **not** protect against someone with full control of the
  browser profile — they can read the key store too. That limit is stated here
  rather than hidden.
- **One-tap erase.** "Erase everything" removes both IndexedDB stores, all
  caches, the service worker registration and local storage, then reloads the
  app.
- **Share links never reach a server.** A shared chemist sheet is encoded into
  the URL fragment (after the `#`), which browsers do not send to any server.
  The receiving device renders it read-only and reads nothing from local
  storage to show it.
- **It collects no personal data, because it never receives any.** There is no
  account, no analytics and no telemetry.
- **No legal-compliance claims are made.** This is a reading aid, not a
  medical device, and no certification of any kind is claimed for it.

## Limits

The same honest list as the README:

- Handwriting is not supported. Typed or printed papers work best.
- Photo reading works best on printed pages, and the text is always shown for
  correction first.
- The medicine list is finite: 259 ingredients and 298 brands. Unknown drugs
  are flagged and copied exactly, not interpreted.
- Translations (Hindi, Telugu) are reviewed templates, not free translation.
- The evaluation is a regression measure on a synthetic corpus, not clinical
  validation.
- There is no interaction checking and no dose-range checking.
- Dates are read day-first, and ambiguous dates are flagged "please confirm".

## Security

### Reporting an issue

Report vulnerabilities through this repository's **Security** tab (GitHub
Security Advisories — "Report a vulnerability"). For anything that is not
sensitive, open a normal issue in the issue tracker. There is no security
email address; anyone asking you to email one is not from this project.

Please include: what you found, the steps or input to reproduce it, the
browser and version, and whether it needs the deployed site or a local build.

### The privacy model

The app is local-only. There is no backend, no database, no analytics and no
telemetry. The document the user adds is read, analysed and stored entirely in
the browser.

- **Content security policy.** The deployed headers set a strict CSP whose
  connection rule is `connect-src 'self'` — the app cannot call another site.
  Supporting headers: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`,
  `Permissions-Policy: camera=(self), microphone=(), geolocation=()` (the
  camera is used locally for photos of papers; the photo never leaves the
  device), `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`.
- **No external calls at runtime.** pdf.js and its worker are bundled and
  self-hosted. The text recogniser (Tesseract) is vendored under `public/ocr/`
  and loaded from this origin only — no CDN. Fonts are bundled, not fetched.
- **Service worker.** Registered only in production builds. It serves
  same-origin requests only: it precaches the app shell for offline use,
  falls back to the cached `index.html` for navigation, and never proxies or
  fetches cross-origin. `sw.js` itself is served with `Cache-Control: no-cache`
  so updates land; hashed assets under `/assets/` are immutable.
- **Visible proof.** The Privacy screen counts cross-origin requests live
  (expected: 0), and the end-to-end suite asserts zero non-local requests.

### Encrypted at rest, and its limits

The working session (papers, before-list, settings) is persisted in
IndexedDB, encrypted with Web Crypto:

- AES-GCM 256; the key is derived with PBKDF2-SHA256 at 600,000 iterations
  (current OWASP guidance for PBKDF2-SHA256); a random 16-byte salt; a fresh
  12-byte IV per record; the stored envelope is `{ v, salt, iters, iv, ct }`.
- The passphrase for that derivation is an auto-generated 256-bit device key,
  created on first use and kept in a separate IndexedDB store (`keys`) from
  the ciphertext (`records`). A casual dump of the records store shows
  ciphertext, not a medicine list.
- **Limits, stated plainly:** this does not protect against someone with full
  control of the browser profile — they can read the key store as well. It
  protects against casual plaintext dumps and nothing more. It is not a
  substitute for device encryption or a screen lock.
- **Erase everything** (one tap, with confirmation) deletes both IndexedDB
  stores, all Cache Storage entries, the service worker registration and
  local/session storage, then reloads the app.
- Intake limits: 200,000 characters per pasted text, files up to 25 MB.

### Share-link handling

A shared chemist sheet is carried entirely inside the URL:

- The sheet rows are serialised to canonical JSON, gzipped with the browser's
  `CompressionStream` (raw fallback), base64url-encoded, and placed in the URL
  **fragment** (`#/sheet/…`). Fragments are never sent to any server and do
  not appear in server logs or `Referer` headers.
- Decoding is validated with Zod before anything renders: 1–40 rows, strict
  per-field length caps, strict date patterns, and a hard limit of 8,000
  characters on the encoded string. Anything that fails validation renders an
  error page, not partial content.
- Everything rendered from the payload is escaped by React; there is no
  `innerHTML` path for share data.
- The shared view is read-only and reads nothing from the receiving device.
- The WhatsApp button composes a `wa.me` text share client-side; nothing is
  sent anywhere until the user confirms in WhatsApp. Users are reminded that
  the link contains the medicine list and to share it only with people they
  trust.

### Dependency policy

- All dependencies are pinned to exact versions, and `npm ci` installs from
  the lockfile. `npm audit` runs in CI.
- The runtime dependencies are only: `react`, `react-dom`, `pdfjs-dist`,
  `qrcode`, `zod` and the two `@fontsource` font packages. Everything else is
  a development dependency and ships nothing to the browser.
- No analytics, advertising or tracking scripts, in dependencies or in the
  app itself.
- When adding a dependency, justify it in the pull request: what it replaces,
  its licence, and whether it loads anything at runtime from another origin
  (it must not).
