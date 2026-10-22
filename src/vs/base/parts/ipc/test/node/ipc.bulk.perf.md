# Bulk JSON IPC performance experiment (2026-10-22)

These standalone measurements used the runtime's default 64 KiB Buffer pool. Linux VS Code sets an 8 KiB pool in `src/bootstrap-node.ts`; in particular, legacy buffer-transport comparisons must be remeasured with that policy. Full packaged smoke runs use the actual bootstrap.

Bulk DTOs use the legacy JSON contract without recursively reading property descriptors across the entire object graph. Payloads with at least 32 enumerable properties inspect their immediate children for native binary or rich values before choosing JSON. Sparse arrays, named array properties, direct native values, cycles and bigint still use the graph path. Smaller payloads retain the recursive eligibility check.

This deliberately trades exact nested structured-clone semantics for speed on bulk DTOs: nested aliases become independent JSON values, nested native objects follow their JSON representation, and custom getters or `toJSON` can run. It is not a universal structured-clone replacement. The normal channel contract historically used JSON for object payloads; URI DTOs still revive through the existing channel layer. Tests cover bulk URI arrays, direct binary values, cycles, sparse arrays and named binary properties.

## Local native MessagePort measurements

Compare `bda3e03a85c7985e6edf55acaa40be6091a8df4b` with the candidate runtime source identified by SHA-256 in `ipc.bulk.perf.results.json`. Both modules use the same current dependencies, Node v24.22.0 and native worker-thread MessagePorts. Eight blocks run strict eligibility, bulk eligibility and legacy buffer transport once each in randomized order (LCG seed 3212232, multiplier 1664525, increment 1013904223, unsigned 32-bit state; Fisher–Yates shuffle). Each process warms each fixture with 200 calls and measures three batches of 1,000 sequential echo round trips. Initial and final values are asserted. No retries, exclusions or outlier removal are applied.

The table reports medians of all 24 batch samples in microseconds per complete round trip. Background activity is uncontrolled; small differences are exploratory, with no statistical-significance claim. These are module benchmarks and do not establish a full smoke-suite improvement.

| Fixture | Strict µs | Bulk µs | Change | Buffer µs |
| --- | ---: | ---: | ---: | ---: |
| primitive | 17.30 | 17.08 | -1.3% | 69.40 |
| small-object | 28.62 | 29.38 | +2.7% | 61.92 |
| settings-100 | 430.95 | 231.46 | -46.3% | 257.20 |
| stat-object | 21.81 | 22.24 | +1.9% | 63.86 |
| directory-100 | 233.44 | 86.69 | -62.9% | 330.89 |
| keys-1000 | 578.84 | 292.35 | -49.5% | 1507.82 |
| text-4KiB | 15.22 | 14.34 | -5.8% | 63.45 |
| uris-100 | 244.91 | 165.86 | -32.3% | 454.53 |
| VSBuffer-4KiB | 34.03 | 31.19 | -8.3% | 53.72 |
| cyclic-map-set | 56.07 | 50.35 | -10.2% | — |

## Validation and reproduction

148 focused Node tests and 114 Electron tests pass across buffer, channel IPC and extension RPC suites. Focused lint and hygiene pass. The earlier complete client type check passed for the preceding candidate; this optimization changes only internal serialization logic and adds fixtures and tests.

Build with the selected worktree's `.nvmrc` Node version and `npm run build-fast -- --client-only`. Run `node out/vs/base/parts/ipc/test/node/ipc.perf.js --transport message-port --samples 3 --iterations 1000`. For strict eligibility, transpile the baseline common `ipc.ts` into a sibling output module and pass its path using `--module`. For legacy transport use `--transport buffer-message-port`. Repeat in the recorded eight-block order. Temporary comparison modules are not runtime features.
