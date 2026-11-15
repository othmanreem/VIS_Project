"""Selection-specific categorical clustering. No outcome variables enter fitting."""
import numpy as np
from scipy.special import logsumexp
from sklearn.metrics import adjusted_rand_score, silhouette_score
from features import row

def prepare(records):
    a=np.array([row(r) for r in records])
    columns=[j for j in range(a.shape[1]) if len(set(a[:,j])-{'?'})>1]
    levels=[sorted(set(a[:,j])-{'?'}) for j in columns]
    x=np.array([[levels[t].index(r[j]) if r[j]!='?' else -1 for t,j in enumerate(columns)] for r in a])
    d=np.zeros((len(a),len(a)));w=d.copy()
    for j in range(x.shape[1]):
        v=x[:,j];valid=(v[:,None]>=0)&(v[None,:]>=0)
        d+=valid*(v[:,None]!=v[None,:]);w+=valid
    d=np.divide(d,w,out=np.ones_like(d),where=w>0);np.fill_diagonal(d,0)
    return a,x,d,[len(v) for v in levels]

def lca(x,dims,k,seed,starts=8):
    rng=np.random.default_rng(seed);best=None
    indicators=[np.eye(v)[np.maximum(x[:,j],0)]*(x[:,j]>=0)[:,None] for j,v in enumerate(dims)]
    for _ in range(starts):
        pi=np.ones(k)/k;theta=[rng.dirichlet(np.ones(v),size=k) for v in dims];old=-np.inf
        for it in range(160):
            lp=np.broadcast_to(np.log(pi),(len(x),k)).copy()
            for j,t in enumerate(theta):
                valid=x[:,j]>=0;lp[valid]+=np.log(t[:,x[valid,j]]).T
            z=logsumexp(lp,axis=1);ll=z.sum();p=np.exp(lp-z[:,None])
            if abs(ll-old)<1e-6*len(x):break
            old=ll;pi=(p.sum(axis=0)+.5)/(len(x)+.5*k);theta=[]
            for j,v in enumerate(dims):
                counts=p.T @ indicators[j] + .5
                theta.append(counts/counts.sum(axis=1,keepdims=True))
        if best is None or ll>best[0]:best=(ll,p.argmax(axis=1),p.max(axis=1))
    return best[1:]

def medoids(d,k,seed,starts=12):
    rng=np.random.default_rng(seed);best=None
    for _ in range(starts):
        med=[int(rng.integers(len(d)))]
        while len(med)<k:
            v=d[:,med].min(axis=1)
            if not v.sum():break
            med.append(int(rng.choice(len(d),p=v/v.sum())))
        med=np.array(med)
        for it in range(80):
            labels=d[:,med].argmin(axis=1);new=med.copy()
            for c in range(len(med)):
                ids=np.flatnonzero(labels==c)
                if len(ids):new[c]=ids[d[np.ix_(ids,ids)].sum(axis=1).argmin()]
            if np.array_equal(new,med):break
            med=new
        labels=d[:,med].argmin(axis=1);cost=d[np.arange(len(d)),med[labels]].sum()
        if best is None or cost<best[0]:best=(cost,labels)
    return best[1],np.ones(len(d))

def evaluate(records,method='LCA'):
    if len(records)<40:return {'status':'insufficient','reason':'Too few matching collisions to assess stable local groups.','candidates':[]}
    a,x,d,dims=prepare(records)
    if len(dims)<2:return {'status':'insufficient','reason':'The selected records have too little variation for useful grouping.','candidates':[]}
    candidates=[];fitted={};n=len(records);minimum=max(10,int(np.ceil(.05*n)))
    for k in range(2,min(5,n//minimum)+1):
        labels,prob=lca(x,dims,k,42) if method=='LCA' else medoids(d,k,42)
        sizes=np.bincount(labels,minlength=k);stability=[]
        for seed in [11,22,33,44,55]:
            ids=np.random.default_rng(seed).choice(n,int(.8*n),replace=False)
            sub,_=lca(x[ids],dims,k,seed,5) if method=='LCA' else medoids(d[np.ix_(ids,ids)],k,seed,8)
            stability.append(float(adjusted_rand_score(labels[ids],sub)))
        sil=float(silhouette_score(d,labels,metric='precomputed')) if len(set(labels))>1 else -1
        # Require two readable distinguishing features in every group.
        descriptions=[]
        for c in range(k):
            members=a[labels==c];features=[]
            if len(members):
                for j in range(a.shape[1]):
                    for value in set(members[:,j])-{'?'}:
                        share=float(np.mean(members[:,j]==value));lift=share-float(np.mean(a[:,j]==value))
                        if share>=.6 and lift>=.1:features.append((lift,share,j,str(value)))
            descriptions.append(sorted(features,reverse=True))
        readable=all(len(v)>=2 for v in descriptions)
        stable=float(np.median(stability));low=min(stability)
        accepted=bool(min(sizes)>=minimum and stable>=.75 and low>=.5 and sil>=.15 and readable)
        info={'method':method,'k':k,'smallest':int(min(sizes)),'stability':round(stable,3),'worst_stability':round(low,3),'silhouette':round(sil,3),'readable':readable,'accepted':accepted}
        candidates.append(info);fitted[k]=(labels,prob,descriptions)
    valid=[c for c in candidates if c['accepted']]
    if not valid:return {'status':'unstable','reason':'No sufficiently stable, distinct local grouping was found. The existing charts still show all matching records.','candidates':candidates}
    # Stability first; prefer simpler solutions when scores are close.
    best=max(valid,key=lambda c:c['stability']+.25*c['silhouette']-.015*c['k'])
    labels,prob,descriptions=fitted[best['k']]
    return {'status':'ready','chosen':best,'labels':labels,'probability':prob,'descriptions':descriptions,'candidates':candidates}

WORDS={'Daylight':'Daylight','Dark-lit':'Darkness, lights on','Dark-unlit':'Darkness, unlit','Fine':'Fine weather','Rain':'Rain','Dry':'Dry surface','Wet':'Wet surface','Single':'Single carriageway','Dual':'Dual carriageway','Urban':'Urban roads','Rural':'Rural roads','Occupant':'Vehicle occupants','Pedestrian':'Pedestrians','Cyclist':'Cyclists','Motorcyclist':'Motorcyclists'}
def feature_words(j,value):
    return f'{value} mph roads' if j==5 else WORDS.get(value,value.replace('+',' + '))
