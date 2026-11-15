import { escapeHtml as esc } from './details.js';
import './temporal.css';

export const differenceWords = n => n>0?`${n} more collisions`:n<0?`${-n} fewer collisions`:'No change';
export const selectedYearWords = t => [...t.years].sort().join(', ');
export function temporalLegend(state, rows, countMax, severityRGB, comparisonMax) {
  const t=state.temporal;
  const key=(label,colour,point=false)=>`<span><i class="${point?'legend-point':'legend-area'}" style="background:${colour}"></i>${label}</span>`;
  const compare=t.mode==='compare';
  return `<div class="time-legend-heading"><b>${compare?`${t.to} compared with ${t.from}`:`Collisions in ${selectedYearWords(t)}`}</b><span>${t.size} m areas</span></div>
    <div class="time-legend-label">${compare?'Difference in collision counts':'Collision counts in the selected years'}</div>
    ${compare?`<div class="time-legend-keys">${key('Fewer','#306da0')}${key('Same count','#687177')}${key('More','#b45126')}</div><p class="time-legend-scale">${t.from===t.to?'Choose two different years.':'Stronger colour means a bigger difference.'}</p>`:`<div class="time-count-ramp" aria-label="Light means fewer collisions; dark means more"><span></span><span></span><span></span><span></span><span></span></div><div class="time-count-range"><span>0 collisions</span><span>${countMax} collisions</span></div>`}
    ${state.showPoints||state.selA||state.selB||state.patternHighlight?`<div class="time-legend-points"><div class="time-legend-label">Collision point severity</div><div class="time-legend-keys">${['Fatal','Serious','Slight'].map((name,i)=>key(name,`rgb(${severityRGB[i].join(',')})`,true)).join('')}</div></div>`:''}
    <div class="time-legend-help">${state.showPoints?'Click a point for full details.':'Click an area to see its collisions.'}</div>`;
}

export function temporalControls(meta,state,totals) {
  const t=state.temporal;
  const buttons=(key,year)=>meta.years.map(y=>`<button type="button" data-time-${key}="${y}" aria-pressed="${year instanceof Set?year.has(y):year===y}">${y}</button>`).join('');
  return `<div class="time-modes seg" aria-label="What the map shows"><button data-time-mode="year" aria-pressed="${t.mode==='year'}">Show selected years</button><button data-time-mode="compare" aria-pressed="${t.mode==='compare'}">Compare two years</button></div>
    ${t.mode==='compare'?`<div class="time-year-label">Compare from</div><div class="time-years">${buttons('from',t.from)}</div>`:''}
    <div class="time-year-label">${t.mode==='compare'?'Compare to':'Years to show · select one or more'}</div><div class="time-years">${t.mode==='compare'?buttons('to',t.to):buttons('years',t.years)}</div>
    <p class="time-totals">${t.mode==='compare'?`${t.from}: <b>${totals[meta.years.indexOf(t.from)]||0}</b> collisions · ${t.to}: <b>${totals[meta.years.indexOf(t.to)]||0}</b> collisions`:`<b>${meta.years.reduce((n,y,i)=>n+(t.years.has(y)?totals[i]:0),0)}</b> collisions in ${selectedYearWords(t)} <button class="time-all" data-time-all="1">All years</button>`}</p>
    <details class="time-options"><summary>Area size</summary><select id="time-size" aria-label="Hexagon width">${[250,500,1000].map(s=>`<option value="${s}" ${t.size===s?'selected':''}>${s} metres wide</option>`).join('')}</select><p>Fixed geographical hexagons. Changing the area size helps check whether a pattern persists.</p></details>`;
}
export function temporalList(rows,state,nameOf) {
  const t=state.temporal;
  return rows.map((b,i)=>`<li class="time-result ${(state.selA?.hexIds||[state.selA?.hexId]).includes(b.id)?'sel':''}" tabindex="0" role="button" data-hex="${b.id}" aria-label="Select ${esc(nameOf(b))}"><span class="rk">${i+1}</span><div><b>${esc(nameOf(b))}</b>
    <strong class="time-difference ${t.mode==='compare'?(b.delta>0?'more':b.delta<0?'fewer':''):''}">${t.mode==='compare'?differenceWords(b.delta):`${b.after} collisions`}</strong>
    <span class="time-counts">${t.mode==='compare'?`${t.from}: ${b.baselineBefore??b.before} collisions · ${t.to}: ${b.baselineAfter??b.after} collisions${b.before!==b.baselineBefore||b.after!==b.baselineAfter?`<br>${b.before+b.after} match the active filters`:''}`:`Selected years: ${selectedYearWords(t)}`}</span></div></li>`).join('')||'<li class="empty">No locations match these filters.</li>';
}
