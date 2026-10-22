# Tightly sized RPC buffers with the Linux product policy (2026-10-22)

The earlier standalone allocation experiment used Node/Electron's default 64 KiB pool. Linux VS Code already sets Buffer.poolSize to 8 KiB in src/bootstrap-node.ts, avoiding Mojo's larger shared-memory threshold. This comparison explicitly uses the product policy, consumes any earlier runtime-created slab, and records actual outgoing backing sizes. It replaces allocation-specific extrapolation from the 64 KiB experiment.

Compare the pooled d016c42c RPC module with the unpooled bda3e03a module. Both retain the original request/ack/reply wire protocol. The currently built supporting VSBuffer module still implements both allocation modes; module hashes are recorded. Node v24.22.0 uses real MessagePorts in one process; Electron v43.7.7 uses a renderer without Node globals and a separate utility process, with the worker's 8192 pool asserted in the raw results.

Eight blocks randomize before/after order (LCG seeds 3212264 Node and 3212265 renderer, multiplier 1664525, increment 1013904223, unsigned state). Each process warms 200 calls per fixture and measures three batches of 1,000 sequential echo round trips, asserting returned values. The table reports all 24-batch medians in microseconds per round trip, without retries, exclusions or outlier removal. Background activity is uncontrolled; small differences are exploratory. These are not full smoke-suite speed claims.

| Transport | Fixture | Pooled µs | Unpooled µs | Change |
| --- | --- | ---: | ---: | ---: |
| node | primitive | 49.89 | 41.47 | -16.9% |
| node | small-object | 48.63 | 49.32 | +1.4% |
| node | settings-100 | 259.90 | 257.72 | -0.8% |
| node | text-4KiB | 85.51 | 76.49 | -10.6% |
| renderer | primitive | 360.25 | 283.95 | -21.2% |
| renderer | small-object | 379.55 | 302.80 | -20.2% |
| renderer | settings-100 | 672.30 | 638.75 | -5.0% |
| renderer | text-4KiB | 387.35 | 368.30 | -4.9% |

The primitive request/ack/reply still references 24,576 pooled backing bytes for 36 logical bytes; tight allocation reduces that to 36. The latency gain is materially smaller than at 64 KiB but persists for the real Electron transport. The small Node-object regression remains included.

Build with the selected .nvmrc Node version, then run the reusable rpcProtocol.perf.js with --pool-size 8192, --samples 3, --iterations 1000 and --module selecting each recorded snapshot, without --native. --filter can restrict the four fixtures. Repeat in the recorded order. Exact Electron helper snapshots are included in the renderer results JSON.
