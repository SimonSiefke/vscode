# Native batches, observed promises and scalar arguments

Selected implementation: `aac6b0fcf3bc6714c8cd7e7dd9fa1bfe6618ba25`. Baseline core: `37e23c02fb542e78dadf80a205dbada712e60406`. These are frozen core overlays on the pre-main-merge foundation, Node 24.22.0 / Electron 43.7.7. They are not current packaged application startup results. Both source labels and exact compiled runtime hashes are retained.

54 paired independent processes per ordinary/string fixture and topology; 12 per asynchronous/sequential/binary control. 2,880 total processes validate values, executed counts and hardware-counter coverage. Balanced ordering, explicit warmup, unprofiled user instructions, exploratory 95% paired bootstrap intervals without multiple-comparison correction.

| Fixture | Node change [95% interval] | Renderer/utility change [95% interval] |
| --- | ---: | ---: |
| ordinary / primitive | -22.152% [-22.973%, -21.684%] | -28.591% [-28.609%, -28.566%] |
| ordinary / small-object | -7.317% [-7.530%, -6.908%] | -15.709% [-15.739%, -15.672%] |
| ordinary / settings-100 | -0.076% [-0.182%, +0.046%] (inconclusive) | -2.449% [-2.509%, -2.371%] |
| strings / text-4KiB | -58.977% [-59.030%, -58.903%] | -47.085% [-47.109%, -47.035%] |
| strings / text-64KiB | -87.380% [-87.400%, -87.333%] | -56.950% [-57.057%, -56.821%] |
| strings / text-escaped | -87.833% [-87.844%, -87.806%] | -80.021% [-80.036%, -79.985%] |
| resolved / primitive | -20.068% [-20.175%, -19.913%] | -26.197% [-27.082%, -26.148%] |
| resolved / small-object | -9.177% [-9.407%, -9.008%] | -14.312% [-14.370%, -14.183%] |
| resolved / settings-100 | -0.012% [-0.327%, +0.425%] (inconclusive) | -2.585% [-2.758%, -2.510%] |
| deferred / primitive | -7.082% [-7.462%, -6.716%] | -5.168% [-5.374%, -4.974%] |
| deferred / small-object | -2.433% [-2.556%, -2.046%] | -2.580% [-2.744%, -2.380%] |
| deferred / settings-100 | -0.298% [-0.435%, -0.056%] | -2.100% [-2.235%, -1.969%] |
| sequential / primitive | -8.178% [-8.284%, -8.098%] | -3.539% [-3.573%, -3.520%] |
| sequential / small-object | -3.105% [-3.163%, -3.008%] | -1.739% [-1.817%, -1.711%] |
| sequential / settings-100 | -0.396% [-0.718%, +0.071%] (inconclusive) | -0.168% [-0.256%, -0.102%] |
| binary12 / buffer-64B | +2.011% [+0.160%, +4.283%] | +0.414% [+0.313%, +0.477%] |
| binary12 / buffer-512B | +2.012% [-0.425%, +3.171%] (inconclusive) | +0.364% [+0.295%, +0.476%] |
| binary12 / buffer-64KiB | +3.122% [-2.232%, +16.247%] (inconclusive) | +0.149% [-0.406%, +0.518%] (inconclusive) |
| binary12 / wrapped-buffer-64B | +0.544% [+0.053%, +1.281%] | +0.194% [+0.059%, +0.437%] |

Small binary regressions are retained: Node 64-byte replies +2.01% and wrapped buffers +0.54%; renderer 64/512-byte replies +0.41/+0.36%. Larger binary controls are inconclusive. Selection trades these costs against substantial scalar/JSON gains; no claim of universal improvement.

Detached migration retained completed samples. One incompletely annotated attempt is archived and restarted; full primary results retain every complete pair, with a separate pre/post-migration sensitivity analysis. Both prior startup-resource comparisons retain missing CPU windows explicitly, without zero substitution or pooling hardware/source baselines.

Selected source validation: 319 Node tests, 1,584 Electron/API/authentication tests, three existing pending, client typechecking, targeted lint and normal commit hygiene. Nine scalar regressions fail before the implementation. No 10–20% whole-product improvement is established. Current merged-base packaged comparison is separate.

Archive SHA-256: `bc3704a8354fa93aaec0ce6a2404c4f8d60214602414e64594581dc0f44c0b3e`.
