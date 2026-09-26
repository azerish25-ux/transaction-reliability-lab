# Human review and unperformed automation

## Better suited to human judgment (not performed)

The clarity of uncertain-money messaging, confidence in a refund/reversal decision, readability under low vision, screen-reader navigation, complex keyboard ergonomics and an interviewer's understanding of the evidence need human review. Automated string/role/focus/axe tests can partially support these questions but do not establish full accessibility or user trust. No human participant, screen-reader audit or manual browser session is claimed.

Review triggers include authentication or monetary form changes, new languages/currencies, modal/error-flow redesigns, policy changes affecting compensation, and evidence UI changes that could confuse a historical run with current live status.

## Mandatory automation still missing, not discretionary exclusions

Database invariant and process-concurrency tests; live API/JWT/CSRF/access-control regression; broker/manual-ACK recovery; durable webhook delivery/signatures/restarts; scheduling occurrence races/DST; Pact provider/message verification; browser/axe/ZAP; all infrastructure faults and full-stack defect experiments; upgrade/restore; reference performance and post-load reconciliation. These remain mandatory and fail the corresponding release gates. They are not listed as human-only merely because execution is blocked.

## Cost/benefit

Fast deterministic component cases are useful feedback and execute here without dependencies. Real infrastructure tests cost more but are necessary for properties those components cannot prove. Do not replace PostgreSQL with H2, broker redelivery with a duplicate function call, worker death with a Java exception or human usability with a screenshot.
