# Renderer CPU and compact-only startup confirmation

Compare source `218b977159b5a4bc24268ca3c12795e6f6d5437d` with selected compact frames `18f8cde2f9d038bd1fb4b868a381fea98ea1aca8`.

Actual Node-disabled Electron renderer and utility-process MessagePorts: 50 independent balanced pairs per fixture, 16,384 warmup and 32,768 measured calls/process at concurrency32. Linux hardware counters are gated after warmup and full GC; counts cover inherited application processes/threads, excluding Xvfb. Values and exact remote executed-call counts are validated. Every reported counter runs100% of the measured interval. Primary user instruction changes: primitive -14.52% (95% exploratory paired interval -14.60% to -14.50%); small object -11.29% (-11.44% to -11.23%); settings100 -0.87% (-0.95% to -0.78%). These are CPU-work changes, not wall-clock startup improvements.

An independent10-pair identical-code renderer A/A calibration has all three userspace intervals crossing zero. Full samples, raw counters, process logs, hashes and the exact renderer harness are included. Compiled/source runtime snapshots and Node/allocation evidence are in the preceding immutable evidence artifact at commit1b7746ad33021ff281ff7a8ffafc7a3a00f63a8d, performance/20261025. The runtime-map paths are local; update them after extracting to a different root. Use matching Electron43.7.7 and compiled ESM imports as described in that artifact.

Compact-only product startup: run40209708548, 50 alternating pairs in each of four scenarios,400 successful measured launches. All four paired intervals include zero. Median changes range from -0.56% to +0.17%; no detectable startup gain. The13.46-second first cold baseline launch is retained. Means, medians, extremes, workflow intervals and all raw application/cache-policy files are included.

The compressed artifact has a SHA256 manifest for every file. Renderer browser-profile caches are excluded; measurement results and logs are retained. Exploratory intervals use10,000 bootstrap resamples without a multiple-comparison correction. No data from separate hosts/topologies is pooled.
