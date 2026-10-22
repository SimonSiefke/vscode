# Native RPC optional arguments

Selected implementation: `undefined-v2`, compared with `9fa339be9423a6c4f55d6fdcc5e4bf9ecbae60a5`. A top-level `undefined` formerly forced the entire argument list into mixed binary encoding, preventing notification delivery and introducing UTF-8 buffers and packet copies. Native JSON requests now carry a signed 32-bit mask of undefined argument positions when necessary. Ordinary JSON requests keep the same two-field serialization result and four-entry header.

The mask supports positions 0–31, including the sign bit and all 32 bits set. Larger optional argument lists, binary/wrapped arguments and byte transports retain their ordinary mixed request/reply path. Cancellation tokens are removed before encoding and supplied normally by the receiver. JSON serialization snapshots queued payloads. The same mask enables explicitly opted-in notification methods with optional arguments.

Native optional argument lists now use JSON array-element serialization. Custom key-sensitive `toJSON` implementations and non-JSON argument values can differ from legacy per-argument mixed serialization. Typed DTOs, undefined positions, null values, nested omission, URIs and cancellation are covered; matching extension-host commits are required.

Eight randomized process blocks per comparison, three measured batches per fixture, matching esbuild settings on both sides, Linux 8 KiB Buffer pools. Ordinary controls and optional arguments measure completed sequential request/reply round trips. Notification throughput includes an ordinary checked delivery barrier; it is not individual request latency. Host background activity is uncontrolled. Small local differences remain exploratory.

## Optional arguments

| Fixture | Node change | Electron renderer change |
| --- | ---: | ---: |
| primitive | -25.41% | -13.18% |
| undefined-value | -21.41% | -7.80% |
| small-object | -20.62% | -1.20% |
| settings-100 | -6.16% | -8.23% |
| text-4KiB | -25.06% | -15.00% |

The optional fixtures pass `(value, undefined, 42, undefined)`. The undefined-value fixture also makes the first argument undefined.

## Ordinary calls and mixed/binary controls

| Fixture | Node change | Electron renderer change |
| --- | ---: | ---: |
| primitive | -6.25% | -5.88% |
| small-object | -4.60% | -6.55% |
| settings-100 | -1.61% | +2.57% |
| text-4KiB | +5.24% | +1.56% |
| wrapped-settings-100 | -0.89% | +3.84% |
| workspace-edits-100 | +0.36% | +3.80% |
| notebook-100 | +1.83% | -2.40% |

## Notifications with optional arguments

| Fixture | Node change | Electron renderer change |
| --- | ---: | ---: |
| echo-primitive | +3.43% | +0.49% |
| echo-small-object | +2.21% | -4.03% |
| notify-32-primitive | -77.24% | -70.73% |
| notify-32-settings-100 | -30.50% | -53.16% |
| notify-32-text-4KiB | -54.62% | -59.26% |
| notify-512-primitive | -76.14% | -90.31% |
| notify-512-settings-100 | -33.65% | -56.16% |
| notify-512-text-4KiB | -57.03% | -75.28% |

All notification fixtures check every delivered update and the final value after a barrier. The echo controls use ordinary arguments.

## Held alternatives and validation

The first optional-mask prototype was held after its ordinary primitive controls regressed 7.44% in Node and 9.54% in the renderer. The selected revision folds mask classification into the existing serializer, preserves ordinary object shapes and reads masks only for incoming requests. All first-prototype measurements remain in the raw files.

Five request-bookkeeping variants were also compared. A numeric Map with cached acknowledgement lookup improved the first Node primitive/small-object comparison 13.11%/6.92%, but renderer controls changed +2.18%/+2.23%. The later combined mask/Map comparison did not show a consistent advantage, so the production pending-reply table and cancellation cleanup remain unchanged. Both combined and isolated raw measurements are retained.

Four intended native/batched regression assertions fail before the mask change, with 104 other RPC cases passing. Twelve additional cases across binary/native/batched modes cover mask boundaries, all-undefined lists, null values, payload snapshots, notification delivery and cancellation. The complete selected Node set passes 250 cases. The combined Electron/API run passes 1,341 cases with three pre-existing pending; six child-process tests pass. Full client typechecking, focused lint and hygiene are checked for the final candidate.

The expanded combined test inventory initially exhausted byte actor IDs because the fixture constructed a new actor before every test. Its main actor now has one stable ID per mode, as production actors do. Fake clocks also clear native timers owned by the surrounding runner. The original failing combined logs are retained locally; no test is disabled.

These are RPC component measurements. They do not demonstrate a 10–20% complete smoke-suite improvement.
