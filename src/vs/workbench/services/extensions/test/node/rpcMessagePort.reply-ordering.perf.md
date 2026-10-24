# Held: individual native RPC reply delivery

Production remains `38b2f1066eedc6cd3395bda950ee1f7e292f9df7`. Native RPC batching can dispatch a later notification before the Promise continuation for a preceding reply. A real MessageChannel prototype test demonstrates the stronger individual-delivery ordering: nine cases pass and the new assertion fails before; ten pass with individual reply delivery. The exact test and unshipped patch are retained in the result JSON.

Posting every native reply individually preserves that ordering while leaving requests and notifications batched. It does not fix the Local chat terminal timeout, which is separately isolated to benchmark command readiness. This prototype is **held** because its concurrent renderer costs conflict with the task's explicit speed-first tradeoff. The production batching ordering limitation is documented, not claimed fixed. No enabled production test is skipped or weakened; the stronger-ordering prototype test is retained as experiment source rather than introduced into the supported suite.

Both variants use the identical current ACK protocol and product 8 KiB pools, matching esbuild ES2024/ESM/decorator settings, actual Node MessageChannels and Electron renderer/utility ports. Eight randomized blocks, three batches, 1,024 checked replies per fixture, async handlers with two immediate awaits, concurrency 1 and 32. There are no retries or outlier removals. These are component round trips, not whole-smoke timings.

| Environment / concurrency | Fixture | Individual reply change |
| --- | --- | ---: |
| node-1 | primitive | -5.67% |
| node-1 | small-object | +0.68% |
| node-1 | text-4KiB | +3.16% |
| renderer-1 | primitive | -12.75% |
| renderer-1 | small-object | -6.72% |
| renderer-1 | text-4KiB | -1.64% |
| node-32 | primitive | +37.04% |
| node-32 | small-object | +18.98% |
| node-32 | text-4KiB | -5.22% |
| renderer-32 | primitive | +71.51% |
| renderer-32 | small-object | +57.48% |
| renderer-32 | text-4KiB | +8.04% |

Every raw sample, exact port/harness source, compiled port hash, identical RPC module hash and prototype test is included in `rpcMessagePort.reply-ordering.results.json`. The 57–72% renderer burst regressions reject this prototype as a speed optimization. The independent harness readiness correction changes no product code or assertions.
