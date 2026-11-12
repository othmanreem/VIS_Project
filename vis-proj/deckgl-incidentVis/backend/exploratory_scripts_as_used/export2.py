import json,numpy as np
from sklearn.cluster import DBSCAN
from scipy.spatial import ConvexHull
D=json.load(open('data.json'))
P=D['points']  # lon,lat,sev,ncas,user,yr,cl,spd,light,wx,hr,dow,mo
sel=[p for p in P if 2022<=p[5]<=2025]
lat0=53.7; X=np.array([[p[0]*111320*np.cos(np.radians(lat0)),p[1]*110540] for p in sel])
for k in [8,10]:
  for e in [100,120,150]:
    l=DBSCAN(eps=e,min_samples=k).fit_predict(X); print(k,e,l.max()+1,round((l>=0).mean()*100))
lab=DBSCAN(eps=120,min_samples=8).fit_predict(X)
T=D['towns']
def town(la,lo): return min(T,key=lambda t:(T[t][0]-la)**2+((T[t][1]-lo)*0.6)**2)
cl=[]
for i in range(lab.max()+1):
  idx=np.where(lab==i)[0]; pts=np.array([[sel[j][0],sel[j][1]] for j in idx]); sub=[sel[j] for j in idx]
  hull=pts[ConvexHull(pts).vertices].tolist()
  ksi=sum(1 for s in sub if s[2]<=2); ped=sum(1 for s in sub if s[4]==1)
  cl.append(dict(n=len(sub),ksi=round(100*ksi/len(sub)),ped=round(100*ped/len(sub)),hull=hull,c=pts.mean(0).tolist(),town=town(pts[:,1].mean(),pts[:,0].mean()),cas=sum(s[3] for s in sub)))
cl.sort(key=lambda c:-c['n']*(1+c['ksi']/100))
D['hs22']=cl
json.dump(D,open('data2.json','w'))
for c in cl[:6]: print(c['town'],c['n'],c['ksi'],c['ped'])
print(len(cl))
