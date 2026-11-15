"""Local collision-profile inference service. Run: python backend/server.py"""
import json, pathlib, collections, threading, uuid
from functools import lru_cache
from local_model import evaluate, feature_words
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
from features import row
ROOT=pathlib.Path(__file__).resolve().parent
records={}
for year in range(2020,2026):
    casualties=collections.defaultdict(list)
    public=ROOT.parent/'public'
    for f in json.loads((public/f'casualties/calderdale_casualties_{year}.geojson').read_text())['features']:
        casualties[str(f['properties']['collision_index'])].append(f['properties'])
    for f in json.loads((public/f'collisions/calderdale_collisions_{year}.geojson').read_text())['features']:
        r=f['properties']; key=str(r['collision_index'])
        records[key]=dict(r,casualties=casualties[key])

MODEL_METHOD='LCA'
fit_lock=threading.Lock()
@lru_cache(maxsize=8)
def fit_selection(ids,refresh_id=""):
    return evaluate([records[key] for key in ids],MODEL_METHOD)

def analyse(payload):
    cells=payload.get('cells',[])
    if not isinstance(cells,list) or not 1<=len(cells)<=60:raise ValueError('Invalid selection')
    selection=set();clean=[]
    for cell in cells:
        if not isinstance(cell.get('ids'),list):raise ValueError('Invalid IDs')
        ids=set(map(str,cell['ids']))
        if not ids.issubset(records):raise ValueError('Unknown collision ID')
        selection.update(ids);clean.append((str(cell['label'])[:200],ids))
    keys=tuple(sorted(selection))
    with fit_lock:
        learned=fit_selection(keys,str(payload.get('requestId') or uuid.uuid4())[:80]) if payload.get('force') is True else fit_selection(keys)
    common={'model':MODEL_METHOD,'status':learned['status'],'selectedCount':len(keys),'reason':learned.get('reason'),'checks':learned['candidates']}
    if learned['status']!='ready':return dict(common,labels=[],cells=[],members=[])
    labels=learned['labels'];prob=learned['probability'];k=learned['chosen']['k']
    descriptions=[];names=[]
    for i,features in enumerate(learned['descriptions']):
        shown=features[:2]
        title=' + '.join(feature_words(j,v) for _,share,j,v in shown)
        if title in names:title+=f' (group {i+1})'
        names.append(title)
        descriptions.append([{'label':feature_words(j,v),'percent':round(100*share)} for _,share,j,v in features[:3]])
    members=[[key for key,label in zip(keys,labels) if label==c] for c in range(k)]
    confidence=dict(zip(keys,prob))
    result=[]
    for title,ids in clean:
        groups=[]
        for c in range(k):
            matches=sorted(ids.intersection(members[c]));severe=sum(int(records[key]['collision_severity']) in [1,2] for key in matches)
            groups.append({'n':len(matches),'severe':severe,'uncertain':int(sum(confidence[key]<.7 for key in matches)),'ids':matches})
        result.append({'label':title,'total':len(ids),'groups':groups})
    return dict(common,chosen=learned['chosen'],labels=names,descriptions=descriptions,cells=result,members=members)

class Handler(BaseHTTPRequestHandler):
    def reply(self,status,data):
        body=json.dumps(data).encode();self.send_response(status)
        origin=self.headers.get('Origin','')
        if origin in ['http://localhost:5173','http://127.0.0.1:5173']:
            self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();
        try:self.wfile.write(body)
        except (BrokenPipeError,ConnectionAbortedError,ConnectionResetError):pass
    def do_OPTIONS(self):
        self.send_response(204);origin=self.headers.get('Origin','')
        if origin in ['http://localhost:5173','http://127.0.0.1:5173']:self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Access-Control-Allow-Headers','Content-Type');self.send_header('Access-Control-Allow-Methods','POST, OPTIONS');self.end_headers()
    def do_POST(self):
        if self.path!='/profiles':return self.reply(404,{'error':'Not found'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length>500000:raise ValueError('Selection too large')
            self.reply(200,analyse(json.loads(self.rfile.read(length))))
        except (ValueError,KeyError,TypeError,AttributeError) as exc:
            print(type(exc).__name__,str(exc),flush=True)
            self.reply(400,{'error':'Invalid selection'})
    def log_message(self,*args):pass

if __name__=='__main__':
    print('Profile model ready: http://127.0.0.1:8001',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8001),Handler).serve_forever()
