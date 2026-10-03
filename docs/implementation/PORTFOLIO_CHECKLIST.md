# Portfolio completion checklist

Reviewed 2026-10-03 from clean remote `7c52b0c67d0b4a5be001038d673cb47cc25c16d0`.
This finite checklist supplements, and does not replace, the complete master
contract or the G01–G16 release gates. Overall status remains **INCOMPLETE / NO_GO**.

## Product presentation and navigation

- [ ] One shared customer/administrator shell; no DOM-injected navigation
- [ ] Coherent Bad Penny typography, colour, hierarchy and synthetic-money labelling
- [ ] Usable desktop, tablet, mobile and keyboard navigation, including Back/Forward
- [ ] Wallet references fully visible and copyable without pointer-only tooltips
- [ ] Financial review cancellation leaves no command and preserves form input
- [ ] Same-wallet transfer/payment caught before review regardless of reference case
- [ ] Empty, loading and service failures do not suggest financial success
- [ ] Actual rendered screenshots inspected, with their fixture limitations recorded
- [x] Type checks, 187 client checks and production frontend build pass

## Functional correctness and independent evidence

- [ ] Ordinary Java/core checks pass on the candidate
- [ ] Exact-source real PostgreSQL/RabbitMQ and browser regression passes in CI
- [ ] Existing fault lab independently reaches its current bounded verified scope
- [ ] Full F01–F08 / D01–D24 catalogue completed and independently verified
- [ ] P10 contracts, security, reference performance, migration and restore gates pass
- [ ] P11 final exploratory reports and real demonstration video exist
- [ ] Source and latest evidence are published and verified on main

## Current execution capability

A single clean checkout on the assistant's cloud computer is used. Java 21,
Node/npm and system Chromium are available. Docker/Compose and the `javac` executable are absent. Chromium launch is blocked by the executor socket restriction, including one supported escalation retry. Local
presentation tests run the shipped React UI against explicit HTTP fixtures; they
prove only browser/UI behaviour, never economic outcomes or real integration.
The existing GitHub workflow supplies the genuine product/lab boundary. No
workflow gate is weakened and no deployment or paid service is part of this pass.

Finishing the presentation checklist alone is not completion of the financial
reliability laboratory. Historical passes retain their original source identities.
