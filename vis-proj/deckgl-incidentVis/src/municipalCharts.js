import {SEVERITY_NAMES, USERS} from "./data.js";
import {escapeHtml as esc} from './details.js';
import {conditionAnalysis,severitySummary,RQ3_PAIRS} from './areaGroups.js';
const pct=x=>x==null?'—':`${Math.round(x)}%`;
const number=n=>n.toLocaleString('en-GB');
export function severityCounts(records){return [1,2,3].map(sev=>records.filter(r=>r.sev===sev).length);}
export function annualUserData(records,years,users){return users.map((name,user)=>({name,user,cells:years.map(year=>{const rs=records.filter(r=>r.yr===year&&(r.users||[r.user]).includes(user));return {year,...severitySummary(rs),counts:severityCounts(rs)};})}));}
export function renderUserYears(root,{records,years,activeYears,scope,users,activeUsers,onUser,onYear,areaScopes}){
 const scopes=areaScopes||[{name:scope,records}];
 const rows=users.map((name,user)=>({name,user,cells:scopes.flatMap((area,index)=>annualUserData(area.records,years,users)[user].cells.map(c=>({...c,area:index,areaName:area.name})))}));
 const key=['Fatal','Serious','Slight'].map((name,i)=>`<span><i style="background:var(--${name.toLowerCase()})"></i>${name}</span>`).join('');
 root.innerHTML=`<p class="analysis-scope">${esc(scope)} · ${years.join(', ')}</p><div class="severity-key">${key}</div><p class="chart-reading">Percent = serious or fatal collisions. Coloured bars show collision severity.</p>
 <div class="user-years-scroll"><table class="user-years"><thead>${scopes.length>1?`<tr><th>Area</th>${scopes.map((a,i)=>`<th colspan="${years.length}">Area ${i+1}: ${esc(a.name)}</th>`).join('')}</tr>`:''}<tr><th>Road user</th>${scopes.map(()=>years.map(y=>`<th><span data-user-year="${y}">${y}</span></th>`).join('')).join('')}</tr></thead><tbody>${rows.map(row=>`<tr class="${activeUsers.has(row.user)?'user-active':''}"><th><button data-user-filter="${row.user}" aria-pressed="${activeUsers.has(row.user)}">${esc(row.name)}</button></th>${row.cells.map(c=>`<td data-user="${row.user}" data-area="${c.area}" data-year="${c.year}" data-total="${c.n}" data-severe="${c.severe}"><button data-user-filter="${row.user}" title="${esc(row.name)} · ${esc(c.areaName)} · ${c.year}: ${c.counts[0]} fatal, ${c.counts[1]} serious, ${c.counts[2]} slight collisions. Click to filter this road-user group.">${c.n?`<b>${pct(c.share)}${c.n<5?'*':''}</b><span class="severity-stack">${c.counts.map((n,i)=>`<i style="width:${100*n/c.n}%;background:var(--${['fatal','serious','slight'][i]})"></i>`).join('')}</span><small>${c.n} collisions</small>`:'<span class="no-records">No records</span>'}</button></td>`).join('')}</tr>`).join('')}</tbody></table></div>
 <p class="chart-reading">* Fewer than 5 collisions. Groups use casualty records; one collision can appear in several groups. Click a road user to filter; click again to clear.</p>`;
 root.querySelectorAll('[data-user-filter]').forEach(b=>b.onclick=()=>onUser(Number(b.dataset.userFilter)));
}
export function renderConditions(root,{records,scope,years,active,onPattern}){
 const data=conditionAnalysis(records);
 const button=g=>`<button class="condition-value" data-condition="${esc(g.label)}" aria-pressed="${active?.label===g.label&&!active?.other}" ${!g.n && active?.label !== g.label ? 'disabled' : ''} title="${g.label}: ${g.severe} serious/fatal out of ${g.n} recorded collisions. Click to highlight; click again to clear."><span>${esc(g.label)}</span><b>${pct(g.share)}${g.n>0&&g.n<5?'*':''}</b><i class="condition-track"><i style="width:${g.share||0}%"></i></i><small>${g.n?`${g.severe} severe out of ${g.n}`:'No records'}</small></button>`;
 root.innerHTML=`<p class="analysis-scope">${esc(scope)} · ${years.length?years.join(', ')+' combined':'all years'} · ${data.total.n} collisions</p><p class="chart-reading">Serious or fatal collisions (%). Same 0–100% scale in every comparison.</p>
 <div class="condition-facets">${data.pairs.map(pair=>`<section><h3>${pair.name}</h3>${pair.groups.map(button).join('')}<small class="excluded">${pair.excluded?`${pair.excluded} other/unknown excluded`:'All records included'}</small></section>`).join('')}</div>
 <h3 class="matrix-title">Lighting and surface together</h3><div class="condition-matrix"><span></span><b>Dry</b><b>Wet / damp</b>${[['Daylight',3,2],['Darkness',1,0]].map(([name,a,b])=>`<b>${name}</b>${[a,b].map(i=>{const g=data.combinations[i];return `<button data-condition="${esc(g.label)}" aria-pressed="${active?.label===g.label&&!active?.other}" ${!g.n && active?.label !== g.label ? 'disabled' : ''} style="background:${g.n?`rgba(48,109,160,${.05+.85*g.share/100})`:'var(--surface)'};color:${g.share>60?'white':'var(--text)'}" title="${g.label}: ${g.severe} serious/fatal out of ${g.n}"><b>${pct(g.share)}${g.n>0&&g.n<5?'*':''}</b><small>${g.n?`${g.severe} severe out of ${g.n}`:'No records'}</small></button>`;}).join('')}`).join('')}</div>
 <p class="chart-reading">Darker blue = a higher severe-outcome percentage. * Fewer than 5 collisions. Observed association, not proof of cause.${data.combinationExcluded?` ${data.combinationExcluded} other/unknown records excluded from the matrix.`:''}</p>`;
 root.querySelectorAll('[data-condition]').forEach(b=>b.onclick=()=>onPattern(b.dataset.condition));
}

