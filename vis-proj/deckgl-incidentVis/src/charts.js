// --------------------------------------------------
// Linked analysis charts (SVG).
// Each chart shows all matching collisions, ignoring its own
// filter so the other options stay visible, with marks for
// the selected area (blue) and the compared area (orange).
// Clicking a bar or cell toggles a filter for every view.
//
// ctx = {
//   records, passes(record, skipKey), filters,
//   selA: records in the selected area (or []),
//   selB: records in the compared area (or null),
//   toggle(filterKey, value), color(cssVar)
// }
// --------------------------------------------------
import { META, USERS, LIGHT, WEATHER, DAYS } from "./data.js";
import {RQ3_PAIRS,RQ3_COMBINATIONS} from "./areaGroups.js";

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs, parent, text) {
  const node = document.createElementNS(NS, tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

export const fmt = (n) => n.toLocaleString("en-GB");
export const ksiShare = (records) =>
  (records.length ? (100 * records.filter((r) => r.sev <= 2).length) / records.length : 0);

// Ring marker for the selected collision (the point clicked on the map), matching the
// pins used in the road-user and conditions charts.
function selectedRing(parent, ctx, cx, cy, r = 4.5) {
  return el("circle", { cx, cy, r, fill: ctx.color("--paper"), stroke: ctx.color("--text"), "stroke-width": 2, "pointer-events": "none", "data-selected-marker": "" }, parent);
}

function prepare(svg) {
  const rect = svg.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  svg.replaceChildren();
  return [rect.width, rect.height];
}

// Keyboard + mouse activation for a clickable SVG group.
function clickable(group, label, onActivate) {
  group.setAttribute("class", "bar-hit");
  group.setAttribute("tabindex", "0");
  group.setAttribute("role", "button");
  group.setAttribute("aria-label", label);
  group.addEventListener("click", onActivate);
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  });
}

