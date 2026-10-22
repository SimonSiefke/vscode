# Common native channel batching (2026-10-22)

Compare `9ec9dde1b2d141b3ab2ee327edc9c15e1ea17348` with the candidate sources and hashes in the adjacent complete result files. This batches common ChannelClient/ChannelServer messages; extension-host RPC batching is separate and was already present.

## Change

Both roles share one lazy adapter per native protocol. Its shared normalizer dispatches each logical frame to both roles before advancing to the next frame, preserving ordering across request, response and event roles. Normalizing separately per observer would change that order.

The first send after receiving data is immediate and schedules no batching microtask. Follow-up immutable JSON/primitive frames coalesce in one microtask, capped at 64 frames and 16 Ki UTF-16 body characters. Large DTOs remain separate. Native binary/graph payloads flush preceding frames and are posted synchronously, preserving call-time snapshots. Channel ID/name headers are freshly allocated internally; arbitrary connection contexts retain the raw handshake path. Byte/socket protocols keep their formats and behavior.

MessagePort and Electron transports flush queued frames before close/disconnect. Delayed sends tolerate a peer closing before their microtask. The adapter detaches its raw listener after the final role observer is removed; the WeakMap cache does not retain unreachable protocols. A separate observer count handles synchronous buffered delivery during Event subscription, before Emitter increments its own count.

## Method

Eight randomized blocks per transport compare before/after at concurrency 1 and 32. All variants use identical esbuild es2024/ESM settings with experimentalDecorators:true and useDefineForClassFields:false. The Linux Buffer pool is 8 KiB, with any earlier runtime slab consumed. Each fixture warms up with 200 sequential calls and measures three batches of 1,024 complete echo round trips. Values are checked and every measured logical frame is counted. No retries, exclusions or outlier removal occur.

Node v24.22.0 uses real worker-thread MessagePorts and bidirectional IPCClients. Electron uses a real renderer with Node integration disabled and a utility process, also with bidirectional IPCClients. Median microseconds per call across all 24 batches are below. The concurrency-32 values measure aggregate burst throughput, rather than individual-call tail latency.

Background host activity is uncontrolled; small differences are exploratory. All regressions are retained. **The requested 10–20% whole smoke-suite improvement remains unproven by these microbenchmarks.**

| Concurrency | Fixture | Node before µs | Node batch µs | Change | Electron before µs | Electron batch µs | Change |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | primitive | 17.27 | 17.05 | -1.3% | 224.95 | 213.38 | -5.1% |
| 1 | small-object | 28.64 | 30.59 | +6.8% | 243.26 | 234.62 | -3.6% |
| 1 | settings-100 | 227.28 | 231.55 | +1.9% | 496.44 | 501.27 | +1.0% |
| 1 | keys-1000 | 334.87 | 334.52 | -0.1% | 619.09 | 636.33 | +2.8% |
| 32 | primitive | 13.06 | 7.35 | -43.7% | 38.28 | 17.43 | -54.5% |
| 32 | small-object | 23.47 | 16.11 | -31.4% | 42.68 | 20.61 | -51.7% |
| 32 | settings-100 | 215.57 | 217.50 | +0.9% | 134.96 | 140.77 | +4.3% |
| 32 | keys-1000 | 326.37 | 323.82 | -0.8% | 211.33 | 222.75 | +5.4% |

In each Electron small-call burst campaign, all 3,072 measured outgoing logical requests remain present while physical outgoing packets fall from 3,072 to 192. Counting both directions in Node, all 6,144 logical frames remain present while physical packets fall from 6,144 to 480. Larger settings bodies have less batching opportunity; key-list bodies exceed the size limit and remain separate. The larger-burst regressions remain in the table.

Complete samples, compiler version, source and compiled hashes, exact sources and primary harness snapshots are in `ipc.channel-batch.node.results.json` and `ipc.channel-batch.renderer.results.json`. Scripts embed this worktree’s absolute paths; adjust the root to reproduce elsewhere. An alternative receiver without the extra Emitter was tested and rejected because it did not consistently improve controls and complicated event semantics.

## Validation

210 selected Node tests, 210 Electron tests and six child-process IPC integration tests pass, along with full client typechecking, focused lint and hygiene. Eleven focused batching tests cover immediate first sends, receive adaptation, packet limits, binary snapshots, per-frame cross-role ordering, lazy listener cleanup, buffered startup delivery, explicit flushing, peer closure and disconnect flushing. The disconnect regression fails without the native flush hook and passes with it. Existing channel tests also cover shared JSON decode idempotence, cancellation, URI marshalling, errors and native graphs.
