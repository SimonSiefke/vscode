# Hybrid IPC performance experiment (2026-10-22)

The previous implementation copies the full object graph before native cloning. A VSBuffer adds another complete receive-side traversal. This experiment sends primitive values, raw bytes, VSBuffer instances and URI DTOs directly; sends eligible object trees as JSON strings without byte encoding; and restores the native-cloned VSBuffer wrappers directly through the reference table. Ordinary objects and typed arrays with a `buffer` property keep their representations. Cycles, repeated object references, getters, sparse arrays, Map, Set, RegExp, bigint and non-finite numbers use the graph path.

The JSON eligibility scan reads data-property descriptors without evaluating getters. It does not create replacement objects. JSON omission of optional `undefined` fields and local callback properties matches the legacy object serializer. The graph path also omits local callback and symbol properties, addressing the previously reproduced terminal/Workspace DataCloneError patterns. These are focused compatibility reproductions; they do not replace the complete ShellExecution integration suite. Arbitrary user-defined `toJSON` behavior and proxies are not an exact structured-clone equivalence guarantee.

## Local MessagePort measurements

Compare PR head `297a0df7b5dc1388b44a834a29ce0cb909712f5e` with the runtime source identified by SHA-256 in `ipc.hybrid.perf.results.json`. Both modules use the same current build dependencies, Node v24.22.0, Linux x64 and native worker-thread MessagePorts. The buffer comparison uses the previous PR's unchanged buffer path over the same native transport. This is a module-only microbenchmark, not a full packaged-product comparison.

Eight blocks run all three variants once in randomized order (LCG seed 32120261022, multiplier 1664525, increment 1013904223, unsigned 32-bit state; Fisher–Yates shuffle). Each fresh process warms each fixture with 200 calls, then measures three batches of 1,000 sequential echo round trips. Assertions verify the initial and final values. The table reports medians of all 24 batch samples in microseconds per complete round trip, without retries, exclusions or outlier removal. The host has ordinary uncontrolled background activity. Small differences are exploratory; this table makes no confidence or statistical-significance claim.

| Fixture | Previous PR µs | Hybrid µs | Change | Buffer µs |
| --- | ---: | ---: | ---: | ---: |
| primitive | 24.94 | 17.97 | -28.0% | 62.41 |
| small-object | 32.16 | 31.38 | -2.4% | 69.03 |
| settings-100 | 656.89 | 436.43 | -33.6% | 266.45 |
| text-4KiB | 22.50 | 17.74 | -21.1% | 54.08 |
| uris-100 | 360.47 | 251.38 | -30.3% | 475.37 |
| VSBuffer-4KiB | 44.56 | 31.77 | -28.7% | 52.13 |
| cyclic-map-set | 58.47 | 54.84 | -6.2% | — |

Settings remains about 64% slower than the buffer path despite improving about 34% against the previous structured-clone implementation. A component probe identifies the DTO eligibility scan as a substantial remaining cost. Native references for URI objects, JSON replacers and per-message descriptor-shape caching were explored and rejected because they did not produce a reliable general improvement. Their pilot samples are excluded from the table and raw primary measurements.

## Product comparison

The user-supplied [37-attempt smoke comparison](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39402173064) compares `d956e8a6ac5d904486557eea07e1d6bd62a4d36f` with older PR revision `b15721828a3b12cd4f8cd16f4df83f0bae61d1e6`. Its successful-suite median increases from 496,988.796 ms to 557,272.857 ms (+12.13%). It uses independent runners, so it cannot isolate the effect of IPC from runner differences or other revision changes.

A fresh large smoke comparison will use the current matched base `4df8bb183f0e984e97d8f4200c802c49061d7d3c`, the previous PR head and this candidate. No improvement in whole-product smoke time is claimed while that run is pending.

## Validation and reproduction

The focused Node and Electron IPC suites cover URI and binary values, cycles, aliases, sparse arrays, getter mutations, events, cancellation and errors. Additional cases exercise JSON wire selection, callback omission, class instances carrying callbacks, callback omission alongside native bytes, ordinary buffer metadata and acyclic aliases. All 94 focused Node IPC tests and 60 Electron IPC tests pass, as do client typechecking, focused lint and hygiene.

Use the Node version in `.nvmrc`, install dependencies in the selected worktree, and build the client:

```sh
npm run install-fast
npm run build-fast -- --client-only
node out/vs/base/parts/ipc/test/node/ipc.perf.js --transport message-port --samples 3 --iterations 1000
node out/vs/base/parts/ipc/test/node/ipc.perf.js --transport buffer-message-port --samples 3 --iterations 1000
```

To reproduce the previous PR variant, obtain `src/vs/base/parts/ipc/common/ipc.ts` from the recorded baseline SHA and transpile it with `transpileFile` from `build/next/transpile.ts` into a sibling `out/vs/base/parts/ipc/common/ipc.baseline.js`. Pass `--module out/vs/base/parts/ipc/common/ipc.baseline.js` to the benchmark command. Repeat in the exact eight-block order recorded in the results JSON. The temporary baseline source/module is not a runtime feature.