// Overall bars and selected-area markers share the same 0–100% scale.
const RISK_FIELDS = { user: USERS, light: LIGHT, wx: WEATHER };
const CONDITION_FIELDS={surface:RQ3_PAIRS[0].groups,road:RQ3_PAIRS[3].groups,combined:RQ3_COMBINATIONS};
const shareText = records => records.length ? `${Math.round(ksiShare(records))}%` : '—';
const countText = records => `${records.filter(r => r.sev <= 2).length} of ${records.length}`;
function areas(ctx, field) {
  return [
    ctx.hasSelection && { label: ctx.selectionLabel||'Area', records: ctx.areaRecords(field), color: ctx.color('--sel') },
    ctx.selB && { label: 'Compared', records: ctx.comparedRecords(field), color: ctx.color('--cmp') },
  ].filter(Boolean);
}
function chartKey(svg, ctx) {
  const hint = svg.previousElementSibling;
  hint.textContent = 'Serious or fatal collisions (%). Grey bar: overall.'
    + (ctx.hasSelection ? ` Blue line: selected ${ctx.selectionLabel==='Circumstance'?'circumstance':'area'}.` : ' Select an area to compare.')
    + (ctx.selB ? ' Orange line: compared area.' : '')
    + (ctx.selected ? ' Ring = selected collision.' : '');
}
function tooltip(g, base, selected) {
  el('title', {}, g, `Overall: ${shareText(base)} (${countText(base)} collisions serious or fatal).`
    + selected.map(a => ` ${a.label}: ${shareText(a.records)} (${countText(a.records)}).`).join('')
    + ' This chart keeps its own filter options visible; other filters apply.');
}
export function renderRisk(svg, ctx, field) {
  const [w, h] = prepare(svg);
  chartKey(svg, ctx);
  const base = ctx.records.filter(r => ctx.passes(r, field));
  const selected = areas(ctx, field);
  const conditions=CONDITION_FIELDS[field];
  const rows = conditions ? conditions.map((m,value)=>({name:field==='combined'?['Dark · wet','Dark · dry','Daylight · wet','Daylight · dry'][value]:m.label,value,metric:m,records:base.filter(m.test)}))
    : RISK_FIELDS[field].map((name,value)=>({name,value,records:base.filter(r=>r[field]===value)})).sort((a,b)=>ksiShare(b.records)-ksiShare(a.records));
  const omitted=conditions?base.length-rows.reduce((n,r)=>n+r.records.length,0):0;
  const ml = Math.min(130, w * .36), mr = 34;
  const X = v => ml + v / 100 * (w - ml - mr);
  const rh = Math.min(64, (h - 20) / rows.length);
  rows.forEach((row, i) => {
    const y = 5 + i * rh, active = conditions ? ctx.pattern?.label===row.metric.label&&!ctx.pattern.other : ctx.filters[field].has(row.value);
    const g = el('g', {'data-category':row.value, 'data-count':row.records.length}, svg);
    el('rect', {x:0,y:y-4,width:w,height:rh-1,fill:active?ctx.color('--sel-soft'):'transparent'}, g);
    el('text', {x:0,y:y+10,'font-size':12,'font-weight':active?700:400},g,row.name);
    el('text', {x:0,y:y+24,'font-size':9,class:'muted'},g,row.records.length?`${countText(row.records)} serious/fatal${row.records.length<5?'*':''}`:'No records');
    el('line', {x1:ml,x2:X(100),y1:y+7,y2:y+7,stroke:ctx.color('--grid'),'stroke-width':1},g);
    if(row.records.length) el('rect', {x:ml,y,width:Math.max(0,X(ksiShare(row.records))-ml),height:14,rx:2,fill:ctx.color('--neutral-bar'),'fill-opacity':conditions||!ctx.filters[field].size||active?1:.35},g);
    el('text',{x:X(100)+5,y:y+11,'font-size':11},g,shareText(row.records));
    const subs = selected.map(a=>({...a, records:a.records.filter(r=>conditions?row.metric.test(r):r[field]===row.value)}));
    subs.forEach((a,j)=>{
      if(a.records.length) el('line',{x1:X(ksiShare(a.records)),x2:X(ksiShare(a.records)),y1:j?y+14:y-3,y2:j?y+25:y+14,stroke:a.color,'stroke-width':3,'data-area-marker':a.label},g);
      const text=el('text',{x:ml,y:y+29+j*13,'font-size':10.5,'font-weight':600},g,
        a.records.length ? `${a.label}: ${shareText(a.records)} (${countText(a.records)})${a.records.length<5?'*':''}` : `${a.label}: no collisions`);
      text.style.fill=a.color;
    });
    tooltip(g,row.records,subs);
    clickable(g,`${row.name}: overall ${shareText(row.records)}. ${subs.map(a=>`${a.label} ${shareText(a.records)}, ${countText(a.records)}`).join('. ')}. ${conditions?'Click to highlight matching collisions; click again to clear.':'Click to filter.'}`,()=>conditions?ctx.selectPattern(row.metric.label):ctx.toggle(field,row.value));
  });
  el('text',{x:0,y:h-2,'font-size':9.5,class:'muted'},svg,conditions?`${omitted?`${omitted} other/unknown excluded · `:''}* Fewer than 5 records`:selected.length?'* Fewer than 5 collisions; read with care.':'Click a category to filter; others stay visible.');
}

// "When collisions happen": hour × weekday counts; dots = selected area.
const HEAT_RAMP = ["#e6e5dc", "#c9cbbe", "#a9ad9e", "#878c7c", "#636857", "#40443a"];

