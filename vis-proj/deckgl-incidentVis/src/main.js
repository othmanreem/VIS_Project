import { Deck, WebMercatorViewport, FlyToInterpolator } from "@deck.gl/core";
import { BitmapLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { YEARS, YEAR_COLORS, USERS, LIGHT, WEATHER, SPEEDS, DAYS, SEVERITY_NAMES, loadAllData } from "./data.js";
import { findHotspots, inPolygon } from "./hotspots.js";
import { PLACES, nearestPlace } from "./places.js";
import { createDetailsPanel, escapeHtml } from "./details.js";
import { renderRisk, renderSpeed, renderHeat, ksiShare, fmt } from "./charts.js";
import "./style.css";

// ==================================================
// Hotspot explorer
// 1. Sidebar ranks automatically found hotspots (DBSCAN).
// 2. Selecting a hotspot, or drawing a lasso / box, opens a card
//    that profiles the area against all matching collisions
//    (or against a second, compared area).
// 3. The analysis charts show risk and timing for everything,
//    with the selected area marked; clicking them filters all views.
// 4. Clicking a point opens the full collision details.
// ==================================================

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hexToRgb = (hex) => {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
};

const COLLISION_BOUNDS = [[-2.17014, 53.625085], [-1.731539, 53.78502]];

// --------------------------------------------------
// State
// --------------------------------------------------
const state = {
  filters: { user: new Set(), light: new Set(), wx: new Set(), spd: new Set(), cell: new Set(), yr: new Set() },
  selA: null, // { type: "hotspot", id } or { type: "area", tool, poly, ids, label }
  selB: null, // second area for comparison
  pickB: false, // waiting for the user to pick the second area
  mode: "select", // select | lasso | box
  hex: false,
  colorBy: "year",
  sort: "risk",
  riskTab: "user",
  hoverHs: null,
  hoverPt: null,
  drawer: false,
  tableSort: { key: "date", dir: -1 },
};

let P = []; // all collision records
let HS = []; // hotspots
let F = []; // records passing the filters
const inF = new Set(); // indices of F
let stats = []; // ranked hotspot statistics for the current filters
let statsById = new Map();
let drawOrder = []; // F sorted slight → fatal, so serious collisions are drawn on top
let hotspotPolygons = []; // stats with a drawable outline
let version = 0; // bumped on every state change, so deck.gl restyles the layers

// --------------------------------------------------
// Filters
// --------------------------------------------------
const FIELD_FILTERS = ["user", "light", "wx", "spd", "yr"];

function passes(record, skip = null) {
  for (const key of FIELD_FILTERS) {
    if (key !== skip && state.filters[key].size && !state.filters[key].has(record[key])) return false;
  }
  if (skip !== "cell" && state.filters.cell.size && !state.filters.cell.has(`${record.dow}-${record.hr}`)) return false;
  return true;
}

function recompute() {
  F = P.filter((record) => passes(record));
  inF.clear();
  F.forEach((record) => inF.add(record.i));
  drawOrder = F.slice().sort((a, b) => b.sev - a.sev);
  computeHotspotStats();
}

function toggleFilter(key, value) {
  const set = state.filters[key];
  if (set.has(value)) set.delete(value);
  else set.add(value);
  update();
}

// --------------------------------------------------
// Selections
// --------------------------------------------------
function selPoints(sel) {
  if (!sel) return [];
  const ids = sel.type === "hotspot" ? HS[sel.id].members : sel.ids;
  return ids.filter((i) => inF.has(i)).map((i) => P[i]);
}

function selName(sel) {
  if (!sel) return "";
  if (sel.type === "hotspot") {
    const h = HS[sel.id];
    return `${h.town}${h.road ? ` · ${h.road}` : ""}`;
  }
  return sel.label;
}

function setSelection(sel) {
  if (state.pickB && state.selA) {
    state.selB = sel;
    state.pickB = false;
  } else {
    state.selA = sel;
    state.selB = null;
    state.pickB = false;
  }
  update();
  zoomToSelection();
}

function selectHotspot(id) {
  setSelection({ type: "hotspot", id });
}

function clearSelection() {
  state.selA = null;
  state.selB = null;
  state.pickB = false;
  state.drawer = false;
  update();
  fitBounds(COLLISION_BOUNDS);
}

// --------------------------------------------------
// Statistics
// --------------------------------------------------
const PROFILE = [
  ["Pedestrian involved", (r) => r.user === 1],
  ["Cyclist / motorcyclist", (r) => r.user >= 2],
  ["Killed or serious", (r) => r.sev <= 2],
  ["In darkness", (r) => r.light === 1 || r.light === 2],
  ["Wet / icy surface", (r) => r.wet === 1],
  ["At a junction", (r) => r.junc === 1],
  ["Weekend", (r) => r.dow >= 5],
];
const share = (records, fn) => (records.length ? (100 * records.filter(fn).length) / records.length : 0);

function computeHotspotStats() {
  const all = HS.map((h) => {
    const members = h.members.filter((i) => inF.has(i)).map((i) => P[i]);
    const yrs = YEARS.map((year) => members.filter((r) => r.yr === year).length);
    const k = ksiShare(members);
    return {
      h, n: members.length, ksi: k, ped: share(members, (r) => r.user === 1), yrs,
      // Risk score: more collisions and a higher KSI share rank higher.
      score: members.length * (1 + k / 100),
      // Rising: collisions in 2024–25 minus 2022–23.
      rising: (yrs[4] + yrs[5]) - (yrs[2] + yrs[3]),
    };
  }).filter((s) => s.n > 0);
  const key = { risk: (s) => -s.score, n: (s) => -s.n, ksi: (s) => -s.ksi, rising: (s) => -s.rising }[state.sort];
  stats = all.sort((a, b) => key(a) - key(b));
  stats.forEach((s, i) => { s.rank = i + 1; });
  statsById = new Map(stats.map((s) => [s.h.id, s]));
  hotspotPolygons = stats.filter((s) => s.h.hull.length >= 3);
}

// --------------------------------------------------
// Map (deck.gl)
// --------------------------------------------------
const basemap = new TileLayer({
  id: "basemap",
  data: "https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png?key=cb1_304d_1_6699e7fd199a1afd970583e4",
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
  renderSubLayers: (props) => {
    const { west, south, east, north } = props.tile.bbox;
    return new BitmapLayer(props, { data: null, image: props.data, bounds: [west, south, east, north] });
  },
});

function mapSize() {
  const pane = $("map-pane");
  return { width: pane.clientWidth || 800, height: pane.clientHeight || 500 };
}

let overviewZoom = 11;

function overviewView() {
  const { width, height } = mapSize();
  const fit = new WebMercatorViewport({ width, height }).fitBounds(COLLISION_BOUNDS, { padding: Math.min(40, width / 8, height / 8) });
  overviewZoom = fit.zoom;
  return { longitude: fit.longitude, latitude: fit.latitude, zoom: fit.zoom };
}

let viewState = { longitude: -1.95, latitude: 53.705, zoom: 11, pitch: 0, bearing: 0 };

function viewport() {
  const { width, height } = mapSize();
  return new WebMercatorViewport({ ...viewState, width, height });
}

// Keep the view on Calderdale.
function clampView(next) {
  const minZoom = overviewZoom - 0.6;
  return {
    ...next,
    zoom: Math.max(minZoom, Math.min(18, next.zoom)),
    longitude: Math.max(COLLISION_BOUNDS[0][0] - 0.1, Math.min(COLLISION_BOUNDS[1][0] + 0.1, next.longitude)),
    latitude: Math.max(COLLISION_BOUNDS[0][1] - 0.05, Math.min(COLLISION_BOUNDS[1][1] + 0.05, next.latitude)),
    pitch: 0,
    bearing: 0,
  };
}

function setView(next, animate) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  viewState = clampView({
    ...viewState,
    ...next,
    transitionDuration: animate && !reduce ? 600 : 0,
    transitionInterpolator: animate && !reduce ? new FlyToInterpolator() : undefined,
  });
  deck.setProps({ viewState });
  scheduleFrame();
}

