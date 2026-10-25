# IPC measurements, 25 October 2026

Production comparison: `218b977159b5a4bc24268ca3c12795e6f6d5437d` → `18f8cde2f9d038bd1fb4b868a381fea98ea1aca8`. This branch preserves research evidence; the implementation is on the existing PR #321 branch.

The [measurement archive](./measurements.tar.gz) contains all completed samples, source and compiled hashes, frozen compiled runtimes, allocation profiles, A/A controls, held experiments and the startup workflow's raw results. Verify its SHA-256 using [the manifest](./manifest.json). The source is covered by the repository MIT license, also included in the archive.

## Selected change

Fifty independent paired processes per fixture use actual RPCProtocol and RPCMessagePort implementations over worker-thread MessagePorts. Both versions use identical compilation options. Counts start after 16,384 warmup calls and full GC in both isolates, and cover 32,768 logical calls per process at concurrency 32. Returned values and the remote handler's exact request count are verified. Linux hardware counters include inherited worker/JIT/GC threads. Separate worker-thread and child-process arithmetic probes verify counting coverage with events initially disabled. Variant order is balanced and fixture order randomized. The exploratory intervals use 10,000 paired bootstrap resamples of median log-ratios, without multiple-comparison correction.

| Fixture | Median paired retired-user-instruction change | 95% interval |
| --- | ---: | ---: |
| Primitive | −18.14% | [−18.52%, −17.80%] |
| Small object | −13.67% | [−13.90%, −13.02%] |
| Settings object, 100 keys | −0.59% | [−0.70%, −0.51%] |

Separate allocation diagnostics use three fresh processes per version/fixture, 10,000 real MessagePort calls per process, and V8 sampling at a 1,024-byte interval including collected objects. Both peers share one process in this diagnostic. Estimated median allocated bytes/call drop 4,013 → 3,161 (−21.24%) for primitives and 4,547 → 3,672 (−19.25%) for small objects. Exact tracked DisposableStore constructions drop from 10,000 to zero in every candidate process. These are allocation estimates and exact constructor counts, respectively—not retained heap or whole-product gains.

The archive retains the 50-process Node and renderer A/A latency studies, ten-pair A/A hardware-counter study, preliminary ten-pair candidate counter study, all sampled profiles and all rejected broad-clone/larger-batch controls. A FIFO acknowledgement plumbing failure is retained separately from valid measurements. There are no measurement retries or outlier exclusions.

## Startup

[Workflow 40204577508](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40204577508) compares upstream `4df8bb183f0e984e97d8f4200c802c49061d7d3c` with the preceding `6e1e253fc47b04643a6bee09f445ed32753f7448`, with 50 alternating pairs each for cold/warm empty/workspace startup. All 400 measured launches pass. Warm workspace startup has a −3.65% median change and a paired interval excluding zero. The other three scenarios are inconclusive. All cold-start outliers are retained. These precede the selected compact-frame increment and must not be attributed to it.

The compact-only startup campaign and further renderer counters are still being collected. No 10–20% whole-product improvement is claimed.

## Reproduction

`perf-final50/harness` contains the exact hardware-counting scripts used for the selected comparison. `baseline-runtime` and `compact-runtime` contain their compiled core modules, with matching `selected-snapshot.json` metadata and source files under `selected-sources`. Node mode requires Node 24 and Linux perf; no npm dependencies are needed for the frozen runtime. Update the absolute root paths in `selected-runtimes.json` for your extraction location, then pass that mapping to `perf-pairs.py --runtime-map`. The archived Electron symlink is intentionally omitted; renderer experiments require the matching Electron executable from the VS Code checkout. The sources and hashes for the held protocol variants are included for reference. Profiling, allocation sampling and hardware instruction counting are separate campaigns.
