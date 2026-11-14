import { escapeHtml as esc } from './details.js';
import { profileRecords } from './areaGroups.js';
import './groupAnalysis.css';

const pct=n=>n==null?'No records':`${Math.round(n)}%`;
function bindCircumstances(root,onPattern){
  root.querySelectorAll('[data-pattern]').forEach(button=>{
    const row=button.closest('tr'),label=button.dataset.pattern;
    row.dataset.pattern=label;row.classList.add('circumstance-row');row.tabIndex=0;
    row.setAttribute('role','button');row.setAttribute('aria-pressed',button.getAttribute('aria-pressed'));
    row.setAttribute('aria-label',`${label}. Select or deselect to show collision points and statistics.`);
    const text=document.createElement('span');text.textContent=label;button.replaceWith(text);
    row.onclick=()=>onPattern(label);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPattern(label);}};
  });
}
export function renderGroupAnalysis(root,{groups,state,year,onFocus,areaName,onArea,allMatching,recordById,scope,records,onPattern}) {
  const open=root.querySelector('details')?.open||false;
  const sort=root.querySelector('#group-area-sort')?.value||'count';
  const t=state.temporal;
  let selected=groups.find(g=>g.id===state.patternGroup)||{id:'all',...profileRecords(groups.flatMap(g=>g.records)),before:profileRecords(groups.flatMap(g=>g.before.records))};
  if(scope) selected={id:'selection',...profileRecords(records.filter(r=>scope.ids.has(r.i)&&r.yr===t.to)),before:profileRecords(records.filter(r=>scope.ids.has(r.i)&&r.yr===t.from))};
  const otherBefore=profileRecords(scope ? records.filter(r=>!scope.ids.has(r.i)&&r.yr===t.from) : groups.filter(g=>g.id!==selected.id).flatMap(g=>g.before.records));
  const otherAfter=profileRecords(scope ? records.filter(r=>!scope.ids.has(r.i)&&r.yr===t.to) : groups.filter(g=>g.id!==selected.id).flatMap(g=>g.records));
  const metrics=p=>[{label:'Serious or fatal collisions',count:p.severe,share:p.share},...p.conditions];
  const a=metrics(selected.before),b=metrics(selected),oa=metrics(otherBefore),ob=metrics(otherAfter);
  const changes=a.map((m,i)=>{
    const delta=m.share==null||b[i].share==null?null:Math.round(b[i].share*10)/10-Math.round(m.share*10)/10;
    const otherDelta=oa[i].share==null||ob[i].share==null?null:Math.round(ob[i].share*10)/10-Math.round(oa[i].share*10)/10;
    return {label:m.label,before:m,after:b[i],delta,otherDelta};
  }).sort((x,y)=>Math.abs(y.delta||0)-Math.abs(x.delta||0)).slice(0,3);
  const words=n=>n==null?'No records to compare':Math.abs(n)<.5?'About the same':`About ${Math.round(Math.abs(n))} ${n>0?'more':'fewer'} per 100 collisions`;
  const count=(m,n)=>n?`${m.count} of ${n} (${m.share.toFixed(1)}%)`:'No matching records';
  root.innerHTML=`<div class="patterns-heading"><b>${scope?`What changed in ${esc(scope.label)}?`:selected.id==='all'?'What changed across all areas?':`What changed in areas with ${selected.id==='same'?'unchanged collision counts':selected.id==='more'?'more collisions':'fewer collisions'}?`}</b><button class="group-reset" data-group="all" aria-pressed="${selected.id==='all'}">Show all areas</button></div>
    <div class="pattern-group-picker" role="group" aria-label="Area group to analyse">${groups.map(g=>`<button data-group="${g.id}" style="--group-colour:${g.colour}" aria-pressed="${selected.id===g.id}"><i></i>${g.label} · ${g.bins.length} areas</button>`).join('')}<span>${selected.before.n} collisions in ${t.from}; ${selected.n} in ${t.to}</span></div>
    ${selected.before.n<5||selected.n<5?'<p class="pattern-context">Few matching records in a comparison year; percentages need care.</p>':''}
    <table class="pattern-changes"><thead><tr><th>Circumstance</th><th>${t.from}</th><th>${t.to}</th><th>More or fewer here</th>${selected.id!=='all'?'<th>More or fewer elsewhere</th>':''}</tr></thead><tbody>${changes.map(m=>`<tr><th><button class="pattern-pick" data-pattern="${esc(m.label)}" aria-pressed="${state.patternHighlight?.label===m.label}">${m.label}</button></th><td>${count(m.before,selected.before.n)}</td><td>${count(m.after,selected.n)}</td><td><span class="pattern-change-value">${words(m.delta)}</span><span class="pattern-change-track"><i style="width:${Math.min(100,Math.abs(m.delta||0)*3)}%;background:${(m.delta||0)>=0?'#b45126':'#306da0'}"></i></span></td>${selected.id!=='all'?`<td>${words(m.otherDelta)}</td>`:''}</tr>`).join('')}</tbody></table>
    <details class="group-area-details" ${open?'open':''}><summary>Compare individual areas together</summary><div class="group-area-toolbar"><span>Counts in both years; profiles in ${year}. ${state.groupFocus?'Selected group only.':'All three groups.'}</span><select id="group-area-sort" aria-label="Sort area profiles"><option value="count">Most matching collisions</option><option value="severity">Highest serious/fatal share (at least 5 collisions)</option></select></div><div class="group-area-table-wrap"><table><thead><tr><th>Area</th><th>Group</th><th>${t.from} collisions</th><th>${t.to} collisions</th><th>Serious/fatal</th><th>Darkness</th><th>Wet surface</th></tr></thead><tbody id="group-area-rows"></tbody></table></div></details>`;
  function renderAreas(order){
    const rows=groups.filter(g=>!state.groupFocus||g.id===state.groupFocus).flatMap(g=>g.bins.map(b=>{
      const records=g.records.filter(r=>b.members.includes(r.i)&&(!scope||scope.ids.has(r.i)));
      const profile=profileRecords(records);
      const before=b.members.filter(i=>allMatching.has(i)&&recordById.get(i).yr===t.from).length;
      const after=b.members.filter(i=>allMatching.has(i)&&recordById.get(i).yr===t.to).length;
      return {b,g,profile,before,after};
    })).filter(r=>r.before||r.after);
    rows.sort((a,b)=>order==='severity'?((b.profile.n>=5?b.profile.share:-1)-(a.profile.n>=5?a.profile.share:-1))||b.profile.n-a.profile.n:b.profile.n-a.profile.n);
    root.querySelector('#group-area-rows').innerHTML=rows.map(r=>`<tr><td><button data-group-area="${r.b.id}">${esc(areaName(r.b))}</button></td><td>${r.g.label}</td><td>${r.before}</td><td>${r.after}</td><td>${r.profile.n?`${r.profile.severe}/${r.profile.n} · ${pct(r.profile.share)}`:'No records'}${r.profile.n>0&&r.profile.n<5?' · few records':''}</td><td>${pct(r.profile.conditions[1].share)}</td><td>${pct(r.profile.conditions[2].share)}</td></tr>`).join('')||'<tr><td colspan="7">No matching collisions in these areas.</td></tr>';
    root.querySelectorAll('[data-group-area]').forEach(b=>b.onclick=()=>onArea(b.dataset.groupArea));
  }
  bindCircumstances(root,onPattern);
  const picker=root.querySelector('.pattern-group-picker'),heading=root.querySelector('.patterns-heading');
  const counts=picker.querySelector('span');counts.className='selected-years-summary';heading.after(counts);
  picker.append(heading.querySelector('[data-group=all]'));root.prepend(picker);
  root.querySelector('#group-area-sort').value=sort;renderAreas(sort);
  root.querySelector('#group-area-sort').onchange=e=>renderAreas(e.target.value);
  root.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>onFocus(b.dataset.group==='all'?null:b.dataset.group));
}

