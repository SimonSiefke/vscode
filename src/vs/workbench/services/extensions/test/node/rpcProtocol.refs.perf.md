# Faster RPC buffer-reference JSON parsing (2026-10-22)

SerializableObjectWithBuffers previously used JSON.parse with a JavaScript reviver on every scalar and object. Ordinary JSON now parses directly when its text contains no buffer-reference marker or relevant URI marker. Unicode escapes conservatively require restoration so escaped marker names cannot bypass it. Other payloads parse once and restore objects in postorder, skipping scalar callbacks. Undefined placeholders still delete object properties and create array holes; buffer aliases, root references, URI transformation order and __proto__ data properties keep their behavior.

## Product-policy measurements

The baseline is `30882a04012034801bd0c6eb0cf9ba831953da78`. Source/module hashes and all raw samples accompany this report. Node and Electron RPC measurements use the Linux product's **8 KiB Buffer pool**, matching src/bootstrap-node.ts; preload/setup also consumes any slab created earlier by the standalone runtime. The Node benchmark now defaults to this policy on Linux, reports bufferPoolSize and accepts --pool-size for explicit alternatives. Earlier standalone 64 KiB measurements are not used in this primary comparison.

Eight blocks randomize before/after order (LCG seeds 3212261 component, 3212262 Node, 3212263 renderer; multiplier 1664525, increment 1013904223, unsigned state). Each process warms each fixture with 200 calls and measures three batches: 1,000 parses/calls for component and Node, 1,024 calls for Electron. Returned RPC values are checked against their initial semantic JSON representation and subsequent replies are compared with the first. The table reports medians of all 24 batches in microseconds, without retries, exclusions or outlier removal.

Component timings measure only parsing, with no Buffer allocation inside the timed function. Node v24.22.0 uses real MessagePorts in one process. Electron v43.7.7 uses a renderer without Node globals and a separate utility process. Ordinary background activity is uncontrolled. Small differences are exploratory; unchanged call-path control fixtures remain in the table and their variation is not attributed to the parser change. These measurements do not establish a whole smoke-suite improvement.

| Measurement | Fixture | Before µs | Faster parser µs | Change |
| --- | --- | ---: | ---: | ---: |
| component | settings-100 | 538.67 | 60.24 | -88.8% |
| component | workspace-edits-100 | 1693.82 | 388.78 | -77.0% |
| component | notebook-100 | 951.39 | 235.66 | -75.2% |
| node | primitive | 29.10 | 31.12 | +6.9% |
| node | small-object | 31.07 | 31.08 | +0.1% |
| node | settings-100 | 225.27 | 217.82 | -3.3% |
| node | text-4KiB | 43.91 | 44.65 | +1.7% |
| node | wrapped-settings-100 | 1336.55 | 366.98 | -72.5% |
| node | workspace-edits-100 | 3586.78 | 1203.88 | -66.4% |
| node | notebook-100 | 2114.07 | 816.48 | -61.4% |
| renderer | primitive | 247.71 | 252.34 | +1.9% |
| renderer | small-object | 267.97 | 266.46 | -0.6% |
| renderer | settings-100 | 569.43 | 570.65 | +0.2% |
| renderer | text-4KiB | 303.47 | 316.50 | +4.3% |
| renderer | wrapped-settings-100 | 1393.85 | 798.73 | -42.7% |
| renderer | workspace-edits-100 | 3223.88 | 1939.60 | -39.8% |
| renderer | notebook-100 | 2134.23 | 1412.99 | -33.8% |

## Validation and reproduction

188 selected Node tests and 174 Electron tests pass, plus complete client typechecking, focused lint and hygiene. Dedicated cases cover ordinary DTOs, buffer aliases/methods, undefined object fields and array holes, escaped reference/URI markers, postorder URI transformation and __proto__ fields. A separate seeded differential run compares 2,000 trees against the original JSON reviver, including escaped markers, invalid references and URI transformer call order.

Build with the selected .nvmrc Node version, then run `node out/vs/workbench/services/extensions/test/node/rpcProtocol.perf.js --native --batch --samples 3 --iterations 1000`. The Linux default pool is 8192; set `--pool-size 8192` explicitly if desired. Use --module with a sibling output module transpiled from the recorded baseline source to reproduce before. --filter can select fixtures by regular expression. Follow the exact recorded eight-block order. Component and Electron helper sources are preserved in their results JSON; adjust their absolute paths when reproducing elsewhere.
