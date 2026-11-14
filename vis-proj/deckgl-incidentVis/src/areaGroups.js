// Groups are defined from unfiltered counts in the comparison years.
// Refinement filters change profiles, never the geographical group membership.
export const GROUPS = [
  {id:'more',label:'More collisions',colour:'#b45126'},
  {id:'fewer',label:'Fewer collisions',colour:'#306da0'},
  {id:'same',label:'Same count',colour:'#687177'},
];
export const CONDITIONS = [
  {label:'Pedestrian involved',test:r=>r.casualties.some(c=>String(c.casualty_type)==='0')},
  {label:'In darkness',test:r=>[4,5,6,7].includes(+r.feature.properties.light_conditions)},
  {label:'Wet surface',test:r=>+r.feature.properties.road_surface_conditions===2},
  {label:'At a junction',test:r=>![0,-1,99].includes(+r.feature.properties.junction_detail)},
  {label:'30 mph roads',test:r=>+r.feature.properties.speed_limit===30},
];
export function classifyAreaGroups(bins,years,from,to) {
  const a=years.indexOf(from), b=years.indexOf(to);
  const membership=new Map(), areas=new Map();
  const groups=GROUPS.map(g=>({...g,bins:[],ids:new Set()}));
  for(const bin of bins){
    if(!bin.counts[a]&&!bin.counts[b])continue;
    const delta=bin.counts[b]-bin.counts[a], id=delta>0?'more':delta<0?'fewer':'same';
    areas.set(bin.id,id);
    const group=groups.find(g=>g.id===id);group.bins.push(bin);
    for(const i of bin.members){group.ids.add(i);membership.set(i,id);}
  }
  return {groups,membership,areas};
}
export function profileRecords(records) {
  const n=records.length, severe=records.filter(r=>r.sev<=2).length;
  return {n,severe,share:n?100*severe/n:null,
    conditions:CONDITIONS.map(c=>{const count=records.filter(c.test).length;return {label:c.label,count,share:n?100*count/n:null};})};
}
export function profileAreaGroups(classification,records,year,passes=()=>true) {
  return classification.groups.map(g=>{
    const matching=records.filter(r=>g.ids.has(r.i)&&r.yr===year&&passes(r));
    return {...g,records:matching,...profileRecords(matching)};
  });
}

export const PATTERN_METRICS = [{label:"Serious or fatal collisions",test:r=>r.sev<=2}, ...CONDITIONS];

// Uses recorded collision severity, not casualty counts or exposure-based risk.
const code=(r,k)=>{const v=r.feature.properties[k];return v==null||v===''?null:Number(v);};
const metric=(label,key,values)=>({label,test:r=>values.includes(code(r,key))});
export const RQ3_PAIRS=[
  {name:'Road surface',groups:[metric('Wet or damp','road_surface_conditions',[2]),metric('Dry','road_surface_conditions',[1])]},
  {name:'Lighting',groups:[metric('Darkness','light_conditions',[4,5,6,7]),metric('Daylight','light_conditions',[1])]},
  {name:'Weather',groups:[metric('Rain','weather_conditions',[2,5]),metric('Fine weather','weather_conditions',[1,4])]},
  {name:'Road type',groups:[metric('Single carriageway','road_type',[6]),metric('Dual carriageway','road_type',[3])]},
];
const [wet,dry]=RQ3_PAIRS[0].groups,[dark,day]=RQ3_PAIRS[1].groups;
export const RQ3_COMBINATIONS=[[dark,wet],[dark,dry],[day,wet],[day,dry]].map(([a,b])=>({label:`${a.label} + ${b.label.toLowerCase()}`,test:r=>a.test(r)&&b.test(r)}));
export const RQ3_METRICS=[...RQ3_PAIRS.flatMap(p=>p.groups),...RQ3_COMBINATIONS];
export function severitySummary(records){
 const valid=records.filter(r=>[1,2,3].includes(r.sev));
 const n=valid.length,severe=valid.filter(r=>r.sev<=2).length;
 return {n,severe,share:n?100*severe/n:null,unknownSeverity:records.length-n};
}
export function conditionAnalysis(records){
 const valid=records.filter(r=>[1,2,3].includes(r.sev));
 const profile=m=>({...m,...severitySummary(valid.filter(m.test))});
 const pairs=RQ3_PAIRS.map(p=>{const groups=p.groups.map(profile);return {...p,groups,excluded:valid.length-groups.reduce((n,g)=>n+g.n,0)};});
 const combinations=RQ3_COMBINATIONS.map(profile);
 return {total:severitySummary(records),pairs,combinations,combinationExcluded:valid.length-combinations.reduce((n,g)=>n+g.n,0)};
}
