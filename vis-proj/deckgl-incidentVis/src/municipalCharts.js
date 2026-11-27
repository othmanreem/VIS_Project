import {escapeHtml as esc} from './details.js';
import {conditionAnalysis,severitySummary} from './areaGroups.js';
const pct=x=>x==null?'—':`${Math.round(x)}%`;
const number=n=>n.toLocaleString('en-GB');
const severityLabels = ['Fatal', 'Serious', 'Slight'];
const severitySwatch = label => `<i aria-hidden="true" style="background:var(--${label.toLowerCase()})"></i>`;
const severitySegmentStyle = (count, total, index) => `width:${100 * count / total}%;--segment-color:var(--${severityLabels[index].toLowerCase()})`;
export function severityCounts(records){return [1,2,3].map(sev=>records.filter(r=>r.sev===sev).length);}
export function annualUserData(records,years,users){return users.map((name,user)=>({name,user,cells:years.map(year=>{const rs=records.filter(r=>r.yr===year&&(r.users||[r.user]).includes(user));return {year,...severitySummary(rs),counts:severityCounts(rs)};})}));}
function severityLegend(severity) {
  return severityLabels.map((label, index) => `<button type="button" data-severity-filter="${index + 1}"
    aria-pressed="${severity === index + 1}">${severitySwatch(label)}${label}</button>`).join('');
}

// marked = severity (1–3) of the selected collision when it is counted in this bar;
// that segment gets an outline so the collision's place in the bar is visible.
function severityStack(counts, total, { interactive, severity, name, marked = null }) {
  const segments = counts.map((count, index) => {
    if (!count) return '';
    const label = `${number(count)} ${severityLabels[index].toLowerCase()} ${count === 1 ? 'collision' : 'collisions'}`;
    const style = severitySegmentStyle(count, total, index);
    const mark = marked === index + 1 ? ' is-marked' : '';
    return interactive ? `<button type="button" class="severity-segment${mark}" data-severity-filter="${index + 1}" data-severity-tip="${label}"
      aria-pressed="${severity === index + 1}" aria-label="${esc(`${name}: ${label}. Toggle severity on map.`)}" style="${style}"></button>`
      : `<i class="severity-segment${mark}" aria-hidden="true" style="${style}"></i>`;
  }).join('');
  return `<span class="severity-stack">${segments}</span>`;
}

// --------------------------------------------------
// Selected collision (a point clicked on the map, shown in "Collision details").
// The charts keep their counts; they only mark where that collision falls.
// --------------------------------------------------
const selectedPin = label => `<i class="selected-pin" role="img" aria-label="${esc(label)}" title="${esc(label)}"></i>`;
const markedSeverity = (selected, records) => selected && records.includes(selected) ? selected.sev : null;
// Columns that get the mark: the selected area(s) containing the collision; only when it is
// in no selected area does the "All collisions" column (index 0) get it instead.
function markedScopes(selected, scopes) {
  if (!selected) return new Set();
  const areas = scopes.map((scope, index) => index > 0 && scope.records.includes(selected) ? index : -1).filter(index => index > 0);
  return new Set(areas.length ? areas : (scopes[0]?.records.includes(selected) ? [0] : []));
}
function selectedStrip(selected) {
  if (!selected) return '';
  const p = selected.feature?.properties || {};
  const when = [p.date, p.time].filter(Boolean).join(', ');
  const sev = severityLabels[selected.sev - 1] || 'Unknown severity';
  return `<div class="selected-strip">${selectedPin('Selected collision')}<span><b>Selected collision</b>${when ? ` · ${esc(when)}` : ''} · <span class="selected-sev" style="--segment-color:var(--${sev.toLowerCase()})">${esc(sev)}</span></span>
    <small>Pins mark where it falls below.</small><button type="button" data-clear-selected aria-label="Clear selected collision" title="Clear selected collision">×</button></div>`;
}
function bindSelectedStrip(root, onClearSelected) {
  root.querySelector('[data-clear-selected]')?.addEventListener('click', event => { event.stopPropagation(); onClearSelected?.(); });
}

