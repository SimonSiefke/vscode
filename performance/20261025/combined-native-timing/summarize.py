from pathlib import Path
import json,math,statistics
p=Path('/home/simon/.cache/ipc-opt-20261025');out={'scope':'Supplementary metrics from the same completed fixed-work, unprofiled paired processes. Separate from full application startup.','intervalMethod':'Distribution-free conservative95% sign/order-statistic interval for population median paired log-ratio; no bootstrap and no multiple-comparison adjustment. All completed pairs retained.','campaigns':{}}
for group in ['ordinary','strings','resolved','deferred','sequential','binary12']:
 for topology in ['node','renderer']:
  name=f'combined-owned-{group}-{topology}';root=p/name;summary=json.loads((root/'summary.json').read_text());n=summary['pairedIndependentProcesses'];tail=0;r=-1
  for i in range(n):
   tail+=math.comb(n,i)/2**n
   if tail<=.025:r=i
   else:break
  assert r>=0;result={}
  for fixture in summary['fixtures']:
   control=[json.loads((root/f'{i:03}-{fixture}-control/result.json').read_text())for i in range(n)]
   candidate=[json.loads((root/f'{i:03}-{fixture}-combined-scalar-arguments-owned/result.json').read_text())for i in range(n)]
   metrics={'elapsedMs':lambda d:d['elapsedMs'],'userPlusKernelInstructions':lambda d:sum(d['counters'][m]['count']for m in ['instructions:u','instructions:k'])}
   if topology=='node':metrics['processCpuMicroseconds']=lambda d:sum(d['processCpuMicroseconds'].values())
   result[fixture]={}
   for metric,read in metrics.items():
    ratios=sorted(math.log(read(a)/read(b))for a,b in zip(candidate,control));lo,hi=[(math.exp(ratios[i])-1)*100 for i in [r,n-1-r]];result[fixture][metric]={'pairs':n,'medianPairedChangePercent':(math.exp(statistics.median(ratios))-1)*100,'intervalPercent':[lo,hi],'inconclusive':lo<=0<=hi,'medianBefore':statistics.median(read(d)for d in control),'medianAfter':statistics.median(read(d)for d in candidate)}
  out['campaigns'][name]=result
  if group in ['ordinary','strings']:
   for fixture,metrics in result.items():
    print(topology,fixture,[(m,round(x['medianPairedChangePercent'],2),[round(y,2)for y in x['intervalPercent']])for m,x in metrics.items()])
(p/'combined-supplementary-orderstats-summary.json').write_text(json.dumps(out,indent=2))
