import json, collections, numpy as np, sys
from sklearn.cluster import DBSCAN
from sklearn.neighbors import NearestNeighbors
base = sys.argv[1]
cols=[]; cas=collections.defaultdict(list); veh=collections.defaultdict(list)
for y in range(2020,2026):
    for f in json.load(open(f'{base}/collisions/calderdale_collisions_{y}.geojson'))['features']:
        if f['geometry']: p=f['properties']; p['lon'],p['lat']=f['geometry']['coordinates'][:2]; cols.append(p)
    for f in json.load(open(f'{base}/casualties/calderdale_casualties_{y}.geojson'))['features']:
        p=f['properties']; cas[(y,p['collision_index'])].append(p)
    for f in json.load(open(f'{base}/vehicles/calderdale_vehicles_{y}.geojson'))['features']:
        p=f['properties']; veh[(y,p['collision_index'])].append(p)
print(len(cols))
MOTO={'2','3','4','5','23','97'}
def user(c):
    ts=[str(x['casualty_type']) for x in cas[(int(c['collision_year']),c['collision_index'])]]
    if '0' in ts: return 'Pedestrian'
    if '1' in ts: return 'Cyclist'
    if MOTO & set(ts): return 'Motorcyclist'
    return 'Vehicle occupant'
for c in cols: c['user']=user(c); c['sev']=int(c['collision_severity']); c['ncas']=int(c['number_of_casualties'])
out={}
yr=collections.defaultdict(lambda:[0,0,0])
for c in cols: yr[int(c['collision_year'])][c['sev']-1]+=1
out['years']={y:v for y,v in sorted(yr.items())}
def ct(key,fn):
    d=collections.defaultdict(lambda:[0,0])
    for c in cols:
        k=fn(c); d[k][0]+=1; d[k][1]+= c['sev']<=2
    return dict(d)
out['user']=ct('user',lambda c:c['user'])
out['speed']=ct('speed',lambda c:str(c['speed_limit']))
LIGHT={'1':'Daylight','4':'Dark – lit','5':'Dark – unlit','6':'Dark – unlit','7':'Dark – unknown'}
out['light']=ct('light',lambda c:LIGHT.get(str(c['light_conditions']),'Unknown'))
W={'1':'Fine','4':'Fine','2':'Rain','5':'Rain','3':'Snow/Fog','6':'Snow/Fog','7':'Snow/Fog'}
out['weather']=ct('w',lambda c:W.get(str(c['weather_conditions']),'Other/unknown'))
# hour x weekday (day_of_week: 1=Sunday)
hm=[[0]*24 for _ in range(7)]
for c in cols:
    try: h=int(str(c['time'])[:2]); d=int(c['day_of_week'])
    except: continue
    hm[(d+5)%7][h]+=1   # Monday=0
out['heat']=hm
print({k:out[k] for k in ['years','user','speed','light','weather']})
# DBSCAN in metres
lat0=np.mean([c['lat'] for c in cols])
X=np.array([[ (c['lon'])*111320*np.cos(np.radians(lat0)), c['lat']*110540] for c in cols])
for k in [5,6,8]:
    nn=NearestNeighbors(n_neighbors=k).fit(X); d,_=nn.kneighbors(X); kd=np.sort(d[:,-1])
    for eps in [100,150,200,250,300]:
        lab=DBSCAN(eps=eps,min_samples=k).fit_predict(X)
        print(k,eps,'clusters',lab.max()+1,'noise%',round((lab==-1).mean()*100,1))
