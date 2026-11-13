// --------------------------------------------------
// Linked analysis charts (SVG).
// Each chart shows all matching collisions, ignoring its own
// filter so the other options stay visible, with marks for
// the selected area (blue) and the compared area (orange).
// Clicking a bar toggles a filter for every view.
//
// ctx = {
//   records, passes(record, skipKey), filters,
//   selA: records in the selected area (or []),
//   selB: records in the compared area (or null),
//   toggle(filterKey, value), color(cssVar)
// }
// --------------------------------------------------
import { META, USERS, LIGHT, WEATHER } from "./data.js";

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

// "Collisions per year": one horizontal bar per year.
//   length = number of collisions in that year
//   hue    = the most common severity among those collisions
// The bars describe the selected area when there is one, otherwise every
// collision that matches the filters. A compared area is shown as an orange
// tick on the same scale. Only years present in the loaded data are listed.
// Ties between severities go to the more severe level. The hues are the
// map's own severity colours (--fatal, --serious, --slight).
//
// Optional ctx.areaRecords(which, skip) returns the records of area "A" or "B"
// that match every filter except `skip`, or null when no such area is selected.
// The year chart asks it to ignore the year filter, so clicking a year does not
// empty the other years' bars. Without it, ctx.selA / ctx.selB are used.
const SEVERITY_STYLE = [
  { name: "Fatal", variable: "--fatal", fallback: "#7a1a14" },
  { name: "Serious", variable: "--serious", fallback: "#d8492b" },
  { name: "Slight", variable: "--slight", fallback: "#f29a5b" },
];

const severityColor = (ctx, index) =>
  ctx.color(SEVERITY_STYLE[index].variable) || SEVERITY_STYLE[index].fallback;

// Most common severity (0 = fatal, 1 = serious, 2 = slight) with its share and counts.
function dominantSeverity(records) {
  const counts = [0, 0, 0];
  records.forEach((r) => {
    if (r.sev >= 1 && r.sev <= 3) counts[r.sev - 1] += 1;
  });
  const known = counts[0] + counts[1] + counts[2];
  if (!known) return null;
  const index = counts.indexOf(Math.max(...counts));
  return { index, share: counts[index] / known, counts };
}

function groupByYear(records, years) {
  const groups = new Map(years.map((year) => [year, []]));
  records.forEach((r) => groups.get(r.yr)?.push(r));
  return groups;
}

export function renderYears(svg, ctx) {
  const [w, h] = prepare(svg);
  const present = new Set(ctx.records.map((r) => r.yr));
  const years = META.years.filter((year) => present.has(year));
  if (!years.length) {
    el("text", { x: 0, y: 16, "font-size": 12, class: "muted" }, svg, "No collisions to show.");
    return;
  }

  // Chosen area if there is one, otherwise everything; other filters still apply.
  const area = (which) => (ctx.areaRecords
    ? ctx.areaRecords(which, "yr")
    : which === "A" ? (ctx.selA && ctx.selA.length ? ctx.selA : null) : ctx.selB || null);
  const areaA = area("A");
  const areaB = area("B");
  const hasArea = areaA !== null;
  const byYear = groupByYear(hasArea ? areaA : ctx.records.filter((r) => ctx.passes(r, "yr")), years);
  const compared = areaB ? groupByYear(areaB, years) : null;
  const filterable = ctx.filters.yr instanceof Set; // years can also act as a filter

  const legendH = 20;
  const top = 4;
  const rh = Math.min(36, (h - legendH - top) / years.length);
  const barH = Math.max(8, Math.min(18, rh - 10));
  const ml = 38;
  const mr = Math.min(130, w * 0.4);
  const max = Math.max(1, ...years.map((year) => Math.max(
    byYear.get(year).length, compared ? compared.get(year).length : 0)));
  const X = (v) => ml + (v / max) * (w - ml - mr);

  years.forEach((year, i) => {
    const records = byYear.get(year);
    const n = records.length;
    const dominant = dominantSeverity(records);
    const y = top + i * rh;
    const by = y + (rh - 2 - barH) / 2;
    const active = filterable && ctx.filters.yr.has(year);
    const on = !filterable || !ctx.filters.yr.size || active;
    const g = el("g", {}, svg);

    el("rect", { x: 0, y, width: w, height: rh - 2, fill: "transparent" }, g);
    el("text", { x: 0, y: by + barH / 2 + 4, "font-size": 12, "font-weight": active ? 700 : 400 }, g, String(year));
    if (n) {
      el("rect", {
        x: ml, y: by, width: Math.max(2, X(n) - ml), height: barH, rx: 2,
        fill: dominant ? severityColor(ctx, dominant.index) : ctx.color("--neutral-bar"),
        "fill-opacity": on ? 1 : 0.3,
      }, g);
    }
    const label = el("text", { x: X(n) + 6, y: by + barH / 2 + 4, "font-size": 11, "font-weight": 650 }, g, fmt(n));
    if (dominant) {
      el("tspan", { dx: 6, "font-size": 10, "font-weight": 400, class: "muted" }, label,
        `${Math.round(dominant.share * 100)}% ${SEVERITY_STYLE[dominant.index].name.toLowerCase()}`);
    }
    if (compared) {
      const c = compared.get(year).length;
      if (c) {
        el("line", { x1: X(c), x2: X(c), y1: by - 3, y2: by + barH + 3, stroke: ctx.color("--cmp"), "stroke-width": 3 }, g);
      }
    }

    const breakdown = dominant
      ? SEVERITY_STYLE.map((s, k) => `${s.name} ${dominant.counts[k]}`).join(", ")
      : "no severity recorded";
    const noun = (count) => `${fmt(count)} ${count === 1 ? "collision" : "collisions"}`;
    const summary = `${year}: ${noun(n)}${hasArea ? " in the selected area" : ""} (${breakdown})`
      + (compared ? ` · ${noun(compared.get(year).length)} in the compared area` : "");
    if (filterable) {
      clickable(g, `${summary}. Click to filter.`, () => ctx.toggle("yr", year));
    } else {
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", summary);
    }
    el("title", {}, g, summary);
  });

  // Colour key for the bar hue.
  let x = 0;
  SEVERITY_STYLE.forEach((style, index) => {
    el("rect", { x, y: h - 13, width: 9, height: 9, rx: 2, fill: severityColor(ctx, index) }, svg);
    el("text", { x: x + 13, y: h - 5, "font-size": 10, class: "muted" }, svg, style.name);
    x += 13 + style.name.length * 5.8 + 14;
  });
}