# Bounded native RPC batching experiment (2026-10-22)

Native JSON RPC frames can be coalesced during a synchronous burst. The first outgoing native frame after receiving data is sent immediately, so a sequential request/reply exchange needs no batching microtask. Follow-up frames coalesce until a microtask, with limits of 64 frames or 16 Ki UTF-16 body characters. Larger DTOs stay pipelined. Binary/control packets flush earlier native frames before sending. Disposal clears incoming and outgoing buffers, and an extension-host port close disposes its adapter.

The adapter retains the existing single BufferedEmitter stream for startup and mixed binary/native traffic. JSON strings and fresh protocol headers belong to the encoder and are not mutated after enqueueing. The protocol wire can carry a single frame or a frame array. Packaged extension-host peers already enforce matching commits.

## Measurements

Use the `de21f53b3671f6792a631c5ac6a235f8350a0dcd` RPC encoder for both variants. The control and candidate use the identical new RPCMessagePort receive adapter and BufferedEmitter; the control overrides its native send method to post immediately. This isolates batching rather than changing the receive event machinery. Sources and compiled module hashes are recorded in the accompanying raw results. An earlier Node control used Event.fromNodeEventEmitter directly; it exaggerated isolated-call overhead and is excluded from this primary comparison because the actual product already used BufferedEmitter before this change.

Eight blocks randomize four combinations: batching on/off and concurrency 1/32. LCG seeds are 3212256 for Node and 3212255 for renderer, multiplier 1664525 and increment 1013904223, with unsigned state and Fisher–Yates shuffle. Each process warms each fixture with 200 sequential calls and measures three batches of 1,024 calls. Returned values are asserted. The table reports medians of all 24 batches, without retries, exclusions or outlier removal.

At concurrency 1, values are microseconds per round trip. At concurrency 32, they are amortized microseconds per completed call (total batch time divided by calls), not the latency of an individual concurrent request. Node v24.22.0 uses real MessagePorts in one process. Electron v43.7.7 uses a renderer without Node globals and a separate utility process. Ordinary background activity is uncontrolled; small differences are exploratory with no statistical-significance claim. These measurements do not establish a smoke-suite improvement.

| Transport | Concurrency | Fixture | Immediate µs/call | Batched µs/call | Change |
| --- | ---: | --- | ---: | ---: | ---: |
| node | 1 | primitive | 26.20 | 25.69 | -2.0% |
| node | 1 | small-object | 29.10 | 29.74 | +2.2% |
| node | 1 | settings-100 | 218.96 | 228.89 | +4.5% |
| node | 1 | text-4KiB | 44.04 | 44.15 | +0.3% |
| node | 32 | primitive | 16.97 | 13.00 | -23.4% |
| node | 32 | small-object | 17.93 | 13.56 | -24.4% |
| node | 32 | settings-100 | 207.24 | 209.25 | +1.0% |
| node | 32 | text-4KiB | 40.68 | 35.13 | -13.6% |
| renderer | 1 | primitive | 245.02 | 239.50 | -2.3% |
| renderer | 1 | small-object | 240.77 | 250.88 | +4.2% |
| renderer | 1 | settings-100 | 524.37 | 535.25 | +2.1% |
| renderer | 1 | text-4KiB | 302.88 | 303.47 | +0.2% |
| renderer | 32 | primitive | 40.43 | 18.99 | -53.0% |
| renderer | 32 | small-object | 41.16 | 16.31 | -60.4% |
| renderer | 32 | settings-100 | 154.88 | 148.93 | -3.8% |
| renderer | 32 | text-4KiB | 51.07 | 40.04 | -21.6% |

Unbounded batching was rejected because it made large settings payloads slower. Always waiting for a batching microtask was also rejected because it added isolated-call overhead. The primary results above use bounded, receive-adaptive batching and retain the remaining small regressions.

## Validation and reproduction

182 selected Node tests and 168 Electron tests pass. All RPC cases run in binary, native JSON and batched JSON modes. Dedicated adapter tests cover burst limits, immediate first sends, received-data scheduling, binary/control order, startup buffering, drain and disposal. Focused lint and hygiene pass. Complete client typechecking passed for the new adapter/API; subsequent scheduling refinements change internal boolean logic only.

After building with the selected `.nvmrc` Node version, compare `node out/vs/workbench/services/extensions/test/node/rpcProtocol.perf.js --native --samples 3 --iterations 1024 --concurrency 32` with the same command plus `--batch`. Repeat with `--concurrency 1`, following the recorded eight-block order. `messages` counts physical port packets; `nativeMessages` counts logical native frames. Exact Electron helper sources are included in the renderer results JSON. Temporary benchmark controls and prototypes are not runtime feature flags.
