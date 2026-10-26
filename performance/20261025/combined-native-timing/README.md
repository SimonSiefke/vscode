# Supplementary fixed-work native RPC timing

Same completed54paired independent processes per ordinary/string fixture and topology as combined core evidence. No extra measurements, no sample selection, no profiler. Intervals use a conservative distribution-free95% order-statistic interval for the median paired log ratio; this is distinct from the primary instruction bootstrap intervals. No multiple-comparison correction. These are isolated RPC round trips, not application startup or smoke-suite timings.

| Fixture | Node elapsed change [95% interval] | Renderer/utility elapsed change [95% interval] |
| --- | ---: | ---: |
| primitive | -5.15% [-11.08%, +0.75%] (inconclusive) | -4.98% [-12.07%, +0.81%] (inconclusive) |
| small-object | +4.23% [-2.97%, +7.33%] (inconclusive) | -2.74% [-6.99%, +2.77%] (inconclusive) |
| settings-100 | -2.01% [-4.91%, +0.43%] (inconclusive) | -3.03% [-5.16%, +1.26%] (inconclusive) |
| text-4KiB | -37.33% [-41.92%, -33.14%] | -15.41% [-22.33%, -11.62%] |
| text-64KiB | -62.98% [-65.24%, -62.09%] | -8.71% [-9.84%, -7.04%] |
| text-escaped | -58.87% [-62.21%, -55.37%] | -46.82% [-48.89%, -43.53%] |

All six ordinary elapsed intervals include zero. All six string intervals exclude zero. Node primitive/small-object process CPU time falls21.21/13.56%, intervals[-26.38,-17.97]/[-19.69,-10.93]%; these CPU-time improvements do not establish elapsed improvement for those ordinary workloads. User plus kernel instructions fall in every string workload, despite higher kernel contributions in some large-string cases. In renderer64KiB, user instructions fall56.95%, total user+kernel instructions fall30.51%, and elapsed falls8.71%; these quantities must not be conflated. Full total-instruction, Node CPU-time, asynchronous/sequential and binary results are retained in summary.json.

Selected core: aac6b0fcf3bc6714c8cd7e7dd9fa1bfe6618ba25. Baseline core:37e23c02fb542e78dadf80a205dbada712e60406. Frozen pre-main-merge foundation and runtime; later19-method metadata commit264f9bc is separate and has all23productioncallsite audit + API validation logs in audit/.