function bindSeverityInteractions(root, content, onSeverity) {
  const tip = root.querySelector('.severity-tooltip');
  function showTip(event) {
    const segment = event.target.closest('[data-severity-tip]');
    if (!segment) return;
    tip.textContent = segment.dataset.severityTip;
    tip.hidden = false;
    const chart = root.getBoundingClientRect();
    const target = segment.getBoundingClientRect();
    const left = target.left - chart.left + (target.width - tip.offsetWidth) / 2;
    tip.style.left = `${Math.max(0, Math.min(left, chart.width - tip.offsetWidth))}px`;
    tip.style.top = `${target.top - chart.top - tip.offsetHeight - 7}px`;
  }
  content.addEventListener('pointerover', showTip);
  content.addEventListener('focusin', showTip);
  for (const event of ['pointerout', 'focusout', 'scroll']) {
    content.addEventListener(event, () => { tip.hidden = true; });
  }
  root.onclick = event => {
    const button = event.target.closest('[data-severity-filter]');
    if (button) onSeverity(button.getAttribute('aria-pressed') === 'true' ? null : Number(button.dataset.severityFilter));
  };
}

export function renderUserSeverity(root, { scopes, years, users, activeUsers, onUser, drilldownYear, onDrilldown, getSeverity, onSeverity, areaContext, selected = null, onClearSelected }) {
  const selectedUsers = selected ? (selected.users || [selected.user]) : [];
  const markScopes = markedScopes(selected, scopes);
  const yearRange = years.every((year, index) => year === years[0] + index) && years.length > 1
    ? `${years[0]}–${years.at(-1)}` : years.join(', ');
  const singleUser = activeUsers.size === 1 ? activeUsers.values().next().value : undefined;
  const yearName = singleUser === undefined ? 'Selected road users' : users[singleUser];
  const initialYear = drilldownYear ?? years.at(-1);
  const yearContent = html => `<div class="severity-year-reveal"><div><div class="severity-year-content">${html}</div></div></div>`;
  root.innerHTML = `<div class="severity-toolbar">
    <div class="severity-key">${severityLegend(getSeverity())}</div>
    <span class="severity-period">${years.length === 1 ? "Year" : "Years"} shown · ${yearRange}</span>
  </div>${selectedStrip(selected)}
  <div class="severity-grid-scroll" tabindex="0" role="region" aria-label="Collision severity by road user"></div>
  <p class="chart-reading severity-method">Road-user selections filter the map. A collision can appear under multiple road users.${areaContext ? ` Selected areas show ${esc(areaContext)}.` : ''}</p>
  <span class="severity-tooltip" aria-hidden="true" hidden></span>`;

  const content = root.querySelector('.severity-grid-scroll');
  const renderCells = (name, user, year = null, combined = false) => {
    const filterable = user !== undefined && year === null;
    const interactive = combined || activeUsers.has(user);
    const filter = filterable ? `data-user-filter="${user}" aria-pressed="${activeUsers.has(user)}"` : '';
    return scopes.map((scope, index) => {
      const records = scope.records.filter(record => {
        if (year !== null && record.yr !== year) return false;
        const groups = record.users || [record.user];
        return combined ? groups.some(group => activeUsers.has(group)) : user === undefined || groups.includes(user);
      });
      const total = records.length;
      const counts = severityCounts(records);
      const breakdown = `${name}${year === null ? '' : ` in ${year}`} · ${scope.label}: ${number(total)} collisions (${counts.map((count, i) => `${number(count)} ${severityLabels[i].toLowerCase()}`).join(', ')})`;
      const count = filterable
        ? `<button type="button" class="severity-total" ${filter} aria-label="${esc(`${breakdown}. Toggle ${name} filter.`)}">${number(total)}</button>`
        : `<b>${number(total)}</b>`;
      const bar = severityStack(counts, total, { interactive, severity: getSeverity(), name: `${name} · ${scope.label}`, marked: markScopes.has(index) && user !== undefined && !combined && selectedUsers.includes(user) ? markedSeverity(selected, records) : null });
      const distribution = !interactive && filterable
        ? `<button type="button" class="severity-distribution" ${filter} aria-label="${esc(`${breakdown}. Toggle ${name} filter.`)}">${bar}<b>${number(total)}</b></button>`
        : `<div class="severity-distribution">${bar}${count}</div>`;
      return `<td class="${index === 0 ? 'severity-baseline' : ''}" data-scope="${index}" data-total="${total}">
        ${year === null ? distribution : yearContent(distribution)}
      </td>`;
    }).join('');
  };
  const renderRow = (name, user, combined = false) => {
    const filterable = user !== undefined;
    const pressed = filterable && activeUsers.has(user);
    const yearControl = years.length > 1 && (combined || (filterable && user === singleUser));
    const yearOpen = drilldownYear !== null;
    const involved = filterable && selectedUsers.includes(user);
    return `<tr class="${filterable ? 'severity-user' : 'severity-overall'}${pressed ? ' is-active' : ''}${combined ? ' severity-combined-total' : ''}${involved ? ' has-selected' : ''}" ${filterable ? `data-road-user="${user}"` : ''}>
      <th scope="row">${filterable ? `<button type="button" class="severity-user-label" data-user-filter="${user}" aria-pressed="${pressed}">${involved ? selectedPin(`The selected collision involves ${name.toLowerCase()}`) : ''}${esc(name)}</button>` : esc(name)}
      ${yearControl ? `<button type="button" class="severity-year-toggle" aria-expanded="${yearOpen}" aria-controls="severity-year-row">By year</button>` : ''}
      </th>${renderCells(name, user, null, combined)}</tr>
      ${yearControl ? `<tr id="severity-year-row" class="severity-year-row${singleUser === undefined ? ' is-combined' : ''}${yearOpen ? ' is-open' : ''}" ${yearOpen ? '' : 'inert'}>
        <th scope="row">${yearContent(`<label>Year <select aria-label="Year for ${esc(yearName)}">${years.map(year => `<option ${year === initialYear ? 'selected' : ''}>${year}</option>`).join('')}</select></label>`)}</th>
        ${renderCells(yearName, singleUser, initialYear, combined)}
      </tr>` : ''}`;
  };
  content.innerHTML = `<table class="severity-grid" style="--severity-scopes:${scopes.length}">
    <thead><tr><th scope="col">Road user</th>${scopes.map((scope, index) => `<th scope="col" class="${index === 0 ? 'severity-baseline' : ''}">
      <b>${index > 0 && selected && scope.records.includes(selected) ? selectedPin(`The selected collision is in ${scope.label}`) : ''}${esc(scope.label)}</b>${scope.name ? `<small>${esc(scope.name)}</small>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${renderRow('All road users')}${activeUsers.size > 1 ? renderRow('Selected road users', undefined, true) : ''}${users.map((name, user) => renderRow(name, user)).join('')}</tbody>
  </table>`;
  bindSeverityInteractions(root, content, onSeverity);
  bindSelectedStrip(root, onClearSelected);
  content.onclick = event => {
    const button = event.target.closest('button, select, label');
    const row = event.target.closest('[data-road-user]');
    if (row && (!button || button.hasAttribute('data-user-filter'))) {
      const user = row.dataset.roadUser;
      const scope = button?.closest('[data-scope]')?.dataset.scope;
      onUser(Number(user));
      const selector = scope === undefined ? '.severity-user-label' : `[data-scope="${scope}"] button`;
      root.querySelector(`${selector}[data-user-filter="${user}"]`)?.focus({ preventScroll: true });
      return;
    }
  };
  const yearToggle = content.querySelector('.severity-year-toggle');
  if (yearToggle) {
    const yearRow = content.querySelector('#severity-year-row');
    const yearPicker = yearRow.querySelector('select');
    let displayedYear = initialYear;
    function showYear(year) {
      const open = year !== null;
      if (open && year !== displayedYear) {
        yearPicker.value = String(year);
        while (yearRow.cells.length > 1) yearRow.deleteCell(-1);
        yearRow.insertAdjacentHTML('beforeend', renderCells(yearName, singleUser, year, singleUser === undefined));
        displayedYear = year;
      }
      yearRow.inert = !open;
      yearRow.classList.toggle('is-open', open);
      yearToggle.setAttribute('aria-expanded', String(open));
    }
    yearToggle.onclick = () => {
      const year = yearRow.inert ? displayedYear : null;
      showYear(year);
      onDrilldown(year);
      if (year !== null) yearPicker.focus({ preventScroll: true });
    };
    yearPicker.onchange = () => {
      const year = Number(yearPicker.value);
      showYear(year);
      onDrilldown(year);
    };
  }
}
// Conditions per area: the same grid as "Collision severity by road user".
// Columns = scopes (All collisions, Area 1, Area 2); rows = conditions
// grouped by Road surface, Lighting, Weather, Road type and Lighting + surface.
// Each cell shows the fatal/serious/slight split as a bar plus the collision count.
function renderConditionGrid(root,{scopes,active,onPattern,severity,onSeverity,selected=null,onClearSelected}){
 const pinned=selected; // the selected collision (local `selected` below means a highlighted row)
 const fits=row=>Boolean(pinned&&[1,2,3].includes(pinned.sev)&&row.test(pinned));
 const markScopes=markedScopes(pinned,scopes);
 const analyses=scopes.map(scope=>({scope,data:conditionAnalysis(scope.records)}));
 const groups=[
   ...analyses[0].data.pairs.map((pair,p)=>({name:pair.name,rows:pair.groups.map((g,i)=>({label:g.label,test:g.test,pick:a=>a.data.pairs[p].groups[i]}))})),
   {name:'Lighting and surface together',rows:analyses[0].data.combinations.map((g,i)=>({label:g.label,test:g.test,pick:a=>a.data.combinations[i]}))},
 ];
 const cell=(row,a,index)=>{
   const g=row.pick(a),selected=active?.label===row.label&&!active?.other;
   const inCell=a.scope.records.filter(r=>[1,2,3].includes(r.sev)&&row.test(r));
   const counts=severityCounts(inCell);
   const breakdown=`${row.label} · ${a.scope.label}: ${number(g.n)} collisions (${counts.map((c,i)=>`${number(c)} ${severityLabels[i].toLowerCase()}`).join(', ')})`;
   return `<td class="${index===0?'severity-baseline':''}" data-scope="${index}" data-total="${g.n}" title="${esc(breakdown)}">
     <div class="severity-distribution">${g.n?severityStack(counts,g.n,{interactive:selected,severity,name:`${row.label} · ${a.scope.label}`,marked:markScopes.has(index)&&fits(row)?markedSeverity(pinned,inCell):null}):'<span class="severity-stack"></span>'}<b>${number(g.n)}</b></div></td>`;
 };
 const rows=groups.map(group=>{
   return `<tr class="condition-group-row"><th scope="rowgroup" colspan="${scopes.length+1}">${esc(group.name)}</th></tr>
   ${group.rows.map(row=>{
     const selected=active?.label===row.label&&!active?.other;
     const any=analyses.some(a=>row.pick(a).n);
     const pin=fits(row);
     return `<tr class="severity-user condition-row${selected?' is-active':''}${pin?' has-selected':''}" data-condition="${esc(row.label)}">
       <th scope="row"><button type="button" class="severity-user-label" data-condition-label aria-pressed="${selected}" ${!any&&!selected?'disabled':''}
         title="Highlight these collisions on the map; click again to clear">${pin?selectedPin(`The selected collision: ${row.label.toLowerCase()}`):''}${esc(row.label)}</button></th>
       ${analyses.map((a,i)=>cell(row,a,i)).join('')}</tr>`;
   }).join('')}`;
 }).join('');
 root.innerHTML=`<div class="severity-key condition-severity-key">${severityLegend(severity)}</div>${selectedStrip(selected)}
 <div class="severity-grid-scroll condition-grid-scroll" tabindex="0" role="region" aria-label="Collision severity by condition">
 <table class="severity-grid condition-grid" style="--severity-scopes:${scopes.length}">
   <thead><tr><th scope="col">Condition</th>${scopes.map((scope,i)=>`<th scope="col" class="${i===0?'severity-baseline':''}"><b>${i>0&&selected&&scope.records.includes(selected)?selectedPin(`The selected collision is in ${scope.label}`):''}${esc(scope.label)}</b>${scope.name?`<small>${esc(scope.name)}</small>`:''}</th>`).join('')}</tr></thead>
   <tbody>${rows}</tbody>
 </table></div>
 <p class="chart-reading severity-method">Numbers = collisions in each condition; the bar splits them into fatal, serious and slight. Click a condition to highlight its collisions on the map. Observed association, not proof of cause.</p>
 <span class="severity-tooltip" aria-hidden="true" hidden></span>`;
 const content=root.querySelector('.condition-grid-scroll');
 bindSeverityInteractions(root,content,onSeverity);
 bindSelectedStrip(root,onClearSelected);
 content.onclick=event=>{
   if(event.target.closest('[data-severity-filter]'))return;
   const row=event.target.closest('[data-condition]');
   if(!row||row.querySelector('[data-condition-label]')?.disabled)return;
   const label=row.dataset.condition;
   onPattern(label);
   root.querySelector(`[data-condition="${CSS.escape(label)}"] [data-condition-label]`)?.focus({preventScroll:true});
 };
}

export function renderConditions(root,{records,scopes,active,onPattern,severity,onSeverity,selected=null,onClearSelected}){
 if(scopes?.length>1)return renderConditionGrid(root,{scopes,active,onPattern,severity,onSeverity,selected,onClearSelected});
 const pinned=selected; // the selected collision (local `selected` below means a highlighted condition)
 const fits=g=>Boolean(pinned&&[1,2,3].includes(pinned.sev)&&g.test(pinned));
 const data=conditionAnalysis(records);
 const conditionBar = group => {
   const inGroup = records.filter(group.test);
   const counts = severityCounts(inGroup);
   const pin = fits(group) ? selectedPin(`The selected collision: ${group.label.toLowerCase()}`) : '';
   const details = `${group.label}: ${counts.map((count, index) => `${number(count)} ${severityLabels[index].toLowerCase()}`).join(', ')} out of ${number(group.n)} collisions`;
   const selected = active?.label === group.label && !active?.other;
   const bar = severityStack(counts, group.n, { interactive: selected, severity, name: group.label, marked: pin ? markedSeverity(pinned, inGroup) : null });
   const label = `<span>${pin}${esc(group.label)}</span><b>${number(group.n)} ${group.n === 1 ? 'collision' : 'collisions'}</b>`;
   const condition = `data-condition="${esc(group.label)}"`;
   if (selected) {
     return `<div class="condition-value is-active${pin ? ' has-selected' : ''}" ${condition}>
       <button type="button" class="condition-label" aria-pressed="true" aria-label="${esc(details)}">${label}</button>${bar}
     </div>`;
   }
   return `<button type="button" class="condition-value${pin ? ' has-selected' : ''}" ${condition} aria-pressed="false" ${!group.n ? 'disabled' : ''}
     aria-label="${esc(details)}">${label}${bar}</button>`;
 };
 root.innerHTML=`<div class="severity-key condition-severity-key">${severityLegend(severity)}</div>${selectedStrip(selected)}
 <div class="condition-facets">${data.pairs.map(pair=>`<section><h3>${pair.name}</h3>${pair.groups.map(conditionBar).join('')}${pair.excluded ? `<small class="excluded">${pair.excluded} other/unknown excluded</small>` : ''}</section>`).join('')}</div>
 <h3 class="matrix-title">Lighting and surface together</h3><div class="condition-matrix"><span></span><b>Dry</b><b>Wet / damp</b>${[['Daylight',3,2],['Darkness',1,0]].map(([name,a,b])=>`<b>${name}</b>${[a,b].map(i=>{const g=data.combinations[i];return `<button data-condition="${esc(g.label)}" aria-pressed="${active?.label===g.label&&!active?.other}" ${!g.n?'disabled':''} style="background:${g.n?`rgba(48,109,160,${.05+.85*g.share/100})`:'var(--surface)'};color:${g.share>60?'white':'var(--text)'}" title="${g.label}: ${g.severe} serious/fatal out of ${g.n}" class="${fits(g)?'has-selected':''}"><b>${fits(g)?selectedPin(`The selected collision: ${g.label.toLowerCase()}`):''}${pct(g.share)}${g.n>0&&g.n<5?'*':''}</b><small>${g.n?`${g.severe} severe out of ${g.n}`:'No records'}</small></button>`;}).join('')}`).join('')}</div>
 <p class="chart-reading">Darker blue = a higher severe-outcome percentage. * Fewer than 5 collisions. Observed association, not proof of cause.${data.combinationExcluded?` ${data.combinationExcluded} other/unknown records excluded from the matrix.`:''}</p>
 <span class="severity-tooltip" aria-hidden="true" hidden></span>`;
 root.querySelectorAll('[data-condition]').forEach(control => {
   control.onclick = event => {
     if (event.target.closest('[data-severity-filter]')) return;
     onPattern(control.dataset.condition);
     const replacement = root.querySelector(`[data-condition="${CSS.escape(control.dataset.condition)}"]`);
     const focusTarget = replacement?.matches('button') ? replacement : replacement?.querySelector('.condition-label');
     focusTarget?.focus({ preventScroll: true });
   };
 });
 bindSeverityInteractions(root, root.querySelector('.condition-facets'), onSeverity);
 bindSelectedStrip(root, onClearSelected);
}
