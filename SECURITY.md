# Security Policy

See the [candidate security model](docs/SECURITY-MODEL.md) for input boundaries, evidence and open review items.

The project is an experimental parser for untrusted files. **Do not use it as a security boundary in production.**

Please report vulnerabilities privately using GitHub's **Report a vulnerability** / private security advisory feature once enabled by the repository owner. If unavailable, do not publish exploit files publicly; request a private reporting channel from maintainers in a non-sensitive issue.

Scope: parsing, integer overflow, memory/resource exhaustion, unsafe rendering, state machine escape, dependency compromise, malicious fixtures, CI supply chain.

Triage targets (provisional): acknowledge within 72 hours; initial severity assessment within 7 days; coordinate patch and disclosure according to impact. These are goals, not guarantees.

Do not include real user data or secrets in reports. Security fixes require regression tests and a documented advisory when appropriate.
