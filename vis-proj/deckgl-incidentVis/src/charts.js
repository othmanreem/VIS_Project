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

// "Where collisions turn serious": KSI share per road user / lighting / weather.
const RISK_FIELDS = { user: USERS, light: LIGHT, wx: WEATHER };

export function renderRisk(svg, ctx, field) {
  const [w, h] = prepare(svg);
  const names = RISK_FIELDS[field];
  const base = ctx.records.filter((r) => ctx.passes(r, field));
  const avg = ksiShare(base);
  const rows = names
    .map((name, value) => {
      const group = base.filter((r) => r[field] === value);
      return { value, name, n: group.length, k: ksiShare(group) };
    })
    .filter((row) => row.n > 0)
    .sort((a, b) => b.k - a.k);

  const ml = Math.min(130, w * 0.36);
  const mr = 46;
  const top = 4;
  const rh = Math.min(40, (h - 22) / Math.max(1, rows.length));
  const barH = Math.max(6, Math.min(14, rh - 14));
  const max = Math.max(60, ...rows.map((row) => row.k));
  const X = (v) => ml + (v / max) * (w - ml - mr);

  rows.forEach((row, i) => {
    const y = top + i * rh;
    const active = ctx.filters[field].has(row.value);
    const on = !ctx.filters[field].size || active;
    const g = el("g", {}, svg);
    el("rect", { x: 0, y, width: w, height: rh - 2, fill: "transparent" }, g);
    el("text", { x: 0, y: y + 12, "font-size": 12, "font-weight": active ? 700 : 400 }, g, row.name);
    el("text", { x: 0, y: y + 25, "font-size": 10, class: "muted" }, g, `${fmt(row.n)} collisions`);
    el("rect", {
      x: ml, y: y + 3, width: Math.max(1, X(row.k) - ml), height: barH, rx: 2,
      fill: row.k > avg + 5 ? ctx.color("--risk") : ctx.color("--neutral-bar"), "fill-opacity": on ? 1 : 0.3,
    }, g);
    el("text", { x: X(row.k) + 5, y: y + 14, "font-size": 11, "font-weight": 650 }, g, `${Math.round(row.k)}%`);
    [[ctx.selA, "--sel"], [ctx.selB, "--cmp"]].forEach(([records, colorVar]) => {
      if (!records) return;
      const sub = records.filter((r) => r[field] === row.value);
      if (sub.length < 3) return; // too few to show a share
      const x = X(ksiShare(sub));
      el("line", { x1: x, x2: x, y1: y, y2: y + barH + 6, stroke: ctx.color(colorVar), "stroke-width": 3 }, g);
    });
    clickable(g, `${row.name}: ${Math.round(row.k)}% killed or seriously injured, ${row.n} collisions. Click to filter.`,
      () => ctx.toggle(field, row.value));
  });

  if (!rows.length) {
    el("text", { x: 0, y: 16, "font-size": 12, class: "muted" }, svg, "No collisions match the filters.");
    return;
  }
  el("line", { x1: X(avg), x2: X(avg), y1: 0, y2: top + rows.length * rh, stroke: ctx.color("--text"), "stroke-dasharray": "3 3" }, svg);
  el("text", {
    x: X(avg), y: Math.min(h - 3, top + rows.length * rh + 12), "text-anchor": "middle", "font-size": 10, class: "muted",
  }, svg, `average ${Math.round(avg)}%`);
}

// "Speed limit risk": KSI share per speed limit (the limits found in the data).
export function renderSpeed(svg, ctx) {
  const [w, h] = prepare(svg);
  const SPEEDS = META.speeds;
  const base = ctx.records.filter((r) => ctx.passes(r, "spd"));
  const groups = SPEEDS.map((_, v) => base.filter((r) => r.spd === v));
  const avg = ksiShare(base);
  const ml = 30;
  const mb = 30;
  const mt = 16;
  const max = Math.max(50, ...groups.map((g) => ksiShare(g)));
  const bw = (w - ml) / SPEEDS.length;
  const Y = (v) => mt + (1 - Math.min(v, max) / max) * (h - mt - mb);

  [0, Math.round(max / 2), Math.round(max)].forEach((v) => {
    el("line", { x1: ml, x2: w, y1: Y(v), y2: Y(v), stroke: ctx.color("--grid") }, svg);
    el("text", { x: ml - 4, y: Y(v) + 3.5, "text-anchor": "end", "font-size": 9.5, class: "muted" }, svg, `${v}%`);
  });

  groups.forEach((group, v) => {
    const k = ksiShare(group);
    const x = ml + v * bw;
    const active = ctx.filters.spd.has(v);
    const on = !ctx.filters.spd.size || active;
    const g = el("g", {}, svg);
    el("rect", { x, y: 0, width: bw, height: h, fill: "transparent" }, g);
    if (group.length) {
      el("rect", {
        x: x + 4, y: Y(k), width: Math.max(1, bw - 8), height: Y(0) - Y(k), rx: 2,
        fill: k > avg + 5 ? ctx.color("--risk") : ctx.color("--neutral-bar"), "fill-opacity": on ? 1 : 0.3,
      }, g);
      el("text", { x: x + bw / 2, y: Y(k) - 4, "text-anchor": "middle", "font-size": 10.5, "font-weight": 650 }, g, `${Math.round(k)}%`);
    }
    el("text", { x: x + bw / 2, y: h - 16, "text-anchor": "middle", "font-size": 10.5, "font-weight": active ? 700 : 400 }, g, SPEEDS[v]);
    el("text", { x: x + bw / 2, y: h - 4, "text-anchor": "middle", "font-size": 9.5, class: "muted" }, g, `n=${group.length}`);
    [[ctx.selA, "--sel"], [ctx.selB, "--cmp"]].forEach(([records, colorVar]) => {
      if (!records) return;
      const sub = records.filter((r) => r.spd === v);
      if (sub.length < 3) return;
      const y = Y(ksiShare(sub));
      el("line", { x1: x + 4, x2: x + bw - 4, y1: y, y2: y, stroke: ctx.color(colorVar), "stroke-width": 3 }, g);
    });
    clickable(g, `${SPEEDS[v]} mph: ${Math.round(k)}% killed or seriously injured, ${group.length} collisions. Click to filter.`,
      () => ctx.toggle("spd", v));
  });
  el("line", { x1: ml, x2: w, y1: Y(avg), y2: Y(avg), stroke: ctx.color("--text"), "stroke-dasharray": "3 3" }, svg);
}

// "When collisions happen": hour × weekday counts; dots = selected area.
const HEAT_RAMP = ["#e6e5dc", "#c9cbbe", "#a9ad9e", "#878c7c", "#636857", "#40443a"];

export function renderHeat(svg, ctx) {
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
      cell.addEventListener("click", () => ctx.toggle("cell", key));
      if (selected[d][hour]) {
        el("circle", {
          cx: ml + hour * cw + cw / 2, cy: d * ch + ch / 2, r: Math.max(1, Math.min(cw / 2 - 1, 1.8 + selected[d][hour])),
          fill: ctx.color("--sel"), "pointer-events": "none",
        }, svg);
      }
    }
  });
  [0, 6, 12, 18].forEach((hour) => {
    el("text", { x: ml + hour * cw, y: h - 4, "font-size": 10, class: "muted" }, svg, `${String(hour).padStart(2, "0")}:00`);
  });
}
