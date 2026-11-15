def group(r):
    groups=set()
    for c in r['casualties']:
        t=int(c['casualty_type']);groups.add('Pedestrian' if t==0 else 'Cyclist' if t==1 else 'Motorcyclist' if t in [2,3,4,5,23,97] else 'Occupant' if t in [8,9,10,11,17,18,19,20,21] else 'Other')
    return '+'.join(sorted(groups)) or '?'
def row(r):
    return [
     {1:'Daylight',4:'Dark-lit',5:'Dark-unlit',6:'Dark-unlit'}.get(int(r['light_conditions']),'?'),
     {1:'Fine',4:'Fine',2:'Rain',5:'Rain',3:'Snow',6:'Snow',7:'Fog',8:'Other'}.get(int(r['weather_conditions']),'?'),
     {1:'Dry',2:'Wet',3:'Snow',4:'Ice',5:'Flood'}.get(int(r['road_surface_conditions']),'?'),
     {1:'Roundabout',2:'One-way',3:'Dual',6:'Single',7:'Slip'}.get(int(r['road_type']),'?'),
     {1:'Urban',2:'Rural'}.get(int(r['urban_or_rural_area']),'?'),
     str(r['speed_limit']),group(r)]
