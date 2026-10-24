# Compact channel backing stores and bulk primitive arrays (2026-10-22)

Compare baseline `813b4e289c443861eab15f13352bbc44a6fd0fed` with the candidate source/module hashes in the adjacent results files.

Standalone native Uint8Array/VSBuffer payloads now copy their visible bytes when the ordinary ArrayBuffer backing store contains more than 4 KiB of excess storage. This avoids cloning an entire Node pool or unrelated large backing store. SharedArrayBuffer values remain shared; graph/nested-buffer aliases retain the existing path. A 64-byte pooled response clones 64 backing bytes instead of 8,192.

Byte channels encode dense plain arrays of at least 32 primitive data properties using the existing JSON wire type, removing per-element buffers and decoder objects. The unchanged baseline decoder reads this representation. Arrays with undefined entries, holes, getters, custom JSON hooks/iterators, binary/complex values or UTF-16 surrogate code units retain the original encoding. The conservative surrogate check preserves the original UTF-8 projection, including replacement of lone surrogates. Non-finite numbers and negative zero keep the legacy projection. JSON can increase wire size: 1,000 fixture keys use 19,895 rather than 18,893 bytes (+5.3%); integers 0–999 use 3,894 rather than 2,875 bytes (+35.4%). This change targets serialization CPU, rather than bandwidth.

## Method

All variants use **identical esbuild es2024, ESM, experimentalDecorators:true, useDefineForClassFields:false** compilation. Preliminary mixed TypeScript/esbuild comparisons were discarded; those compiler differences affected tiny-call results. Linux product Buffer.poolSize is 8 KiB, with any preexisting runtime slab consumed before measurements.

Eight randomized blocks each measure three batches of 1,000 sequential complete echo round trips after 200 warmups. Both endpoints are bidirectional IPCClients. Node v24.22.0 uses native worker-thread MessagePorts; Electron uses a real sandboxed renderer (Node integration disabled) and utility process. The native compaction fixture returns a genuinely pooled buffer from the utility process. The byte fixture uses MessagePorts to isolate byte-channel work; it is not a remote network latency measurement.

All 24 batches contribute to each median in microseconds. No retries, exclusions or outlier removal are used. Background host activity is uncontrolled, so small changes are exploratory and are not statistical-significance claims. **These results do not demonstrate a whole smoke-suite improvement.**

## Results

| Native Electron response | Baseline µs | Candidate µs | Change |
| --- | ---: | ---: | ---: |
| Pooled VSBuffer 64 B | 293.70 | 265.35 | -9.7% |
| Pooled VSBuffer 1 KiB | 296.30 | 249.05 | -15.9% |
| Pooled Uint8Array 64 B | 280.85 | 241.90 | -13.9% |
| Already compact VSBuffer 64 B control | 254.45 | 272.05 | +6.9% |

| Byte-channel fixture | Node baseline µs | Node candidate µs | Change | Electron baseline µs | Electron candidate µs | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Primitive control | 39.11 | 36.67 | -6.2% | 305.25 | 320.35 | +4.9% |
| Small object control | 45.50 | 45.94 | +1.0% | 294.50 | 298.80 | +1.5% |
| Settings control | 250.98 | 252.89 | +0.8% | 554.15 | 548.20 | -1.1% |
| 1,000 keys | 1591.88 | 651.20 | -59.1% | 4506.50 | 1122.00 | -75.1% |

Unchanged native Node controls range from -10.2% to +2.4%; retain them as evidence of local variability, rather than attributing the primitive difference to this byte-array optimization. All control regressions remain in the samples.

Complete samples, exact baseline/candidate sources, compiler version, hashes and primary harness snapshots are in `ipc.compact-arrays.node.results.json`, `ipc.compact-arrays.compact.renderer.results.json` and `ipc.compact-arrays.arrays.renderer.results.json`. The snapshot scripts contain this worktree’s absolute paths; adjust the root to reproduce elsewhere.

## Validation

Seven focused regressions cover compact VSBuffer/Uint8Array snapshots, retained shared memory, the old JSON wire type, undefined/holes/binary/lone-surrogate fallback, getters/JSON hooks and number projection. The two allocation regressions and JSON framing regression fail against baseline. Three thousand seeded differential cases also confirm that the unchanged baseline decoder reads new frames with the same values as the original writer.

The reusable benchmark adds 64 B/1 KiB pooled Node fixtures. After building, run `node out/vs/base/parts/ipc/test/node/ipc.perf.js --bidirectional --transport buffer-message-port --pool-size 8192 --filter keys-1000 --samples 3 --iterations 1000`. Use `--module` for a sibling baseline compiled with the same settings, and `--transport message-port` for native frames.
