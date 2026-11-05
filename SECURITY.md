# Security Policy

See the [candidate security model](docs/SECURITY-MODEL.md) for input boundaries, evidence and open review items.

The project is an experimental parser for untrusted files. **Do not use it as a security boundary in production.**

Report vulnerabilities privately through GitHub's [Report a vulnerability](https://github.com/almonder01/iimg/security/advisories/new) form. Private vulnerability reporting is enabled for this repository.

Scope: parsing, integer overflow, memory/resource exhaustion, unsafe rendering, state machine escape, dependency compromise, malicious fixtures, CI supply chain.

Triage targets (provisional): acknowledge within 72 hours; initial severity assessment within 7 days; coordinate patch and disclosure according to impact. These are goals, not guarantees.

Do not include real user data or secrets in reports. Security fixes require regression tests and a documented advisory when appropriate.
