// One palette for the map and every chart. Years use position and text.
export const SEVERITIES = [
  { code: "1", label: "Fatal", color: [133, 31, 68, 235] },
  { code: "2", label: "Serious", color: [203, 91, 25, 235] },
  { code: "3", label: "Slight", color: [36, 121, 139, 220] },
  { code: "unknown", label: "Not recorded", color: [115, 120, 112, 220] },
];

// Membership describes injured people in the casualty records.
// A collision may belong to more than one group.
export const ROAD_USER_GROUPS = [
  { key: "pedestrian", label: "Pedestrians", codes: ["0"] },
  { key: "cyclist", label: "Cyclists", codes: ["1"] },
  { key: "motorcycle", label: "Motorcycle riders / passengers", codes: ["2", "3", "4", "5", "23", "97"] },
  { key: "car", label: "Car / taxi occupants", codes: ["8", "9"] },
  { key: "bus", label: "Bus / minibus occupants", codes: ["10", "11"] },
  { key: "goods", label: "Goods vehicle occupants", codes: ["19", "20", "21", "98"] },
  { key: "other", label: "Other recorded road users", codes: ["16", "17", "18", "22", "90"] },
  { key: "unknown", label: "Unknown / not recorded", codes: ["-1", "99"] },
];

export function severityCode(feature) {
  const code = String(feature.properties.collision_severity);
  return SEVERITIES.some((severity) => severity.code === code) ? code : "unknown";
}

export function severityColor(feature) {
  return SEVERITIES.find((severity) => severity.code === severityCode(feature)).color;
}

function featureKey(feature) {
  return `${feature.properties.collision_year}:${feature.properties.collision_index}`;
}

const number = (value) => value.toLocaleString("en-GB");
const percentage = (count, total) => total ? `${(100 * count / total).toFixed(1)}%` : "—";
const cssColor = (color) => `rgb(${color.slice(0, 3).join(",")})`;