function fitBounds(bounds, animate = true) {
  const { width, height } = mapSize();
  const card = $("card");
  let right = width > 700 ? card.offsetWidth + 36 : 30;
  if (width - right - 40 < 120) right = 30;
  const small = height < 260;
  const fit = new WebMercatorViewport({ width, height }).fitBounds(bounds, {
    padding: { top: small ? 10 : 60, bottom: small ? 10 : 40, left: 40, right },
    maxZoom: 17,
  });
  setView({ longitude: fit.longitude, latitude: fit.latitude, zoom: fit.zoom }, animate);
}

function boundsOf(records) {
  const pad = 0.002;
  const lons = records.map((r) => r.lon);
  const lats = records.map((r) => r.lat);
  return [[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]];
}

function zoomToSelection() {
  const records = [...selPoints(state.selA), ...selPoints(state.selB)];
  if (records.length) fitBounds(boundsOf(records));
}

// Point size grows a little as you zoom in.
const pointRadius = () => Math.max(2.4, Math.min(6, 2.4 + (viewState.zoom - overviewZoom) * 0.9));

function pointColor(record) {
  return state.colorBy === "year" ? YEAR_COLORS[record.yr] : SEVERITY_RGB[record.sev - 1];
}
let SEVERITY_RGB = [[122, 26, 20], [216, 73, 43], [242, 154, 91]];

// Hexagons are binned in screen space so they keep a constant size on screen.
const HEX_RAMP = [[243, 217, 194], [234, 176, 132], [221, 134, 83], [194, 88, 45], [138, 42, 28]];

function hexBins() {
  const vp = viewport();
  const R = 15;
  const { width, height } = mapSize();
  const bins = new Map();
  for (const record of F) {
    const [x, y] = vp.project(record.position);
    if (x < -R || y < -R || x > width + R || y > height + R) continue;
    const q = ((x * Math.sqrt(3)) / 3 - y / 3) / R;
    const r = ((y * 2) / 3) / R;
    let rx = Math.round(q);
    let rz = Math.round(r);
    const ry = Math.round(-q - r);
    const dx = Math.abs(rx - q);
    const dz = Math.abs(rz - r);
    const dy = Math.abs(ry + q + r);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dz > dy) rz = -rx - ry;
    const key = `${rx},${rz}`;
    if (!bins.has(key)) bins.set(key, { q: rx, r: rz, records: [] });
    bins.get(key).records.push(record);
  }
  const max = Math.max(1, ...[...bins.values()].map((b) => b.records.length));
  const selected = new Set(selPoints(state.selA).map((r) => r.i));
  return [...bins.values()].map((bin) => {
    const cx = Math.sqrt(3) * R * (bin.q + bin.r / 2);
    const cy = 1.5 * R * bin.r;
    const size = R * (0.45 + 0.55 * Math.sqrt(bin.records.length / max));
    const polygon = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      polygon.push(vp.unproject([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]));
    }
    return {
      polygon,
      n: bin.records.length,
      ksi: ksiShare(bin.records),
      inSelection: selected.size > 0 && bin.records.some((r) => selected.has(r.i)),
    };
  });
}

