# Native extension RPC JSON experiment (2026-10-22)

The standalone measurements below used Node/Electron's default 64 KiB Buffer pool. The Linux product already sets an 8 KiB pool in `src/bootstrap-node.ts`. The allocation-specific gains therefore do not establish the gain for the Linux product; product-policy remeasurements are being collected separately. Full packaged smoke runs use the actual product bootstrap and are unaffected.

Local desktop extension hosts can send the existing serialized JSON strings directly through their native MessagePort. This removes UTF-8 encoding, copying into a request/reply buffer, and byte decoding. Requests containing VSBuffer, undefined arguments or SerializableObjectWithBuffers retain their existing mixed binary format. Binary replies, errors, cancellation and socket/remote transports retain their existing encodings. URI transformations still apply to parsed values.

Native frames travel through the same ordered BufferedEmitter stream as binary startup and RPC messages. A locally tagged zero-length VSBuffer carries an already cloned native frame through existing handshake/termination wrappers; the attachment never goes over the wire. Commit matching remains enforced by the packaged extension-host handshake.

Immediate replies also acknowledge receipt, reducing successful immediate calls from three messages to two. Pending handlers still acknowledge in a microtask. Reply/explicit acknowledgement accounting is idempotent, including late and duplicate acknowledgements. Peers are expected to use the matching build. Native messages report zero encoded byte length to the existing logger, matching the structured channel transport convention; they are not byte-encoded frames.

## Measurements

Compare `199bfa689d673a28ba1d8998a343816c84fed6db` with the source and compiled module hashes recorded in the accompanying Node and renderer raw results. Eight blocks randomize before/after order (LCG seeds 3212249 for Node and 3212248 for renderer, multiplier 1664525, increment 1013904223; unsigned state and Fisher–Yates shuffle). Each process warms each fixture with 200 calls and measures three batches of 1,000 sequential echo round trips, validating returned values. The table reports medians of all 24 batches in microseconds per round trip, without retries, exclusions or outlier removal.

Node v24.22.0 uses real worker-thread MessagePorts in one process. Electron v43.7.7 uses a real renderer without Node globals and a separate utility process, matching the local extension-host transport. The renderer harness source is preserved in its results JSON. Ordinary background activity is uncontrolled. These exploratory module measurements do not establish statistical significance or a smoke-suite improvement. The renderer settings regression is retained, not excluded.

| Transport | Fixture | Before µs | Native µs | Change |
| --- | --- | ---: | ---: | ---: |
| node | primitive | 41.06 | 26.01 | -36.7% |
| node | small-object | 44.82 | 29.35 | -34.5% |
| node | settings-100 | 248.58 | 217.39 | -12.5% |
| node | text-4KiB | 68.00 | 40.68 | -40.2% |
| renderer | primitive | 264.70 | 231.75 | -12.4% |
| renderer | small-object | 267.10 | 259.30 | -2.9% |
| renderer | settings-100 | 551.85 | 564.90 | +2.4% |
| renderer | text-4KiB | 309.50 | 289.50 | -6.5% |

Earlier standalone acknowledgement coalescing improved Node results but regressed some Electron main-process cases. It was not pushed as an independent optimization. Earlier split-event native prototypes also measured better renderer settings results than the final ordered implementation; only the actual integrated implementation appears in the primary table.

## Validation and reproduction

152 selected Node tests and 138 Electron tests pass. All RPC cases run in both binary and native modes, including cancellation, errors, buffer references, disposal and mixed native/binary invocation ordering. Focused lint, hygiene and complete client typechecking pass.

After building with the selected `.nvmrc` Node version, run `node out/vs/workbench/services/extensions/test/node/rpcProtocol.perf.js --native --samples 3 --iterations 1000`. For the baseline, transpile the recorded baseline rpcProtocol.ts to a sibling output module and use `--module <absolute output module>` without `--native`. Repeat in the exact order recorded in the raw results. Binary traffic counters count encoded binary bytes; nativeMessage and nativeStringCharacters counters identify JSON traffic separately.
