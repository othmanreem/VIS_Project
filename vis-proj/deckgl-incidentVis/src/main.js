import { Deck, WebMercatorViewport } from "@deck.gl/core";
import { BitmapLayer, GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { CATEGORIES } from "./codes.js";
import "./style.css";

// --------------------------------------------------
// Bounds of all 2,016 collision locations (2020-2025).
// Fit the overview to the map size, leaving space for
// the sidebar and some surrounding area.
// --------------------------------------------------
const COLLISION_BOUNDS = [
  [-2.17014, 53.625085],
  [-1.731539, 53.78502],
];

function getOverviewViewState() {
  const map = document.getElementById("map");
  const sidebar = document.getElementById("sidebar");
  const width = map.clientWidth;
  const height = map.clientHeight;
  const padding = Math.min(80, width * 0.08, height * 0.12);

  const overview = new WebMercatorViewport({ width, height }).fitBounds(
    COLLISION_BOUNDS,
    {
      padding: {
        top: padding,
        bottom: padding,
        left: Math.min(sidebar.offsetWidth + 60, width * 0.4),
        right: padding,
      },
    },
  );

  const zoom = overview.zoom - 0.3;
  const viewport = new WebMercatorViewport({
    width,
    height,
    longitude: overview.longitude,
    latitude: overview.latitude,
    zoom,
  });

  return {
    longitude: overview.longitude,
    latitude: overview.latitude,
    zoom,
    minZoom: zoom,
    // Keep panning inside the area visible at full overview.
    maxBounds: [
      viewport.unproject([0, height]),
      viewport.unproject([width, 0]),
    ],
    pitch: 0,
    bearing: 0,
  };
}

const INITIAL_VIEW_STATE = getOverviewViewState();

// --------------------------------------------------
// One fixed color for each year.
// The same color is used in the year choices and points.
// Optional map labels use neutral text for readability.
// --------------------------------------------------
const YEAR_COLORS = {
  2020: [230, 126, 34, 210],
  2021: [52, 152, 219, 210],
  2022: [46, 204, 113, 210],
  2023: [155, 89, 182, 210],
  2024: [241, 196, 15, 220],
  2025: [231, 76, 60, 210],
};

const YEARS = Object.keys(YEAR_COLORS);

// --------------------------------------------------
// Base map
// --------------------------------------------------
const mapLayer = new TileLayer({
  id: "basemap",
  data: "https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png?key=cb1_304d_1_6699e7fd199a1afd970583e4",
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,

  renderSubLayers: (props) => {
    const {
      bbox: { west, south, east, north },
    } = props.tile;

    return new BitmapLayer(props, {
      data: null,
      image: props.data,
      bounds: [west, south, east, north],
    });
  },
});

// --------------------------------------------------
// Data loading (cached, so re-pressing View is fast)
// Expected files:
// /calderdale_collisions_YYYY.geojson
// /calderdale_vehicles_YYYY.geojson   (only needed for driver filters)
// --------------------------------------------------
const fetchCache = new Map();

function fetchGeoJson(url, errorMessage) {
  if (!fetchCache.has(url)) {
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(errorMessage);
        }
        return response.json();
      })
      .catch((error) => {
        fetchCache.delete(url);
        throw error;
      });

    fetchCache.set(url, request);
  }

  return fetchCache.get(url);
}

function loadYearData(year) {
  return fetchGeoJson(
    `collisions/calderdale_collisions_${year}.geojson`,
    `Could not load collision data for ${year}.`,
  );
}

// --------------------------------------------------
// Vehicles are joined to collisions with collision_index.
// For every collision we keep, per vehicle-based category,
// the set of codes found among its drivers.
// Result: Map(collision_index -> { driverGender: Set, driverAge: Set })
// --------------------------------------------------
const vehicleIndexCache = new Map();
const VEHICLE_CATEGORIES = CATEGORIES.filter((cat) => cat.source === "vehicle");

