# Explicit native RPC notifications (2026-10-22)

Compare `c1ada2d98cbb2d66435b97d6862af68818ffbe4c` with the candidate sources and hashes in the adjacent raw files. Proxy identifiers can opt individual void methods into native one-way delivery. Ten document, editor, configuration and workspace methods are marked after auditing their current call sites: the callers ignore the return value. No method returning a result is opted in.

**Contract:** notification promises indicate enqueue completion, not completion of the remote handler. Handler errors are reported at the receiver rather than returned to an ignored caller promise. FIFO delivery, synchronous argument serialization and URI transformation remain intact. Byte protocols, binary/mixed arguments and cancellation use ordinary request/reply RPC. These are explicit semantics for marked methods, not inferred behavior for arbitrary calls.

When no other unacknowledged request monitors the connection, a marked call uses the regular path at least once per second, using the existing responsiveness deadline as the throttle. It acts as a liveness probe. Notification-only traffic can therefore add up to about one second to the existing responsiveness polling window. A single call after an idle period follows the ordinary path. Probes, outstanding replies and timers are disposed normally.

## Method

Eight seeded randomized blocks per environment compare matching esbuild es2024/ESM builds, experimentalDecorators:true and useDefineForClassFields:false. Linux Buffer.poolSize is 8 KiB. Node v24.22.0 uses real MessagePorts; Electron uses a real renderer with Node integration disabled and a utility process. The script runs Node then Electron without resetting its shuffle generator. No retries, exclusions or outlier removal occur. Background host activity is uncontrolled; small differences are exploratory. Short functional probes ran during the campaign.

An ordinary reset request establishes recent liveness before each measured notification burst. Then 32 or 512 ignored void calls update a counter and last payload at the receiver. A final ordinary state request acts as a FIFO barrier: the timer stops only after its reply arrives, and both update count and final value are checked. Three batches per block provide 24 samples per fixture. The figures are aggregate microseconds per notification including the barrier, rather than single-call latency. Ordinary echo controls measure 1,000 sequential awaited calls per batch after 200 warmups. These are generic actors, not timings of the actual document/editor handlers.

| Fixture | Node before µs | Node after µs | Change | Renderer before µs | Renderer after µs | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| echo-primitive | 24.76 | 26.35 | +6.4% | 261.30 | 233.70 | -10.6% |
| echo-small-object | 26.12 | 25.26 | -3.3% | 253.70 | 253.95 | +0.1% |
| notify-32-primitive | 12.53 | 6.58 | -47.5% | 18.75 | 17.19 | -8.3% |
| notify-32-settings-100 | 71.87 | 66.69 | -7.2% | 65.63 | 62.50 | -4.8% |
| notify-32-text-4KiB | 33.01 | 22.76 | -31.0% | 48.44 | 34.38 | -29.0% |
| notify-512-primitive | 6.80 | 4.38 | -35.6% | 6.84 | 4.69 | -31.4% |
| notify-512-settings-100 | 69.60 | 58.92 | -15.3% | 53.52 | 36.43 | -31.9% |
| notify-512-text-4KiB | 29.05 | 19.24 | -33.7% | 25.20 | 13.96 | -44.6% |

The ordinary Node primitive control regresses 6.4%; the renderer small-object control is approximately flat (+0.1%). All controls are retained. In a separate real-port delivery probe, all 1,000 updates arrive before the barrier while physical packets fall from 60 to 27. Byte-mode traffic remains unchanged at 2,012 packets for that full probe. This avoids unused replies, pending-reply objects and associated cleanup; it does not skip domain updates.

Full samples, exact sources, compiler settings, call-site audit and harness/probe snapshots are in `rpcProtocol.notifications.node.results.json` and `rpcProtocol.notifications.renderer.results.json`. The harness injects the metadata into a generic proxy identifier for both variants; the baseline ignores it. Actual source metadata marks only the ten audited methods. Paths in the scripts need adjustment outside this worktree.

## Validation and limits

245 selected Node tests, 245 Electron tests and 106 relevant extension API tests pass. New cases cover complete FIFO delivery, argument snapshots, URI values, binary and cancellation fallbacks, synchronous/asynchronous handler errors, periodic liveness probing, silent peers and disposal. Separate real-port probes also cover delivery counts and fallbacks. Full client typechecking and focused lint pass.

This is a local notification-throughput improvement, not a demonstrated 10–20% whole smoke improvement. Earlier cumulative candidates produced full-suite results of −0.5% (inconclusive), −2.6%, and +3.8% on separate matched campaigns. The latest full comparisons remain necessary; do not compare raw suite medians across different runners.
