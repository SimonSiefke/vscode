# Reuse extension RPC responsiveness checks (2026-10-22)

Compare `5cae459e4aada510c694218fb13d253c8825095b` with the exact selected `timer` sources in the adjacent raw files. A successful isolated request formerly created and cancelled a responsiveness timer on every call. The candidate leaves one scheduled check in place; it exits if the connection is idle and otherwise retains the existing three-second deadline and one-second polling. The final acknowledgement no longer updates an unused idle deadline; the next request resets it.

A connection can now retain one scheduled check for up to one second after becoming idle. Disposing the RPC protocol cancels it. In a deterministic clock probe, 500 completed requests schedule one timer rather than 500, and perform one scheduler cancel rather than 1,000 (schedule itself calls cancel). Idle expiry, an unresponsive peer, recovery and disposal pass. There is no wire-format change.

## Method

Eight seeded randomized blocks compare five variants: baseline, removal of empty disposal stores, merged reply/promise objects, timer reuse, and a combined allocation/timer variant. The same driver runs Node first and Electron next without resetting its shuffle generator. Every variant warms up and measures three batches per fixture; the table uses all 24 batches for each variant and fixture. No retries, exclusions or outlier removal occur. Host activity is uncontrolled; short lifecycle probes/tests and artifact processing also occurred during the exploratory campaign. Small changes should not be generalized.

Both sides use matching esbuild es2024/ESM compilation with experimentalDecorators:true and useDefineForClassFields:false. Linux Buffer.poolSize is 8 KiB. Node v24.22.0 measures 1,000 complete native/batched RPC calls per batch through real worker-thread MessagePorts. Electron measures 1,024 calls through a real renderer with Node integration disabled and a utility process. Values are checked. Auxiliary native frame/batching helpers are shared by all variants. Their used exports are identical across all five variants.

Median microseconds per complete call:

| Fixture | Node baseline | Node timer | Change | Renderer baseline | Renderer timer | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primitive | 32.07 | 24.22 | -24.5% | 279.79 | 251.42 | -10.1% |
| small-object | 34.64 | 32.03 | -7.6% | 265.87 | 259.57 | -2.4% |
| settings-100 | 228.90 | 221.67 | -3.2% | 566.60 | 540.82 | -4.6% |
| text-4KiB | 47.36 | 45.10 | -4.8% | 330.71 | 308.50 | -6.7% |
| wrapped-settings-100 | 386.43 | 371.69 | -3.8% | 792.24 | 788.82 | -0.4% |
| workspace-edits-100 | 1253.76 | 1231.89 | -1.7% | 2033.59 | 1945.95 | -4.3% |
| notebook-100 | 860.58 | 857.68 | -0.3% | 1431.59 | 1372.90 | -4.1% |

All five variants and controls remain in `rpcProtocol.timer.node.results.json` and `rpcProtocol.timer.renderer.results.json`, including exact sources, hashes, compiler settings and harness snapshots. The allocation-only/merged variants were held: some fixtures regressed and combining them did not consistently beat the simpler timer change. Scripts contain worktree-specific paths that need adjustment elsewhere.

## Validation and limits

228 selected Node tests, 228 Electron tests and six child-process integration tests pass for the timer candidate. Full client typechecking, compilation and focused lint pass. The new timer-reuse regression fails in all three binary/native/batched modes on the baseline (100 schedules instead of one) and passes with the candidate. Tests cover idle expiry, unresponsive detection/recovery, timer disposal and caller cancellation-subscription cleanup on success/error. Existing cancellation, pending acknowledgements, duplicate/late acknowledgements, errors, buffers and disposal cases also pass.

These are local RPC timings, not full smoke-suite gains. Earlier full-suite campaigns measure cumulative older candidates: b655 is inconclusive at -0.5%; 813 improves 2.6% on its matched runner. Neither establishes the requested 10–20% target, and neither contains this timer change.