async function loadVehicleIndex(year) {
  if (vehicleIndexCache.has(year)) {
    return vehicleIndexCache.get(year);
  }

  const data = await fetchGeoJson(
    `vehicles/calderdale_vehicles_${year}.geojson`,
    `Could not load vehicle data for ${year}.`,
  );

  const index = new Map();

  for (const feature of data.features) {
    const props = feature.properties || {};
    let entry = index.get(props.collision_index);

    if (!entry) {
      entry = {};
      VEHICLE_CATEGORIES.forEach((cat) => {
        entry[cat.key] = new Set();
      });
      index.set(props.collision_index, entry);
    }

    VEHICLE_CATEGORIES.forEach((cat) => {
      const value = props[cat.field];
      if (value !== undefined && value !== null) {
        entry[cat.key].add(String(value));
      }
    });
  }

  vehicleIndexCache.set(year, index);
  return index;
}

// --------------------------------------------------
// Codes of one collision for one category.
// Collision-based categories have a single code.
// Vehicle-based categories can have several (one per driver).
// --------------------------------------------------
function getCodes(category, feature, vehicleIndex) {
  if (category.source === "collision") {
    const value = feature.properties?.[category.field];
    return value === undefined || value === null ? [] : [String(value)];
  }

  const entry = vehicleIndex?.get(feature.properties?.collision_index);
  return entry ? Array.from(entry[category.key]) : [];
}

// code -> label lookup for each category (built once)
const LABELS = {};
CATEGORIES.forEach((cat) => {
  LABELS[cat.key] = Object.fromEntries(cat.codes.map((c) => [c.code, c.label]));
});

// --------------------------------------------------
// Displayed records, selected collision and label controls
// --------------------------------------------------
let displayedYears = [];
let displayedFeatures = [];
let selectedCollision = null;
let selectedGroup = [];
let selectedDrivers = null;
let detailsRequest = 0;
let labelFrame = 0;

const showLabelsInput = document.getElementById("show-labels");
const labelField = document.getElementById("label-field");
const labelStatus = document.getElementById("label-status");
const detailsPanel = document.getElementById("collision-details");
const detailsContent = document.getElementById("details-content");
const labelContext = document.createElement("canvas").getContext("2d");

