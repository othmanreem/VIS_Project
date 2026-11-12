exec(open('analyse.py').read().split('# DBSCAN')[0].replace("print({k","0 and print({k"))
import numpy as np
from scipy.spatial import ConvexHull
lat0=np.mean([c['lat'] for c in cols])
X=np.array([[ (c['lon'])*111320*np.cos(np.radians(lat0)), c['lat']*110540] for c in cols])
K,EPS=10,120
lab=DBSCAN(eps=EPS,min_samples=K).fit_predict(X)
nn=NearestNeighbors(n_neighbors=K).fit(X); d,_=nn.kneighbors(X); kd=np.sort(d[:,-1])
out['kdist']=[round(float(kd[int(i)]),1) for i in np.linspace(0,len(kd)-1,120)]
sweep={}
for k in [5,8,10,12,15]:
    for eps in [60,90,120,150,180,210]:
        l=DBSCAN(eps=eps,min_samples=k).fit_predict(X)
        sweep[f'{k}_{eps}']=[int(l.max()+1), round(float((l==-1).mean()*100))]
out['sweep']=sweep
TOWNS={'Halifax centre':(53.7225,-1.8600),'Brighouse':(53.7034,-1.7826),'Elland':(53.6853,-1.8389),'Sowerby Bridge':(53.7086,-1.9076),'Hebden Bridge':(53.7420,-2.0130),'Todmorden':(53.7135,-2.0990),'King Cross':(53.7130,-1.8780),'Illingworth':(53.7480,-1.8820),'Shelf':(53.7480,-1.8180),'Hipperholme':(53.7260,-1.8110),'Ovenden':(53.7400,-1.8700),'Siddal':(53.7090,-1.8460),'Rastrick':(53.6930,-1.7950),'Mytholmroyd':(53.7300,-1.9820),'Northowram':(53.7360,-1.8310),'Boothtown':(53.7350,-1.8600),'Pellon':(53.7300,-1.8800),'Southowram':(53.7120,-1.8350)}
def town(lat,lon):
    return min(TOWNS,key=lambda t:(TOWNS[t][0]-lat)**2+((TOWNS[t][1]-lon)*0.6)**2)
def rate(sub,fn): return round(100*sum(1 for c in sub if fn(c))/max(1,len(sub)))
feats={'Pedestrian involved':lambda c:c['user']=='Pedestrian','Cyclist / motorcyclist':lambda c:c['user'] in('Cyclist','Motorcyclist'),'Killed or serious':lambda c:c['sev']<=2,'In darkness':lambda c:str(c['light_conditions'])!='1','Wet / icy surface':lambda c:str(c['road_surface_conditions']) in('2','3','4'),'At junction':lambda c:str(c['junction_detail']) not in('0','-1','99'),'Weekend':lambda c:str(c['day_of_week']) in('1','7')}
out['baseline']={k:rate(cols,f) for k,f in feats.items()}
cl=[]
for i in range(lab.max()+1):
    idx=np.where(lab==i)[0]; sub=[cols[j] for j in idx]
    pts=np.array([[cols[j]['lon'],cols[j]['lat']] for j in idx])
    hull=pts[ConvexHull(pts).vertices].tolist() if len(pts)>=3 else pts.tolist()
    roads=collections.Counter(f"{ {'1':'M','2':'A','3':'A','4':'B'}.get(str(c['first_road_class']),'')}{c['first_road_number']}" for c in sub if str(c['first_road_class']) in '1234' and str(c['first_road_number']) not in('0','-1'))
    cy,cx=pts[:,1].mean(),pts[:,0].mean()
    cl.append(dict(id=i,n=len(sub),ksi=rate(sub,feats['Killed or serious']),ped=rate(sub,feats['Pedestrian involved']),cas=sum(c['ncas'] for c in sub),
        road=(roads.most_common(1)[0][0] if roads else 'Unclassified'),town=town(cy,cx),hull=hull,c=[cx,cy],
        profile={k:rate(sub,f) for k,f in feats.items()},
        yrs=[sum(1 for c in sub if int(c['collision_year'])==y) for y in range(2020,2026)]))
# rank by KSI-weighted score
for c in cl: c['score']=round(c['n']*(1+c['ksi']/100),1)
cl.sort(key=lambda c:-c['score'])
remap={c['id']:r for r,c in enumerate(cl)}
for r,c in enumerate(cl): c['rank']=r+1
out['clusters']=cl
out['points']=[[round(c['lon'],5),round(c['lat'],5),c['sev'],c['ncas'],['Vehicle occupant','Pedestrian','Cyclist','Motorcyclist'].index(c['user']),int(c['collision_year']),remap.get(int(l),-1)] for c,l in zip(cols,lab)]
# selected cluster table rows (rank 1)
sel=[ (c,l) for c,l in zip(cols,lab) if remap.get(int(l),-1)==0]
sel.sort(key=lambda t:(t[0]['sev'],t[0]['date_iso'] if t[0].get('date_iso') else ''))
L={'1':'Daylight','4':'Dark (lit)','5':'Dark (unlit)','6':'Dark (none)','7':'Dark (?)'}
out['table']=[[c.get('date_iso') or c['date'],str(c['time'])[:5],['Fatal','Serious','Slight'][c['sev']-1],c['ncas'],c['user'],str(c['speed_limit']),L.get(str(c['light_conditions']),'—')] for c,_ in sel[:9]]
out['tableN']=len(sel)
schools=json.load(open(base+'/../public/schools.geojson')) if False else json.load(open(base+'/schools.geojson'))
out['schools']=[f['geometry']['coordinates'][:2] for f in schools['features'] if f.get('geometry') and f['geometry']['type']=='Point']
out['towns']=TOWNS
json.dump(out,open('data.json','w'))
for c in cl[:8]: print(c['rank'],c['town'],c['road'],c['n'],c['ksi'],c['ped'],c['profile'])
print(out['baseline'], len(out['schools']), out['tableN'])
SPD=['20','30','40','50','60','70']
LG={'1':0,'4':1,'5':2,'6':2,'7':3}
WG={'1':0,'4':0,'2':1,'5':1,'3':2,'6':2,'7':2}
pts=[]
for p,(c,l) in zip(out['points'],zip(cols,lab)):
    try: h=int(str(c['time'])[:2])
    except: h=-1
    di=c.get('date_iso') or ''
    try: mi=(int(di[:4])-2020)*12+int(di[5:7])-1
    except: mi=-1
    pts.append(p+[SPD.index(str(c['speed_limit'])) if str(c['speed_limit']) in SPD else -1, LG.get(str(c['light_conditions']),3), WG.get(str(c['weather_conditions']),3), h, (int(c['day_of_week'])+5)%7, mi])
out['points']=pts
json.dump(out,open('data.json','w'))
import collections as C
print(C.Counter(p[-1] for p in pts if p[-1]<0), min(p[-1] for p in pts), max(p[-1] for p in pts), out['table'][:3])
