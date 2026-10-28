from pathlib import Path
import json,re,statistics,subprocess,os,hashlib
p=Path(__file__).resolve().parent; source=Path('/home/simon/.cache/vscode-ipc-opt-20261022')
phases={f'{kind}-{phase}-{schedule}':count*fixtures*variants for kind,fixtures in [('rpc',3),('binary',2)] for phase,count,variants in [('aa',10,2),('comparison',20,3)] for schedule in [1,32]}
samples=[]
for phase,count in phases.items():
 manifest=json.loads((p/phase/'manifest.json').read_text());assert len(manifest['samples'])==count
 for row in manifest['samples']:
  assert row['status']=='success';value=json.loads((p/phase/row['path']).read_text());assert value['measuredLogicalCalls']==8192;samples.append(value)
assert len(samples)==800
identity=json.loads((p/'rpc-source-identity.json').read_text())
for name,digest in identity['modules'].items():assert hashlib.sha256((source/'out/vs/workbench/services/extensions/common'/name).read_bytes()).hexdigest()==digest
assert subprocess.run(['git','diff','--quiet',identity['sourceHead'],'--','src/**/*.ts'],cwd=source).returncode==0
ui=json.loads((p/'ui-comparison/manifest.json').read_text());assert len(ui['samples'])==38 and all(row['valid'] for row in ui['samples'])
full=[s for s in ui['samples'] if not s['label'].startswith('pilot')];assert len(full)==32 and all(set(s['counts'].values())=={37} for s in full)
ansi=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
def tests(name):
 text=ansi.sub('',(p/name).read_text());passed=re.findall(r'(\d+) passing',text);assert passed and not re.search(r'\d+ failing',text)
 pending=re.findall(r'(\d+) pending',text);return {'passing':int(passed[-1]),'pending':int(pending[-1]) if pending else 0}
validation={name:tests(name+'.log') for name in ['final-focused-electron-tests','final-api-electron-tests','final-policy-tests']}
rows=json.loads((p/'focused-comparison-summary.json').read_text())['rows'];uiRows=json.loads((p/'ui-comparison-summary.json').read_text())['rows']
allocation={}
for fixture in ['primitive','small-object']:
 allocation[fixture]={}
 for variant in ['control','native-unbatched','native-batched']:
  values=[json.loads(f.read_text()) for f in (p/'allocations').glob(f'[0-5]-{fixture}-{variant}.json')];assert len(values)==6 and all(v['completedCalls']==1000 for v in values)
  allocation[fixture][variant]=statistics.median(v['sampledBytesPerCall'] for v in values)
versions={}
for label,root in [('before',p/'baseline'),('after',source)]:
 versions[label]=json.loads(subprocess.check_output([str(root/'.build/electron/code-oss'),'-p','JSON.stringify(process.versions)'],env={**os.environ,'ELECTRON_RUN_AS_NODE':'1'},text=True))
(p/'electron-runtime-versions.json').write_text(json.dumps(versions,indent=2))
summary={'sourceHead':identity['sourceHead'],'targetProcesses':len(samples),'measuredRPCs':sum(s['measuredLogicalCalls'] for s in samples),'uiLaunches':len(ui['samples']),'fullUiActions':sum(sum(s['counts'].values()) for s in full),'pilotActions':sum(sum(s['counts'].values()) for s in ui['samples'] if s['label'].startswith('pilot')),'validation':validation,'sampledJavaScriptBytesPerCall':allocation}
(p/'final-validation.json').write_text(json.dumps(summary,indent=2))
def pc(value):return f'{value:+.1f}%'
def estimate(entry):
 low,high=entry['intervalPercent'];return f"{pc(entry['medianPairedChangePercent'])} [{pc(low)}, {pc(high)}]"
def find(fixture,schedule):return next(r for r in rows if r['fixture']==fixture and r['concurrency']==schedule and r['comparison']=='native-batched vs byte')
table=['| Fixture | Sequential instructions | Sequential elapsed | Batch-32 instructions | Batch-32 elapsed |','| --- | ---: | ---: | ---: | ---: |']
for fixture in ['primitive','small-object','text-64KiB','binary-64','binary-64KiB']:
 a,b=find(fixture,1),find(fixture,32)
 table.append('| '+fixture+' | '+' | '.join(pc(r['metrics'][m]['medianPairedChangePercent']) for r,m in [(a,'instructions'),(a,'elapsedMs'),(b,'instructions'),(b,'elapsedMs')])+' |')
uiTable=['| Scenario | 37-action total, paired change and conservative interval | A/A control |','| --- | ---: | ---: |']
for scenario in ['activity-bar-toggle','editor-open']:
 ab=next(r for r in uiRows if r['scenario']==scenario and r['phase']=='ab');aa=next(r for r in uiRows if r['scenario']==scenario and r['phase']=='aa')
 uiTable.append(f"| {scenario} | {estimate(ab['fixedWorkEstimate'])} | {estimate(aa['fixedWorkEstimate'])} |")
