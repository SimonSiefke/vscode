# Byte-channel codec allocation (2026-10-22)

Compare `0252d16f0d5f870e2606726f03bfb4e0cce074eb` with the exact candidate sources/hashes in the adjacent result files. BufferReader consumes type and VQL bytes directly, avoiding a VSBuffer and typed-array slice for every byte. Other IReader implementations retain the existing read(1) fallback. VQL values 1–255 reuse immutable one/two-byte unpooled buffers, without pinning message slabs. The cache has 256 slots; strict uint8 eligibility preserves coercion behavior for unusual Proxy array lengths. The wire bytes are unchanged.

Eight randomized blocks compare matching esbuild es2024/ESM builds, experimentalDecorators:true and useDefineForClassFields:false. Each fixture warms up and measures three batches of 1,000 complete bidirectional echo calls. Linux product Buffer.poolSize is 8 KiB. Node v24.22.0 uses real worker-thread MessagePorts; Electron uses a real renderer with Node integration disabled and a utility process. The latter carries byte-channel frames. No retries, exclusions or outlier removal occur. Every control is retained; host activity is uncontrolled.

Median microseconds per complete call across all 24 batches:

| Transport | Fixture | Before µs | After µs | Change |
| --- | --- | ---: | ---: | ---: |
| Node byte | primitive | 41.58 | 36.57 | -12.0% |
| Node byte | small-object | 49.70 | 46.00 | -7.4% |
| Node byte | settings-100 | 259.90 | 248.10 | -4.5% |
| Node byte | keys-1000 | 631.98 | 633.30 | +0.2% |
| Electron byte | primitive | 321.95 | 289.20 | -10.2% |
| Electron byte | small-object | 334.65 | 317.20 | -5.2% |
| Electron byte | settings-100 | 576.85 | 541.15 | -6.2% |
| Electron byte | keys-1000 | 1159.10 | 1123.85 | -3.0% |
| Node native control | primitive | 18.38 | 19.02 | +3.5% |
| Node native control | small-object | 32.34 | 33.19 | +2.7% |
| Node native control | settings-100 | 225.92 | 222.52 | -1.5% |
| Node native control | keys-1000 | 299.49 | 305.84 | +2.1% |

Native frames bypass these byte-codec changes. Their small differences illustrate background noise. The byte cache retains at most 383 bytes of new backing storage plus 255 buffer wrappers and the fixed array; zero keeps its existing shared constant. These measurements do not establish the requested 10–20% whole smoke-suite improvement.

Complete samples, sources, hashes and harness snapshots are in `ipc.byte-codec.node.results.json` and `ipc.byte-codec.renderer.results.json`. The scripts contain local worktree paths that must be adjusted elsewhere. Preliminary component variants and a renderer pilot with mixed results informed the experiment; this table uses the final production source, including its strict cache-bound guard.

216 selected Node tests, 216 Electron tests and six child-process IPC integration tests pass, along with full client typechecking, lint and hygiene. Six new cases cover exact VQL wire boundaries, every cached value, stable cached bytes, coercible Proxy lengths, owned backing buffers, mixed reads with view offsets and opaque readers. The cache-bound regression fails on a permissive fractional/string cache prototype and passes with the uint8 guard. Three thousand seeded differential cases and all cached/boundary integer wire bytes were also checked against the unchanged decoder.
