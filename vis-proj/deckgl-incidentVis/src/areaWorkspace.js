import {escapeHtml as esc} from './details.js';
import {PATTERN_METRICS} from './areaGroups.js';
export function renderSavedComparisons(root,{state,onLoad,onRemove}){
  root.hidden=!state.savedComparisons.length;if(root.hidden)return;
  root.innerHTML=`<h2>Saved comparisons</h2><p class="hint">Click a row to restore both areas, years and filters. Saved for this session.</p><div>${state.savedComparisons.map(c=>{
    const t=c.snapshot.temporal,years=t.mode==='compare'?`${t.from} vs ${t.to}`:[...t.years].sort().join(', ');
    return `<div class="saved-comparison-row"><button class="saved-comparison-load" data-load-comparison="${c.id}"><b>${esc(c.name)}</b><span>${years} · ${t.size} m hexagons</span></button><button class="saved-comparison-remove" data-remove-comparison="${c.id}" aria-label="Remove ${esc(c.name)}">×</button></div>`;
  }).join('')}</div>`;
  root.querySelectorAll('[data-load-comparison]').forEach(b=>b.onclick=()=>onLoad(Number(b.dataset.loadComparison)));
  root.querySelectorAll('[data-remove-comparison]').forEach(b=>b.onclick=()=>onRemove(Number(b.dataset.removeComparison)));
}

export function renderComparison(root,{state,areas,onPattern,onAdd,onFocus,onRemove,onSave}){
  const expanded=root.querySelector('[data-more-comparison]')?.open||false;
  const years=[...state.filters.yr].sort((a,b)=>a-b);
  const countCell=(n,total)=>total?`${n} of ${total} (${Math.round(100*n/total)}%)`:'No records';
  const metricRow=m=>`<tr class="circumstance-row" tabindex="0" role="button" data-pattern="${esc(m.label)}" aria-pressed="${state.patternHighlight?.label===m.label}" aria-label="${esc(m.label)}. Select or deselect points and statistics."><th>${esc(m.label)}</th>${areas.map(a=>{const n=a.records.filter(m.test).length;return `<td>${countCell(n,a.records.length)}<div class="comparison-share"><i style="width:${a.records.length?100*n/a.records.length:0}%"></i></div></td>`;}).join('')}</tr>`;
  const primary=PATTERN_METRICS.filter(m=>['Serious or fatal collisions','In darkness','Wet surface'].includes(m.label));
  const secondary=PATTERN_METRICS.filter(m=>!primary.includes(m));
  const headers=()=>`<tr><th>Measure</th>${areas.map((a,i)=>`<th><button data-focus-comparison="${i}" title="Show this area on the map">Area ${i+1}: ${esc(a.name)}</button><button class="comparison-remove" data-remove-comparison-area="${i}" aria-label="Remove area ${i+1}">×</button></th>`).join('')}</tr>`;
  root.innerHTML=`<div class="patterns-heading"><b>Compare ${areas.length} areas</b><span class="comparison-actions"><button data-add-comparison-area>Add another area</button><button data-save-whole-comparison>Save comparison</button></span></div>
    <p class="hint">Same years and filters for every area. Overlapping areas can share collisions.${areas.some(a=>a.records.length<5)?' Fewer than 5 collisions: read percentages with care.':''}</p>
    <div class="comparison-scroll"><table class="pattern-changes comparison-matrix"><thead>${headers()}</thead><tbody>${years.map(y=>`<tr><th>Collisions in ${y}</th>${areas.map(a=>`<td>${a.records.filter(r=>r.yr===y).length}</td>`).join('')}</tr>`).join('')}${primary.map(metricRow).join('')}</tbody></table></div>
    <details data-more-comparison ${expanded?'open':''}><summary>More circumstances</summary><div class="comparison-scroll"><table class="pattern-changes comparison-matrix"><thead>${headers()}</thead><tbody>${secondary.map(metricRow).join('')}</tbody></table></div></details>
    <p class="hint">The charts below show Area 1 and Area 2; this comparison includes every area above.</p>`;
  root.querySelectorAll('[data-pattern]').forEach(row=>{row.onclick=()=>onPattern(row.dataset.pattern);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPattern(row.dataset.pattern);}};});
  root.querySelectorAll('[data-focus-comparison]').forEach(b=>b.onclick=()=>onFocus(Number(b.dataset.focusComparison)));
  root.querySelectorAll('[data-remove-comparison-area]').forEach(b=>b.onclick=()=>onRemove(Number(b.dataset.removeComparisonArea)));
  root.querySelector('[data-add-comparison-area]').onclick=onAdd;
  root.querySelector('[data-save-whole-comparison]').onclick=onSave;
}
