# ADR-0001: Use a dependency-free Node local runtime

- Status: Accepted
- Date: 2026-09-05

## Context

TierForge's browser application was JavaScript while its local runtime was a large Python script.
Working on an Import required moving between two languages, and launching the application required
a separate Python installation even though Node was already the desired project runtime.

## Decision

Use Node 20 or newer for the local runtime and browser tooling. Keep the runtime dependency-free,
using built-in `http`, `fetch`, filesystem, and test modules. Preserve the existing Board format and
HTTP interface so saved Boards and browser behavior remain compatible.

The Import module owns remote-source parsing and image materialization behind one interface. The
server module owns local persistence and HTTP routing. Browser code remains framework-free.

## Consequences

- Contributors need one language and one runtime.
- `TierForge.cmd` becomes a thin `npm run serve` launcher.
- Import parsers are testable without starting the server.
- There is no dependency installation step beyond having Node available.
- A curl executable remains an optional fallback for hosts that reject Node's direct request.
