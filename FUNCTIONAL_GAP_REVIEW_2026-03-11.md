# Functional Gap Review (2026-03-11)

## Scope

- Runtime functional integrity for subtitle capture
- Cross-frame behavior and fallback continuity
- Persistence, export, and user-visible safety semantics

## Baseline Findings (Merged View)

This document consolidates the baseline functional review and the follow-up addendum.

| Priority | Topic | Current State |
|---|---|---|
| High | Observer message integrity | Mitigated by bridge token verification |
| High | Unconfirmed subtitle filter consistency | Mitigated across `.smi_word` and container fallback paths |
| Medium-High | Frame-forward nonce lifecycle | Mitigated by nonce rotation on tab navigation |
| Medium | Frame probing fallback overhead | Mitigated by adaptive backoff + cached frame-path probing |
| Medium | Invalidated extension context cleanup | Mitigated via explicit shutdown path |
| Medium | Subtitle row style computation cost | Mitigated via color normalization cache + bounded descendant checks |
| Low-Medium | Offscreen duplicate document create errors | Mitigated via tolerant already-exists handling |
| Low | Runtime-module regression detection | Improved with focused tests for probe/bridge paths |

## Implemented Remediation Map

| Area | Implemented In |
|---|---|
| Message token propagation and verification | `src/content/content-script.ts`, `src/content/injected-observer.ts`, `src/shared/message-types.ts` |
| Unconfirmed container fallback guard | `src/content/dom-probe.ts`, `src/content/injected-observer.ts` |
| Fallback backoff + cached target frame probe | `src/content/content-script.ts`, `src/content/frame-probe.ts` |
| Invalidated context shutdown lifecycle | `src/content/content-script.ts` |
| Offscreen creation robustness | `src/background/service-worker.ts` |
| Nonce rotation policy | `src/background/service-worker.ts` |
| Subtitle row performance tuning | `src/content/subtitle-rows.ts` |
| Added regression tests | `tests/dom-probe.test.ts`, `tests/frame-probe.test.ts`, `tests/injected-observer.test.ts` |

## Validation Status

Executed and passing:

- `npm run lint`
- `npm run typecheck`
- `npm run test:coverage`
- `npm run build`
- `npm run verify`

## Traceability Notes

- This file is the baseline functional index.
- Detailed addendum closure and per-item mapping are maintained in:
  - `FUNCTIONAL_GAP_REVIEW_ADDENDUM_2026-03-11.md`
  - `BUILD_ENV_FEATURE_REVIEW_2026-03-11.md`
