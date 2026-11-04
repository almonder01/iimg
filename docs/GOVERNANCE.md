# Governance (provisional)

Maintainers are accountable for spec stability, security response, CI health and contributor review. Decisions should be public and documented except embargoed vulnerabilities.

- Routine bug fixes: one maintainer approval and green CI.
- Public API changes: two maintainers or one maintainer plus documented RFC review period.
- Wire-format/security-sensitive changes: RFC, threat-model update, two independent reviews, new fixtures, explicit compatibility decision.
- RFC process: proposal issue → `rfcs/NNNN-title.md` → 14-day minimum public comment for breaking changes → accepted/rejected ADR.
- Conflicts of interest must be disclosed; maintainers recuse themselves when appropriate.
- Maintainer appointments/removals and voting rules to be formalized before external governance.

Do not promise consensus or independence before a real contributor community exists.
