# RPC proxy getter allocation optimization

The current `4a7ffd59` RPCProtocol source is byte-for-byte identical to the frozen measured control. The small first-use method factory change in source commit `01727f8ddcdc94276b35b7e417b9c39e49708253` compiles byte-for-byte to the measured candidate (`f27977b35f913f8a952972532ab4b02a3790dfa6da5f1121baab8841201ca80c`). Notification/native-promise metadata, null-prototype caching/overrides and server actor lookup are preserved. Current RPC/MessagePort/serialization/completion tests pass all202 cases, with lint and normal commit hygiene.

This is selected as an allocation optimization. A separate calibrated interval-1 V8 diagnostic has six fresh processes per label/fixture,1000 sequential real MessagePort RPCs after16384 warmup andGC, both peers in one process. Median sampled JS bytes fall2.60% for primitive and1.39% for small-object RPCs. These estimates exclude native/external memory, are not exact allocation counts, and have no CPU-time interpretation. Missing getter frame attribution stays null rather than zero. All24 profiles and totals are retained.

The independent cohort has ten identical-binary A/A pairs and fifty fixed before/after pairs per ordinary/deferred/sequential cell and topology:960 unprofiled processes plus8 plumbing launches. Exactly one of eight total-instruction intervals excludes zero (ordinary renderer primitive,-0.121%); the other seven total and all eight elapsed intervals include zero. Node ordinary primitive kernel instructions rise2.321% [0.804%,4.314%], while total/elapsed are inconclusive. Identical-binary false positives include Node ordinary total-3.627% and sequential total-0.274%; neither is removed. There is no broad CPU, startup, whole-smoke or packaged-API speedup claim, and no multiplication with independent earlier gains. The original52 exploratory comparisons and24 profiles remain separate rather than pooled.

Tables show paired median changes and95% intervals. User/kernel are the original exploratory bootstrap; total/elapsed use conservative sign/order statistics. No multiple-comparison correction.

## Independent fixed50 comparisons

| Cell | Fixture | User instructions | Kernel instructions | Total instructions | Elapsed |
| --- | --- | --- | --- | --- | --- |
| ordinary-final50-node | primitive | -1.259% [-1.805,-0.109] | +2.321% [+0.804,+4.314] | -1.060% [-1.658,+0.099] (inconclusive) | +2.079% [-2.932,+5.750] (inconclusive) |
| ordinary-final50-node | small-object | -0.094% [-0.478,+0.036] (inconclusive) | +0.453% [-0.775,+2.070] (inconclusive) | -0.072% [-0.547,+0.156] (inconclusive) | +0.299% [-2.316,+2.044] (inconclusive) |
| ordinary-final50-renderer | primitive | -0.130% [-0.180,-0.053] | +0.326% [-0.875,+0.963] (inconclusive) | -0.121% [-0.175,-0.013] | -4.289% [-7.582,+3.046] (inconclusive) |
| ordinary-final50-renderer | small-object | -0.020% [-0.035,+0.010] (inconclusive) | +0.541% [-0.428,+1.624] (inconclusive) | +0.003% [-0.032,+0.103] (inconclusive) | +1.556% [-2.569,+6.929] (inconclusive) |
| deferred-final50-node | primitive | -0.129% [-0.267,+0.064] (inconclusive) | -1.322% [-4.681,+5.386] (inconclusive) | -0.233% [-0.484,+0.353] (inconclusive) | -0.353% [-10.210,+8.250] (inconclusive) |
| deferred-final50-renderer | primitive | -0.032% [-0.198,+0.083] (inconclusive) | -0.257% [-1.274,+0.304] (inconclusive) | -0.017% [-0.244,+0.154] (inconclusive) | +0.137% [-7.987,+7.708] (inconclusive) |
| sequential-final50-node | primitive | -0.116% [-0.172,-0.082] | +0.139% [-0.089,+0.648] (inconclusive) | -0.042% [-0.190,+0.093] (inconclusive) | +0.105% [-1.744,+2.881] (inconclusive) |
| sequential-final50-renderer | primitive | -0.073% [-0.142,-0.023] | +0.151% [-0.170,+0.414] (inconclusive) | +0.016% [-0.184,+0.102] (inconclusive) | +0.242% [-2.130,+2.476] (inconclusive) |

## Identical-binary A/A controls

| Cell | Fixture | User instructions | Kernel instructions | Total instructions | Elapsed |
| --- | --- | --- | --- | --- | --- |
| ordinary-aa10-node | primitive | -3.607% [-6.012,-0.700] | -0.467% [-7.819,+2.978] (inconclusive) | -3.627% [-6.098,-0.793] | -10.571% [-19.656,+5.203] (inconclusive) |
| ordinary-aa10-node | small-object | +0.262% [-1.833,+3.417] (inconclusive) | -0.404% [-4.708,+3.616] (inconclusive) | +0.180% [-3.504,+3.743] (inconclusive) | -5.287% [-13.435,+5.115] (inconclusive) |
| ordinary-aa10-renderer | primitive | -0.008% [-0.045,+0.036] (inconclusive) | -0.211% [-3.656,+2.047] (inconclusive) | +0.008% [-0.391,+0.317] (inconclusive) | -1.110% [-8.008,+15.486] (inconclusive) |
| ordinary-aa10-renderer | small-object | -0.028% [-0.066,+0.005] (inconclusive) | +2.437% [+0.741,+4.769] | +0.172% [-0.115,+0.357] (inconclusive) | +1.829% [-1.471,+14.093] (inconclusive) |
| deferred-aa10-node | primitive | +0.170% [-0.537,+0.863] (inconclusive) | -1.806% [-8.110,+8.117] (inconclusive) | +0.178% [-0.823,+0.790] (inconclusive) | -8.790% [-26.958,+5.673] (inconclusive) |
| deferred-aa10-renderer | primitive | -0.186% [-0.612,+0.186] (inconclusive) | +0.125% [-1.909,+1.939] (inconclusive) | -0.103% [-0.875,+0.730] (inconclusive) | -4.560% [-9.131,+16.661] (inconclusive) |
| sequential-aa10-node | primitive | +0.090% [-0.066,+0.197] (inconclusive) | -1.057% [-1.268,-0.556] | -0.274% [-0.532,-0.068] | -4.691% [-10.800,+0.761] (inconclusive) |
| sequential-aa10-renderer | primitive | +0.039% [-0.127,+0.185] (inconclusive) | +0.135% [-0.869,+1.979] (inconclusive) | +0.141% [-0.538,+1.044] (inconclusive) | -0.455% [-6.094,+9.907] (inconclusive) |

Archive SHA-256: `bf22ca76db2410b7a08e5c0049ae537aa423337e082d491a36bc85cdb4a3d1b1`. Complete source, frozen-input hashes, all raw results/counters/process logs, both cohorts, semantic probes and allocation profiles are archived. Named runtime caches are excluded.