let ringRecord = null; // collision shown in the details panel

function buildLayers() {
  const layers = [basemap];
  const A = state.selA ? new Set(selPoints(state.selA).map((r) => r.i)) : null;
  const B = state.selB ? new Set(selPoints(state.selB).map((r) => r.i)) : null;
  const anySelection = Boolean(A || B);
  const selRgb = hexToRgb(css("--sel"));
  const cmpRgb = hexToRgb(css("--cmp"));
  const inkRgb = hexToRgb(css("--text"));
  const selectionKey = version;

  if (state.hex) {
    layers.push(new PolygonLayer({
      id: "hexagons",
      data: hexBins(),
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => HEX_RAMP[Math.min(4, Math.floor(d.ksi / 12))].concat(anySelection && !d.inSelection ? 90 : 240),
      stroked: true,
      getLineColor: (d) => (d.inSelection ? selRgb : [255, 254, 250]),
      getLineWidth: (d) => (d.inSelection ? 2 : 0.8),
      lineWidthUnits: "pixels",
      pickable: true,
    }));
  }

  // Hotspot outlines (also the click / hover target for a hotspot).
  layers.push(new PolygonLayer({
    id: "hotspots",
    data: hotspotPolygons,
    getPolygon: (s) => s.h.hull,
    filled: true,
    getFillColor: (s) => {
      if (state.selA?.type === "hotspot" && state.selA.id === s.h.id) return selRgb.concat(36);
      if (state.selB?.type === "hotspot" && state.selB.id === s.h.id) return cmpRgb.concat(36);
      if (state.hoverHs === s.h.id) return inkRgb.concat(24);
      return inkRgb.concat(4); // nearly invisible, but still clickable
    },
    stroked: true,
    getLineColor: (s) => {
      if (state.selA?.type === "hotspot" && state.selA.id === s.h.id) return selRgb;
      if (state.selB?.type === "hotspot" && state.selB.id === s.h.id) return cmpRgb;
      return inkRgb.concat(state.hoverHs === s.h.id ? 255 : 140);
    },
    getLineWidth: (s) => ((state.selA?.id === s.h.id && state.selA?.type === "hotspot")
      || (state.selB?.id === s.h.id && state.selB?.type === "hotspot") || state.hoverHs === s.h.id ? 2.2 : 1),
    lineWidthUnits: "pixels",
    lineJointRounded: true,
    pickable: true,
    updateTriggers: { getFillColor: [selectionKey, state.hoverHs], getLineColor: [selectionKey, state.hoverHs], getLineWidth: [selectionKey, state.hoverHs] },
  }));

  // Lasso / box areas.
  const areas = [[state.selA, selRgb], [state.selB, cmpRgb]]
    .filter(([sel]) => sel && sel.type === "area")
    .map(([sel, rgb]) => ({ polygon: sel.poly, rgb }));
  if (areas.length) {
    layers.push(new PolygonLayer({
      id: "areas",
      data: areas,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.rgb.concat(28),
      getLineColor: (d) => d.rgb,
      getLineWidth: 2,
      lineWidthUnits: "pixels",
    }));
  }

  if (!state.hex) {
    const radius = pointRadius();
    layers.push(new ScatterplotLayer({
      id: "collisions",
      // Slight first, so serious and fatal collisions are drawn on top.
      data: drawOrder,
      getPosition: (r) => r.position,
      getRadius: (r) => ((A && A.has(r.i)) || (B && B.has(r.i)) ? radius + 0.6 : radius),
      radiusUnits: "pixels",
      getFillColor: (r) => pointColor(r).concat(anySelection && !(A?.has(r.i) || B?.has(r.i)) ? 64 : 242),
      stroked: true,
      getLineColor: [255, 254, 250, 230],
      getLineWidth: (r) => (anySelection && !(A?.has(r.i) || B?.has(r.i)) ? 0.3 : 0.8),
      lineWidthUnits: "pixels",
      pickable: true,
      updateTriggers: {
        getRadius: [selectionKey, radius],
        getFillColor: [selectionKey, state.colorBy],
        getLineWidth: [selectionKey],
      },
    }));

    const ring = ringRecord ?? (state.hoverPt != null ? P[state.hoverPt] : null);
    if (ring && inF.has(ring.i)) {
      layers.push(new ScatterplotLayer({
        id: "ring",
        data: [ring],
        getPosition: (r) => r.position,
        getRadius: radius + 5,
        radiusUnits: "pixels",
        filled: false,
        stroked: true,
        getLineColor: inkRgb,
        getLineWidth: 1.8,
        lineWidthUnits: "pixels",
      }));
    }
  }
  return layers;
}

