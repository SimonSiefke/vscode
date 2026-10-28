from pathlib import Path
import json,math,statistics
root=Path(__file__).resolve().parent

def interval(values):
 values=sorted(values);n=len(values)
 ranks=[k for k in range(1,n//2+1) if 2*sum(math.comb(n,j) for j in range(k))/2**n<=.05]
 if not ranks:return [None,None]
 k=max(ranks);return [values[k-1],values[n-k]]
def compare(before,after):
 ratios=[math.log(b/a) for a,b in zip(before,after)]
 change=lambda x:math.expm1(x)*100 if x is not None else None
 return {'pairs':len(ratios),'medianPairedChangePercent':change(statistics.median(ratios)),'intervalPercent':[change(v) for v in interval(ratios)]}
def value(sample,metric):
 if metric=='instructions':return sum(c['count'] for c in sample['counters'].values())
 if metric=='cpuMicroseconds':return sum(sample['processCpuMicroseconds'].values())
 return sample[metric]
rows=[]
for prefix,fixtures in [('rpc',['primitive','small-object','text-64KiB']),('binary',['binary-64','binary-64KiB'])]:
 for concurrency in [1,32]:
  phase=root/f'{prefix}-comparison-{concurrency}'; aa=root/f'{prefix}-aa-{concurrency}'
  if not (phase/'summary.json').exists():continue
  for fixture in fixtures:
   read=lambda directory,variant: [json.loads(path.read_text()) for path in sorted(directory.glob(f'*-{fixture}-{variant}/result.json'))]
   before=read(phase,'control');native=read(phase,'native-unbatched');batched=read(phase,'native-batched');a=read(aa,'control');b=read(aa,'aa-b')
   for baseline,candidate,name in [(before,native,'native-unbatched vs byte'),(before,batched,'native-batched vs byte'),(native,batched,'batching increment')]:
    row={'fixture':fixture,'concurrency':concurrency,'comparison':name,'metrics':{}}
    for metric in ['instructions','elapsedMs','cpuMicroseconds','packets']:
     entry=compare([value(v,metric) for v in baseline],[value(v,metric) for v in candidate]); entry['byteAAControl']=compare([value(v,metric) for v in a],[value(v,metric) for v in b]);row['metrics'][metric]=entry
    rows.append(row)
(root/'focused-comparison-summary.json').write_text(json.dumps({'method':'Paired median log ratios, conservative 95% binomial/order-statistic intervals; no multiple-comparison correction; independent application processes','rows':rows},indent=2))
for row in rows:
 if row['comparison']=='native-batched vs byte':
  print(row['fixture'],row['concurrency'],{metric:{key:entry[key] for key in ['medianPairedChangePercent','intervalPercent']} for metric,entry in row['metrics'].items()})
ui=root/'ui-comparison'
if (ui/'manifest.json').exists():
 manifest=json.loads((ui/'manifest.json').read_text());uiRows=[]
 for scenario in manifest['scenarios']:
  medians={}
  totals={}
  for sample in manifest['samples']:
   stages=[json.loads(line) for line in (ui/sample['label']/'stages.jsonl').read_text().splitlines()]
   values=[s['elapsedMs'] for s in stages if s['stage']=='run' and Path(s['file']).stem==scenario]
   medians[sample['label']]=statistics.median(values) if values else None
   totals[sample['label']]=sum(values)
  for phase,first,second in [('aa','a','b'),('ab','A','B')]:
   valid=[i for i in range(8) if f'{phase}-{i}-{first}' in medians and f'{phase}-{i}-{second}' in medians]
   if valid:uiRows.append({'scenario':scenario,'phase':phase,'estimate':compare([medians[f'{phase}-{i}-{first}'] for i in valid],[medians[f'{phase}-{i}-{second}'] for i in valid]),'fixedWorkEstimate':compare([totals[f'{phase}-{i}-{first}'] for i in valid],[totals[f'{phase}-{i}-{second}'] for i in valid]),'launchMedians':{k:v for k,v in medians.items() if k.startswith(phase+'-')},'launchActionTotals':{k:v for k,v in totals.items() if k.startswith(phase+'-')}})
 (root/'ui-comparison-summary.json').write_text(json.dumps({'method':'Per-launch median of 37 actions, then paired independent-launch log ratios; conservative 95% intervals; all attempts retained','rows':uiRows},indent=2))
