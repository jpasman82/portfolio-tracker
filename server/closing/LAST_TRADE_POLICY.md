# B1 daily last traded price - policy v3

Status: implementation for review, NOT DEPLOYED. No production writes or new
provider requests were needed for this policy change. Original checkout untouched.

## Business contract

The daily price is the eligible trade with the greatest cumulative operation count
observed by BYMA Snapshot in our post-wheel reconciliation window for that instrument
and valuationDate. This is NOT a
BYMA official close/fixing. It is not EOD and is not a carried prior price.

Source: BYMA_SNAPSHOT. Price policy: BYMA_SNAPSHOT_LAST_TRADE.
Policy/normalizer version: b1-snapshot-last-trade-v3. Version v2 is rejected rather
than silently reinterpreted because it selected the first eligible observation.

TRADE is VALID only if all of these hold:

- trade is a finite numeric value > 0.
- trades is a safe integer > 0. Zero operations cannot qualify a carried price.
- Date is a real YYYY-MM-DD date equal to valuationDate.
- Provider symbol/security_id, category/group, currency, settlement 0002,
  market CT and operativeForm C all match. Missing dimensions are NOT defaulted
  from the request. Identity disagreements reject the observation.
- The capture belongs to the same Argentine calendar date, a weekday, and is
  at or after the configured cutoff (reviewed minimum 18:00 ART).
- Durable reconstruction rechecks the policy, source, evidence and window;
  a persisted status=VALID alone is insufficient.

Missing/zero trade or zero operations is NO_TRADE (for a correctly dated/identified
row). An invalid/missing positive-operation count with a positive price is
UNKNOWN_TRADE_COUNT. Wrong session/identity has precedence over NO_TRADE.
Closing_price and previous_close are preserved as REFERENCE_ONLY with unknown
priceDate. Neither can fill a missing trade.

Exactly zero quantity excludes that asset from price requirements; positive and
negative quantities both require a daily price. Existing MEP requirements and
baseline exclusions/aliases remain unchanged. Negative positions are not dropped.
An obligatory NO_TRADE keeps the run PARTIAL and prevents publication. No automatic
last-known-price or stale-price policy is implemented.

## Date evidence and its limits

