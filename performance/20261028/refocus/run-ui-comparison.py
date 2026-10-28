from pathlib import Path
import os,subprocess,json,time,shutil,collections,hashlib,sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'rpc-harness'))
from benchmark_process import run_owned
root=Path(__file__).resolve().parent
driver=root/'driver'
variants={'before':root/'baseline','after':Path('/home/simon/.cache/vscode-ipc-opt-20261022')}
scenarios=['activity-bar-toggle','editor-open']
output=root/'ui-comparison'
output.mkdir(exist_ok=False)
manifest={'driverHead':subprocess.check_output(['git','-C',str(driver),'rev-parse','HEAD'],text=True).strip(),'driverPatchSHA256':hashlib.sha256((root/'ui-timing-harness.patch').read_bytes()).hexdigest(),'variants':{k:subprocess.check_output(['git','-C',str(v),'rev-parse','HEAD'],text=True).strip() for k,v in variants.items()},'scenarios':scenarios,'samples':[],'statisticalUnit':'independent application launch; operations within a launch are correlated'}
(output/'manifest.json').write_text(json.dumps(manifest,indent=2))
def sample(label,variant,runs):
 target=output/label;target.mkdir()
 command=['xvfb-run','-a','node','packages/cli/bin/test.js','--cwd','packages/e2e','--vscode-path',str(variants[variant]/'scripts/code.sh'),'--runs',str(runs),'--timeout-between','0','--run-mode=import']
 env={**os.environ,'VSCODE_SKIP_PRELAUNCH':'1','RPC_UI_SCENARIOS':json.dumps(scenarios),'RPC_UI_TIMING_FILE':str(target/'stages.jsonl')}
 (target/'command.json').write_text(json.dumps({'command':command,'variant':variant,'runs':runs,'selectedScenarios':scenarios},indent=2))
 print('Start',label,variant,flush=True)
 started=time.monotonic()
 with (target/'process.log').open('w') as log:
  result=run_owned(command,cwd=driver,env=env,stdout=log,stderr=log,timeout=300)
 elapsed=(time.monotonic()-started)*1000
 stages=[json.loads(line) for line in (target/'stages.jsonl').read_text().splitlines()] if (target/'stages.jsonl').exists() else []
 counts=collections.Counter(Path(row['file']).stem for row in stages if row['stage']=='run' and row['status']=='passed')
 failures=[row for row in stages if row['status']!='passed']
 activationErrors=[]
 profile=driver/'.vscode-user-data-dir'
 if profile.exists():
  for path in profile.glob('logs/**/exthost.log'):
   for line in path.read_text(errors='replace').splitlines():
    if 'failed' in line.lower() and ('activat' in line.lower() or 'cannot find module' in line.lower()):activationErrors.append(line)
 summary={'label':label,'variant':variant,'exitCode':result.returncode,'totalElapsedMs':elapsed,'counts':dict(counts),'failures':failures,'activationErrors':activationErrors,'expectedCounts':dict.fromkeys(scenarios,runs)}
 summary['valid']=result.returncode==0 and dict(counts)==dict.fromkeys(scenarios,runs) and not failures and not activationErrors
 (target/'result.json').write_text(json.dumps(summary,indent=2));manifest['samples'].append(summary);(output/'manifest.json').write_text(json.dumps(manifest,indent=2))
 for name in ['.vscode-user-data-dir','.vscode-test-workspace']:
  path=driver/name
  if path.exists():shutil.move(str(path),str(target/name))
 print(label,summary,flush=True)
 if not summary['valid']:raise SystemExit('Functional pilot/campaign failure; all original evidence retained')
for pair in range(2):
 for label in ['a','b']:sample(f'pilot-aa-{pair}-{label}','before',3)
for variant in ['before','after']:sample('pilot-ab-'+variant,variant,3)
if os.environ.get('RPC_UI_PILOT_ONLY')=='1':raise SystemExit(0)
for pair in range(8):
 for label in ['a','b'] if pair%2==0 else ['b','a']:sample(f'aa-{pair}-{label}','before',37)
for pair,order in enumerate(['AB','BA','BA','AB']*2):
 for label in order:sample(f'ab-{pair}-{label}','before' if label=='A' else 'after',37)
print('Completed UI controls and comparisons',flush=True)