export function renderHeat(svg, ctx) {
  if(svg.dataset.brushing)return;
  const [w, h] = prepare(svg);
  const counts = DAYS.map(() => new Array(24).fill(0));
  ctx.records.filter((r) => ctx.passes(r, "cell")).forEach((r) => { if (r.hr >= 0) counts[r.dow][r.hr] += 1; });
  const selected = DAYS.map(() => new Array(24).fill(0));
  ctx.selA.forEach((r) => { if (r.hr >= 0) selected[r.dow][r.hr] += 1; });
  const max = Math.max(1, ...counts.flat());
  const ml = 30;
  const mb = 18;
  const cw = (w - ml) / 24;
  const ch = (h - mb) / 7;
  installTimeBrush(svg,ctx,ml,cw,ch);

  DAYS.forEach((day, d) => {
    el("text", { x: ml - 5, y: d * ch + ch / 2 + 3.5, "text-anchor": "end", "font-size": 10, class: "muted" }, svg, day);
    for (let hour = 0; hour < 24; hour++) {
      const value = counts[d][hour];
      const key = `${d}-${hour}`;
      const active = ctx.filters.cell.has(key);
      const step = value ? Math.min(5, Math.floor((value / max) * 5.999)) : -1;
      const cell = el("rect", {
        x: ml + hour * cw + 0.6, y: d * ch + 0.6, width: Math.max(0.5, cw - 1.2), height: Math.max(0.5, ch - 1.2), rx: 2,
        fill: step < 0 ? ctx.color("--cell0") : HEAT_RAMP[step],
        stroke: active ? ctx.color("--text") : "none", "stroke-width": active ? 2 : 0, class: "bar-hit",
      }, svg);
      const hh = (n) => String(n).padStart(2, "0");
      el("title", {}, cell, `${day} ${hh(hour)}:00–${hh(hour + 1)}:00 · ${value} collisions`
        + (selected[d][hour] ? ` · ${selected[d][hour]} in the selected area` : ""));
      cell.dataset.timeCell=key;
      cell.setAttribute("role","button");cell.setAttribute("tabindex","0");cell.setAttribute("aria-pressed",String(active));
      cell.setAttribute("aria-label",`${day} ${hh(hour)}:00, ${value} collisions. Toggle time filter.`);
      cell.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();ctx.toggle("cell",key);}};
      if (selected[d][hour]) {
        el("circle", {
          cx: ml + hour * cw + cw / 2, cy: d * ch + ch / 2, r: Math.max(1, Math.min(cw / 2 - 1, 1.8 + selected[d][hour])),
          fill: ctx.color("--sel"), "pointer-events": "none",
        }, svg);
      }
    }
  });
  const sel = ctx.selected;
  if (sel && sel.hr >= 0 && sel.dow >= 0) {
    const x = ml + sel.hr * cw, y = sel.dow * ch;
    // White halo + dark outline so it reads on light and dark cells alike.
    el("rect", { x: x - 0.5, y: y - 0.5, width: cw + 1, height: ch + 1, rx: 3, fill: "none", stroke: ctx.color("--paper"), "stroke-width": 4.5, "pointer-events": "none" }, svg);
    el("rect", { x: x - 0.5, y: y - 0.5, width: cw + 1, height: ch + 1, rx: 3, fill: "none", stroke: ctx.color("--text"), "stroke-width": 2.2, "pointer-events": "none", "data-selected-marker": "" }, svg);
    selectedRing(svg, ctx, x + cw / 2, y + ch / 2, Math.max(2.5, Math.min(cw, ch) / 2 - 3));
  }
  [0, 6, 12, 18].forEach((hour) => {
    el("text", { x: ml + hour * cw, y: h - 4, "font-size": 10, class: "muted" }, svg, `${String(hour).padStart(2, "0")}:00`);
  });
}

function installTimeBrush(svg, ctx, ml, cw, ch) {
  let drag=null,box=null;
  svg.style.touchAction='none';
  const cellAt=e=>{
    const r=svg.getBoundingClientRect(),x=(e.clientX-r.left)*svg.viewBox.baseVal.width/r.width,y=(e.clientY-r.top)*svg.viewBox.baseVal.height/r.height;
    return [Math.max(0,Math.min(6,Math.floor(y/ch))),Math.max(0,Math.min(23,Math.floor((x-ml)/cw)))];
  };
  const clear=()=>{box?.remove();box=null;drag=null;delete svg.dataset.brushing;};
  svg.onpointerdown=e=>{
    if(e.button!==0||!e.target.dataset.timeCell)return;
    e.preventDefault();svg.dataset.brushing='true';const start=cellAt(e);drag={start,end:start,add:e.ctrlKey||e.metaKey||e.shiftKey,x:e.clientX,y:e.clientY};
    svg.setPointerCapture(e.pointerId);
    box=el('rect',{fill:'rgba(45,112,176,.15)',stroke:ctx.color('--sel'),'stroke-width':2,'pointer-events':'none'},svg);
  };
  svg.onpointermove=e=>{
    if(!drag)return;drag.end=cellAt(e);
    const [d,h]=drag.start,[d2,h2]=drag.end;
    box.setAttribute('x',ml+Math.min(h,h2)*cw);box.setAttribute('y',Math.min(d,d2)*ch);
    box.setAttribute('width',(Math.abs(h-h2)+1)*cw);box.setAttribute('height',(Math.abs(d-d2)+1)*ch);
  };
  svg.onpointerup=e=>{
    if(!drag)return;
    const {start,end,add,x,y}=drag;clear();if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
    if(Math.hypot(e.clientX-x,e.clientY-y)<4){ctx.toggle('cell',`${start[0]}-${start[1]}`);return;}
    const keys=[];for(let d=Math.min(start[0],end[0]);d<=Math.max(start[0],end[0]);d++)for(let h=Math.min(start[1],end[1]);h<=Math.max(start[1],end[1]);h++)keys.push(`${d}-${h}`);
    ctx.selectTimeCells(keys,add);
  };
  svg.onpointercancel=clear;
  svg.onkeydown=e=>{if(e.key==='Escape')clear();};
}
