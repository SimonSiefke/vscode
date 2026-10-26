# Packaged combined-core validation and calibration

Startup resources and core compatibility compare a167347ebc4ab8923c027674f602a4f74d39ada5 to aac6b0fcf3bc6714c8cd7e7dd9fa1bfe6618ba25 on the current merged base. A separate functional pair compares aac6b0fc to the metadata-only head 264f9bc0fbf05a94c51fd0f9bc0171095b994a97. No benchmark scopes, source baselines or hosted CPUs are pooled.

## Startup CPU/resources

[Run 40251176145](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40251176145). Four scenarios request 50 independent AB/BA launch pairs each. All 400 launches retain PSS resources; 399 have CPU counters. Task-clock is summed process-tree CPU time, not elapsed startup time. Intervals are exploratory paired bootstrap intervals for median CPU differences in milliseconds; no multiple-comparison correction.

| Scenario | Complete pairs | Median CPU before → after (ms) | Median change | Paired 95% interval (ms) | Hosted CPU |
| --- | ---: | ---: | ---: | ---: | --- |
| startup-empty-cold-resources | 49 | 3927.49 → 3917.64 | -0.251% | [-26.77, +23.01] | AMD EPYC 7763 64-Core Processor |
| startup-empty-warm-resources | 50 | 2176.11 → 2190.14 | +0.644% | [-25.26, +37.11] | AMD EPYC 9V74 80-Core Processor |
| startup-workspace-cold-resources | 50 | 3322.35 → 3290.07 | -0.972% | [-75.19, +60.80] | AMD EPYC 9V45 96-Core Processor |
| startup-workspace-warm-resources | 50 | 2737.80 → 2748.33 | +0.385% | [-22.54, +45.97] | AMD EPYC 9V74 80-Core Processor |

All four intervals include zero. Empty/cold baseline pair 0 has empty perf output; its unmatched after-side CPU value 3930.181784 ms remains retained. No replacement launch, zero substitution or outlier removal is used. These runs do not demonstrate a startup improvement or a 10–20% whole-product speedup. Raw resource, fault/context-switch counters and partial diagnostics remain in the archive.

## Functional compatibility

[Core run 40253184303](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40253184303) and [metadata run 40253420502](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40253420502) each pass the same 62 tests with 68 pending and zero failures in both packages. The original shared smoke harness is reused with the identical local-chat readiness correction. These single pairs establish compatibility for covered cases, not speed. Both raw durations and all logs/screenshots are retained.

## Independent actual-API A/A calibration

Same original 4df package on both labels, ten independent pairs per fixture, 32768completed public-API calls after 16384warmup, concurrency 32. All 60 processes validate results and hardware-counter coverage. This calibration belongs to the separately queued original 4df→37e cumulative campaign; it is not an A/A result for the current merged-base packages.

| Fixture | User-instruction change [95% interval] |
| --- | ---: |
| context-unchanged | +1.232% [-3.681%, +3.487%] |
| context-changing | +0.942% [-0.577%, +5.334%] |
| clipboard-64KiB | +0.263% [-0.659%, +1.526%] |

All user and kernel intervals include zero. Command workloads vary more than clipboard reads; retain every sample and use the planned 50 pairs before interpreting candidate differences.

Archive SHA-256: `ddd1379d32133e75ff05f283c246ace1be12a54210bbd099ba1c239761147aa7`. Manifest contains file-level checksums. Full app packages are identified by exact source and build artifact metadata; they are not duplicated in this evidence archive.
