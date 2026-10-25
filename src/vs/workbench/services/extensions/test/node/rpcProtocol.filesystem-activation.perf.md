# Share local filesystem activation barriers

The captured chat scenario sends 91 `$ensureActivation` RPCs immediately before operations on an already local filesystem provider. Each operation otherwise takes the local provider shortcut. Keep the first activation barrier per provider registration, share concurrent activation, remember successful activation, and clear failed activation for retry. Disposing and re-registering a provider creates a fresh barrier. The extension service already remembers requested activation events when deciding whether to activate later-added extensions. Main-thread remote, readonly write, trash, copy and rename paths retain their existing behavior.

## Actual API component benchmark

Both variants use the real `ExtHostConsumerFileSystem.value` API and real `RPCProtocol`/`RPCMessagePort`, with a fixed local filesystem provider and a remote activation handler returning an immediate async result. Node uses a separate worker thread; Electron uses a renderer without Buffer and a separate utility process. All peers use an 8 KiB Buffer pool. These isolate local API/activation overhead and contain no disk/network waits. They do not predict whole-product gains.

Before/after files use matching esbuild 0.27.2 options (ES2024, ESM, legacy decorators). Eight randomized blocks with seed 3212513, three batches of 256 logical calls per fixture, 64 warmup calls per variant/fixture; fixture and variant orders are randomized within each shared-process block. Every call checks its returned value. Every batch asserts actual outgoing RPC request counts: warm local operations change from 256 to zero after initial activation; cold-provider and remote-stat controls retain 256 requests. Samples within a process are correlated.

| Fixture | Node median change | Renderer/utility median change |
| --- | ---: | ---: |
| cold-1 | -11.46% | +1.00% |
| mixed-32 | -88.46% | -87.50% |
| read4k-1 | -94.31% | -97.30% |
| readdir-1 | -97.10% | -98.87% |
| remote-1 | -1.29% | +3.35% |
| stat-1 | -96.72% | -99.13% |

Negative means faster. Cold activation and remote-stat controls are retained, including renderer controls of +1.00% and +3.35%. The large warm-local gains remove a transport round trip; they are not a 10–20% full-smoke result.

## Real scenario diagnostic

An independently patched, profiled diagnostic package runs the two unchanged smoke scenarios (restored editors and Copilot CLI chat), with zero failures, zero pending and no retries. The preceding authentication/notification diagnostic observes 9, 7 and 91 activation RPCs across the three launches. The filesystem diagnostic observes 1, 1 and 1. These are separate executions with scheduling differences; profiled elapsed times are not used for performance claims. The package keeps the original minified bindings and copies the exact selected activation helper into both extension-host bundles; six call sites pass their existing local provider records to it. Manifests include original and modified bundle hashes. Production contains no diagnostic logging.

## Verification

Before the production change, the real public-API regression suite has 2 passing checks and 4 intended assertion failures: sequential and concurrent duplicate activation, retry after successful activation, and provider-registration isolation. With the change it passes all five cases plus disposable tracking. Coverage includes safe-copy results, no provider I/O before activation completes, failure retry, concurrent reads, disposal/re-registration during an earlier pending activation, readonly writes, writable-provider trash, rename/copy, and no-local-provider fallback. Combined transport, API and authentication-service suites: 1,495 passing, 3 pre-existing pending. Targeted lint passes; client typecheck status is recorded with the selected commit.

All component samples, controls, exact sources, diagnostics, hashes and test output are in `rpcProtocol.filesystem-activation.perf.results.json`. The benchmarked production source is the selected source without additional changes. The 10–20% full-suite target remains unverified.
