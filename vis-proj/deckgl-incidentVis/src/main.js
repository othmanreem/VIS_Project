import { Deck, WebMercatorViewport } from "@deck.gl/core";
import { BitmapLayer, GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { CATEGORIES } from "./codes.js";
import { DETAIL_CODES } from "./detailCodes.js";
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
        left: sidebar.hidden ? padding : Math.min(sidebar.offsetWidth + 60, width * 0.4),
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
// /vehicles/calderdale_vehicles_YYYY.geojson
// /casualties/calderdale_casualties_YYYY.geojson
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
// Keep whole linked records instead of separate sets of codes.
// Combined vehicle filters must match the same vehicle;
// combined casualty filters must match the same person.
// --------------------------------------------------
const recordIndexCache = new Map();
const LINKED_SOURCES = { vehicle: "vehicles", casualty: "casualties" };
const FILTER_GROUPS = [
  { source: "collision", label: "Collision conditions", hint: "Conditions recorded for the collision." },
  { source: "vehicle", label: "Vehicles and drivers", hint: "One vehicle must match all chosen vehicle and driver conditions." },
  { source: "casualty", label: "Casualties", hint: "One casualty must match all chosen casualty conditions. This can be a different person from the matching driver." },
];

async function loadRecordIndex(year, source) {
  const key = `${source}:${year}`;
  if (recordIndexCache.has(key)) {
    return recordIndexCache.get(key);
  }

  const folder = LINKED_SOURCES[source];
  const data = await fetchGeoJson(
    `${folder}/calderdale_${folder}_${year}.geojson`,
    `Could not load ${folder} data for ${year}.`,
  );

  const index = new Map();

  for (const feature of data.features) {
    const props = feature.properties || {};
    if (!index.has(props.collision_index)) {
      index.set(props.collision_index, []);
    }
    index.get(props.collision_index).push(props);
  }

  recordIndexCache.set(key, index);
  return index;
}

// --------------------------------------------------
// Values within one category use OR; categories use AND.
// An empty category places no restriction on the records.
// --------------------------------------------------
function matchesCategories(record, categories, filters) {
  return categories.every((category) => {
    const value = record[category.field];
    const code = value === undefined || value === null || value === "" ? "-1" : String(value);
    return filters[category.key].has(code);
  });
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
let selectedRecords = { vehicle: null, casualty: null };
let activeDetailsTab = "collision";
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
    ["Collision severity", categoryLabel("severity", p.collision_severity)],
    ["Date", recordedValue(p.date)],
    ["Time", recordedValue(p.time)],
    ["Lighting", categoryLabel("lighting", p.light_conditions)],
    ["Weather", categoryLabel("weather", p.weather_conditions)],
    ["Road class", categoryLabel("roadClass", p.first_road_class)],
    ["Road type", categoryLabel("roadType", p.road_type)],
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
function createYearLayers(year, collisions, indexes, filters) {
  const groups = FILTER_GROUPS.map((group) => ({
    ...group,
    categories: CATEGORIES.filter((cat) => cat.source === group.source && filters[cat.key]),
  })).filter((group) => group.categories.length > 0);
  const features = collisions.features.filter(
    (feature) => feature.geometry && groups.every((group) =>
      group.source === "collision"
        ? matchesCategories(feature.properties, group.categories, filters)
        : (indexes[group.source]?.get(feature.properties.collision_index) || [])
          .some((record) => matchesCategories(record, group.categories, filters)),
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
    labelStatus.textContent = displayedYears.length > 0
      ? "No matching collisions to label. Try changing the filters."
      : "Apply a year selection to show labels.";
    return null;
  }

  const viewport = deck.getViewports()[0];
  const minimumZoom = Math.max(12, deck.props.initialViewState.minZoom + 1);
  if (viewport.zoom < minimumZoom) {
    labelStatus.textContent = "Zoom in to reveal labels. Matching dots are retained.";
    return null;
  }

  const mapRect = document.getElementById("map").getBoundingClientRect();
  const panels = ["sidebar", "show-filters", "map-display", "collision-details"]
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
  const countField = labelField.value === "vehicleCount" ? "number_of_vehicles"
    : labelField.value === "casualtyCount" ? "number_of_casualties" : null;
  const labels = [];
  labelContext.font = '500 12px "Segoe UI", Arial';

  for (const { feature, x, y, radius } of points) {
    if (panels.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) continue;
    const count = countField ? recordedValue(feature.properties[countField]) : null;
    const text = countField
      ? `${count} ${labelField.value === "vehicleCount" ? (count === "1" ? "vehicle" : "vehicles") : (count === "1" ? "casualty" : "casualties")}`
      : categoryLabel(category.key, feature.properties[category.field]);
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
    : `${labels.length} ${labels.length === 1 ? "label" : "labels"} shown · ${countField ? "totals per collision, including all involved" : "overlaps hidden, dots unchanged"}`;

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

// --------------------------------------------------
// Linked records are grouped into readable summaries.
// Less common attributes stay available under More details.
// Shared collision IDs and GeoJSON provenance are not repeated.
// --------------------------------------------------
const RECORD_FIELDS = {
  vehicle: [
    ["vehicle_type", "Vehicle type"],
    ["generic_make_model", "Make / model"],
    ["vehicle_manoeuvre", "Manoeuvre"],
    ["sex_of_driver", "Driver sex"],
    ["age_of_driver", "Driver age"],
    ["journey_purpose_of_driver", "Journey purpose"],
    ["age_band_of_driver", "Driver age band"],
    ["age_of_vehicle", "Vehicle age"],
    ["engine_capacity_cc", "Engine capacity"],
    ["propulsion_code", "Propulsion"],
    ["escooter_flag", "E-scooter"],
    ["first_point_of_impact", "First impact"],
    ["towing_and_articulation", "Towing / articulation"],
    ["skidding_and_overturning", "Skidding / overturning"],
    ["hit_object_in_carriageway", "Object hit on road"],
    ["hit_object_off_carriageway", "Object hit off road"],
    ["junction_location", "Junction location"],
    ["vehicle_direction_from", "Direction from"],
    ["vehicle_direction_to", "Direction to"],
    ["vehicle_leaving_carriageway", "Leaving the road"],
    ["vehicle_left_hand_drive", "Left-hand drive"],
    ["vehicle_location_restricted_lane", "Restricted lane"],
    ["driver_distance_banding", "Driver distance band"],
    ["driver_imd_decile", "Driver IMD decile"],
    ["lsoa_of_driver", "Driver LSOA"],
    ["journey_purpose_of_driver_historic", "Journey purpose (historic)"],
    ["vehicle_manoeuvre_historic", "Manoeuvre (historic)"],
    ["vehicle_location_restricted_lane_historic", "Restricted lane (historic)"],
  ],
  casualty: [
    ["casualty_severity", "Injury severity"],
    ["casualty_class", "Person's role"],
    ["casualty_type", "Road user type"],
    ["sex_of_casualty", "Sex"],
    ["age_of_casualty", "Age"],
    ["vehicle_reference", "Linked vehicle"],
    ["age_band_of_casualty", "Age band"],
    ["enhanced_casualty_severity", "Detailed severity"],
    ["casualty_injury_based", "Severity reporting"],
    ["car_passenger", "Car passenger"],
    ["bus_or_coach_passenger", "Bus / coach passenger"],
    ["pedestrian_location", "Pedestrian location"],
    ["pedestrian_movement", "Pedestrian movement"],
    ["pedestrian_road_maintenance_worker", "Road maintenance worker"],
    ["casualty_distance_banding", "Distance band"],
    ["casualty_imd_decile", "IMD decile"],
    ["lsoa_of_casualty", "LSOA"],
    ["casualty_adjusted_severity_serious", "Serious severity adjustment"],
    ["casualty_adjusted_severity_slight", "Slight severity adjustment"],
  ],
};

function recordValue(kind, field, value) {
  const recorded = recordedValue(value);
  if (recorded === "Not recorded") return recorded;
  const codes = DETAIL_CODES[kind][field];
  if (codes) return codes[recorded] || `Unknown code (${recorded})`;
  if (["age_of_driver", "age_of_casualty", "age_of_vehicle"].includes(field)) return `${recorded} years`;
  if (field === "engine_capacity_cc") return `${recorded} cc`;
  if (field === "vehicle_reference") return `Vehicle ${recorded}`;
  return recorded;
}

function renderRecordRows(kind, record, fields) {
  return `<dl class="detail-rows">${fields.map(([field, label]) =>
    `<div><dt>${label}</dt><dd>${escapeHtml(recordValue(kind, field, record[field]))}</dd></div>`,
  ).join("")}</dl>`;
}

function updateDetailsTabs() {
  const p = selectedCollision.properties;
  detailsPanel.querySelectorAll("[data-details-tab]").forEach((button) => {
    const kind = button.dataset.detailsTab;
    const active = kind === activeDetailsTab;
    const records = selectedRecords[kind];
    const count = Array.isArray(records) ? records.length
      : p[kind === "vehicle" ? "number_of_vehicles" : "number_of_casualties"];
    button.textContent = kind === "collision" ? "Collision"
      : `${kind === "vehicle" ? "Vehicles" : "Casualties"} (${recordedValue(count)})`;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  detailsContent.setAttribute("aria-labelledby", `details-tab-${activeDetailsTab}`);
}

function renderLinkedRecords(kind) {
  const records = selectedRecords[kind];
  const name = kind === "vehicle" ? "vehicle" : "casualty";
  if (records === null) return `<p class="control-hint" role="status">Loading ${name} records…</p>`;
  if (records === false) return `<p class="error-message">Could not load ${name} records.</p>
    <button class="retry-records" type="button" data-retry-records="${kind}">Retry loading ${name} records</button>`;
  if (records.length === 0) return `<p class="control-hint">No linked ${name} records found in this year's data.</p>`;

  const expected = selectedCollision.properties[kind === "vehicle" ? "number_of_vehicles" : "number_of_casualties"];
  const mismatch = Number(expected) !== records.length;
  const hint = kind === "vehicle"
    ? "All vehicles in this collision, including drivers outside the chosen driver filters."
    : "Each injured person is listed separately. Injury severity can differ from the overall collision severity.";

  return `<p class="control-hint">${hint}</p>
    ${mismatch ? `<p class="control-hint">${escapeHtml(expected)} reported in the collision record; ${records.length} linked records available.</p>` : ""}
    ${records.map((record, index) => {
      const reference = record[`${kind}_reference`];
      const title = kind === "vehicle"
        ? `Vehicle ${recordedValue(reference)} · ${recordValue(kind, "vehicle_type", record.vehicle_type)}`
        : `Casualty ${recordedValue(reference)} · ${recordValue(kind, "casualty_severity", record.casualty_severity)}`;
      const subtitle = kind === "vehicle"
        ? `${recordValue(kind, "sex_of_driver", record.sex_of_driver)} · ${recordValue(kind, "age_of_driver", record.age_of_driver)}`
        : `${recordValue(kind, "casualty_class", record.casualty_class)} · ${recordValue(kind, "age_of_casualty", record.age_of_casualty)}`;
      return `<details class="linked-record" ${index === 0 ? "open" : ""}>
        <summary><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></summary>
        ${renderRecordRows(kind, record, RECORD_FIELDS[kind].slice(0, 6))}
        <details class="more-record-details"><summary>More ${name} details</summary>
          ${renderRecordRows(kind, record, RECORD_FIELDS[kind].slice(6))}
          <p class="control-hint">Not recorded means the source has no usable value. Historic fields use the earlier recording format.
            IMD is the Index of Multiple Deprivation. LSOA is a small statistical area.
            ${kind === "casualty" ? "Severity adjustments are statistical weights, not extra casualties or injury diagnoses." : ""}</p>
        </details>
      </details>`;
    }).join("")}`;
}

function renderCollisionDetails() {
  if (!selectedCollision) return;
  const p = selectedCollision.properties;
  const index = selectedGroup.findIndex((feature) => collisionKey(feature) === collisionKey(selectedCollision));
  const rows = collisionRows(selectedCollision);
  updateDetailsTabs();

  detailsContent.innerHTML = `
    <div class="detail-heading"><span class="detail-year year-${p.collision_year}">${escapeHtml(p.collision_year)}</span>
      <strong>${escapeHtml(categoryLabel("severity", p.collision_severity))} collision</strong></div>
    <p class="record-reference">${escapeHtml(p.collision_index)}</p>
    ${selectedGroup.length > 1 ? `<div class="location-records">
      <span>${selectedGroup.length} collisions at this location<br><strong>Record ${index + 1} of ${selectedGroup.length}</strong></span>
      <button type="button" data-record-step="-1" aria-label="Previous collision at this location" ${index === 0 ? "disabled" : ""}>←</button>
      <button type="button" data-record-step="1" aria-label="Next collision at this location" ${index === selectedGroup.length - 1 ? "disabled" : ""}>→</button>
    </div>` : ""}
    ${activeDetailsTab === "collision" ? `<dl class="detail-rows">${rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      <div><dt>Coordinates</dt><dd>${selectedCollision.geometry.coordinates.map((value) => value.toFixed(5)).join(", ")}</dd></div>
    </dl>` : renderLinkedRecords(activeDetailsTab)}`;
}

async function loadCollisionRecords(kind, feature, request) {
  const folder = kind === "vehicle" ? "vehicles" : "casualties";
  try {
    const year = feature.properties.collision_year;
    const data = await fetchGeoJson(`${folder}/calderdale_${folder}_${year}.geojson`, `Could not load ${folder} for ${year}.`);
    if (request !== detailsRequest) return;
    // Join within the selected year, then keep each vehicle / casualty separate.
    selectedRecords[kind] = data.features
      .filter((record) => record.properties.collision_index === feature.properties.collision_index)
      .map((record) => record.properties)
      .sort((a, b) => Number(a[`${kind}_reference`]) - Number(b[`${kind}_reference`]));
  } catch (error) {
    if (request !== detailsRequest) return;
    selectedRecords[kind] = false;
  }
  updateDetailsTabs();
  if (activeDetailsTab === kind) renderCollisionDetails();
}

async function selectCollision(feature, group = null) {
  const request = ++detailsRequest;
  selectedCollision = feature;
  selectedGroup = group || displayedFeatures.filter((other) =>
    other.geometry.coordinates[0] === feature.geometry.coordinates[0] &&
    other.geometry.coordinates[1] === feature.geometry.coordinates[1],
  );
  selectedRecords = { vehicle: null, casualty: null };
  if (!group) activeDetailsTab = "collision";
  detailsPanel.hidden = false;
  detailsContent.scrollTop = 0;
  renderCollisionDetails();
  refreshMapLayers();

  await Promise.all(["vehicle", "casualty"].map((kind) => loadCollisionRecords(kind, feature, request)));
}

function clearCollisionSelection() {
  detailsRequest++;
  selectedCollision = null;
  selectedGroup = [];
  selectedRecords = { vehicle: null, casualty: null };
  detailsPanel.hidden = true;
}

showLabelsInput.addEventListener("change", refreshMapLayers);
labelField.addEventListener("change", refreshMapLayers);
document.getElementById("close-details").addEventListener("click", () => {
  clearCollisionSelection();
  refreshMapLayers();
});
const detailsTabs = detailsPanel.querySelector(".details-tabs");
function activateDetailsTab(button) {
  activeDetailsTab = button.dataset.detailsTab;
  renderCollisionDetails();
  detailsContent.scrollTop = 0;
}
detailsTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-details-tab]");
  if (button) activateDetailsTab(button);
});
detailsTabs.addEventListener("keydown", (event) => {
  const buttons = Array.from(detailsTabs.querySelectorAll("[data-details-tab]"));
  const index = buttons.indexOf(document.activeElement);
  if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
  activateDetailsTab(buttons[next]);
  buttons[next].focus();
});
detailsContent.addEventListener("click", (event) => {
  const retry = event.target.closest("[data-retry-records]");
  if (retry) {
    const kind = retry.dataset.retryRecords;
    selectedRecords[kind] = null;
    renderCollisionDetails();
    loadCollisionRecords(kind, selectedCollision, detailsRequest);
    return;
  }
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
function updateOverviewView() {
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
}

window.addEventListener("resize", updateOverviewView);

// Hiding the panel keeps its controls and scroll position intact.
// Refit only an overview; preserve a closer location when possible.
const sidebar = document.getElementById("sidebar");
const showFiltersButton = document.getElementById("show-filters");
const hideFiltersButton = document.getElementById("hide-filters");
const collapsedFilterCount = document.getElementById("collapsed-filter-count");

function setFiltersCollapsed(collapsed) {
  sidebar.hidden = collapsed;
  showFiltersButton.hidden = !collapsed;
  showFiltersButton.setAttribute("aria-expanded", String(!collapsed));
  updateOverviewView();
  (collapsed ? showFiltersButton : hideFiltersButton).focus();
}

hideFiltersButton.addEventListener("click", () => setFiltersCollapsed(true));
showFiltersButton.addEventListener("click", () => setFiltersCollapsed(false));

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
                <p class="control-hint">Filters apply to year ${year} only. Choose any values within a category; chosen categories must all match.</p>
                ${FILTER_GROUPS.map((group) => `
                <section class="filter-group" aria-labelledby="group-${year}-${group.source}">
                    <h3 id="group-${year}-${group.source}">${group.label}</h3>
                    <p class="control-hint">${group.hint}</p>
                ${CATEGORIES.filter((cat) => cat.source === group.source).map(
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
                </section>`).join("")}
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
        const sources = Object.keys(LINKED_SOURCES).filter((source) =>
          CATEGORIES.some((cat) => cat.source === source && filters[cat.key]),
        );
        const [collisions, entries] = await Promise.all([
          loadYearData(year),
          Promise.all(sources.map(async (source) => [source, await loadRecordIndex(year, source)])),
        ]);

        return createYearLayers(year, collisions, Object.fromEntries(entries), filters);
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
  const selections = getSelections();
  const hasChanges = getSelectionSignature() !== appliedSelection;
  const count = selections.reduce((total, selection) => total + Object.keys(selection.filters).length, 0);
  collapsedFilterCount.textContent = count;
  collapsedFilterCount.hidden = count === 0;
  showFiltersButton.setAttribute("aria-label", `Show filters${count ? `, ${count} selected filter ${count === 1 ? "category" : "categories"}` : ""}${hasChanges ? ", changes not applied" : ""}`);
  showFiltersButton.classList.toggle("has-changes", hasChanges);
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
