# Skip payload decoding in the inactive IPC role (2026-10-22)

IPCClient installs a ChannelClient and ChannelServer on the same ordered protocol stream. Request headers use the 100 namespace and response headers use 200. Both native and byte receivers now inspect that header before decoding a payload that belongs to the other role. Byte/socket protocols previously decoded every body twice. Native protocols already share an idempotently decoded frame after the preceding fix; the header check also avoids the inactive observer's metadata/buffer work.

## Measurements

Compare `b65533addf8a3b794b109e89ebed2030f27218a1` with the source/module hashes in ipc.roles.perf.results.json. Both peers are real bidirectional IPCClients, not a one-way ChannelClient/ChannelServer pair. The Node v24.22.0 harness uses real MessagePorts with Linux's 8 KiB Buffer pool. Eight blocks randomize four combinations: before/after and native/byte transport (LCG seed 3212271, multiplier 1664525, increment 1013904223, unsigned state; Fisher–Yates shuffle). Each process warms each fixture with 200 calls and measures three batches of 1,000 sequential echo round trips, asserting returned values.

Medians of all 24 batches appear below in microseconds per round trip. There are no retries, exclusions or outlier removal. Ordinary background activity is uncontrolled; small differences are exploratory, with no statistical-significance claim. The byte case uses MessagePorts to isolate channel serialization/decoding; it is not a remote network latency measurement. These microbenchmarks do not establish a full smoke-suite improvement.

| Transport | Fixture | Before µs | Header filter µs | Change |
| --- | --- | ---: | ---: | ---: |
| native | primitive | 18.62 | 19.00 | +2.0% |
| native | small-object | 33.29 | 32.37 | -2.8% |
| native | settings-100 | 231.97 | 228.91 | -1.3% |
| native | keys-1000 | 333.68 | 336.68 | +0.9% |
| buffer | primitive | 42.79 | 38.16 | -10.8% |
| buffer | small-object | 50.08 | 45.26 | -9.6% |
| buffer | settings-100 | 388.21 | 253.82 | -34.6% |
| buffer | keys-1000 | 2171.84 | 1455.91 | -33.0% |

## Validation and reproduction

192 selected Node tests, 178 Electron tests and six child-process IPC integration tests pass. Dedicated native probes verify that the inactive role does not even read a payload getter; they fail on the previous implementation. Bidirectional JSON/binary round trips and multiple same-role observers cover shared-frame decode idempotence.

Build with the selected .nvmrc Node version. The reusable benchmark now defaults to the product's Linux pool and supports bidirectional clients: `node out/vs/base/parts/ipc/test/node/ipc.perf.js --bidirectional --transport buffer-message-port --pool-size 8192 --samples 3 --iterations 1000`. Use message-port for native transport and --module for a sibling output module transpiled from baseline. --filter selects fixtures. The exact primary harness and order are embedded in the results JSON; its settings/key names differ slightly from the general benchmark fixtures, so use that snapshot for exact reproduction.
