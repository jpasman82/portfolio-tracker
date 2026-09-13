# Loan engine v1

This directory contains a pure, deterministic, date-only loan valuation engine. It has no dependency on React, Firebase, broker valuation, market prices, or portfolio snapshots.

## Numeric policy

- Financial arithmetic uses `decimal.js` with 40 significant digits and `ROUND_HALF_UP` as the configured rounding mode.
- The engine does not round balances at capitalization boundaries or round monetary output to cents.
- Monetary outputs are canonical decimal strings. A presentation layer may round those strings to two decimal places; that rounding is intentionally outside this module.
- `calculationVersion` must be `loan-v1`, so future convention changes can be introduced without silently changing historical results.

## Date and interest policy

- Contract dates are strict `YYYY-MM-DD` calendar dates and are never interpreted in the browser's local timezone.
- Monthly boundaries retain the original start-day anchor. A missing day is clamped to month-end, and the original anchor is retried the following month.
- The effective monthly rate is prorated exponentially within each period: `(1 + r)^(d / D)`.
- `monthly_effective` is native. `annual_effective` is converted to its equivalent monthly effective rate with `(1 + annualRate)^(1 / 12) - 1`. TNA is unsupported in v1.
- At a capitalization boundary, the previous period is closed and capitalized before movements effective on that date are applied.
- Interest stops at `maturityDate`, including when maturity is inside a monthly period.

## Movements and output definitions

Contributions and withdrawals are positive amounts whose sign is determined by their type. Movements are ordered by date, with contributions before withdrawals on the same date. A withdrawal first consumes accrued, uncapitalized interest and then capitalized balance. It fails if it exceeds the total value available on its effective date.

`calculateLoanAtDate` returns:

- `asOfDate`: requested valuation date.
- `valuationDate`: effective calculation date, capped at maturity.
- `currency`: normalized loan currency.
- `netCashFlow`: contributions minus all withdrawals through `valuationDate`.
- `capitalizedBalance`: balance already capitalized, plus contributions, less the principal portion of withdrawals.
- `accruedInterest`: current-period interest earned but neither capitalized nor withdrawn.
- `totalInterestGenerated`: cumulative interest generated, including interest already withdrawn; defined as `value - netCashFlow`.
- `value`: amount still held in the loan at `valuationDate`.
- `lastCapitalizationDate`: latest completed contractual capitalization boundary, or `null`.
- `nextCapitalizationDate`: next contractual capitalization boundary at or before maturity, or `null`.
- `matured`: whether the requested `asOfDate` is on or after maturity.

These definitions preserve both accounting identities even after withdrawals:

`value = netCashFlow + totalInterestGenerated`

`value = capitalizedBalance + accruedInterest`

`projectLoanToMaturity` ignores movements dated after `asOfDate`, assumes no new future movements, and returns the projected maturity value plus the additional interest from the current value to maturity.