// Charts share the applied collision set. Hover/click only highlights;
// a road-user choice or an explicit area selection changes the scope.
export function createAnalysis({ onChange, onHighlight, onLayout }) {
  const panel = document.getElementById("analysis-panel");
  const show = document.getElementById("show-analysis");
  const hide = document.getElementById("hide-analysis");
  const groupSelect = document.getElementById("analysis-road-user");
  const areaButton = document.getElementById("select-analysis-area");
  const clearArea = document.getElementById("clear-analysis-area");
  const areaHint = document.getElementById("analysis-area-hint");
  const clearHighlight = document.getElementById("clear-analysis-highlight");
  const chartIds = ["analysis-year-chart", "analysis-severity-chart", "analysis-group-chart"];
  let results = [];
  let base = [];
  let scoped = [];
  let memberships = new Map();
  let area = null;
  let firstCorner = null;
  let choosingArea = false;
  let pinned = null;
  let hovered = null;
  let openedOnce = false;

  groupSelect.innerHTML = '<option value="all">All injured road users</option>' +
    ROAD_USER_GROUPS.map((group) => `<option value="${group.key}">${group.label}</option>`).join("");
  document.getElementById("severity-legend").innerHTML = SEVERITIES.slice(0, 3).map((severity) =>
    `<span><i style="background:${cssColor(severity.color)}" aria-hidden="true"></i>${severity.label}</span>`,
  ).join("");

  function belongs(feature, group) {
    return group === "all" || memberships.get(featureKey(feature))?.has(group);
  }

  function matches(feature, focus) {
    return !focus || ((!focus.year || String(feature.properties.collision_year) === focus.year) &&
      (!focus.severity || severityCode(feature) === focus.severity) &&
      (!focus.group || belongs(feature, focus.group)));
  }

  function getFocus() { return hovered || pinned; }

  function updateHighlight() {
    const focus = getFocus();
    const count = focus ? scoped.filter((feature) => matches(feature, focus)).length : 0;
    const parts = focus ? [focus.year,
      SEVERITIES.find((severity) => severity.code === focus.severity)?.label,
      ROAD_USER_GROUPS.find((group) => group.key === focus.group)?.label].filter(Boolean) : [];
    document.getElementById("analysis-highlight").textContent = focus
      ? `${parts.join(" · ")}: ${number(count)} of ${number(scoped.length)} highlighted`
      : "No chart highlight";
    const context = [ROAD_USER_GROUPS.find((group) => group.key === groupSelect.value)?.label,
      area ? "Selected area" : null, ...parts].filter(Boolean);
    show.textContent = ["Analysis", ...context].join(" · ");
    show.title = document.getElementById("analysis-scope").textContent;
    clearHighlight.hidden = !pinned;
    panel.querySelectorAll("[data-chart-focus]").forEach((button) => {
      button.setAttribute("aria-pressed", String(Boolean(pinned) && button.dataset.chartFocus === JSON.stringify(pinned)));
    });
    onHighlight();
  }

  function counts(features) {
    return SEVERITIES.map((severity) => ({ ...severity,
      count: features.filter((feature) => severityCode(feature) === severity.code).length }));
  }

  function focusAttributes(focus, label) {
    const value = JSON.stringify(focus).replace(/"/g, "&quot;");
    return `data-chart-focus="${value}" aria-pressed="false" aria-label="${label}" title="${label}"`;
  }

  function stackedRow(label, features, focus, maximum) {
    const values = counts(features).filter((value) => value.code !== "unknown" || value.count);
    const segments = values.filter((value) => value.count).map((value) =>
      `<button type="button" class="analysis-segment" style="width:${100 * value.count / maximum}%;background:${cssColor(value.color)}"
        ${focusAttributes({ ...focus, severity: value.code }, `${label}, ${value.label}: ${number(value.count)} collisions`)}></button>`,
    ).join("");
    return `<div class="analysis-chart-row">
      <div class="analysis-row-heading"><button type="button" class="analysis-row-label"
        ${focusAttributes(focus, `${label}: ${number(features.length)} collisions`)}>${label}</button><strong>${number(features.length)}</strong></div>
      <div class="analysis-stack">${segments}</div>
      <div class="analysis-row-values">${values.map((value) => `<button type="button"
        ${focusAttributes({ ...focus, severity: value.code }, `${label}, ${value.label}: ${number(value.count)} collisions`)}>${value.count} ${value.label.toLowerCase()}</button>`).join("")}</div>
    </div>`;
  }

  function renderCharts() {
    const yearChart = document.getElementById(chartIds[0]);
    const severityChart = document.getElementById(chartIds[1]);
    const groupChart = document.getElementById(chartIds[2]);
    if (!results.length) {
      yearChart.textContent = "Select years and apply filters to show the charts.";
      severityChart.replaceChildren();
      groupChart.replaceChildren();
      return;
    }
    const years = results.map((result) => ({ year: result.year,
      features: scoped.filter((feature) => String(feature.properties.collision_year) === result.year) }));
    const maximum = Math.max(1, ...years.map((year) => year.features.length));
    yearChart.innerHTML = years.map(({ year, features }) => stackedRow(year, features, { year }, maximum)).join("") +
      `<p class="analysis-help">${scoped.length ? `Collision counts · shared scale 0–${number(maximum)}. Only applied years are shown.` : "No collisions match this selection."}</p>`;
    const values = counts(scoped).filter((value) => value.code !== "unknown" || value.count);
    const severityMaximum = Math.max(1, ...values.map((value) => value.count));
    severityChart.innerHTML = values.map((value) => `<button type="button" class="analysis-outcome"
      ${focusAttributes({ severity: value.code }, `${value.label}: ${number(value.count)} collisions, ${percentage(value.count, scoped.length)} of this selection`)}>
      <span class="analysis-outcome-label"><i style="background:${cssColor(value.color)}" aria-hidden="true"></i>${value.label}</span>
      <strong>${number(value.count)}</strong><span>${percentage(value.count, scoped.length)}</span>
      <span class="analysis-outcome-track"><i style="width:${100 * value.count / severityMaximum}%;background:${cssColor(value.color)}"></i></span>
    </button>`).join("") + `<p class="analysis-help">${scoped.length ? `Percentages use all ${number(scoped.length)} collisions in this selection. Highlighting leaves these totals unchanged.` : "Percentages are unavailable because no collisions match this selection."}</p>`;
    // Each group's denominator is its own set of unique collisions.
    // Keep all rows to expose overlaps, including an honest zero.
    const groups = ROAD_USER_GROUPS.map((group) => ({ ...group,
      features: scoped.filter((feature) => belongs(feature, group.key)) }));
    const groupMaximum = Math.max(1, ...groups.map((group) => group.features.length));
    groupChart.innerHTML = groups.map((group) => stackedRow(group.label, group.features, { group: group.key }, groupMaximum)).join("");
  }

  function renderScope() {
    const group = groupSelect.value;
    scoped = base.filter((feature) => {
      const [x, y] = feature.geometry.coordinates;
      return belongs(feature, group) && (!area || (x >= area[0][0] && x <= area[1][0] && y >= area[0][1] && y <= area[1][1]));
    });
    document.getElementById("analysis-scope").textContent = results.length
      ? `${number(scoped.length)} collisions · ${area ? "Selected map area" : "All Calderdale"}`
      : "Select years and apply filters to begin.";
    const signatures = results.map((result) => JSON.stringify(Object.entries(result.filters)
      .map(([key, values]) => [key, [...values].sort()]).sort(([a], [b]) => a.localeCompare(b))));
    const note = document.getElementById("analysis-filter-note");
    note.hidden = new Set(signatures).size <= 1;
    note.textContent = "Different filters are applied to these years. Compare like-for-like conditions before drawing conclusions.";
    clearArea.hidden = !area;
    groupSelect.disabled = areaButton.disabled = !results.length;
    document.getElementById("severity-legend").innerHTML = SEVERITIES.filter((severity) =>
      severity.code !== "unknown" || base.some((feature) => severityCode(feature) === "unknown"),
    ).map((severity) => `<span><i style="background:${cssColor(severity.color)}" aria-hidden="true"></i>${severity.label}</span>`).join("");
    renderCharts();
    updateHighlight();
    onChange();
  }

  function setOpen(open) {
    panel.hidden = !open;
    show.hidden = open;
    show.setAttribute("aria-expanded", String(open));
    if (!open) { stopArea(); hovered = null; updateHighlight(); }
    onLayout(open);
  }

  function stopArea() {
    choosingArea = false;
    firstCorner = null;
    areaHint.hidden = true;
    areaButton.textContent = "Select map area";
    areaButton.setAttribute("aria-pressed", "false");
  }

  show.addEventListener("click", () => { setOpen(true); hide.focus(); });
  hide.addEventListener("click", () => { stopArea(); setOpen(false); show.focus(); onHighlight(); });
  groupSelect.addEventListener("change", () => {
    pinned = hovered = null;
    renderScope();
  });
  clearHighlight.addEventListener("click", () => { pinned = hovered = null; updateHighlight(); });
  clearArea.addEventListener("click", () => { area = null; pinned = hovered = null; stopArea(); renderScope(); });
  areaButton.addEventListener("click", () => {
    if (choosingArea) stopArea();
    else {
      choosingArea = true;
      firstCorner = null;
      areaButton.textContent = "Cancel area selection";
      areaButton.setAttribute("aria-pressed", "true");
      areaHint.hidden = false;
      areaHint.textContent = "Select area: click one corner on the map, then the opposite corner. Escape cancels.";
    }
    onHighlight();
  });

  // Delegation keeps keyboard and pointer interactions identical after chart updates.
  chartIds.forEach((id) => {
    const chart = document.getElementById(id);
    function enter(event) {
      const button = event.target.closest("[data-chart-focus]");
      if (!button || button.contains(event.relatedTarget)) return;
      hovered = JSON.parse(button.dataset.chartFocus);
      updateHighlight();
    }
    function leave(event) {
      if (chart.contains(event.relatedTarget)) return;
      hovered = null;
      updateHighlight();
    }
    chart.addEventListener("pointerover", enter);
    chart.addEventListener("focusin", enter);
    chart.addEventListener("pointerleave", leave);
    chart.addEventListener("focusout", leave);
    chart.addEventListener("click", (event) => {
      const button = event.target.closest("[data-chart-focus]");
      if (!button) return;
      const focus = JSON.parse(button.dataset.chartFocus);
      pinned = JSON.stringify(pinned) === JSON.stringify(focus) ? null : focus;
      hovered = null;
      updateHighlight();
    });
  });

  return {
    setOpen,
    getFeatures: () => scoped,
    isHighlighted: (feature) => matches(feature, getFocus()),
    hasHighlight: () => Boolean(getFocus()),
    isChoosingArea: () => choosingArea,
    getArea: () => area,
    getCorner: () => firstCorner,
    cancelArea() {
      if (!choosingArea) return false;
      stopArea();
      onHighlight();
      return true;
    },
    pickArea(coordinate) {
      if (!choosingArea || !coordinate) return;
      if (!firstCorner) {
        firstCorner = coordinate.slice(0, 2);
        areaHint.textContent = "Now click the opposite corner. Escape cancels.";
        onHighlight();
      } else {
        if (Math.abs(firstCorner[0] - coordinate[0]) < 0.00001 || Math.abs(firstCorner[1] - coordinate[1]) < 0.00001) {
          areaHint.textContent = "Choose a different opposite corner to give the area a width and height. Escape cancels.";
          return;
        }
        area = [
          [Math.min(firstCorner[0], coordinate[0]), Math.min(firstCorner[1], coordinate[1])],
          [Math.max(firstCorner[0], coordinate[0]), Math.max(firstCorner[1], coordinate[1])],
        ];
        pinned = hovered = null;
        stopArea();
        renderScope();
      }
    },
    setData(next) {
      results = next;
      base = results.flatMap((result) => result.features);
      memberships = new Map(results.flatMap((result) => [...result.memberships]));
      pinned = hovered = null;
      stopArea();
      if (!next.length) { area = null; groupSelect.value = "all"; }
      renderScope();
      if (next.length && !openedOnce) { openedOnce = true; setOpen(true); }
    },
  };
}
