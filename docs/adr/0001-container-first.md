# ADR-0001: Container-first experimental prototype
Status: Accepted for prototype only (2026-11-04)

Context: universal image compatibility cannot be achieved merely by adding a file extension.
Decision: ship a small Rust container codec before renderer or editor; keep wire format explicitly unstable.
Consequences: early releases validate and inspect files but cannot display interactive images. Avoid claiming production readiness.
Alternatives: SVG scripting, Rive runtime, HTML bundle, PNG ancillary chunks. Reevaluate after measured comparisons.
