# BYMA Snapshot previous-close policy

## Contract

For a BYMA trading session `D`, the historical price is Snapshot
`previous_close` observed on the following covered information date. The BYMA
Snapshot field contract defines `previous_close` as the previous closing price.
That documented meaning is the semantic basis; live observations separately
establish population, identity and information-date consistency.

The reviewed Snapshot reference is:
<https://jira-tecval.atlassian.net/wiki/external/NTQ0OTRmYzBlMTUzNGFlOTg1MTFkMzI2OWIzYTM1MTc>.

`Date` identifies the date of the returned Snapshot information. It is not
silently re-labelled as the effective close date. The effective
`valuationDate` is derived independently through the versioned BYMA trading
calendar. `broadcast_time` is retained only as provider trace when available;
it is not date evidence.

## Fail-closed rules

- all five requested groups must have one consistent `Date` equal to the
  derived `informationDate`;
- every required non-zero position must have one unambiguous, identity-valid,
  finite positive `previous_close`;
- AL30 ARS and AL30D USD must meet the same rules and produce a finite positive
  MEP ratio;
- `trade`, `trades`, `closing_price` and local prices never substitute a missing
  `previous_close`; and
- unknown calendar coverage or an existing incompatible daily snapshot blocks
  publication.
