// Fixed, equal-area local-metre hexagons. Membership is independent of year,
// viewport and filters. A cell's annual counts include every matching collision.
export function buildConcentrations(records, years, size = 500) {
  const meanLat = records.reduce((s, r) => s + r.lat, 0) / Math.max(1, records.length);
  const mx = 111320 * Math.cos(meanLat * Math.PI / 180), my = 110540;
  const bins = new Map();
  const radius = size / Math.sqrt(3); // width between parallel east/west sides
  for (const r of records) {
    const px=r.lon*mx, py=r.lat*my;
    const q=(Math.sqrt(3)*px/3-py/3)/radius, z=2*py/(3*radius);
    let x=Math.round(q), y=Math.round(z);
    const cubeY=Math.round(-q-z), dx=Math.abs(x-q), dy=Math.abs(y-z), dc=Math.abs(cubeY+q+z);
    if(dx>dy&&dx>dc)x=-cubeY-y;
    else if(dy>dc)y=-x-cubeY;
    const id = `${x}:${y}`;
    if (!bins.has(id)) bins.set(id, { id, x, y, counts: years.map(() => 0), members: [], roads: new Map() });
    const bin = bins.get(id), yi = years.indexOf(r.yr);
    if (yi >= 0) bin.counts[yi]++;
    bin.members.push(r.i);
    if (r.road && r.road !== 'Unclassified') bin.roads.set(r.road, (bin.roads.get(r.road) || 0) + 1);
  }
  return [...bins.values()].map(b => {
    const cx=Math.sqrt(3)*radius*(b.x+b.y/2), cy=1.5*radius*b.y;
    const polygon=Array.from({length:6},(_,i)=>{
      const angle=(60*i-30)*Math.PI/180;
      return [(cx+radius*Math.cos(angle))/mx,(cy+radius*Math.sin(angle))/my];
    });
    const road = [...b.roads].sort((a, c) => c[1] - a[1])[0]?.[0];
    return { ...b, polygon, road:road||'', centre:[cx/mx,cy/my],
      label: `${road ? road + ' · ' : ''}${(cy/my).toFixed(3)}°N, ${Math.abs(cx/mx).toFixed(3)}°W` };
  });
}

export function compareConcentrations(bins, years, from, to, metric = 'count') {
  const totals = years.map((_, i) => bins.reduce((s,b) => s+b.counts[i],0));
  const values = b => b.counts.map((n,i) => metric === 'share' ? (totals[i] ? n/totals[i]*100 : 0) : n);
  return { totals, rows: bins.map(b => {
    const v = values(b);
    return { ...b, values:v, delta:v[years.indexOf(to)]-v[years.indexOf(from)] };
  }) };
}
