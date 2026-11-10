import { PolygonLayer } from "@deck.gl/layers";
import proj4 from "proj4";

// --------------------------------------------------
// Aggregate in metres using the recorded British National Grid
// coordinates. The grid origin stays fixed when the year changes.
// Only polygon display coordinates are transformed to longitude/latitude.
// --------------------------------------------------
const NATIONAL_GRID = "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +datum=OSGB36 +units=m +no_defs";
const projection = proj4(NATIONAL_GRID, "EPSG:4326");
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const COUNT_COLORS = [[218, 222, 225, 220], [126, 185, 219, 255], [66, 143, 193, 255], [32, 104, 164, 255], [12, 67, 128, 255], [6, 35, 82, 255]];
const COUNT_LIMITS = [0, 1, 3, 6, 11, 21];
const COUNT_LABELS = ["0", "1–2", "3–5", "6–10", "11–20", "21+"];
const signed = (value) => `${value > 0 ? "+" : ""}${value}`;
const number = (value) => value.toLocaleString("en-GB");
const cssColor = (color) => `rgb(${color.slice(0, 3).join(",")})`;

function gridCoordinate(x, y, radius) {
  const q = (Math.sqrt(3) * x / 3 - y / 3) / radius;
  const r = 2 * y / (3 * radius);
  let a = Math.round(q), b = Math.round(r);
  const c = Math.round(-q - r);
  if (Math.abs(a - q) > Math.abs(b - r) && Math.abs(a - q) > Math.abs(c + q + r)) a = -b - c;
  else if (Math.abs(b - r) > Math.abs(c + q + r)) b = -a - c;
  return [a, b];
}

