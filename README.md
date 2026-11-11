# FusionLite Report

A Node.js service that, every day at **00:05 (Europe/Rome)**, reads the previous
day's data from FusionSolar and sends an email (in Italian) with:

- production, consumption, self-consumption, grid export and grid import;
- self-sufficiency and self-consumption share;
- peak power and specific yield;
- hourly power curve (production and consumption);
- battery (charge, discharge, estimated cycles);
- month total up to the report day and comparison with the average;
- costs/revenues, if prices are set in `.env`;
- notes and data source.

It is the companion service of the **FusionLite** Android app: it does not
modify the app and does not need it to work, because it performs its own login
to FusionSolar with the credentials specified in `.env`.

> Unofficial project, not affiliated with Huawei. Only use credentials and data
> you are entitled to use.

---

## Table of contents

- [FusionLite Report](#fusionlite-report)
  - [Table of contents](#table-of-contents)
  - [1. Requirements](#1-requirements)
  - [2. Installation](#2-installation)
  - [3. `.env` configuration](#3-env-configuration)
    - [Full example](#full-example)
    - [Fields](#fields)
    - [How to get `GMAIL_APP_PASSWORD`](#how-to-get-gmail_app_password)
  - [4. Commands](#4-commands)
  - [5. Automation with cron](#5-automation-with-cron)
  - [6. Logs and state](#6-logs-and-state)
  - [7. How it works](#7-how-it-works)
  - [8. Common problems](#8-common-problems)
  - [9. Privacy and security](#9-privacy-and-security)
  - [10. License](#10-license)

---

## 1. Requirements

- Node.js **≥ 20.11** (tested with Node 26; required for `import.meta.dirname`).
- A system with `cron` (Linux/macOS) or another scheduler.
- A Gmail account with 2-step verification enabled and an **app password**
  (see below).
- A FusionSolar account **without 2FA**: the service cannot enter a
  verification code.

---

## 2. Installation

```bash
git clone <repository-url> fusionlite-report
cd fusionlite-report
npm install
cp .env.example .env
chmod 600 .env
mkdir -p var
```

The Huawei CA is included in `ca/huawei_equipment_ca.cer`. It is needed because
the FusionSolar certificates have no SAN and use Huawei's internal PKI; without
this CA every request fails TLS verification.

Project structure:

```
.
├── bin/run.sh              wrapper for cron and manual use
├── ca/                     Huawei CA (public)
├── src/                    API client, model, HTML, email sending
├── var/                    state, logs and previews (ignored by git)
├── .env.example            configuration template
├── .gitignore
├── LICENSE
├── package.json
└── README.md
```

---

## 3. `.env` configuration

The file is read automatically: **`--env-file` is not needed**.

### Full example

```dotenv
# --- FusionSolar ---
FUSIONSOLAR_USER=user@example.com
FUSIONSOLAR_PASSWORD=your-fusionsolar-password
# FUSIONSOLAR_AUTH_HOST=intl.fusionsolar.huawei.com
# FUSIONSOLAR_AUTH_PORT=32800

# --- Plant (exact name as shown in the app) ---
PLANT_NAME=My plant
# PLANT_DN=NE=000000000

# --- Report ---
TIMEZONE=Europe/Rome
# REPORT_BUY_CENTS=25
# REPORT_SELL_CENTS=12
# REPORT_CURRENCY=€

# --- Gmail ---
GMAIL_USER=youremail@gmail.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
REPORT_TO=youremail@gmail.com
REPORT_TO_2=second@example.com
# MAIL_FROM=youremail@gmail.com
```

### Fields

| Variable | Required | Notes |
|---|---|---|
| `FUSIONSOLAR_USER` | yes | FusionSolar user |
| `FUSIONSOLAR_PASSWORD` | yes | FusionSolar password |
| `FUSIONSOLAR_AUTH_HOST` | no | default `intl.fusionsolar.huawei.com` |
| `FUSIONSOLAR_AUTH_PORT` | no | default `32800` |
| `APP_CLIENT_ID` | no | 32 hex characters; if empty it is generated in `var/state.json` |
| `PLANT_NAME` | yes* | plant name, case-insensitive comparison |
| `PLANT_DN` | yes* | alternative to the name, takes precedence |
| `TIMEZONE` | no | default `Europe/Rome` |
| `REPORT_BUY_CENTS` | no | purchase price in cents/kWh; enables the Costs section |
| `REPORT_SELL_CENTS` | no | selling price in cents/kWh |
| `REPORT_CURRENCY` | no | symbol used if the server does not return a valid one |
| `GMAIL_USER` | yes | sender Gmail account |
| `GMAIL_APP_PASSWORD` | yes | app password (16 letters) |
| `REPORT_TO` | yes | recipient; accepts multiple comma-separated addresses |
| `REPORT_TO_2` | no | second recipient |
| `MAIL_FROM` | no | default `GMAIL_USER` |

\* at least one of `PLANT_NAME` and `PLANT_DN`.

### How to get `GMAIL_APP_PASSWORD`

It is not your normal Google password.

1. Enable 2-step verification: <https://myaccount.google.com/security>
2. Go to <https://myaccount.google.com/apppasswords>
3. Choose "Other", name it `FusionLite Report`, and generate.
4. Paste the 16 letters into `GMAIL_APP_PASSWORD` (spaces are removed).

The `From` address is always `GMAIL_USER`: Gmail does not allow sending with a
different sender.

---

## 4. Commands

```bash
# check the configuration (shows masked values)
./bin/run.sh --check

# preview with fake data, no credentials, nothing sent
./bin/run.sh --demo --out var/report-preview.html

# download yesterday's real data, write the HTML, do NOT send
./bin/run.sh --dry-run --out var/report-real.html

# actually send yesterday's report (without updating the state)
./bin/run.sh --test-email

# send yesterday's report (normal)
./bin/run.sh

# retrieve a specific day
./bin/run.sh --date 2026-01-15 --force

# ignore the "already sent" check
./bin/run.sh --force

# verbose log
./bin/run.sh --dry-run --verbose
```

| Option | Meaning |
|---|---|
| `--demo` | demo data, no calls to FusionSolar |
| `--out FILE` | writes the HTML to `FILE` |
| `--dry-run` | generates but does not send (Gmail not required) |
| `--test-email` | sends immediately, does not update the state |
| `--date YYYY-MM-DD` | report for a specific day |
| `--force` | ignores "already sent" |
| `--catch-up` | sends only if yesterday's report is missing |
| `--to ADDRESS` | replaces the configured recipients |
| `--check` | checks `.env` |
| `--verbose` | verbose log |

Open `var/report-preview.html` or `var/report-real.html` in the browser to check
how the email looks.

---

## 5. Automation with cron

From the project folder, read the absolute path:

```bash
pwd
# example: /home/you/fusionlite-report
```

Then add the two lines with `crontab -e`, replacing
`/home/you/fusionlite-report` with the real path:

```cron
5 0 * * *  /home/you/fusionlite-report/bin/run.sh >> /home/you/fusionlite-report/var/report.log 2>&1
@reboot    /home/you/fusionlite-report/bin/run.sh --catch-up >> /home/you/fusionlite-report/var/report.log 2>&1
```

- `5 0 * * *` = 00:05 **system local time**. Check the time zone with
  `timedatectl` (or `date`); `TIMEZONE` in `.env` instead determines the
  boundaries of the report day.
- `@reboot --catch-up` covers the case where the machine was off at 00:05: if
  yesterday's report is missing and 00:05 has passed, it sends it at reboot.
- Verify with `crontab -l`.
- For a different time, change the `5 0`.
- The `var/` directory must exist before the first send (cron's redirect only
  creates the file if the folder exists): the repository includes
  `var/.gitkeep`.
- If `cron` cannot find Node (for example with `nvm`), set
  `NODE_BIN=/path/to/node` in the crontab or use the absolute path inside
  `bin/run.sh`.

---

## 6. Logs and state

- `var/report.log`: one JSON line per run, for example
  `{"ts":"…","date":"2026-01-01","plant":"…","kwh":12.4,"sent":true,"transport":"v1 GET","ms":1506}`.
- `var/state.json`: stable `appClientId` and `lastSentDate` (prevents duplicate
  sends). It does not contain credentials.
- `var/report-preview.html`, `var/report-real.html`: local previews.

`var/` is excluded from git: it may contain the plant name, consumption and
other personal data.

---

## 7. How it works

```
login (authentication host)
  → data host (regionFloatIp / regionList[0].regionIp)
  → station-list
  → energy-balance timeDim=2 (yesterday)   → kW series + kWh totals
  → energy-balance timeDim=4 (month)       → total up to the report day
  → HTML + text → Gmail SMTP 465
```

Important details, verified in the field:

- **`station-real-kpi` always returns today's values**, even when passing a past
  `queryTime`. For this reason the service **does not use it** for past days:
  the `energy-balance` totals are exact kWh and are correct for any date. The
  KPI is only called for the current day.
- The **day** series is power in **kW**; the `total*` fields are energy in
  **kWh**. In the report the curve is therefore in kW and the totals in kWh.
- The **month** series is daily energy (kWh) with `--` for days without data;
  the total is cut at the report day, so the average does not include today.
- `installedCapacity` is sometimes `0.0`: the real power is in
  `onlyInverterPower` and is used as a fallback.
- Some gateways reject the POST with **HTTP 405**: the service tries
  `v1 POST → v2 POST → v1 GET → v2 GET` and remembers the transport that works.
- TLS: the Huawei CA is pinned; the certificates have no SAN, so the same rule
  as the app applies (configured host, `fusionsolar.huawei.com`,
  `*.fusionsolar.huawei.com`, `*.energyorb.com`). Never trust-all.
- Expired session = 302 to `/unisess/v1/auth|logout`, or 401/403: the service
  logs in again once and repeats the request.
- `timeZone` in the API is the offset in hours **without** `+` (`"1"`, `"2"`,
  `"5.5"`), `timeZoneStr` is `Europe/Rome`, the `x-timezone-offset` header is
  `+0100`.

The report is in Italian; for another language, edit the texts in
`src/html.mjs`.

---

## 8. Common problems

The messages below are shown exactly as the program prints them (in Italian);
the English meaning is in parentheses.

| Message | What to do |
|---|---|
| `Login rifiutato: user.login.user_or_value_invalid` (login rejected) | wrong username/password in `.env` |
| `l'account richiede la verifica in due passaggi` (the account requires 2-step verification) | disable 2FA or use an account without 2FA |
| `Impianto non trovato. Impianti disponibili: …` (plant not found; available plants: …) | copy the name exactly into `PLANT_NAME` (or use `PLANT_DN`) |
| `Manca GMAIL_USER` (`GMAIL_USER` is missing) | fill in `GMAIL_USER` |
| `Invio non riuscito: Invalid login: 535-5.7.8` (sending failed) | `GMAIL_APP_PASSWORD` is not the app password |
| `Nessuna serie energetica disponibile` (no energy series available) | check `var/report.log`: it contains the HTTP status of each attempt |
| production `0,0` | a day without sun, or data not yet consolidated: try at 00:15 |
| report does not arrive | `crontab -l`, `var/report.log`, and `./bin/run.sh --check` |

---

## 9. Privacy and security

- `.env` contains the FusionSolar password and the Gmail app password: it must
  be `chmod 600` and must not be committed. `.gitignore` excludes it.
- `var/` is excluded from git: logs, state and previews may contain plant data.
- Logs do not contain passwords or tokens.
- The session is not saved to disk: a new login is performed on every run.
- The report is sent only to the addresses in `REPORT_TO` / `REPORT_TO_2`
  (or `--to`).
- The CA in `ca/` is the public certificate of the Huawei PKI, not a secret.

Before publishing a fork, make sure you have not added `.env`, `var/` or other
files containing personal data.

---

## 10. License

Distributed under the **MIT** license. See the [LICENSE](LICENSE) file.