export function renderSelectedYearsAnalysis(root,{state,records,areas,areaName,onArea,scope,onPattern}) {
  const open=root.querySelector('details')?.open||false;
  const years=[...state.temporal.years].sort();
  const combined=profileRecords(records);
  const byYear=years.map(y=>profileRecords(records.filter(r=>r.yr===y)));
  const metrics=p=>[{label:'Serious or fatal collisions',count:p.severe,share:p.share},...p.conditions];
  const combinedMetrics=metrics(combined), yearMetrics=byYear.map(metrics);
  const chosen=[0,...combined.conditions.map((c,i)=>({i:i+1,count:c.count})).sort((a,b)=>b.count-a.count).slice(0,2).map(c=>c.i)];
  const cell=(m,n)=>n?`<span>${m.count} of ${n}</span><small>${m.share.toFixed(1)}%</small>`:'No matching records';
  const areaRows=areas.map(b=>({b,profile:profileRecords(records.filter(r=>b.members.includes(r.i)))})).filter(r=>r.profile.n).sort((a,b)=>b.profile.n-a.profile.n);
  root.innerHTML=`<div class="patterns-heading"><b>${scope?`What do collisions in ${esc(scope.label)} have in common?`:"What do collisions in the selected years have in common?"}</b></div>
    <div class="selected-years-summary">${records.length} matching collisions across ${areaRows.length} areas · Selected years: ${years.join(', ')}</div>
    <table class="pattern-changes"><thead><tr><th>Recorded circumstance</th>${years.map(y=>`<th>${y}</th>`).join('')}${years.length>1?'<th>All selected years</th>':''}</tr></thead><tbody>${chosen.map(i=>`<tr><th><button class="pattern-pick" data-pattern="${esc(combinedMetrics[i].label)}" aria-pressed="${state.patternHighlight?.label===combinedMetrics[i].label}">${combinedMetrics[i].label}</button></th>${byYear.map((p,j)=>`<td class="pattern-year-cell">${cell(yearMetrics[j][i],p.n)}</td>`).join('')}${years.length>1?`<td class="pattern-year-cell">${cell(combinedMetrics[i],combined.n)}</td>`:''}</tr>`).join('')}</tbody></table>
    <details class="group-area-details" ${open?'open':''}><summary>Compare individual areas together</summary><div class="group-area-table-wrap"><table><thead><tr><th>Area</th><th>Matching collisions</th><th>Serious or fatal</th><th>Darkness</th><th>Wet surface</th></tr></thead><tbody>${areaRows.map(r=>`<tr><td><button data-group-area="${r.b.id}">${esc(areaName(r.b))}</button></td><td>${r.profile.n}</td><td>${r.profile.severe} of ${r.profile.n} (${pct(r.profile.share)})${r.profile.n<5?' · few records':''}</td><td>${pct(r.profile.conditions[1].share)}</td><td>${pct(r.profile.conditions[2].share)}</td></tr>`).join('')||'<tr><td colspan="5">No matching records.</td></tr>'}</tbody></table></div></details>`;
  root.querySelectorAll('[data-group-area]').forEach(b=>b.onclick=()=>onArea(b.dataset.groupArea));
  bindCircumstances(root,onPattern);
}