report=f'''# Isolated structured-clone RPC: current evidence

Runtime source: `{identity['sourceHead']}`. The legacy RPC engine and three byte transport implementation files match base `416e5d6b0db90081fddd1d62c9a905cdeb9ebcff`. All ordinary RPC comparisons use these engines on the same candidate dependency graph; they isolate engine behavior rather than all application changes. UI compares complete development builds at that base and the candidate source, with the same frozen harness and fixtures.

## Validation

- Client typechecking and targeted lint (43 files) pass. Source commits pass normal index hygiene.
- Final focused Electron tests: {validation['final-focused-electron-tests']['passing']} passing, {validation['final-focused-electron-tests']['pending']} pending.
- Broader extension API Electron tests: {validation['final-api-electron-tests']['passing']} passing, {validation['final-api-electron-tests']['pending']} pending. These suites overlap the focused run; counts are not added as unique tests.
- Policy/native managed settings tests: {validation['final-policy-tests']['passing']} passing. The repository layer checks pass.
- Both complete development builds have all 34 built-in desktop entrypoints and the codicon font. The isolated driver uses its declared Node version; product commands use the product's declared Node version.
- New regressions cover threshold/nested getters, primed real-port terminal start/data/end with the actual stream reader, provider error classifications, exact file bytes and offsets, early native frames during handshakes, reentrant FIFO delivery, disposal, and native actor cancellation.

## Fixed completed RPC work

800 independent unprofiled Node target processes (plus four plumbing processes), each with a real MessagePort peer in a worker thread, complete {summary['measuredRPCs']:,} measured RPCs. Each fixture/schedule has a separate ten-pair identical-engine A/A control and twenty fixed three-label comparisons: byte, native without batching, and native with batching. Every process completes 4,096 warmup calls, GC before counting, and 8,192 measured calls. Returned fixture values and exact completed actor counts are validated. Both user and kernel instructions cover the target process and inherited threads with at least 99% counter coverage.

Instructions measure work rather than CPU seconds. The table shows paired median changes; [all conservative intervals and controls](focused-comparison-summary.json) also report CPU time, elapsed time, packets and the batching increment. No multiple-comparison correction is applied. No samples, bands or unfavorable fixtures are removed. Runtime/harness source identities and all original counters/logs are included.

'''+ '\n'.join(table)+'''

The 64-KiB binary results are mixed: sequential elapsed increases and batched instructions increase, with variation overlapping the corresponding A/A controls. These possible costs remain visible; there is no universal binary performance claim. The source uses an explicit byte-codec envelope for binary RPC and does not batch those buffers. The unbatched/batched binary contrast itself is inconclusive; no causal attribution is made from a noisy timing difference. No source change was selected by dropping those rows.

## Allocation diagnostic

Both real Node MessagePort peers run in one isolate for this separate diagnostic. Six fresh processes per label/fixture profile 1,000 completed ordinary sequential RPCs after 4,096 warmup calls and GC, using interval-1 V8 sampling with collected objects included. These are sampled JavaScript allocation estimates, excluding native/external allocation and retained memory. Disposable-construction tracking is instrumented diagnostic evidence, not an unprofiled timing result.

'''
for fixture,values in allocation.items():report+=f"- {fixture}: byte {values['control']:.1f}, native unbatched {values['native-unbatched']:.1f}, native batched {values['native-batched']:.1f} sampled JS bytes/call ({pc((values['native-batched']/values['control']-1)*100)} for native batched).\n"
report+='''
Three independent count-doubling calibration profiles use 2,000 calls. The per-call estimates remain within approximately 2% of the corresponding 1,000-call medians. All 39 profiles and constructor/traffic diagnostics are retained. `backingBytes` counts raw byte-array backing stores only; it is not a comparable native wire-size measurement.

## Real Electron UI

Six plumbing/pilot launches pass before expanding to sixteen identical-build control launches and sixteen balanced before/after launches. Every full launch runs both originally non-skipped scenarios exactly 37 times: 2,368 full-campaign actions plus 36 pilot actions. Every launch has a fresh profile, zero failed/skipped actions, and no detected built-in extension activation error. Profile contents and unrelated user state are excluded from publication; timings, commands and logs are retained.

The independent application launch is the statistical unit. The table compares the sum of all 37 measured action durations in each scenario. Per-launch action medians are retained as a separate descriptive estimate. Setup/teardown and total CLI duration are recorded separately. Timing excludes heap snapshots, allocation instrumentation and forced GC; the harness's memory path is gated off. Action timings still include UI automation and polling, and total suite duration includes substantial readiness/setup overhead. These two scenarios do not establish a whole-suite or startup speedup.

'''+ '\n'.join(uiTable)+'''

The fixed scenario list, harness patch, exact commands and launch order were frozen before the UI campaign. Completed operations within a launch are correlated and are not treated as 37 independent samples. The shared host is not exclusively reserved or CPU-pinned; controls and full distributions remain part of the result.

## Reproduction and historical evidence

See `measurement-plan*.json`, `rpc-source-identity.json`, `rpc-runtimes.json`, `rpc-harness/`, `rpc-binary-harness/`, `run-ui-comparison.py`, `ui-timing-harness.patch`, and the per-phase manifests. Paths identify the original local worktrees; use the recorded revisions and adapt roots when reproducing. `summarize-comparisons.py` computes paired log-ratio medians with conservative binomial/order-statistic intervals. Unprofiled RPC, allocation and UI scopes remain separate and their gains are not multiplied.

Earlier packaged API, startup, smoke and allocation experiments remain historical evidence under `performance/20261025` on the existing evidence branch. They do not establish the performance of this refactored source.
'''
(p/'REPORT.md').write_text(report)
(p/'primary-results-table.md').write_text('\n'.join(table)+'\n')
(p/'ui-results-table.md').write_text('\n'.join(uiTable)+'\n')
print(json.dumps(summary,indent=2))
