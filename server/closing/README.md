# Morning previous-close valuation

Production policy: `BYMA_SNAPSHOT_PREVIOUS_CLOSE`, version
`morning-previous-close-v1`.

## Business boundary

The historical portfolio is the sum of the portfolios stored in the top-level
`brokerPositions` collection. Loans, Activos, Reclus, loan movements, interest
and `nonBrokerAssets` are not inputs and contribute zero to this series. The
morning job never writes `brokerPositions`.

## Production flow

Vercel invokes `GET /api/portfolio-snapshot-morning` once on weekdays with
`0 13 * * 1-5` (10:00–10:59 ART on the current fixed UTC-3 offset). The internal
earliest cutoff is 10:00 ART, so the first possible Hobby invocation is valid.
There is no request-controlled date, mode, force or policy.

The route:

1. derives `informationDate` in `America/Argentina/Buenos_Aires`;
2. checks the versioned BYMA calendar;
3. resolves `valuationDate = previousTradingSession(informationDate)`;
4. reads only `brokerPositions`;
5. fetches all five BYMA Snapshot groups;
6. requires every group to expose the same `Date = informationDate`;
7. requires strict instrument identity and positive finite `previous_close` for
   every non-zero holding;
8. calculates MEP as `AL30 previous_close / AL30D previous_close`;
9. builds a complete brokers-only valuation in memory; and
10. creates `portfolioDailySnapshots/{valuationDate}` atomically if absent.

There are no intermediate Firestore writes. A retry with the same policy,
broker input hash and selected BYMA prices is a no-op. An existing manual,
different-policy or otherwise incompatible document is a closed conflict and is
never overwritten.

Authentication retains the prior production contract: exact bearer match when
`CRON_SECRET` exists; otherwise the exact Vercel Cron user agent is accepted
only in Production and only on the exact morning route.

## Calendar

`calendar.js` covers every date in 2026 using the reviewed BYMA calendar at
<https://www.byma.com.ar/mercado/calendario-bursatil>. It distinguishes:

- `TRADING`;
- `LIMITED_WITH_TRADING` for BYMA days without settlement but with trading; and
- `CLOSED` for weekends and no-trading holidays.

The metadata includes a version, covered year, source and review date. A needed
date outside the covered year is `CALENDAR_UNKNOWN` and fails closed. BYMA notes
that its calendar may be updated following official resolutions, so extending
or revising coverage requires a new reviewed version.

## Price and identity contract

Only numeric, finite `previous_close > 0` is eligible. `trade`, `trades`,
`closing_price` and cached local prices are ignored, including as fallback.
Exactly-zero holdings do not create a quote requirement; negative holdings do.

Identity remains strict for symbol/security ID, BYMA category, requested group,
currency, settlement `0002`, response market `CT` and operative form `C`.
Acciones and CEDEARs are not collapsed when the same symbol appears in both.
Fixed-income quotes retain their `PER_100_NOMINAL` unit.

Each official snapshot traces `informationDate`, `valuationDate`, calendar
metadata, policy, source, capture time, input hash, build ID, MEP legs and every
selected price/identity tuple.

## Retired night surface

The public capture and publish API files and both night crons were removed.
`pipeline.js`, the last-trade tests and `LAST_TRADE_POLICY.md` remain as an
unexposed rollback/audit record. `model.js` and `repository.js` also retain the
reviewed shared group/hash/number and Firestore REST primitives. The morning
route never invokes the old `runClose` or `createRepository` reconciliation
path. The generic Firestore REST store and existing broker valuation adapter
are reused.

## Verification

```text
npm run test:b1
npm test
npm run test:b1:firestore
npm run test:firestore
npm run build
npx eslint api/portfolio-snapshot-morning.js server/closing scripts/morning-byma-readonly.mjs test/b1/morning.firestore.test.js
git diff --check
```
