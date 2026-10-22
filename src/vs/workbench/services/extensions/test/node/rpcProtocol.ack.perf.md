# Native acknowledgement and short-async reply measurements

Baseline production source: `5f2d3bd8d632f37f8c2c226731edd97144da4267`. Four variants compare unchanged acknowledgements, native acknowledgements, native acknowledgements with the first later reply flushed, and that path with a brief microtask grace for short async handlers. The selected variant is `ack2-flush-grace2`.

Use actual Node MessageChannels and actual Electron renderer/utility-process MessagePorts, with product 8 KiB Buffer pools on both ends. Both sides use matching esbuild options (ES2024, ESM, experimental decorators). Eight randomized blocks (seed 3212410), three batches per fixture per variant, no outlier removal or measurement retries. Async actors await two already-resolved promises before replying. Async runs use concurrency 1 and 32, 1,024 calls per batch. Ordinary and wrapped/binary controls use synchronous actors with concurrency 1, 1,000 Node / 1,024 renderer calls per batch. Every reply is checked. RPCMessagePort source is frozen across variants; no transfer list or port-dispatch change is included.

These are RPC round-trip measurements, **not full smoke-suite gains**. The complete raw datasets, exact variant sources, harnesses and compiled module hashes are in `rpcProtocol.ack.perf.results.json`. The earlier interrupted ACK refinement was discarded and rerun from the current baseline; none of its partial results enters these comparisons.

## Async handler comparisons

Changes are median round-trip time relative to `ack2-before` (negative is faster). The intermediate alternatives and all controls are retained.

| Environment/concurrency | Fixture | Native ACK | First-reply flush | First-reply flush + grace |
| --- | --- | ---: | ---: | ---: |
| refined-node-1 | primitive | -13.53% | -8.95% | -35.22% |
| refined-node-1 | small-object | -7.49% | +0.64% | -23.83% |
| refined-node-1 | text-4KiB | -7.59% | -7.72% | -10.24% |
| refined-renderer-1 | primitive | -7.43% | -2.83% | -11.99% |
| refined-renderer-1 | small-object | -0.76% | -11.02% | -9.82% |
| refined-renderer-1 | text-4KiB | -4.45% | -0.98% | -4.73% |
| refined-node-32 | primitive | -16.17% | -20.98% | -28.94% |
| refined-node-32 | small-object | -26.02% | -22.54% | -29.80% |
| refined-node-32 | text-4KiB | -5.91% | -6.08% | -15.14% |
| refined-renderer-32 | primitive | -37.73% | -35.27% | -42.89% |
| refined-renderer-32 | small-object | -35.66% | -29.55% | -39.74% |
| refined-renderer-32 | text-4KiB | -16.37% | -10.31% | -24.51% |

## Ordinary and mixed-payload controls

| Environment | Fixture | Selected change |
| --- | --- | ---: |
| controls-node | primitive | -0.59% |
| controls-node | small-object | -2.31% |
| controls-node | settings-100 | +0.95% |
| controls-node | text-4KiB | +2.21% |
| controls-node | wrapped-settings-100 | +2.49% |
| controls-node | workspace-edits-100 | +0.55% |
| controls-node | notebook-100 | +2.59% |
| controls-renderer | primitive | -10.58% |
| controls-renderer | small-object | -0.52% |
| controls-renderer | settings-100 | +0.77% |
| controls-renderer | text-4KiB | +2.56% |
| controls-renderer | wrapped-settings-100 | +2.60% |
| controls-renderer | workspace-edits-100 | +0.16% |
| controls-renderer | notebook-100 | +2.91% |

The microtask grace lets a short async result acknowledge its own request, avoiding a separate ACK frame. Handlers still pending after the bounded grace receive an explicit acknowledgement without a task or wall-clock delay. Native ACKs use the existing acknowledged message type on the native stream; ordinary byte peers retain their existing wire encoding. A pending native ACK can consume the port's immediate-send slot, so the first later reply flushes the port rather than waiting for another batching microtask. Binary replies and errors already flush preceding native frames.

Tests cover short async success and failure without separate ACKs, errors after explicit ACKs, native/byte ACK format, duplicate acknowledgements, responsiveness recovery, cancellation, disposal and mixed-frame ordering. The silent-peer fixture drops both native and binary traffic. Full client typechecking and product smoke validation are required before accepting the candidate as a whole-product improvement. The requested 10–20% whole-smoke target is not established by this microbenchmark.

Validation: 249 selected Node tests, 1,340 combined Electron/API tests (three pre-existing pending), and six child-process integration cases pass. Full client typechecking, focused lint and hygiene pass. Before the change, the updated RPC test suite has 109 passes and eight intended assertion failures; after the change all assertions pass. Both silent-peer fixtures now drop native as well as binary messages. The formatter changes only whitespace.

The ordinary controls include +2.2–2.9% regressions on several larger fixtures. These are retained; the candidate is selected for its larger short-async gains and remains experimental until packaged whole-suite validation. The unmeasured grace-only prototype is not included in production or counted as a result.
