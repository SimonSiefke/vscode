# Structured-clone IPC experiments

Parent: `5f0eb30e4bd4412f394a12fa902ed660ee4bd477` (microsoft/vscode#330439). The final patch changes the object/array traversal in `transformStructuredCloneData`: iterate own enumerable keys, read each value when visiting it, assign ordinary keys, and define `__proto__` as an own data property. The URI/VSBuffer conversion and graph identity map remain in place.

## Method

Node v24.18.0 on Linux x64, AMD EPYC-Rome. Each measurement is a sequential ChannelClient → echo ChannelServer → ChannelClient round trip, including marshalling, native cloning, delivery, promise handling, and response unmarshalling. `clone` uses synchronous `structuredClone`; `message-port` uses real Node worker-thread MessagePorts. The buffer comparison uses the parent serializer over the corresponding native transport. These are microbenchmarks, not Electron main/renderer IPC, startup, or whole-application throughput measurements.

Eight paired blocks per transport; all four variants run in a seeded random order within each block (seed 330439). Each process warms each case with 200 round trips and records three batches of 500 round trips. Assertions verify the initial result and the final result of every batch. The tables show medians of the 24 batch samples, in microseconds per round trip. Confidence intervals are for percentage changes of means, resampling the eight paired process blocks 10,000 times with seed 330439 (sorted bootstrap indices 249 and 9749). Negative changes mean less time. Ordinary background host load was not controlled. Pilot runs and validation/build work are excluded from the measured batch.

`keys` is the final patch. `envelope` additionally avoided transforming the header/body envelope; this experiment was not adopted. Both use the same graph traversal. All variants use the same compiled dependencies; only the selected IPC module changes. The parent IPC source was obtained with `git show` and transpiled with the repository’s `transpileFile` helper. The final compiled IPC code matches the measured `keys` variant byte for byte after excluding its source-map URL.

## Results

### Native Node MessagePort

| Case | Parent µs | Optimized µs | Median change | Paired mean change 95% CI | Buffer µs |
| --- | ---: | ---: | ---: | ---: | ---: |
| primitive | 32.21 | 21.95 | -31.9% | [-34.8%, -20.4%] | 89.49 |
| small-object | 45.46 | 34.85 | -23.3% | [-31.2%, -22.3%] | 81.75 |
| settings-100 | 1021.27 | 587.53 | -42.5% | [-47.0%, -41.1%] | 270.84 |
| text-4KiB | 29.92 | 22.54 | -24.7% | [-36.0%, -18.3%] | 68.49 |
| uris-100 | 479.59 | 304.47 | -36.5% | [-40.3%, -36.6%] | 451.79 |
| VSBuffer-4KiB | 55.75 | 40.99 | -26.5% | [-28.8%, -5.1%] | 62.55 |
| cyclic-map-set | 74.47 | 53.08 | -28.7% | [-38.0%, -21.3%] | — |

### In-memory native structured clone

| Case | Parent µs | Optimized µs | Median change | Paired mean change 95% CI | Buffer µs |
| --- | ---: | ---: | ---: | ---: | ---: |
| primitive | 20.96 | 12.99 | -38.0% | [-34.9%, -16.5%] | 85.63 |
| small-object | 39.89 | 23.56 | -40.9% | [-49.0%, -32.3%] | 64.35 |
| settings-100 | 995.05 | 558.53 | -43.9% | [-44.0%, -30.5%] | 251.84 |
| text-4KiB | 20.40 | 15.82 | -22.4% | [-29.9%, -15.5%] | 56.61 |
| uris-100 | 464.03 | 291.22 | -37.2% | [-38.5%, -35.5%] | 451.81 |
| VSBuffer-4KiB | 42.19 | 33.99 | -19.4% | [-24.3%, -13.8%] | 67.37 |
| cyclic-map-set | 56.50 | 42.17 | -25.4% | [-29.8%, -7.3%] | — |

The settings object remains substantially slower than buffer IPC: the JavaScript object walk plus native cloning still outweigh the buffer path’s JSON serialization for this fixture. This patch reduces the existing structured-clone overhead; it does not establish that structured-clone IPC wins for every workload. The cyclic Map/Set fixture is omitted from buffer comparisons because the legacy serializer cannot preserve that graph.

### Envelope ablation

| MessagePort case | Envelope vs keys median change | Paired mean change 95% CI |
| --- | ---: | ---: |
| primitive | +2.0% | [-12.2%, +2.4%] |
| small-object | -3.5% | [-7.5%, +4.9%] |
| settings-100 | -2.0% | [-3.8%, +2.3%] |
| text-4KiB | -3.7% | [-12.0%, +3.9%] |
| uris-100 | +0.1% | [-2.5%, +3.7%] |
| VSBuffer-4KiB | -3.3% | [-27.1%, +12.8%] |
| cyclic-map-set | -0.2% | [-1.5%, +7.1%] |

## Correctness

The new getter-order regression fails against the parent (`later: 1`) and passes with this patch, matching native `structuredClone` (`later: 2`). Reading values one key at a time observes changes made by a nested getter before visiting later siblings. The other new cases cover frozen inputs, getters evaluated once, own `__proto__` data properties, null prototypes, symbol/non-enumerable exclusion, sparse arrays with extra properties, cycles through Map/Set/array edges, URI conversion, VSBuffer methods and aliases, typed-array offsets/shared storage, cancellation, errors, and event-subscription disposal. Native Electron renderer MessagePorts exercise the production MessagePort protocol.

## Reproduce

Build with the Node version in `.nvmrc`:

```sh
npm run install-fast
npm run build-fast -- --client-only
node out/vs/base/parts/ipc/test/node/ipc.perf.js --transport message-port --samples 3 --iterations 500
node out/vs/base/parts/ipc/test/node/ipc.perf.js --transport clone --samples 3 --iterations 500
```

To compare a parent IPC module without sharing or switching worktrees, save `git show 5f0eb30e4bd4412f394a12fa902ed660ee4bd477:src/vs/base/parts/ipc/common/ipc.ts` to an ignored source file. Use `transpileFile` from `build/next/transpile.ts` to emit `out/vs/base/parts/ipc/common/ipc.baseline.js`, so relative imports use the same dependencies. Pass `--module out/vs/base/parts/ipc/common/ipc.baseline.js`. Add `buffer-` to a transport name for its buffer comparison. Run eight fresh processes per variant in the recorded order. The unadopted envelope experiment is described above rather than exported as a runtime feature.

The complete batch samples, order, runtime versions, variant descriptions, compiled-code digests, and comparisons are in [ipc.perf.results.json](ipc.perf.results.json).

## Validation

The final patch passes `npm run typecheck-client`, focused `npm run eslint -- <changed TypeScript paths>`, and `node build/hygiene.ts <changed paths>`. `npm run test-node -- --runGlob '**/parts/ipc/test/{common,node}/**/*.test.js'` passes 77 tests. `VSCODE_SKIP_PRELAUNCH=1 xvfb-run -a scripts/test.sh --no-sandbox --disable-gpu --runGlob '**/parts/ipc/test/{common/ipc,electron-browser/ipc.mp}.test.js'` passes 43 tests. The full development build and smoke/automation compilation also pass.

The existing Electron workbench smoke selection for Preferences, Settings editor, Search, Quick Open, Language Features, Statusbar, Multiroot, Launch, and Notebooks passes 19 tests with 11 existing pending tests. Run from `test/smoke` after `npm run build-fast` and `npm --prefix test/smoke run compile`:

```sh
VSCODE_SKIP_PRELAUNCH=1 xvfb-run -a node test/index.js --electronArgs=--no-sandbox -g 'VSCode Smoke Tests \(Electron\) (Preferences|Settings editor|Search|Quick Open|Language Features|Statusbar|Multiroot|Launch|Notebooks)'
```

The smoke fixture is `ecb012634f104f7a8188d9e3610a4d2d65bef6f6`. No missing-module, native-module ABI, or extension-activation-failure messages appeared in the smoke logs. The pending cases include notebook tests and are not counted as passes.

## Remaining experiments

Measure Electron main ↔ renderer and utility-process traffic, large binary payloads, main-thread CPU/allocations, and matched packaged/minified startup runs. Investigate the object-heavy regression against buffer IPC before drawing a general performance conclusion. A pre-scan that sends unchanged objects directly must not evaluate getters twice; that shortcut has not been adopted.
