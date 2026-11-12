import json, sys, collections, numpy as np
from sklearn.cluster import DBSCAN
from scipy.spatial import ConvexHull
base=sys.argv[1]
cols=[]; cas=collections.defaultdict(list)
for y in range(2020,2026):
    for f in json.load(open(f'{base}/collisions/calderdale_collisions_{y}.geojson'))['features']:
        if f['geometry']: p=f['properties']; p['lon'],p['lat']=f['geometry']['coordinates'][:2]; cols.append(p)
    for f in json.load(open(f'{base}/casualties/calderdale_casualties_{y}.geojson'))['features']:
        p=f['properties']; cas[(y,p['collision_index'])].append(p)
MOTO={'2','3','4','5','23','97'}
def user(c):
    ts=[str(x['casualty_type']) for x in cas[(int(c['collision_year']),c['collision_index'])]]
    if '0' in ts: return 1
    if '1' in ts: return 2
    if MOTO & set(ts): return 3
    return 0
LG={'1':0,'4':1,'5':2,'6':2,'7':3}
WG={'1':0,'4':0,'2':1,'5':1,'3':2,'6':2,'7':2}
SPD=['20','30','40','50','60','70']
RC={'1':'M','2':'A','3':'A','4':'B'}
pts=[]
for c in cols:
    di=c.get('date_iso') or ''
    try: mo=(int(di[:4])-2020)*12+int(di[5:7])-1
    except: mo=-1
    try: hr=int(str(c['time'])[:2])
    except: hr=-1
    road=(RC.get(str(c['first_road_class']),'')+str(c['first_road_number'])) if str(c['first_road_class']) in RC and str(c['first_road_number']) not in('0','-1') else ''
    ncas=int(c['number_of_casualties'])
    pts.append([round(c['lon'],5),round(c['lat'],5),int(c['collision_severity']),ncas,user(c),int(c['collision_year']),
        SPD.index(str(c['speed_limit'])) if str(c['speed_limit']) in SPD else -1, LG.get(str(c['light_conditions']),3), WG.get(str(c['weather_conditions']),3),
        hr,(int(c['day_of_week'])+5)%7,mo,1 if str(c['road_surface_conditions']) in('2','3','4') else 0,
        0 if str(c['junction_detail']) in('0','-1','99') else 1, di, str(c['time'])[:5], road, int(c['number_of_vehicles'])])
lat0=53.7
X=np.array([[p[0]*111320*np.cos(np.radians(lat0)),p[1]*110540] for p in pts])
lab=DBSCAN(eps=120,min_samples=10).fit_predict(X)
T={'Halifax centre':(53.7225,-1.8600),'Brighouse':(53.7034,-1.7826),'Elland':(53.6853,-1.8389),'Sowerby Bridge':(53.7086,-1.9076),'Hebden Bridge':(53.7420,-2.0130),'Todmorden':(53.7135,-2.0990),'King Cross':(53.7130,-1.8780),'Illingworth':(53.7480,-1.8820),'Shelf':(53.7480,-1.8180),'Hipperholme':(53.7260,-1.8110),'Ovenden':(53.7400,-1.8700),'Siddal':(53.7090,-1.8460),'Rastrick':(53.6930,-1.7950),'Mytholmroyd':(53.7300,-1.9820),'Northowram':(53.7360,-1.8310),'Boothtown':(53.7350,-1.8600),'Pellon':(53.7300,-1.8800),'Southowram':(53.7120,-1.8350),'Ripponden':(53.6730,-1.9430),'Greetland':(53.6900,-1.8700)}
def town(la,lo): return min(T,key=lambda t:(T[t][0]-la)**2+((T[t][1]-lo)*0.6)**2)
hs=[]
for i in range(lab.max()+1):
    idx=np.where(lab==i)[0]; P=np.array([[pts[j][0],pts[j][1]] for j in idx])
    hull=P[ConvexHull(P).vertices].tolist()
    roads=collections.Counter(pts[j][16] for j in idx if pts[j][16])
    hs.append(dict(members=idx.tolist(),hull=hull,town=town(P[:,1].mean(),P[:,0].mean()),road=roads.most_common(1)[0][0] if roads else ''))
json.dump(dict(points=pts,hotspots=hs,towns={k:[v[1],v[0]] for k,v in T.items()}),open('vadata.json','w'),separators=(',',':'))
print(len(pts),len(hs))