const [wet, dry] = RQ3_PAIRS[0].groups;
const surfaces = [dry, wet, {label: "Other / unknown", test: record => !dry.test(record) && !wet.test(record)}];
const severitySymbols = ["◆", "▲", "●"];

export function combinationCounts(records) {
  const counts = new Map();
  for (const record of records) {
    const surface = surfaces.findIndex(group => group.test(record));
    for (const outcome of record.casualtyOutcomes) {
      const key = `${surface}-${outcome}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export function matchesCombination(record, key) {
  const [surface, user, severity] = key.split("-");
  return surfaces[surface].test(record) && record.casualtyOutcomes.has(`${user}-${severity}`);
}

export function combinationLabel(key) {
  const [surface, user, severity] = key.split("-");
  return `${surfaces[surface].label} · ${USERS[user]} · ${SEVERITY_NAMES[severity - 1]} injury`;
}

export function renderCombinations(root, {records, scope, years, active, onSelect, onRecords}) {
  const counts = combinationCounts(records);
  const severityMark = (name, index) =>
    `<span class="outcome-mark" style="color:var(--${name.toLowerCase()})" aria-hidden="true">${severitySymbols[index]}</span>`;
  root.innerHTML = `
    <p class="analysis-scope">${esc(scope)} · ${years.join(", ")}</p>
    <div class="severity-key">${SEVERITY_NAMES.map((name, index) => `<span>${severityMark(name, index)} ${name}</span>`).join("")}</div>
    <p class="chart-reading">Counts show collisions with at least one casualty of the indicated road-user type and injury severity. A collision can appear in several groups.</p>
    <div class="outcome-scroll"><table class="outcome-matrix">
      <thead><tr><th scope="col">Road user</th>${surfaces.map(surface => `<th scope="col">${surface.label}</th>`).join("")}</tr></thead>
      <tbody>${USERS.map((user, userIndex) => `
        <tr><th scope="row">${esc(user)}</th>${surfaces.map((_, surfaceIndex) => `
          <td><div class="outcome-counts">${SEVERITY_NAMES.map((name, index) => {
            const key = `${surfaceIndex}-${userIndex}-${index + 1}`;
            const count = counts.get(key) ?? 0;
            const label = `${combinationLabel(key)} · ${count} ${count === 1 ? "collision" : "collisions"}`;
            return `<button type="button" data-combination="${key}" aria-pressed="${active === key}" aria-label="${esc(label)}" title="${esc(label)}">${severityMark(name, index)} <strong>${number(count)}</strong></button>`;
          }).join("")}</div></td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <div class="outcome-actions" aria-live="polite">${active ? `<span>${esc(combinationLabel(active))} · ${number(counts.get(active) ?? 0)} collisions</span>
      <button type="button" class="btn" data-combination-records>View records</button>` : ""}</div>`;
  root.querySelectorAll("[data-combination]").forEach(button => {
    button.onclick = () => {
      const key = button.dataset.combination;
      onSelect(key);
      root.querySelector(`[data-combination="${key}"]`).focus({preventScroll: true});
    };
  });
  root.querySelector("[data-combination-records]")?.addEventListener("click", onRecords);
}
