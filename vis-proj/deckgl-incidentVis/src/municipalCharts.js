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

function severityStack(counts, total, { interactive, severity, name }) {
  const segments = counts.map((count, index) => {
    if (!count) return '';
    const label = `${number(count)} ${severityLabels[index].toLowerCase()} ${count === 1 ? 'collision' : 'collisions'}`;
    const style = severitySegmentStyle(count, total, index);
    return interactive ? `<button type="button" class="severity-segment" data-severity-filter="${index + 1}" data-severity-tip="${label}"
      aria-pressed="${severity === index + 1}" aria-label="${esc(`${name}: ${label}. Toggle severity on map.`)}" style="${style}"></button>`
      : `<i class="severity-segment" aria-hidden="true" style="${style}"></i>`;
  }).join('');
  return `<span class="severity-stack">${segments}</span>`;
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

export function renderUserSeverity(root, { scopes, years, users, activeUsers, onUser, drilldownYear, onDrilldown, getSeverity, onSeverity, areaContext }) {
  const yearRange = years.every((year, index) => year === years[0] + index) && years.length > 1
    ? `${years[0]}–${years.at(-1)}` : years.join(', ');
  const singleUser = activeUsers.size === 1 ? activeUsers.values().next().value : undefined;
  const yearName = singleUser === undefined ? 'Selected road users' : users[singleUser];
  const initialYear = drilldownYear ?? years.at(-1);
  const yearContent = html => `<div class="severity-year-reveal"><div><div class="severity-year-content">${html}</div></div></div>`;
  root.innerHTML = `<div class="severity-toolbar">
    <div class="severity-key">${severityLegend(getSeverity())}</div>
    <span class="severity-period">${years.length === 1 ? "Year" : "Years"} shown · ${yearRange}</span>
  </div>
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
      const bar = severityStack(counts, total, { interactive, severity: getSeverity(), name: `${name} · ${scope.label}` });
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
    return `<tr class="${filterable ? 'severity-user' : 'severity-overall'}${pressed ? ' is-active' : ''}${combined ? ' severity-combined-total' : ''}" ${filterable ? `data-road-user="${user}"` : ''}>
      <th scope="row">${filterable ? `<button type="button" class="severity-user-label" data-user-filter="${user}" aria-pressed="${pressed}">${esc(name)}</button>` : esc(name)}
      ${yearControl ? `<button type="button" class="severity-year-toggle" aria-expanded="${yearOpen}" aria-controls="severity-year-row">By year</button>` : ''}
      </th>${renderCells(name, user, null, combined)}</tr>
      ${yearControl ? `<tr id="severity-year-row" class="severity-year-row${singleUser === undefined ? ' is-combined' : ''}${yearOpen ? ' is-open' : ''}" ${yearOpen ? '' : 'inert'}>
        <th scope="row">${yearContent(`<label>Year <select aria-label="Year for ${esc(yearName)}">${years.map(year => `<option ${year === initialYear ? 'selected' : ''}>${year}</option>`).join('')}</select></label>`)}</th>
        ${renderCells(yearName, singleUser, initialYear, combined)}
      </tr>` : ''}`;
  };
  content.innerHTML = `<table class="severity-grid" style="--severity-scopes:${scopes.length}">
    <thead><tr><th scope="col">Road user</th>${scopes.map((scope, index) => `<th scope="col" class="${index === 0 ? 'severity-baseline' : ''}">
      <b>${esc(scope.label)}</b>${scope.name ? `<small>${esc(scope.name)}</small>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${renderRow('All road users')}${activeUsers.size > 1 ? renderRow('Selected road users', undefined, true) : ''}${users.map((name, user) => renderRow(name, user)).join('')}</tbody>
  </table>`;
  bindSeverityInteractions(root, content, onSeverity);
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
export function renderConditions(root,{records,active,onPattern,severity,onSeverity}){
 const data=conditionAnalysis(records);
 const conditionBar = group => {
   const counts = severityCounts(records.filter(group.test));
   const details = `${group.label}: ${counts.map((count, index) => `${number(count)} ${severityLabels[index].toLowerCase()}`).join(', ')} out of ${number(group.n)} collisions`;
   const selected = active?.label === group.label && !active?.other;
   const bar = severityStack(counts, group.n, { interactive: selected, severity, name: group.label });
   const label = `<span>${esc(group.label)}</span><b>${number(group.n)} ${group.n === 1 ? 'collision' : 'collisions'}</b>`;
   const condition = `data-condition="${esc(group.label)}"`;
   if (selected) {
     return `<div class="condition-value is-active" ${condition}>
       <button type="button" class="condition-label" aria-pressed="true" aria-label="${esc(details)}">${label}</button>${bar}
     </div>`;
   }
   return `<button type="button" class="condition-value" ${condition} aria-pressed="false" ${!group.n ? 'disabled' : ''}
     aria-label="${esc(details)}">${label}${bar}</button>`;
 };
 root.innerHTML=`<div class="severity-key condition-severity-key">${severityLegend(severity)}</div>
 <div class="condition-facets">${data.pairs.map(pair=>`<section><h3>${pair.name}</h3>${pair.groups.map(conditionBar).join('')}${pair.excluded ? `<small class="excluded">${pair.excluded} other/unknown excluded</small>` : ''}</section>`).join('')}</div>
 <h3 class="matrix-title">Lighting and surface together</h3><div class="condition-matrix"><span></span><b>Dry</b><b>Wet / damp</b>${[['Daylight',3,2],['Darkness',1,0]].map(([name,a,b])=>`<b>${name}</b>${[a,b].map(i=>{const g=data.combinations[i];return `<button data-condition="${esc(g.label)}" aria-pressed="${active?.label===g.label&&!active?.other}" ${!g.n?'disabled':''} style="background:${g.n?`rgba(48,109,160,${.05+.85*g.share/100})`:'var(--surface)'};color:${g.share>60?'white':'var(--text)'}" title="${g.label}: ${g.severe} serious/fatal out of ${g.n}"><b>${pct(g.share)}${g.n>0&&g.n<5?'*':''}</b><small>${g.n?`${g.severe} severe out of ${g.n}`:'No records'}</small></button>`;}).join('')}`).join('')}</div>
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
}