Primary source: [BYMA Market Data manual](https://jira-tecval.atlassian.net/wiki/external/NTQ0OTRmYzBlMTUzNGFlOTg1MTFkMzI2OWIzYTM1MTc),
Snapshot Equity and Fixed Income sections, inspected in B1A/B1B.

- DOCUMENTED: trade is the last execution price; trades counts operations;
  Date is the information day; broadcast_time is the latest update time.
- OBSERVED on 2026-09-15: Date was the current day in all five queried groups;
  positive trade/count pairs increased/changed intraday, while multiple rows
  had zero trades/price. GGAL went from trade 6775/count 3528 at 15:18 ART to
  6750/3876 at 15:53. POLL remained trade=0/trades=0 even with closing_price=298.
- BUSINESS INFERENCE: a correctly dated row with a positive operation count and
  trade is evidence of an execution in that information session. This is the
  minimum operational rule approved for the new series, NOT an exchange-certified
  per-execution timestamp or proof of an official fixing.
- broadcast_time is retained raw, not used to date the execution, prove market
  completion or require the instrument to have traded near closing time. POLL's
  observed time even moved from 09:25:09 to 09:25:05 without any trade.

The policy cannot detect a provider silently misdating a whole row while carrying
a positive trade AND counter. No separate execution date is present in the inspected
Snapshot schema. No historical API capability is implied. A later capture only
supersedes the selection when its valid cumulative operation counter is greater.

## Capture window

Production uses `0 21 * * 1-5` and `0 23 * * 1-5`: on Vercel Hobby these are
effective windows of approximately 18:00–18:59 and 20:00–20:59 ART. Internal
cutoffs are the start of each window (18:00 and 20:00), so every possible hourly
invocation is eligible. First attempt is post-wheel; second is retry/reconciliation.

Basis reviewed on 2026-09-16:

- User confirmed ordinary relevant trading ends at 17:00 ART.
- [BYMA communication 18835, dated 2025-09-23](https://www.byma.com.ar/comunicados/comunicado-18835)
  describes regular activity through 17:00 and a specific own-account fixed-income
  modality through 17:30. Its published effective-date sentence contains blanks;
  we do not manufacture an effective date. This supplements the user's current
  confirmation; it is not a guarantee against exceptional session extensions.
- Earlier [communication 18776](https://www.byma.com.ar/comunicados/comunicado-18776)
  described a 19:00 extension and is modified by 18835. We do not use the older
  extension as today's timetable. Both were read as independent official documents.

Minimum cutoff 18:00 leaves 60 minutes after the user-confirmed ordinary end and
30 minutes after the specific modality described above. These are operational
margins, not claims of a BYMA data-ready SLA.
The code accepts later invocations on the same ART day, not only an exact cron minute.

PORTFOLIO_CAPTURE_CUTOFF_ART remains available to lower-level diagnostic callers,
but the production HTTP routes pin it to 18:00 so an inherited environment value
cannot move the cutoff inside the Hobby invocation window. A changed policy in an
existing durable run is still rejected as CAPTURE_POLICY_MISMATCH. No automatic
exchange calendar or emergency-extension detector is claimed by this change.

Pre-window invocation is rejected before lease, input freeze, BYMA or Firestore
writes. A capture crossing midnight ART is rejected for that valuationDate.
No date override, backfill or automatic previous-session recovery is added.

## Durable retry contract

Keep marketPriceRuns, immutable observations, frozen inputs, lease/CAS, idempotent
commits and atomic publication. Do not delete observations between attempts.

1. Reconcile eligible durable observations with successful group checkpoints
   before requesting the provider again.
2. Query every group required by frozen inputs on every reconciliation attempt,
   including requirements that already have a selection.
3. Persist each response's observations, then checkpoint its group.
4. For one quote identity, select the eligible observation with greatest `tradeCount`.
   A later capture replaces the selection only when its positive counter is greater.
5. Equal counter and equal price is a no-op. A lower later counter is preserved as
   evidence and classified TRADE_COUNT_REGRESSION without moving backwards.
   Equal counter with different prices is TRADE_COUNT_PRICE_CONFLICT: retain the
   prior selection as evidence, mark the requirement missing/PARTIAL and forbid
   publication until a unique greater counter resolves it. Invalid observations
   never compete, regardless of their counter.
6. Missing/no-trade remains PARTIAL; newly eligible missing trades can complete it.
7. Build from durable evidence, then atomically publish only when all required
   prices (including both same-day MEP legs) and frozen inputs are valid.

The policy version is bumped: v1/v2 runs fail POLICY_VERSION_MISMATCH, not silently
reinterpreted. No data migration or automatic overwrite of old history is included.
If a process dies before any durable write, that response can still be lost.

## Metadata and compatibility

Observation includes priceType=TRADE, source=BYMA_SNAPSHOT, valuationDate,
priceDate, providerDate, tradeCount, capturedAt, cutoff, identity, policy and evidence.
The snapshot adds pricePolicy, priceSource, dailyPriceDefinition and priceObservations
with selected observation references, dates, counts and capture times.
The legacy UI payload/calculations and its source field remain compatible. Existing
history is neither rewritten nor relabeled. The UI may still display 'cierre', but
the metadata and documentation unambiguously describe daily last traded price.

There is no automatic or request-selectable legacy fallback. Production uses two
explicit routes: the 18:00 ART window always passes `publish: false`; the 20:00 ART
route reconciles again and passes `publish: true`. The client no longer exports or
invokes `saveDailyPortfolioSnapshot`. Authenticated users retain read access to
`portfolioDailySnapshots/**`, but Firestore rules deny client create/update/delete.
Manual references use the separate `portfolioManualBaselines/**` collection and
cannot overwrite the official daily document.

## Preserved B1A/B1B findings / EOD

EOD: NOT REQUIRED FOR CURRENT BUSINESS POLICY. Do not request scopes/entitlement
as part of this policy. No credentials, subscription or product changes.

B1A: Snapshot closing_price was not homologated as official close. At 15:18 and
15:53 ART on 2026-09-15 POLL had closing_price=previous_close=298, trade=trades=0.
Other seven sampled instruments had closing_price=0. This remains diagnostic
evidence and POLL is now explicitly NO_TRADE, not a usable daily-price substitute.

B1B (2026-09-16): scope eod.read request returned HTTP 400, provider error 401,
without token at 13:54:37 UTC; control snapshot.read returned HTTP 200 and that
scope at 13:55:03 UTC. Earlier EOD GETs with snapshot.read returned 403 in five
groups. This does not establish absence of contractual entitlement. No historical
date parameter/retention guarantee was verified; EOD can remain a future comparison
source, not a prerequisite of current business policy.

## Verification

Production-policy unit tests cover eligibility, missing/zero/invalid price/count,
wrong date/identity, signed quantities, positive prices surviving PARTIAL, retry,
restart before/after group checkpoints, ambiguity, rollover/cutoff, metadata and
strict durable reconstruction. Existing tests retain atomicity, lease fencing,
duplicate/uncertain ACK handling, frozen inputs and no overwrite of existing history.
The localhost demo Firestore suite exercises the real REST/CAS adapter and rules.

fixtures/snapshot-2026-09-15.js contains actual sanitized intraday excerpts for
GGAL, YPFD, POLL, AAPL, SPY, AL30, AL30D and AL30C. Their actual capture timestamp
is rejected as pre-cutoff. Tests simulating a post-cutoff timestamp do NOT claim
that a real post-close capture occurred. As of 2026-09-16 12:15 ART, real post-cutoff
validation for that date is PENDING; this implementation does not wait or fabricate it.
