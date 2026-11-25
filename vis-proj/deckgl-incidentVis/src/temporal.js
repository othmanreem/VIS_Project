import { escapeHtml as esc } from './details.js';
import './temporal.css';

export const differenceWords = n => n>0?`${n} more collisions`:n<0?`${-n} fewer collisions`:'No change';
export const selectedYearWords = t => [...t.years].sort().join(', ');
export function temporalRankBadge(index, direction) {
  if (direction === 'more') return `↑\u2009${index + 1}`;
  if (direction === 'fewer') return `↓\u2009${index + 1}`;
  return String(index + 1);
}
export function temporalLegend(state, rows, countMax, severityRGB, comparisonMax) {
  const t=state.temporal;
  const key=(label,colour,point=false)=>`<span><i class="${point?'legend-point':'legend-area'}" style="background:${colour}"></i>${label}</span>`;
  const compare=t.mode==='compare';
  return `<div class="time-legend-heading"><b>${compare?`${t.to} compared with ${t.from}`:`Collisions in ${selectedYearWords(t)}`}</b><span>${t.size} m areas</span></div>
    <div class="time-legend-label">${compare?'Difference in collision counts':'Collision counts in the selected years'}</div>
    ${compare?`<div class="time-legend-keys">${key('Fewer','#306da0')}${key('Same count','#687177')}${key('More','#b45126')}</div><p class="time-legend-scale">${t.from===t.to?'Choose two different years.':'Stronger colour means a bigger difference.'}</p>`:`<div class="time-count-ramp" aria-label="Light means fewer collisions; dark means more"><span></span><span></span><span></span><span></span><span></span></div><div class="time-count-range"><span>0 collisions</span><span>${countMax} collisions</span></div>`}
    <div class="time-legend-points"><div class="time-legend-label">Collision point severity</div><div class="time-legend-keys">${['Fatal','Serious','Slight'].map((name,i)=>key(name,`rgb(${severityRGB[i].join(',')})`,true)).join('')}</div></div>
    <div class="time-legend-help">Select an area or a visible collision point for details.</div>`;
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
export function temporalList(groups, state, nameOf) {
  const { from, to } = state.temporal;
  const selectedIds = state.selA?.hexIds || [state.selA?.hexId];
  const maximum = Math.max(1, ...groups.flatMap(({ rows, direction }) => rows.map(area => direction ? Math.abs(area.delta) : area.after)));
  return groups.map(({ rows, direction, label }) => {
    const items = rows.map((area, index) => {
      const name = esc(nameOf(area));
      const count = `${area.after} ${area.after === 1 ? 'collision' : 'collisions'}`;
      const magnitude = direction ? Math.abs(area.delta) : area.after;
      const value = direction === 'more' ? `+${magnitude}` : direction === 'fewer' ? `−${magnitude}` : magnitude;
      const before = area.baselineBefore ?? area.before;
      const after = area.baselineAfter ?? area.after;
      const description = direction ? `${before} in ${from}, ${after} in ${to}, ${differenceWords(area.delta)}` : count;
      const countsByYear = direction
        ? `<span class="time-counts"><span><strong>${before}</strong> in ${from}</span> <span><span aria-hidden="true">→</span> <strong>${after}</strong> in ${to}</span>${area.before !== before || area.after !== after ? `<small>${area.before + area.after} match the active filters</small>` : ''}</span>`
        : '';
      return `<li class="time-result${selectedIds.includes(area.id) ? ' sel' : ''}" tabindex="0" role="button" data-hex="${area.id}" aria-label="Select ${name}, ${description}">
        <span class="rk" aria-hidden="true">${temporalRankBadge(index, direction)}</span>
        <div class="time-rank-place"><b>${name}</b>${countsByYear}</div>
        <strong class="time-difference">${value}</strong>
        <span class="time-rank-track" aria-hidden="true"><i style="width:${magnitude / maximum * 100}%"></i></span>
      </li>`;
    }).join('');
    if (!direction) return items || '<li class="empty">No locations match these filters.</li>';
    return `<li class="time-rank-group ${direction}">
      <h3 id="time-rank-${direction}">${label}</h3>
      <ol aria-labelledby="time-rank-${direction}">${items || '<li class="empty hint">No areas</li>'}</ol>
    </li>`;
  }).join('');
}
