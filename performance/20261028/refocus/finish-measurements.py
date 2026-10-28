from pathlib import Path
import subprocess,os,time,json,datetime
p=Path(__file__).resolve().parent; root=Path('/home/simon/.cache/vscode-ipc-opt-20261022')
def run(command,name,cwd=root,env=None):
 print(datetime.datetime.now(datetime.timezone.utc).isoformat(),name,flush=True)
 with (p/(name+'.log')).open('w') as log:
  result=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=log)
 if result.returncode:raise SystemExit(f'{name} failed ({result.returncode}); original artifacts retained')
while 'Completed all independent-process comparisons' not in (p/'rpc-campaign.log').read_text():
 time.sleep(2)
for schedule in [1,32]:
 for phase,variants,count in [('aa','control,aa-b',10),('comparison','control,native-unbatched,native-batched',20)]:
  name=f'binary-{phase}-{schedule}'
  run(['python3',str(p/'rpc-binary-harness/perf-pairs.py'),'--root',str(root),'--runtime-map',str(p/'rpc-runtimes.json'),'--output',str(p/name),'--variants',variants,'--fixtures','binary-64,binary-64KiB','--replicates',str(count),'--iterations','8192','--warmup','4096','--concurrency',str(schedule)],name)
allocation=p/'allocations';allocation.mkdir(exist_ok=False);runtimes=json.loads((p/'rpc-runtimes.json').read_text())
for replicate in range(6):
 for fixture in ['primitive','small-object']:
  variants=['control','native-unbatched','native-batched']
  if replicate%2:variants.reverse()
  for variant in variants:
   name=f'{replicate}-{fixture}-{variant}'
   options={**runtimes[variant],'fixture':fixture,'iterations':1000,'samplingInterval':1,'batching':variant!='native-unbatched'}
   env={**os.environ,'IPC_OPT_BENCH_OPTIONS':json.dumps(options),'OUTPUT':str(allocation/(name+'.json'))}
   run(['node','--import',str(p/'rpc-harness/product-pool.mjs'),str(p/'rpc-harness/allocations.mjs')],'allocation-'+name,env=env)
# A count-doubling calibration is independent of unprofiled timing.
for variant in ['control','native-unbatched','native-batched']:
 options={**runtimes[variant],'fixture':'primitive','iterations':2000,'samplingInterval':1,'batching':variant!='native-unbatched'}
 env={**os.environ,'IPC_OPT_BENCH_OPTIONS':json.dumps(options),'OUTPUT':str(allocation/('calibration-'+variant+'.json'))}
 run(['node','--import',str(p/'rpc-harness/product-pool.mjs'),str(p/'rpc-harness/allocations.mjs')],'allocation-calibration-'+variant,env=env)
driverVersion=(p/'driver/.nvmrc').read_text().strip().lstrip('v');driverBin=Path('/home/simon/.nvm/versions/node')/('v'+driverVersion)/'bin'
run(['python3',str(p/'run-ui-comparison.py')],'ui-campaign',env={**os.environ,'PATH':str(driverBin)+':'+os.environ['PATH']})
run(['xvfb-run','-a','scripts/test.sh','--no-sandbox','--runGlob','**/{ipc,ipc.mp,rpcProtocol,rpcMessagePort,rpcProtocol.serialization,rpcProtocol.observedVoid,extHostNotifications,extHostFileSystemEventService,extHostFileSystemConsumer,mainThreadAuthentication,extHostTerminalShellIntegration,files,diskFileSystemProviderIpc}.test.js'],'final-focused-electron-tests')
run(['xvfb-run','-a','scripts/test.sh','--no-sandbox','--runGlob','**/workbench/api/test/{browser,common}/**/*.test.js'],'final-api-electron-tests')
run(['python3',str(p/'summarize-comparisons.py')],'comparison-summary')
print('All measurements and final checks completed',flush=True)