// Labels verified against the stored official DfT code guide.
const SURFACE_LABELS = {
  1: "Dry", 2: "Wet or damp", 3: "Snow", 4: "Frost or ice",
  5: "Flood over 3 cm deep", 6: "Oil or diesel", 7: "Mud",
  9: "Unknown (self-reported)",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function recordedValue(value) {
  return value === undefined || value === null || value === "" || String(value) === "-1"
    ? "Not recorded"
    : String(value);
}

function categoryLabel(key, value) {
  const recorded = recordedValue(value);
  return recorded === "Not recorded" ? recorded : LABELS[key]?.[String(value)] || `Unknown code (${recorded})`;
}

function collisionKey(feature) {
  const p = feature.properties;
  return `${p.collision_year}:${p.collision_index}`;
}

function collisionRows(feature) {
  const p = feature.properties;
  const speed = recordedValue(p.speed_limit);
  const surface = recordedValue(p.road_surface_conditions);

  return [
    ["Severity", categoryLabel("severity", p.collision_severity)],
    ["Date", recordedValue(p.date)],
    ["Time", recordedValue(p.time)],
    ["Lighting", categoryLabel("lighting", p.light_conditions)],
    ["Weather", categoryLabel("weather", p.weather_conditions)],
    ["Road class", categoryLabel("roadType", p.first_road_class)],
    ["Road number", recordedValue(p.first_road_number)],
    ["Road surface", SURFACE_LABELS[surface] || surface],
    ["Speed limit", speed === "Not recorded" ? speed : `${speed} mph`],
    ["Vehicles", recordedValue(p.number_of_vehicles)],
    ["Casualties", recordedValue(p.number_of_casualties)],
  ];
}

// --------------------------------------------------
// One point layer per year. Filters change the records;
// label visibility is controlled separately.
// --------------------------------------------------
function createYearLayers(year, collisions, vehicleIndex, filters) {
  const activeCategories = CATEGORIES.filter((cat) => filters[cat.key]);
  const features = collisions.features.filter(
    (feature) => feature.geometry && activeCategories.every((cat) =>
      getCodes(cat, feature, vehicleIndex).some((code) => filters[cat.key].has(code)),
    ),
  );

  const pointLayer = new GeoJsonLayer({
    id: `collisions-${year}`,
    data: { type: "FeatureCollection", features },
    pointType: "circle",
    filled: true,
    stroked: true,
    getFillColor: YEAR_COLORS[year],
    getLineColor: [255, 255, 255, 255],
    getPointRadius: 45,
    pointRadiusMinPixels: 4,
    pointRadiusMaxPixels: 12,
    lineWidthMinPixels: 1,
    pickable: true,
    autoHighlight: true,
    highlightColor: [40, 44, 41, 70],
    updateTriggers: { getFillColor: [year] },
  });

  return { pointLayer, features };
}

// --------------------------------------------------
// Short, neutral labels at closer zooms only.
// A small screen grid keeps labels clear of other labels,
// point symbols, panel edges and the visible controls.
// All collision points remain on the map.
// --------------------------------------------------
function createLabelLayer() {
  labelField.disabled = !showLabelsInput.checked;

  if (!showLabelsInput.checked) {
    labelStatus.textContent = "Hover for details. Click to keep them open.";
    return null;
  }

  if (displayedFeatures.length === 0) {
    labelStatus.textContent = "Apply a year selection to show labels.";
    return null;
  }

  const viewport = deck.getViewports()[0];
  const minimumZoom = Math.max(12, deck.props.initialViewState.minZoom + 1);
  if (viewport.zoom < minimumZoom) {
    labelStatus.textContent = "Zoom in to reveal labels. All dots remain visible.";
    return null;
  }

  const mapRect = document.getElementById("map").getBoundingClientRect();
  const panels = ["sidebar", "map-display", "collision-details"]
    .map((id) => document.getElementById(id))
    .filter((panel) => !panel.hidden)
    .map((panel) => {
      const rect = panel.getBoundingClientRect();
      return { left: rect.left - mapRect.left - 6, top: rect.top - mapRect.top - 6,
        right: rect.right - mapRect.left + 6, bottom: rect.bottom - mapRect.top + 6 };
    });

  const cells = new Map();
  const cellSize = 64;
  function cellKeys(box) {
    const keys = [];
    for (let x = Math.floor(box.left / cellSize); x <= Math.floor(box.right / cellSize); x++) {
      for (let y = Math.floor(box.top / cellSize); y <= Math.floor(box.bottom / cellSize); y++) {
        keys.push(`${x}:${y}`);
      }
    }
    return keys;
  }
  function reserve(box) {
    cellKeys(box).forEach((key) => {
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(box);
    });
  }
  function overlaps(box) {
    return cellKeys(box).some((key) => (cells.get(key) || []).some((other) =>
      box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top,
    ));
  }

  panels.forEach(reserve);
  const points = displayedFeatures.map((feature) => {
    const [x, y] = viewport.project(feature.geometry.coordinates);
    const radius = Math.max(4, Math.min(12, 45 * viewport.distanceScales.unitsPerMeter[0] * viewport.scale));
    const key = collisionKey(feature);
    // Stable ordering mixes years instead of always favouring the first year.
    const priority = selectedCollision && key === collisionKey(selectedCollision) ? -1
      : Array.from(key).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0);
    return { feature, x, y, radius, priority };
  }).filter(({ x, y }) => x >= 0 && y >= 0 && x <= viewport.width && y <= viewport.height);

  points.forEach(({ x, y, radius }) => reserve({
    left: x - radius - 2, right: x + radius + 2,
    top: y - radius - 2, bottom: y + radius + 2,
  }));
  points.sort((a, b) => a.priority - b.priority);

  const category = CATEGORIES.find((cat) => cat.key === labelField.value);
  const labels = [];
  labelContext.font = '500 12px "Segoe UI", Arial';

  for (const { feature, x, y, radius } of points) {
    if (panels.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) continue;
    const text = categoryLabel(category.key, feature.properties[category.field]);
    const width = Math.ceil(labelContext.measureText(text).width) + 6;
    const height = 20;
    const distance = radius + 7;
    const candidates = [
      [distance + width / 2, 0], [-distance - width / 2, 0],
      [0, -distance - height / 2], [0, distance + height / 2],
      [distance + width / 2, -distance - height / 2],
      [-distance - width / 2, distance + height / 2],
    ];

    for (const offset of candidates) {
      const box = { left: x + offset[0] - width / 2, right: x + offset[0] + width / 2,
        top: y + offset[1] - height / 2, bottom: y + offset[1] + height / 2 };
      if (box.left < 8 || box.top < 8 || box.right > viewport.width - 8 || box.bottom > viewport.height - 8 || overlaps(box)) continue;
      reserve(box);
      labels.push({ position: feature.geometry.coordinates, text, offset });
      break;
    }
  }

  labelStatus.textContent = labels.length === 0
    ? "No room for labels here. Hover a dot for details."
    : `${labels.length} labels shown · overlaps hidden, dots unchanged`;

  return new TextLayer({
    id: "collision-labels",
    data: labels,
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    getPixelOffset: (d) => d.offset,
    getColor: [40, 44, 41, 255],
    getSize: 12,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    fontFamily: "Segoe UI, Arial, sans-serif",
    fontWeight: 500,
    fontSettings: { sdf: true },
    outlineWidth: 2,
    outlineColor: [255, 254, 250, 255],
    pickable: false,
  });
}

