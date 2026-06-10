# Security Policy

## Reporting a vulnerability

Email: **security@ratingcount.ai**
Also accepted: [GitHub Private Vulnerability Reporting](https://github.com/ratingCount/ratingCount-contracts/security/advisories/new)

We do **not** run a paid bug bounty program. Disclosure is ad-hoc and handled directly. If you report something material that materially improves the contracts, we'll credit you (with your consent) in release notes.

For anything exploitable against the live mainnet contracts, please use one of the private
channels above — do **not** open a public GitHub issue first.

## Scope

- Contracts in [contracts/](./contracts/) as deployed on Ethereum mainnet (chainId 1):
  - `RatingCountAI` (RATE token) — `0x14969077E80B0696aCC89db8D1ad2E1dC3a175E6`
  - `FairLaunchSale` — `0xce03e154329e1d962667D5B51d4eE2aCc543AA25`
  - `VestingManager` — `0x52e1293Ff5621A135Ec884031bD8933Dbc605bdf`
- Test suite + scripts in this repo

Out of scope:
- The ratingCount website, backend, and operational infrastructure (separate private repo)
- Third-party dependencies (report upstream)
- Documented owner capabilities: the contracts are owner-controlled by design, and every
  owner power is enumerated in
  [README → Security & Launch Facts](./README.md#admin-capabilities--the-exact-list).
  "The owner can do X" is only a finding if X is **not** on that list.

## Response expectations

- Acknowledgement within 72 hours
- Triage within 1 week
- For confirmed material issues: fix and disclosure plan within 30 days of triage

## Disclosure preferences

Coordinated. Tell us before going public; we'll work with you on timing.
