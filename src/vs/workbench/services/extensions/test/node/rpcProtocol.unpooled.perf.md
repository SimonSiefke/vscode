# Unpooled extension-host RPC messages

RPC packets allocated through Node's shared Buffer pool can make native MessagePort serialization copy far more than the logical message. In this Node v24.22.0 environment, a primitive request/ack/reply exchanges 36 wire bytes but its three buffers reference 196,608 bytes of pooled backing storage. The candidate uses `VSBuffer.alloc(size, { unpooled: true })` for complete RPC packets, preserving the same wire bytes while allocating only their actual storage. Other allocations keep their existing behavior. [Node documents the full-pool cloning behavior](https://nodejs.org/api/worker_threads.html#considerations-when-transferring-typedarrays-and-buffers).

The new outgoing-message regression fails against the prior RPC module and passes with the candidate. The focused buffer, channel IPC and extension-host RPC suites pass: 142 Node tests and 108 Electron tests. Native renderer MessagePorts remain covered by the channel suite. These checks do not establish a full smoke-suite speedup.

## Local measurements

Eight randomized paired process blocks (LCG seed 3212210) compare the RPC module from `d016c42c229695834c83312088aae1a80869ae4e` with the candidate. Supporting modules and the Node runtime are shared. Each fixture warms 200 sequential calls, then records three batches of 1,000 complete RPC echo round trips over real worker-thread MessagePorts. The table reports medians of 24 batch samples per variant, in microseconds per round trip. No retries, outlier removal or sample exclusions are used. Host background activity is uncontrolled and the values are exploratory microbenchmarks, not whole-product measurements.

| Fixture | Pooled µs | Unpooled µs | Change |
| --- | ---: | ---: | ---: |
| primitive | 88.85 | 42.11 | -52.6% |
| small-object | 81.50 | 47.55 | -41.7% |
| settings-100 | 283.60 | 256.05 | -9.7% |
| text-4KiB | 95.67 | 72.99 | -23.7% |

Both variants send three messages per call. Candidate backing-store bytes equal the wire-byte count for all four fixtures. Raw batch timings, traffic counts, variant order and runtime source digests are in `rpcProtocol.unpooled.perf.results.json`. The retained temporary harness originally labels its default module "baseline"; the enclosing variant and source digests identify the actual implementation.

After building with the Node version in `.nvmrc`, run the reusable benchmark:

```sh
node out/vs/workbench/services/extensions/test/node/rpcProtocol.perf.js --samples 3 --iterations 1000
```

To compare the old allocation, transpile the prior `rpcProtocol.ts` to a sibling `rpcProtocol.baseline.js` and pass its path using `--module`. Keep its supporting modules and runtime identical. The baseline source/module is an experiment artifact, not a runtime feature.

A full packaged comparison will run the same compiled smoke suite and fixture against the current upstream base and candidate sequentially on one runner, alternating order. Product-level results remain pending.