function refreshMapLayers() {
  const layers = [mapLayer, ...displayedYears.map((result) => result.pointLayer)];

  if (selectedCollision) {
    layers.push(new GeoJsonLayer({
      id: "selected-collision",
      data: { type: "FeatureCollection", features: [selectedCollision] },
      pointType: "circle", filled: false, stroked: true,
      getLineColor: [40, 44, 41, 255], getPointRadius: 55,
      pointRadiusMinPixels: 7, pointRadiusMaxPixels: 16,
      lineWidthMinPixels: 2, pickable: false,
    }));
  }

  const labels = createLabelLayer();
  if (labels) layers.push(labels);
  deck.setProps({ layers });
}

function scheduleLabelUpdate() {
  if (!showLabelsInput.checked || labelFrame) return;
  labelFrame = requestAnimationFrame(() => {
    labelFrame = 0;
    refreshMapLayers();
  });
}

// --------------------------------------------------
// Hover gives a quick, decoded summary. Click keeps the
// record open and highlights its actual map location.
// --------------------------------------------------
function getTooltip({ object }) {
  if (!object?.properties) return null;
  if (selectedCollision && collisionKey(object) === collisionKey(selectedCollision)) return null;
  const p = object.properties;
  const rows = collisionRows(object);
  return {
    html: `<div class="tooltip-content">
      <strong>${escapeHtml(p.collision_year)} · ${escapeHtml(categoryLabel("severity", p.collision_severity))} collision</strong>
      <span class="tooltip-date">${escapeHtml(p.date)} · ${escapeHtml(p.time)}</span>
      <dl>${rows.filter(([name]) => ["Lighting", "Weather", "Speed limit", "Vehicles", "Casualties"].includes(name))
        .map(([name, value]) => `<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <span class="tooltip-hint">Click to inspect this collision</span>
    </div>`,
    style: { backgroundColor: "#fffefa", color: "#282c29", borderRadius: "9px", padding: "13px", maxWidth: "290px" },
  };
}

function renderCollisionDetails() {
  if (!selectedCollision) return;
  const p = selectedCollision.properties;
  const index = selectedGroup.findIndex((feature) => collisionKey(feature) === collisionKey(selectedCollision));
  const rows = collisionRows(selectedCollision);

  detailsContent.innerHTML = `
    <div class="detail-heading"><span class="detail-year year-${p.collision_year}">${escapeHtml(p.collision_year)}</span>
      <strong>${escapeHtml(categoryLabel("severity", p.collision_severity))} collision</strong></div>
    <p class="record-reference">${escapeHtml(p.collision_index)}</p>
    ${selectedGroup.length > 1 ? `<div class="location-records">
      <span>${selectedGroup.length} collisions at this location<br><strong>Record ${index + 1} of ${selectedGroup.length}</strong></span>
      <button type="button" data-record-step="-1" aria-label="Previous collision at this location" ${index === 0 ? "disabled" : ""}>←</button>
      <button type="button" data-record-step="1" aria-label="Next collision at this location" ${index === selectedGroup.length - 1 ? "disabled" : ""}>→</button>
    </div>` : ""}
    <dl class="detail-rows">${rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      <div><dt>Coordinates</dt><dd>${selectedCollision.geometry.coordinates.map((value) => value.toFixed(5)).join(", ")}</dd></div>
    </dl>
    <div class="driver-details"><h3>Drivers in this collision</h3>
      <p class="control-hint">All involved drivers, including those outside the chosen driver filters.</p>
      ${selectedDrivers === null ? '<p class="control-hint">Loading driver details…</p>'
        : selectedDrivers === false ? '<p class="error-message">Could not load driver details. Close and select the collision to retry.</p>'
        : selectedDrivers.length === 0 ? '<p class="control-hint">No linked vehicle records found.</p>'
        : selectedDrivers.map((driver) => `<div class="driver-record"><strong>Vehicle ${escapeHtml(driver.vehicle_reference)}</strong>
          <span>${escapeHtml(categoryLabel("driverGender", driver.sex_of_driver))} · ${escapeHtml(recordedValue(driver.age_of_driver) === "Not recorded"
            ? categoryLabel("driverAge", driver.age_band_of_driver) : `${driver.age_of_driver} years old`)}</span></div>`).join("")}
    </div>`;
}

async function selectCollision(feature, group = null) {
  const request = ++detailsRequest;
  selectedCollision = feature;
  selectedGroup = group || displayedFeatures.filter((other) =>
    other.geometry.coordinates[0] === feature.geometry.coordinates[0] &&
    other.geometry.coordinates[1] === feature.geometry.coordinates[1],
  );
  selectedDrivers = null;
  detailsPanel.hidden = false;
  renderCollisionDetails();
  refreshMapLayers();

  try {
    const year = feature.properties.collision_year;
    const vehicles = await fetchGeoJson(`vehicles/calderdale_vehicles_${year}.geojson`, `Could not load vehicles for ${year}.`);
    if (request !== detailsRequest) return;
    selectedDrivers = vehicles.features.filter((vehicle) => vehicle.properties.collision_index === feature.properties.collision_index)
      .map((vehicle) => vehicle.properties);
  } catch (error) {
    if (request !== detailsRequest) return;
    selectedDrivers = false;
  }
  renderCollisionDetails();
  scheduleLabelUpdate();
}

function clearCollisionSelection() {
  detailsRequest++;
  selectedCollision = null;
  selectedGroup = [];
  selectedDrivers = null;
  detailsPanel.hidden = true;
}

showLabelsInput.addEventListener("change", refreshMapLayers);
labelField.addEventListener("change", refreshMapLayers);
document.getElementById("close-details").addEventListener("click", () => {
  clearCollisionSelection();
  refreshMapLayers();
});
detailsContent.addEventListener("click", (event) => {
  const button = event.target.closest("[data-record-step]");
  if (!button || button.disabled) return;
  const index = selectedGroup.findIndex((feature) => collisionKey(feature) === collisionKey(selectedCollision));
  selectCollision(selectedGroup[index + Number(button.dataset.recordStep)], selectedGroup);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && selectedCollision) {
    clearCollisionSelection();
    refreshMapLayers();
  }
});

// --------------------------------------------------
// Deck instance
// --------------------------------------------------
const deck = new Deck({
  parent: document.getElementById("map"),
  initialViewState: INITIAL_VIEW_STATE,
  controller: true,
  layers: [mapLayer],
  getTooltip,
  onViewStateChange: scheduleLabelUpdate,
  onClick: (info) => {
    // Pick at the click position even if no hover event came first.
    const object = info.object || deck.pickObject({ x: info.x, y: info.y, radius: 2 })?.object;
    if (object?.properties) {
      selectCollision(object);
    } else {
      clearCollisionSelection();
      refreshMapLayers();
    }
  },
});

// Keep the overview limit suitable for the window size.
// Preserve a closer view when the user has zoomed in.
window.addEventListener("resize", () => {
  const overview = getOverviewViewState();
  const current = deck.getViewports()[0];
  const wasOverview =
    current.zoom <= deck.props.initialViewState.minZoom + 0.01;

  deck.setProps({
    initialViewState: wasOverview
      ? overview
      : {
          ...overview,
          longitude: current.longitude,
          latitude: current.latitude,
          zoom: Math.max(current.zoom, overview.minZoom),
        },
  });
  scheduleLabelUpdate();
});

// --------------------------------------------------
// Build the year rows + filter sub-menus
// --------------------------------------------------
const yearOptions = document.getElementById("year-options");

function buildYearMenu() {
  yearOptions.innerHTML = YEARS.map(
    (year) => `
        <div class="year-block" data-year="${year}">
            <div class="year-row">
                <label class="year-option">
                    <input type="checkbox" class="year-checkbox" value="${year}" aria-label="${year}">
                    <span class="color-dot year-${year}"></span>
                    <span>${year}</span>
                </label>
                <button type="button" class="expand-btn year-toggle"
                        aria-expanded="false"
                        aria-controls="filters-${year}"
                        title="Edit filters for ${year}"
                        aria-label="Filters for ${year}">
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3 2v12M8 2v12M13 2v12M1 6h4M6 10h4M11 5h4"/>
                    </svg>
                </button>
            </div>

            <div class="sub-menu" id="filters-${year}" hidden>
                <div class="editor-heading">
                    <h2>Filters for ${year}</h2>
                    <span class="filter-count">No filters</span>
                </div>
                <p class="control-hint">Filters  will apply to year ${year} only.</p>
                ${CATEGORIES.map(
                  (cat) => `
                    <div class="category" data-cat="${cat.key}">
                        <div class="category-row">
                            <button type="button" class="expand-btn category-toggle"
                                    aria-expanded="false"
                                    aria-controls="options-${year}-${cat.key}"
                                    aria-label="${cat.label} options for ${year}">
                                <span class="category-name">${cat.label}</span>
                                <span class="category-summary">Any</span>
                                <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                    <path d="M4 6l4 4 4-4"/>
                                </svg>
                            </button>
                        </div>

                        <div class="option-list" id="options-${year}-${cat.key}" hidden>
                            <label class="category-option">
                                <input type="checkbox" class="category-checkbox">
                                <span>Select all options</span>
                            </label>
                            ${cat.codes
                              .map(
                                (c) => `
                                <label class="sub-option">
                                    <input type="checkbox" class="code-checkbox" value="${c.code}">
                                    <span>${c.label}</span>
                                </label>
                            `,
                              )
                              .join("")}
                        </div>
                    </div>
                `,
                ).join("")}
            </div>
        </div>
    `,
  ).join("");
}

buildYearMenu();

let appliedSelection = "[]";
let isApplying = false;
let displayRequest = 0;

// --------------------------------------------------
// Read what the user has selected.
// Returns [{ year, filters: { categoryKey: Set(codes) } }]
// Categories with nothing ticked are not filtered.
// --------------------------------------------------
function getSelections() {
  return Array.from(yearOptions.querySelectorAll(".year-block"))
    .filter((block) => block.querySelector(".year-checkbox").checked)
    .map((block) => {
      const filters = {};

      block.querySelectorAll(".category").forEach((categoryEl) => {
        const codes = Array.from(
          categoryEl.querySelectorAll(".code-checkbox:checked"),
        ).map((input) => input.value);

        if (codes.length > 0) {
          filters[categoryEl.dataset.cat] = new Set(codes);
        }
      });

      return { year: block.dataset.year, filters };
    });
}

// --------------------------------------------------
// Render selected years
// --------------------------------------------------
async function showSelectedYears(selections) {
  const info = document.getElementById("info");
  const request = ++displayRequest;

  if (selections.length === 0) {
    displayedYears = [];
    displayedFeatures = [];
    clearCollisionSelection();
    refreshMapLayers();

    info.innerHTML = `
            <span class="result-number">—</span>
            <div class="result-description">
                <strong>Matching collisions</strong>
                <span>Select years to begin</span>
            </div>
        `;
    appliedSelection = getSelectionSignature(selections);
    updateFilterStatus();
    return;
  }

  const years = selections.map((s) => s.year);
  isApplying = true;
  viewButton.disabled = true;
  info.setAttribute("aria-busy", "true");
  updateFilterStatus();
  info.innerHTML = `
        <span class="result-number loading-dots">…</span>
        <div class="result-description">
            <strong>Loading collisions</strong>
            <span>${years.join(", ")}</span>
        </div>
    `;

  try {
    const results = await Promise.all(
      selections.map(async ({ year, filters }) => {
        const needsVehicles = VEHICLE_CATEGORIES.some(
          (cat) => filters[cat.key],
        );

        const [collisions, vehicleIndex] = await Promise.all([
          loadYearData(year),
          needsVehicles ? loadVehicleIndex(year) : Promise.resolve(null),
        ]);

        return createYearLayers(year, collisions, vehicleIndex, filters);
      }),
    );

    // A reset or a newer request takes priority over an older response.
    if (request !== displayRequest) {
      return;
    }

    displayedYears = results;
    displayedFeatures = results.flatMap((result) => result.features);
    clearCollisionSelection();
    refreshMapLayers();
    const total = displayedFeatures.length;

    info.innerHTML = `
            <span class="result-number">${total.toLocaleString("en-GB")}</span>
            <div class="result-description">
                <strong>${total === 1 ? "Matching collision" : "Matching collisions"}</strong>
                <span>${total === 0 ? "No matches for this selection" : years.join(", ")}</span>
            </div>
        `;
    appliedSelection = getSelectionSignature(selections);
  } catch (error) {
    if (request !== displayRequest) {
      return;
    }

    console.error(error);

    info.innerHTML = `
            <p class="error-message">
                Could not load this selection. The map has not been updated. Try applying again.
            </p>
        `;
  } finally {
    if (request === displayRequest) {
      isApplying = false;
      viewButton.disabled = false;
      info.setAttribute("aria-busy", "false");
      updateFilterStatus();
    }
  }
}

// --------------------------------------------------
// Filter panel behaviour
// --------------------------------------------------
const selectedYearsText = document.getElementById("selected-years-text");
const viewButton = document.getElementById("view-button");
const clearButton = document.getElementById("clear-button");
const allYearsButton = document.getElementById("all-years-button");
const filterStatus = document.getElementById("filter-status");

function getSelectionSignature(selections = getSelections()) {
  return JSON.stringify(selections, (key, value) =>
    value instanceof Set ? Array.from(value) : value,
  );
}

function updateFilterStatus() {
  const hasChanges = getSelectionSignature() !== appliedSelection;
  filterStatus.classList.toggle("has-changes", hasChanges && !isApplying);

  if (isApplying) {
    filterStatus.textContent = "Updating the map…";
  } else if (hasChanges) {
    filterStatus.textContent = "Click on Apply filters to update the map";
  } else if (getSelections().length > 0) {
    filterStatus.textContent = "Map up to date";
  } else {
    filterStatus.textContent = "Choose years to begin";
  }
}

function updateSelectedYearsText() {
  const selectedYears = Array.from(
    yearOptions.querySelectorAll(".year-checkbox:checked"),
  ).map((input) => input.value);

  selectedYearsText.textContent = `${selectedYears.length} selected`;
  allYearsButton.textContent =
    selectedYears.length === YEARS.length ? "Deselect all" : "Select all";
  updateFilterStatus();
}

function updateFilterSummaries() {
  yearOptions.querySelectorAll(".year-block").forEach((block) => {
    let activeCount = 0;

    block.querySelectorAll(".category").forEach((category) => {
      const selected = Array.from(
        category.querySelectorAll(".code-checkbox:checked"),
      );
      const total = category.querySelectorAll(".code-checkbox").length;
      const summary = category.querySelector(".category-summary");

      category.classList.toggle("is-active", selected.length > 0);

      if (selected.length === 0) {
        summary.textContent = "Any";
      } else if (selected.length === total) {
        summary.textContent = `All ${total} selected`;
      } else if (selected.length === 1) {
        summary.textContent = selected[0].nextElementSibling.textContent;
      } else {
        summary.textContent = `${selected.length} selected`;
      }

      summary.title = summary.textContent;
      activeCount += selected.length > 0 ? 1 : 0;
    });

    block.querySelector(".filter-count").textContent =
      activeCount === 0 ? "No filters" : `${activeCount} active`;
    block
      .querySelector(".year-toggle")
      .classList.toggle("has-filters", activeCount > 0);
  });
}

// Sync a category checkbox with its option checkboxes
// (checked = all, indeterminate = some, unchecked = none).
function syncCategoryCheckbox(categoryEl) {
  const boxes = Array.from(categoryEl.querySelectorAll(".code-checkbox"));
  const checkedCount = boxes.filter((box) => box.checked).length;
  const parent = categoryEl.querySelector(".category-checkbox");

  parent.checked = checkedCount === boxes.length;
  parent.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

function setExpanded(button, panel, expanded) {
  panel.hidden = !expanded;
  button.classList.toggle("expanded", expanded);
  button.setAttribute("aria-expanded", String(expanded));
}

function openYearFilters(block) {
  yearOptions.querySelectorAll(".year-block").forEach((yearBlock) => {
    const expanded = yearBlock === block;
    yearBlock.querySelector(".year-row").classList.toggle("editing", expanded);
    setExpanded(
      yearBlock.querySelector(".year-toggle"),
      yearBlock.querySelector(".sub-menu"),
      expanded,
    );
  });
}

// Keep one year's editor open, with expandable categories inside it.
yearOptions.addEventListener("click", (event) => {
  const yearToggle = event.target.closest(".year-toggle");
  const categoryToggle = event.target.closest(".category-toggle");

  if (yearToggle) {
    const block = yearToggle.closest(".year-block");
    const panel = block.querySelector(".sub-menu");

    if (panel.hidden) {
      openYearFilters(block);
    } else {
      setExpanded(yearToggle, panel, false);
      block.querySelector(".year-row").classList.remove("editing");
    }
  } else if (categoryToggle) {
    const panel = categoryToggle
      .closest(".category")
      .querySelector(".option-list");
    setExpanded(categoryToggle, panel, panel.hidden);
  }
});

// Checkbox logic
yearOptions.addEventListener("change", (event) => {
  const input = event.target;
  const block = input.closest(".year-block");

  if (input.classList.contains("year-checkbox") && input.checked) {
    openYearFilters(block);
  }

  if (input.classList.contains("category-checkbox")) {
    // Selecting the category selects every option inside it.
    const categoryEl = input.closest(".category");
    categoryEl.querySelectorAll(".code-checkbox").forEach((box) => {
      box.checked = input.checked;
    });
    input.indeterminate = false;

    // Make the options visible when a category gets selected.
    if (input.checked) {
      setExpanded(
        categoryEl.querySelector(".category-toggle"),
        categoryEl.querySelector(".option-list"),
        true,
      );
    }
  }

  if (input.classList.contains("code-checkbox")) {
    syncCategoryCheckbox(input.closest(".category"));
  }

  // Choosing any filter automatically selects that year.
  if (
    (input.classList.contains("category-checkbox") ||
      input.classList.contains("code-checkbox")) &&
    block.querySelector(".code-checkbox:checked")
  ) {
    block.querySelector(".year-checkbox").checked = true;
  }

  updateFilterSummaries();
  updateSelectedYearsText();
});

viewButton.addEventListener("click", async () => {
  await showSelectedYears(getSelections());
});

allYearsButton.addEventListener("click", () => {
  const boxes = Array.from(yearOptions.querySelectorAll(".year-checkbox"));
  const selectAll = !boxes.every((box) => box.checked);
  boxes.forEach((box) => {
    box.checked = selectAll;
  });
  updateSelectedYearsText();
});

clearButton.addEventListener("click", () => {
  displayRequest++;
  isApplying = false;
  viewButton.disabled = false;
  appliedSelection = "[]";

  // Uncheck every year, category and option checkbox
  yearOptions.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = false;
    input.indeterminate = false;
  });

  // Collapse the categories and return to the latest year's editor.
  yearOptions.querySelectorAll(".option-list").forEach((panel) => {
    panel.hidden = true;
  });
  yearOptions.querySelectorAll(".expand-btn").forEach((button) => {
    button.classList.remove("expanded");
    button.setAttribute("aria-expanded", "false");
  });

  openYearFilters(yearOptions.querySelector(".year-block:last-child"));
  updateFilterSummaries();
  updateSelectedYearsText();

  // Clear the displayed records, labels and selected collision.
  displayedYears = [];
  displayedFeatures = [];
  clearCollisionSelection();
  showLabelsInput.checked = false;
  labelField.value = "severity";
  refreshMapLayers();

  const info = document.getElementById("info");
  info.setAttribute("aria-busy", "false");
  info.innerHTML = `
        <span class="result-number">—</span>
        <div class="result-description">
            <strong>Matching collisions</strong>
            <span>Select years to begin</span>
        </div>
    `;
});

openYearFilters(yearOptions.querySelector(".year-block:last-child"));
updateFilterSummaries();
updateSelectedYearsText();
