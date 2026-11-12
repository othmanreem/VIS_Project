exec(open('analyse.py').read().split('# DBSCAN')[0].replace("print({k","0 and print({k"))
import numpy as np
lat0=np.mean([c['lat'] for c in cols])
X=np.array([[ (c['lon'])*111320*np.cos(np.radians(lat0)), c['lat']*110540] for c in cols])
for k in [10,12,15]:
    for eps in [80,100,120,150,180]:
        lab=DBSCAN(eps=eps,min_samples=k).fit_predict(X)
        sizes=sorted(collections.Counter(lab[lab>=0]).values(),reverse=True)
        print(k,eps,'clusters',lab.max()+1,'noise%',round((lab==-1).mean()*100,1),sizes[:6])