export function buildConcentrationCells(results, width) {
  const radius = width / Math.sqrt(3);
  const cells = new Map();
  const seen = new Set();

  for (const { year, features } of results) {
    for (const feature of features) {
      const key = `${year}:${feature.properties.collision_index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = feature.properties;
      let x = Number(p.location_easting_osgr), y = Number(p.location_northing_osgr);
      if (!p.location_easting_osgr || !p.location_northing_osgr || !Number.isFinite(x) || !Number.isFinite(y)) {
        [x, y] = projection.inverse(feature.geometry.coordinates.slice(0, 2));
      }
      const [q, r] = gridCoordinate(x, y, radius);
      const id = `${q}:${r}`;
      if (!cells.has(id)) {
        const center = [width * (q + r / 2), radius * 1.5 * r];
        const polygon = Array.from({ length: 6 }, (_, i) => {
          const angle = (30 + i * 60) * Math.PI / 180;
          return projection.forward([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
        });
        cells.set(id, { kind: "concentration", id, center: projection.forward(center), polygon, counts: YEARS.map(() => 0), records: YEARS.map(() => []) });
      }
      const cell = cells.get(id);
      const index = Number(year) - YEARS[0];
      cell.counts[index]++;
      cell.records[index].push(feature);
    }
  }
  return [...cells.values()];
}

// --------------------------------------------------
// One temporal selection drives the map, legend and area history.
// Filters are applied upstream to every year using the same conditions.
// Changing zoom never changes the analytical grid size.
// --------------------------------------------------
export function createConcentrations({ onChange, onCollision, onLayout }) {
  const el = (id) => document.getElementById(id);
  const slider = el("year-slider");
  const inspector = el("area-inspector");
  const reference = el("reference-year");
  const areaChoice = el("area-choice");
  let results = [];
  let cells = [];
  let year = 2025;
  let baseline = 2024;
  let view = "count";
  let width = 700;
  let selected = null;
  let accumulated = false;
  let combined = false;
  let customYears = [2025];
  let busy = true;
  let maxDifference = 1;
  let historyMaximum = 1;
  let areaRecords = [];
  let sliderFrame = 0;

  reference.innerHTML = YEARS.map((y) => `<option value="${y}">${y}</option>`).join("");
  el("combined-years").innerHTML = YEARS.map((y) => `<label><input type="checkbox" value="${y}" ${y === year ? "checked" : ""}>${y}</label>`).join("");

  function getYears() {
    if (view === "change") return [baseline, year];
    if (combined) return customYears;
    return accumulated ? YEARS.filter((y) => y <= year) : [year];
  }

  function getCount(cell) {
    return getYears().reduce((total, y) => total + cell.counts[y - 2020], 0);
  }

  function getDifference(cell) {
    return cell.counts[year - 2020] - cell.counts[baseline - 2020];
  }

  function fillColor(cell) {
    if (view === "count") {
      const count = getCount(cell);
      return COUNT_COLORS[COUNT_LIMITS.filter((limit) => count >= limit).length - 1];
    }
    const difference = getDifference(cell);
    if (!difference) return COUNT_COLORS[0];
    const end = difference > 0 ? [17, 83, 164] : [184, 58, 12];
    const mix = 0.55 + 0.45 * Math.abs(difference) / maxDifference;
    return end.map((channel) => Math.round(247 + (channel - 247) * mix)).concat(255);
  }

  function rebuildCells() {
    cells = buildConcentrationCells(results, width);
    historyMaximum = Math.max(1, ...cells.flatMap((cell) => cell.counts));
    // The symmetric change scale covers all year pairs, not just the
    // currently displayed pair, so stepping years preserves its meaning.
    maxDifference = Math.max(1, ...cells.map((cell) => Math.max(...cell.counts) - Math.min(...cell.counts)));
    selected = selected ? cells.find((cell) => cell.id === selected.id) || null : null;
    const ordered = cells.slice().sort((a, b) => b.counts.reduce((n, c) => n + c, 0) - a.counts.reduce((n, c) => n + c, 0));
    areaChoice.innerHTML = '<option value="">Choose an area…</option>' + ordered.map((cell) => `<option value="${cell.id}">Area ${cell.id} · ${number(cell.counts.reduce((n, c) => n + c, 0))} across all years</option>`).join("");
  }

  function renderInspector() {
    areaChoice.value = selected?.id || "";
    const ys = getYears();
    el("area-location").textContent = selected
      ? `Cell ${selected.id} · ${width} m across · ${selected.center[1].toFixed(4)}° N, ${Math.abs(selected.center[0]).toFixed(4)}° W`
      : "Select a hexagon on the map or choose an area above.";
    el("area-result").textContent = !selected ? "" : view === "change"
      ? `${baseline}: ${selected.counts[baseline - 2020]} → ${year}: ${selected.counts[year - 2020]} (${signed(getDifference(selected))})`
      : `${number(getCount(selected))} recorded collisions · ${ys.join(", ") || "no years chosen"}`;
    el("area-history").innerHTML = selected ? YEARS.map((y, i) => `<div class="area-history-row ${ys.includes(y) ? "in-period" : ""}"><span>${y}</span><span class="area-history-track"><i style="width:${100 * selected.counts[i] / historyMaximum}%"></i></span><strong>${selected.counts[i]}</strong></div>`).join("") : "";
    el("area-history-note").textContent = selected ? `Annual counts · shared bar scale 0–${historyMaximum}. Same applied filters in all six years.` : "";
    areaRecords = selected ? ys.flatMap((y) => selected.records[y - 2020]) : [];
    el("area-record-count").textContent = `Collision records in this selection (${areaRecords.length})`;
    el("area-record").innerHTML = areaRecords.map((feature, i) => `<option value="${i}">${feature.properties.collision_year} · ${feature.properties.date} · ${feature.properties.collision_index}</option>`).join("");
    el("area-record").disabled = el("open-area-record").disabled = !areaRecords.length;
  }

  function render() {
    const ys = getYears();
    slider.value = year;
    slider.disabled = busy || combined;
    slider.setAttribute("aria-valuetext", view === "change" ? `${year}, compared with ${baseline}` : accumulated ? `2020 to ${year}, accumulated` : String(year));
    slider.classList.toggle("accumulating", accumulated);
    slider.style.setProperty("--year-progress", `${100 * (year - 2020) / 5}%`);
    el("current-year").textContent = combined ? customYears.join(" + ") || "Choose years" : accumulated ? `2020–${year}` : year;
    el("previous-year").disabled = busy || combined || year === 2020;
    el("next-year").disabled = busy || combined || year === 2025;
    el("view-concentrations").setAttribute("aria-pressed", String(view === "count"));
    el("view-change").setAttribute("aria-pressed", String(view === "change"));
    el("reference-control").hidden = view !== "change";
    reference.value = baseline;
    [...reference.options].forEach((option) => option.disabled = Number(option.value) === year);
    slider.min = view === "change" ? 2021 : 2020;
    // The slider always occupies the same 2020–2025 track. In change
    // view 2020 is permitted too, with an explicitly later reference.
    slider.min = 2020;
    el("accumulate-years").checked = accumulated;
    el("accumulate-years").disabled = view === "change" || busy;
    el("combined-period").hidden = view === "change";
    for (const id of ["reference-year", "cell-width", "view-concentrations", "view-change", "inspect-area"]) el(id).disabled = busy;
    el("inspect-area").disabled = busy || !cells.length;
    el("combined-years").querySelectorAll("input").forEach((input) => { input.checked = customYears.includes(Number(input.value)); input.disabled = busy; });
    el("concentration-title").textContent = view === "change" ? `Change in recorded collisions · ${baseline} → ${year}`
      : combined || accumulated ? `Combined collision counts · ${ys.join(" + ") || "choose years"}` : `Recorded collisions · ${year}`;
    const totals = Object.fromEntries(results.map((result) => [result.year, result.features.length]));
    const total = ys.reduce((n, y) => n + (totals[y] || 0), 0);
    el("concentration-scope").textContent = busy ? "Updating collision records…" : view === "change"
      ? `Calderdale: ${number(totals[baseline] || 0)} → ${number(totals[year] || 0)} (${signed((totals[year] || 0) - (totals[baseline] || 0))}) · same filters in both years`
      : `${number(total)} matching collisions · ${ys.length} ${ys.length === 1 ? "year" : "years"}`;
    const colours = view === "count" ? COUNT_COLORS.map(cssColor) : [-maxDifference, -maxDifference/2, 0, maxDifference/2, maxDifference].map(n => cssColor(fillColor({counts: YEARS.map(y => y === year ? Math.max(n,0) : y === baseline ? Math.max(-n,0) : 0)})));
    const labels = view === "count" ? COUNT_LABELS : [`-${maxDifference}`, "", "0", "", `+${maxDifference}`];
    el("concentration-legend").innerHTML = `<span>${view === "count" ? "Collisions / hexagon" : "Count change"}</span><div class="map-scale"><div class="map-scale-colours">${colours.map(c => `<i style="background:${c}"></i>`).join("")}</div><div class="map-scale-labels">${labels.map(l => `<span>${l}</span>`).join("")}</div></div>${view === "change" ? '<span>Fewer / unchanged / more</span>' : ""}`;
    el("temporal-note").textContent = view === "change"
      ? "Unchanged areas can still have high counts. Use Concentrations to see their levels."
      : accumulated || combined ? "Combined counts show accumulation, not annual change."
      : "Fixed geographic cells in every year. Counts describe recorded collisions, not road risk.";
    renderInspector();
    onChange();
  }

  function setInspectorOpen(open) {
    inspector.hidden = !open;
    document.body.classList.toggle("area-open", open);
    el("inspect-area").setAttribute("aria-expanded", String(open));
    onLayout();
  }

  function setYear(value) {
    year = Number(value);
    if (view === "change") baseline = year === 2020 ? 2021 : year - 1;
    render();
  }

  slider.addEventListener("input", () => {
    if (sliderFrame) cancelAnimationFrame(sliderFrame);
    sliderFrame = requestAnimationFrame(() => { sliderFrame = 0; setYear(slider.value); });
  });
  slider.addEventListener("change", () => {
    if (sliderFrame) cancelAnimationFrame(sliderFrame);
    sliderFrame = 0;
    setYear(slider.value);
  });
  el("previous-year").addEventListener("click", () => setYear(Math.max(2020, year - 1)));
  el("next-year").addEventListener("click", () => setYear(Math.min(2025, year + 1)));
  el("view-concentrations").addEventListener("click", () => { view = "count"; render(); });
  el("view-change").addEventListener("click", () => { view = "change"; accumulated = combined = false; el("combined-period").open = false; if (baseline === year) baseline = year === 2020 ? 2021 : year - 1; render(); });
  reference.addEventListener("change", () => { baseline = Number(reference.value); render(); });
  el("cell-width").addEventListener("change", () => { width = Number(el("cell-width").value); selected = null; rebuildCells(); render(); });
  el("accumulate-years").addEventListener("change", () => { accumulated = el("accumulate-years").checked; combined = false; el("combined-period").open = false; render(); });
  el("combined-period").addEventListener("toggle", () => { combined = el("combined-period").open; if (combined) accumulated = false; render(); onLayout(); });
  el("combined-years").addEventListener("change", () => { customYears = [...el("combined-years").querySelectorAll("input:checked")].map((input) => Number(input.value)); render(); });
  el("inspect-area").addEventListener("click", () => { setInspectorOpen(inspector.hidden); if (!inspector.hidden) areaChoice.focus(); });
  el("close-area").addEventListener("click", () => { setInspectorOpen(false); el("inspect-area").focus(); });
  areaChoice.addEventListener("change", () => { selected = cells.find((cell) => cell.id === areaChoice.value) || null; render(); });
  el("open-area-record").addEventListener("click", () => {
    const feature = areaRecords[Number(el("area-record").value)];
    if (feature) { setInspectorOpen(false); onCollision(feature); }
  });

  return {
    setData(next) { results = next; busy = false; rebuildCells(); render(); },
    setBusy(value) { busy = value; render(); },
    getYears,
    getFeatures: () => results.filter((result) => getYears().includes(Number(result.year))).flatMap((result) => result.features),
    selectCell(cell) {
      selected = cells.find((item) => item.id === cell.id) || null;
      render();
      setInspectorOpen(true);
      inspector.querySelector(".area-body").scrollTop = 0;
    },
    getLayers() {
      if (!cells.length) return [];
      return [new PolygonLayer({
        id: "collision-concentrations", data: cells,
        getPolygon: (cell) => cell.polygon,
        filled: true, stroked: true, extruded: false,
        getFillColor: fillColor,
        getLineColor: (cell) => cell.id === selected?.id ? [40, 44, 41, 255] : [255, 254, 250, 180],
        getLineWidth: (cell) => cell.id === selected?.id ? 3 : 0.8,
        lineWidthUnits: "pixels", pickable: true,
        autoHighlight: true, highlightColor: [40, 44, 41, 45],
        updateTriggers: { getFillColor: [view, year, baseline, accumulated, combined, customYears.join(","), maxDifference], getLineColor: [selected?.id], getLineWidth: [selected?.id] },
        transitions: { getFillColor: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180 },
      })];
    },
    getTooltip(cell) {
      return { text: `Area ${cell.id} · ${width} m\n${view === "change" ? `${baseline}: ${cell.counts[baseline - 2020]} → ${year}: ${cell.counts[year - 2020]} (${signed(getDifference(cell))})` : `${number(getCount(cell))} recorded collisions`}\nClick to inspect this area.`, style: { backgroundColor: "#fffefa", color: "#282c29", borderRadius: "9px", padding: "12px" } };
    },
  };
}