function onHover(info) {
  const { object, layer, x, y } = info;
  let changed = false;
  if (layer?.id === "collisions" && object) {
    changed = state.hoverPt !== object.i || state.hoverHs !== null;
    state.hoverPt = object.i;
    state.hoverHs = null;
    showTip(x, y, tipFor(object));
  } else if (layer?.id === "hotspots" && object) {
    changed = state.hoverHs !== object.h.id || state.hoverPt !== null;
    state.hoverHs = object.h.id;
    state.hoverPt = null;
    showTip(x, y, `<b>${escapeHtml(object.h.town)}${object.h.road ? ` · ${object.h.road}` : ""}</b><span>${object.n} collisions · ${Math.round(object.ksi)}% KSI · click to select</span>`);
  } else if (layer?.id === "hexagons" && object) {
    showTip(x, y, `<b>${object.n} collisions</b><span>${Math.round(object.ksi)}% killed or seriously injured</span>`);
  } else {
    changed = state.hoverPt !== null || state.hoverHs !== null;
    state.hoverPt = null;
    state.hoverHs = null;
    hideTip();
  }
  if (changed) {
    renderRank();
    scheduleFrame();
  }
}

function onClick(info) {
  const { object, layer } = info;
  if (layer?.id === "collisions" && object) {
    const sameLocation = F.filter((r) => r.lon === object.lon && r.lat === object.lat);
    details.open(object, sameLocation);
    return;
  }
  if (layer?.id === "hotspots" && object) {
    selectHotspot(object.h.id);
  }
}

const deck = new Deck({
  parent: $("map"),
  viewState,
  controller: { doubleClickZoom: false },
  layers: [basemap],
  pickingRadius: 5,
  onViewStateChange: ({ viewState: next }) => {
    viewState = clampView(next);
    deck.setProps({ viewState });
    hideTip();
    scheduleFrame();
  },
  onHover,
  onClick,
  getCursor: ({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab"),
});

// --------------------------------------------------
// Overlay: hotspot numbers, hover label, town names, drawing
// --------------------------------------------------
const overlay = $("overlay");
const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs, parent, text) {
  const node = document.createElementNS(NS, tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

let drawing = null; // { tool, points: [[x, y], ...] } while drawing a lasso or box

function drawOverlay() {
  const { width, height } = mapSize();
  overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  overlay.replaceChildren();
  const vp = viewport();
  const land = css("--land");

  // Town names
  const detailed = viewState.zoom > overviewZoom + 1.5;
  PLACES.filter((p) => detailed || p.label).forEach((place) => {
    const [x, y] = vp.project([place.lon, place.lat]);
    if (x < 0 || y < 20 || x > width || y > height) return;
    svgEl("text", {
      x, y: y - 22, "text-anchor": "middle", "font-size": 10.5, "font-weight": 600, "letter-spacing": 1,
      class: "muted", stroke: land, "stroke-width": 3, "paint-order": "stroke",
    }, overlay, place.name.replace(" centre", "").toUpperCase());
  });

  // Hotspot rank numbers (top 10, plus selected / hovered)
  stats.forEach((s) => {
    const isA = state.selA?.type === "hotspot" && state.selA.id === s.h.id;
    const isB = state.selB?.type === "hotspot" && state.selB.id === s.h.id;
    const hover = state.hoverHs === s.h.id;
    if (s.rank > 10 && !isA && !isB && !hover) return;
    const pts = s.h.hull.map((p) => vp.project(p));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const bx = Math.max(...xs) + 9;
    const by = Math.min(...ys) - 7;
    const color = isA ? css("--sel") : isB ? css("--cmp") : css("--text");
    svgEl("circle", { cx: bx, cy: by, r: 9, fill: isA || isB ? color : css("--paper"), stroke: color, "stroke-width": 1.4 }, overlay);
    svgEl("text", { x: bx, y: by + 3.6, "text-anchor": "middle", "font-size": 10, "font-weight": 700, fill: isA || isB ? "#fff" : css("--text") }, overlay, s.rank);
    if (hover) {
      svgEl("text", {
        x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) + 16, "text-anchor": "middle", "font-size": 11.5, "font-weight": 650,
        stroke: land, "stroke-width": 3.5, "paint-order": "stroke",
      }, overlay, `${s.h.town} · ${s.n} collisions · ${Math.round(s.ksi)}% KSI`);
    }
  });

  // Lasso / box being drawn
  if (drawing && drawing.points.length > 1) {
    const pts = drawing.tool === "box" ? boxCorners(drawing.points[0], drawing.points[drawing.points.length - 1]) : drawing.points;
    const colorVar = state.pickB ? "--cmp" : "--sel";
    svgEl("path", {
      d: `M${pts.map((p) => p.join(",")).join("L")}${drawing.tool === "box" ? "Z" : ""}`,
      fill: state.pickB ? css("--cmp-soft") : css("--sel-soft"), stroke: css(colorVar), "stroke-width": 2, "stroke-dasharray": "6 4",
    }, overlay);
  }
}

function boxCorners([x0, y0], [x1, y1]) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

let frame = 0;
function scheduleFrame() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    deck.setProps({ layers: buildLayers() });
    drawOverlay();
  });
}

// Lasso and box drawing happens on the overlay, which only takes
// pointer events while one of those tools is active.
function localPoint(event) {
  const rect = overlay.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

overlay.addEventListener("pointerdown", (event) => {
  if (state.mode === "select") return;
  overlay.setPointerCapture(event.pointerId);
  drawing = { tool: state.mode, points: [localPoint(event)] };
});
overlay.addEventListener("pointermove", (event) => {
  if (!drawing) return;
  const point = localPoint(event);
  if (drawing.tool === "box") drawing.points[1] = point;
  else drawing.points.push(point);
  drawOverlay();
});
overlay.addEventListener("pointerup", (event) => {
  if (!drawing) return;
  overlay.releasePointerCapture(event.pointerId);
  const { tool, points } = drawing;
  drawing = null;
  const screen = tool === "box" ? (points[1] ? boxCorners(points[0], points[1]) : null) : points;
  if (!screen || screen.length < 3) {
    drawOverlay();
    return;
  }
  const vp = viewport();
  const poly = screen.map((p) => vp.unproject(p));
  const ids = P.filter((r) => inPolygon(r.lon, r.lat, poly)).map((r) => r.i);
  if (!ids.length) {
    drawOverlay();
    setNote("No collisions inside that shape. Try drawing a larger area.");
    return;
  }
  const lon = ids.reduce((sum, i) => sum + P[i].lon, 0) / ids.length;
  const lat = ids.reduce((sum, i) => sum + P[i].lat, 0) / ids.length;
  state.mode = "select";
  setSelection({ type: "area", tool, poly, ids, label: `Area near ${nearestPlace(lon, lat).replace(" centre", "")}` });
});

// --------------------------------------------------
// Tooltip
// --------------------------------------------------
function tipFor(r) {
  return `<b>${SEVERITY_NAMES[r.sev - 1]} · ${USERS[r.user].toLowerCase()}</b><span>${escapeHtml(r.date)} · ${escapeHtml(r.time)}</span>
    <dl><dt>Casualties</dt><dd>${r.cas}</dd><dt>Vehicles</dt><dd>${r.veh}</dd>
    <dt>Speed limit</dt><dd>${r.spd >= 0 ? `${SPEEDS[r.spd]} mph` : "—"}</dd><dt>Light</dt><dd>${LIGHT[r.light]}</dd>
    <dt>Road</dt><dd>${escapeHtml(r.road)}</dd></dl><span>Click for full details</span>`;
}

function showTip(x, y, html) {
  const tip = $("tip");
  tip.innerHTML = html;
  tip.hidden = false;
  const { width, height } = mapSize();
  tip.style.left = `${Math.max(4, Math.min(x + 14, width - tip.offsetWidth - 8))}px`;
  tip.style.top = `${Math.max(4, Math.min(y + 14, height - tip.offsetHeight - 8))}px`;
}

function hideTip() {
  $("tip").hidden = true;
}

// --------------------------------------------------
// Sidebar
// --------------------------------------------------
const FILTER_LABEL = {
  user: (v) => USERS[v],
  light: (v) => LIGHT[v],
  wx: (v) => WEATHER[v],
  spd: (v) => `${SPEEDS[v]} mph`,
  yr: (v) => String(v),
  cell: (v) => {
    const [d, h] = v.split("-");
    return `${DAYS[d]} ${String(h).padStart(2, "0")}:00`;
  },
};

function renderHeader() {
  $("kpi-n").textContent = fmt(F.length);
  const count = Object.values(state.filters).reduce((sum, set) => sum + set.size, 0);
  $("kpi-sub").textContent = count
    ? `of ${fmt(P.length)} · ${count} filter${count > 1 ? "s" : ""} active`
    : "2020 – 2025 · all collisions";

  let html = "";
  if (state.selA) html += `<span class="chip sel">Area: ${escapeHtml(selName(state.selA))}<button type="button" data-clear="A" aria-label="Clear selected area">×</button></span>`;
  if (state.selB) html += `<span class="chip cmp">Compare: ${escapeHtml(selName(state.selB))}<button type="button" data-clear="B" aria-label="Clear compared area">×</button></span>`;
  Object.entries(state.filters).forEach(([key, set]) => set.forEach((value) => {
    html += `<span class="chip">${escapeHtml(FILTER_LABEL[key](value))}<button type="button" data-unfilter="${key}|${value}" aria-label="Remove filter">×</button></span>`;
  }));
  if (count) html += `<span class="chip clear"><button type="button" data-clear-all="1">Clear all filters</button></span>`;
  $("chips").innerHTML = html;

  if (state.colorBy === "year") {
    $("key").innerHTML = YEARS.map((year) => `<button type="button" data-year="${year}" aria-pressed="${!state.filters.yr.size || state.filters.yr.has(year)}" title="Click to show only this year; click more years to add them">
      <span class="dot" style="background:rgb(${YEAR_COLORS[year].join(",")})"></span>${year}</button>`).join("");
  } else {
    $("key").innerHTML = SEVERITY_NAMES.map((name, i) => `<span><span class="dot" style="background:rgb(${SEVERITY_RGB[i].join(",")})"></span>${name}</span>`).join("");
  }
  document.querySelectorAll("#colorby [data-c]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === state.colorBy)));
}

function renderRank() {
  $("hs-count").textContent = `${stats.length} ${stats.length === 1 ? "area" : "areas"}`;
  $("rank").innerHTML = stats.map((s) => {
    const max = Math.max(1, ...s.yrs);
    const up = s.rising > 0;
    const line = s.yrs.map((v, j) => `${2 + j * 11},${17 - (v / max) * 13}`).join(" ");
    const cls = state.selA?.type === "hotspot" && state.selA.id === s.h.id ? "sel"
      : state.selB?.type === "hotspot" && state.selB.id === s.h.id ? "cmp"
      : state.hoverHs === s.h.id ? "hov" : "";
    const trendColor = up ? "var(--risk)" : "var(--muted)";
    return `<li data-hs="${s.h.id}" class="${cls}" tabindex="0">
      <span class="rk">${s.rank}</span>
      <div class="nm">${escapeHtml(s.h.town)}${s.h.road ? ` · ${escapeHtml(s.h.road)}` : ""}
        <div class="mini"><span><i style="width:${Math.round(s.ksi * 0.55)}px;background:var(--risk)"></i>${Math.round(s.ksi)}% KSI</span>
        <span><i style="width:${Math.round(s.ped * 0.55)}px;background:var(--muted)"></i>${Math.round(s.ped)}% ped.</span></div></div>
      <div class="ct">${s.n}<svg width="60" height="20" aria-label="Collisions per year, 2020 to 2025"><polyline points="${line}" fill="none" stroke="${trendColor}" stroke-width="1.5"/>
        <circle cx="57" cy="${17 - (s.yrs[5] / max) * 13}" r="2" fill="${trendColor}"/></svg></div>
    </li>`;
  }).join("") || '<li class="empty"><span class="hint">No hotspot has collisions matching these filters.</span></li>';
  document.querySelectorAll("#sort [data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
}

// --------------------------------------------------
// Selected-area card
// --------------------------------------------------
function renderCard() {
  const card = $("card");
  if (!state.selA) {
    card.className = "card empty";
    card.innerHTML = `<div class="k">Start here</div><h3>Select an area to see what makes it different</h3>
      <ol><li>Click a hotspot in the list or on the map, or</li><li>choose <b>Lasso area</b> or <b>Box</b> and draw on the map.</li><li>Click chart bars to filter everything at once.</li></ol>`;
    return;
  }
  card.className = "card";
  const A = selPoints(state.selA);
  const B = state.selB ? selPoints(state.selB) : null;
  const reference = B || F;
  const referenceLabel = B ? selName(state.selB) : "all matching collisions";
  const summary = (records) => ({
    n: records.length,
    cas: records.reduce((sum, r) => sum + r.cas, 0),
    k: Math.round(ksiShare(records)),
    f: records.filter((r) => r.sev === 1).length,
  });
  const a = summary(A);
  const b = B ? summary(B) : null;

  // Profile: share in the area vs the reference, as bars around a dashed line.
  const rows = PROFILE.map(([label, fn]) => ({ label, v: share(A, fn), r: share(reference, fn) }));
  const mid = 200;
  const scale = 2.4;
  const rowH = 23;
  let profile = `<svg width="100%" viewBox="0 0 330 ${rows.length * rowH + 6}" role="img" aria-label="Profile compared with ${escapeHtml(referenceLabel)}">
    <line x1="${mid}" x2="${mid}" y1="0" y2="${rows.length * rowH}" stroke="var(--muted)" stroke-dasharray="2 2"/>`;
  rows.forEach((row, i) => {
    const d = row.v - row.r;
    const y = i * rowH;
    const w = Math.max(1.5, Math.min(d >= 0 ? 90 : 34, Math.abs(d) * scale));
    const x = d >= 0 ? mid : mid - w;
    const fill = d >= 8 ? "var(--risk)" : d <= -8 ? "var(--sel)" : "var(--neutral-bar)";
    profile += `<text x="0" y="${y + 12}" font-size="11.5">${row.label}</text>
      <rect x="${x}" y="${y + 3}" width="${w}" height="11" rx="2" fill="${fill}"/>
      <text x="${d >= 0 ? mid + w + 4 : mid - w - 4}" y="${y + 12.5}" font-size="10.5" font-weight="650" text-anchor="${d >= 0 ? "start" : "end"}">${Math.round(row.v)}%</text>`;
  });
  profile += "</svg>";

  const top = [...rows].sort((x, y) => Math.abs(y.v - y.r) - Math.abs(x.v - x.r))[0];
  const ratio = top.r ? top.v / top.r : 0;
  const standout = A.length < 5
    ? "Too few collisions in this area for a reliable profile."
    : Math.abs(top.v - top.r) < 5
      ? `This area looks like ${B ? escapeHtml(referenceLabel) : "the rest of Calderdale"}; nothing stands out by more than 5 points.`
      : `<b>Stands out:</b> ${top.label.toLowerCase()} in ${Math.round(top.v)}% of collisions vs ${Math.round(top.r)}% ${B ? `in ${escapeHtml(referenceLabel)}` : "overall"}${ratio >= 1.6 ? ` (${ratio.toFixed(1)}×)` : ""}.`;

  const stat = (value, label, other) => `<div><b>${value}</b><span>${label}</span>${b ? `<div class="b2">${other}</div>` : ""}</div>`;
  card.innerHTML = `<div class="k">${state.selA.type === "hotspot" ? "Selected hotspot" : `Selected area · ${state.selA.tool}`}</div>
    <h3>${escapeHtml(selName(state.selA))}${B ? `<small>compared with ${escapeHtml(referenceLabel)}</small>` : ""}</h3>
    <div class="stats">
      ${stat(a.n, "collisions", b?.n)}${stat(a.cas, "casualties", b?.cas)}${stat(`${a.k}%`, "KSI", `${b?.k}%`)}${stat(a.f, "fatal", b?.f)}
    </div>
    <div class="prof-h"><span>Compared with ${escapeHtml(referenceLabel)}</span><span>dashed line = ${B ? "compared area" : "average"}</span></div>
    ${profile}
    <p class="standout">${standout}</p>
    <div class="btns">
      <button type="button" class="btn primary" data-card="table">Show these ${a.n} in a table</button>
      <button type="button" class="btn" data-card="compare">${state.selB ? "Change comparison" : state.pickB ? "Picking… (Esc to cancel)" : "Compare with…"}</button>
      <button type="button" class="btn" data-card="zoom">Zoom to area</button>
      <button type="button" class="btn" data-card="clear">Clear</button>
    </div>`;
}

// --------------------------------------------------
// Records table
// --------------------------------------------------
const COLUMNS = [["date", "Date"], ["time", "Time"], ["sev", "Severity"], ["cas", "Casualties"], ["user", "Road user"], ["spd", "Limit"], ["light", "Light"], ["road", "Road"]];

function renderTable() {
  const drawer = $("drawer");
  drawer.hidden = !state.drawer || !state.selA;
  $("map-pane").classList.toggle("has-drawer", !drawer.hidden);
  if (drawer.hidden) return;
  const rows = selPoints(state.selA).slice();
  const { key, dir } = state.tableSort;
  rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
  $("drawer-title").textContent = `${rows.length} collisions · ${selName(state.selA)}`;
  $("thead").innerHTML = `<tr>${COLUMNS.map(([k, label]) => `<th><button type="button" data-table-sort="${k}">${label}${k === key ? (dir > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("")}</tr>`;
  $("tbody").innerHTML = rows.map((r) => `<tr data-record="${r.i}">
    <td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.time)}</td>
    <td><span class="dot" style="background:rgb(${SEVERITY_RGB[r.sev - 1].join(",")});margin-right:6px"></span>${SEVERITY_NAMES[r.sev - 1]}</td>
    <td>${r.cas}</td><td>${USERS[r.user]}</td><td>${r.spd >= 0 ? SPEEDS[r.spd] : "—"}</td><td>${LIGHT[r.light]}</td><td>${escapeHtml(r.road)}</td></tr>`).join("");
}

// --------------------------------------------------
// Charts
// --------------------------------------------------
function chartContext() {
  return {
    records: P,
    passes,
    filters: state.filters,
    selA: selPoints(state.selA),
    selB: state.selB ? selPoints(state.selB) : null,
    toggle: toggleFilter,
    color: css,
  };
}

function renderCharts() {
  const ctx = chartContext();
  renderRisk($("risk-chart"), ctx, state.riskTab);
  renderSpeed($("speed-chart"), ctx);
  renderHeat($("heat-chart"), ctx);
  document.querySelectorAll("#risk-tab [data-t]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === state.riskTab)));
}

// --------------------------------------------------
// Notes and tools
// --------------------------------------------------
let noteOverride = "";
function setNote(text) {
  noteOverride = text;
  renderNote();
}

function renderNote() {
  const note = $("mapnote");
  note.classList.toggle("alert", state.pickB);
  note.textContent = noteOverride
    || (state.pickB ? "Pick a second area to compare: click a hotspot, a row in the list, or draw a lasso or box."
      : state.mode === "lasso" ? "Drag on the map to draw around an area."
      : state.mode === "box" ? "Drag on the map to draw a box."
      : state.hex ? "Hexagon colour = share killed or seriously injured (light → dark). Size = number of collisions."
      : "Drag to pan, scroll to zoom. Hover a point for a summary, click it for full details. Click a hotspot outline to select it.");
  noteOverride = "";
  const A = selPoints(state.selA);
  $("an-status").textContent = state.selA
    ? `bars = all matching collisions · blue marks = ${A.length} in ${selName(state.selA)}`
    : "all matching collisions · select an area to compare it";
  $("leg-b").hidden = !state.selB;
  document.querySelectorAll(".tool[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  $("hex-button").setAttribute("aria-pressed", String(state.hex));
  overlay.classList.toggle("drawing", state.mode !== "select");
}

// --------------------------------------------------
// Render everything from the state
// --------------------------------------------------
function renderAll() {
  renderHeader();
  renderRank();
  renderCard();
  renderCharts();
  renderTable();
  renderNote();
  scheduleFrame();
}

function update() {
  version += 1;
  recompute();
  // A shown collision that no longer matches the filters is closed.
  if (details.isOpen() && !inF.has(details.current().i)) details.close();
  renderAll();
}

// --------------------------------------------------
// Events
// --------------------------------------------------
const details = createDetailsPanel((record) => {
  ringRecord = record;
  scheduleFrame();
});

document.querySelectorAll(".tool[data-mode]").forEach((button) => button.addEventListener("click", () => {
  state.mode = button.dataset.mode;
  hideTip();
  renderNote();
}));
$("hex-button").addEventListener("click", () => {
  state.hex = !state.hex;
  hideTip();
  renderNote();
  scheduleFrame();
});
$("sort").addEventListener("click", (event) => {
  const sort = event.target.closest("[data-sort]")?.dataset.sort;
  if (!sort) return;
  state.sort = sort;
  version += 1;
  computeHotspotStats();
  renderRank();
  scheduleFrame();
});
$("colorby").addEventListener("click", (event) => {
  const colorBy = event.target.closest("[data-c]")?.dataset.c;
  if (!colorBy) return;
  state.colorBy = colorBy;
  version += 1;
  renderHeader();
  scheduleFrame();
});
$("risk-tab").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-t]")?.dataset.t;
  if (!tab) return;
  state.riskTab = tab;
  renderCharts();
});
$("key").addEventListener("click", (event) => {
  const year = Number(event.target.closest("[data-year]")?.dataset.year);
  if (year) toggleFilter("yr", year);
});

const rank = $("rank");
rank.addEventListener("click", (event) => {
  const id = event.target.closest("[data-hs]")?.dataset.hs;
  if (id != null) selectHotspot(Number(id));
});
rank.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const id = event.target.closest("[data-hs]")?.dataset.hs;
  if (id == null) return;
  event.preventDefault();
  selectHotspot(Number(id));
});
rank.addEventListener("mouseover", (event) => {
  const id = event.target.closest("[data-hs]")?.dataset.hs;
  const value = id == null ? null : Number(id);
  if (value !== state.hoverHs) {
    state.hoverHs = value;
    scheduleFrame();
  }
});
rank.addEventListener("mouseleave", () => {
  state.hoverHs = null;
  scheduleFrame();
});

$("chips").addEventListener("click", (event) => {
  const clear = event.target.closest("[data-clear]")?.dataset.clear;
  if (clear === "A") {
    if (state.selB) {
      state.selA = state.selB;
      state.selB = null;
      state.pickB = false;
      update();
    } else {
      clearSelection();
    }
    return;
  }
  if (clear === "B") {
    state.selB = null;
    update();
    return;
  }
  const remove = event.target.closest("[data-unfilter]")?.dataset.unfilter;
  if (remove) {
    const [key, value] = remove.split("|");
    state.filters[key].delete(key === "cell" ? value : Number(value));
    update();
    return;
  }
  if (event.target.closest("[data-clear-all]")) {
    Object.values(state.filters).forEach((set) => set.clear());
    update();
  }
});

$("card").addEventListener("click", (event) => {
  const action = event.target.closest("[data-card]")?.dataset.card;
  if (action === "table") {
    state.drawer = true;
    renderTable();
  } else if (action === "compare") {
    state.pickB = true;
    state.selB = null;
    update();
  } else if (action === "zoom") {
    zoomToSelection();
  } else if (action === "clear") {
    clearSelection();
  }
});

$("drawer-close").addEventListener("click", () => {
  state.drawer = false;
  renderTable();
});
$("thead").addEventListener("click", (event) => {
  const key = event.target.closest("[data-table-sort]")?.dataset.tableSort;
  if (!key) return;
  state.tableSort = { key, dir: state.tableSort.key === key ? -state.tableSort.dir : key === "date" ? -1 : 1 };
  renderTable();
});
$("tbody").addEventListener("mouseover", (event) => {
  const id = event.target.closest("[data-record]")?.dataset.record;
  const value = id == null ? null : Number(id);
  if (value !== state.hoverPt) {
    state.hoverPt = value;
    scheduleFrame();
  }
});
$("tbody").addEventListener("mouseleave", () => {
  state.hoverPt = null;
  scheduleFrame();
});
$("tbody").addEventListener("click", (event) => {
  const id = event.target.closest("[data-record]")?.dataset.record;
  if (id == null) return;
  const record = P[Number(id)];
  details.open(record, F.filter((r) => r.lon === record.lon && r.lat === record.lat));
  setView({ longitude: record.lon, latitude: record.lat, zoom: Math.max(viewState.zoom, 16) }, true);
});

$("zoom-in").addEventListener("click", () => setView({ zoom: viewState.zoom + 1 }, true));
$("zoom-out").addEventListener("click", () => setView({ zoom: viewState.zoom - 1 }, true));
$("zoom-home").addEventListener("click", () => fitBounds(COLLISION_BOUNDS));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (drawing) {
    drawing = null;
    drawOverlay();
  } else if (state.pickB) {
    state.pickB = false;
    renderCard();
    renderNote();
  } else if (details.isOpen()) {
    details.close();
  } else if (state.drawer) {
    state.drawer = false;
    renderTable();
  } else if (state.mode !== "select") {
    state.mode = "select";
    renderNote();
  }
});

new ResizeObserver(() => {
  renderCharts();
  scheduleFrame();
}).observe(document.body);

// --------------------------------------------------
// Start-up
// --------------------------------------------------
async function start() {
  SEVERITY_RGB = [hexToRgb(css("--fatal")), hexToRgb(css("--serious")), hexToRgb(css("--slight"))];
  setView(overviewView(), false);
  try {
    P = await loadAllData((progress) => {
      $("loading").textContent = `Loading collision data… ${Math.round(progress * 100)}%`;
    });
  } catch (error) {
    console.error(error);
    $("loading").textContent = "Could not load the data files. Check that the public/ folders are present and reload the page.";
    return;
  }
  HS = findHotspots(P);
  $("loading").hidden = true;
  update();
  // Open in a working state: the highest-risk hotspot selected.
  if (stats.length) selectHotspot(stats[0].h.id);
}

start();
