import {renderProfiles} from './profiles.js';
import { Deck, WebMercatorViewport } from "@deck.gl/core";
import { BitmapLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { META, USERS, LIGHT, WEATHER, DAYS, SEVERITY_NAMES, loadAllData } from "./data.js";
import { inPolygon } from "./hotspots.js";
import { createPlaceNamer } from "./placeNames.js";
import { createDetailsPanel, escapeHtml } from "./details.js";
import { renderSpeed, renderHeat, ksiShare, fmt } from "./charts.js";
import "./style.css";
import {renderUserYears,renderConditions} from "./municipalCharts.js";
import { classifyAreaGroups, profileAreaGroups, PATTERN_METRICS, RQ3_METRICS } from "./areaGroups.js";
import { renderSavedComparisons, renderComparison } from "./areaWorkspace.js";
import { renderGroupAnalysis, renderSelectedYearsAnalysis } from "./groupAnalysis.js";
import { buildConcentrations, compareConcentrations } from "./concentrations.js";
import { temporalControls, temporalList, differenceWords, selectedYearWords, temporalLegend } from "./temporal.js";

// ==================================================
// Collision area explorer
// 1. Sidebar lists fixed hexagon areas for the selected years.
// 2. Selecting a hotspot, or drawing a lasso / box, opens a card
//    that profiles the area against all matching collisions
//    (or against a second, compared area).
// 3. The analysis charts show risk and timing for everything,
//    with the selected area marked; clicking them filters all views.
// 4. Clicking a point opens the full collision details.
// ==================================================

const POINT_PATTERNS=[...PATTERN_METRICS,...RQ3_METRICS];
const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hexToRgb = (hex) => {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
};


// --------------------------------------------------
// State
// --------------------------------------------------
const state = {
  filters: { user: new Set(), light: new Set(), wx: new Set(), spd: new Set(), cell: new Set(), yr: new Set() },
  selA: null, // { type: "hotspot", id } or { type: "area", tool, poly, ids, label }
  selB: null, // second area for comparison
  pickB: false, // waiting for the user to pick the second area
  mode: "select", // select | lasso | box
  hex: true,
  showPoints:false, extraAreas:[], pickExtra:false, multiHex:false, editArea:"A", savedComparisons:[], nextAreaNumber:1, patternHighlight:null,
  temporal: { mode:"year", from:2020, to:2025, size:500, years:new Set([2025]) },
  groupFocus:null,
  patternGroup:null,
  colorBy: "sev",
  sort: "risk",
  riskTab: "user",
  hoverHs: null,
  hoverPt: null,
  drawer: false,
  tableSort: { key: "date", dir: -1 },
};

let P = []; // all collision records
let HS = []; // hotspots
let geographicalHexagons=[], temporalData=[], temporalRank=[], temporalTotals=[], temporalAnnualMax=1, temporalCountMax=1;
let areaClassification=null, groupProfiles=[], classificationKey="", comparisonDeltaMax=1;
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
  const skipped=key=>Array.isArray(skip)?skip.includes(key):key===skip;
  for (const key of FIELD_FILTERS) {
    if(!skipped(key)&&state.filters[key].size){
      const match=key==='user'?(record.users||[record.user]).some(v=>state.filters.user.has(v)):state.filters[key].has(record[key]);
      if(!match)return false;
    }
  }
  if (!skipped("cell") && state.filters.cell.size && !state.filters.cell.has(`${record.dow}-${record.hr}`)) return false;
  return true;
}

function recompute() {
  F = P.filter((record) => passes(record));
  inF.clear();
  F.forEach((record) => inF.add(record.i));
  drawOrder = F.slice().sort((a, b) => b.sev - a.sev);
  computeHotspotStats();
  computeTemporalStats();
  if(areaClassification){
    const before=profileAreaGroups(areaClassification,P,state.temporal.from,r=>passes(r,"yr"));
    groupProfiles=profileAreaGroups(areaClassification,P,state.temporal.to,r=>passes(r,"yr")).map((g,i)=>({...g,before:before[i]}));
  }
}

function toggleFilter(key, value) {
  const set = state.filters[key];
  if (set.has(value)) set.delete(value);
  else set.add(value);
  update();
  if(state.selA)zoomToSelection();
}

function inFocusedGroup(record){return !state.groupFocus||areaClassification?.membership.get(record.i)===state.groupFocus;}

function computeTemporalStats() {
  if (!geographicalHexagons.length) return;
  const key=`${state.temporal.size}:${state.temporal.from}:${state.temporal.to}`;
  if(key!==classificationKey){areaClassification=classifyAreaGroups(geographicalHexagons,META.years,state.temporal.from,state.temporal.to);classificationKey=key;}
  const bins=geographicalHexagons.map(b=>({...b, counts:META.years.map(y=>b.members.reduce((sum,i)=>sum+(P[i].yr===y&&passes(P[i],"yr")?1:0),0))}));
  const t=state.temporal, result=compareConcentrations(bins,META.years,t.from,t.to);
  temporalTotals=result.totals;
  temporalAnnualMax=Math.max(1,...result.rows.flatMap(b=>b.counts));
  temporalCountMax=t.years.size===1?temporalAnnualMax:Math.max(1,...result.rows.map(b=>META.years.reduce((sum,y,i)=>sum+(t.years.has(y)?b.counts[i]:0),0)));
  temporalData=result.rows.map(b=>({...b,before:b.counts[META.years.indexOf(t.from)],after:t.mode==="compare"?b.counts[META.years.indexOf(t.to)]:META.years.reduce((sum,y,i)=>sum+(t.years.has(y)?b.counts[i]:0),0)})).filter(b=>t.mode==="compare"?b.before||b.after:b.after);
  if(t.mode==="compare")temporalData=temporalData.map(b=>{
    const original=geographicalHexagons.find(g=>g.id===b.id);
    const baselineBefore=original.counts[META.years.indexOf(t.from)],baselineAfter=original.counts[META.years.indexOf(t.to)];
    return {...b,baselineBefore,baselineAfter,delta:baselineAfter-baselineBefore,group:areaClassification.areas.get(b.id)};
  });
  comparisonDeltaMax=Math.max(1,...geographicalHexagons.map(b=>Math.abs(b.counts[META.years.indexOf(t.to)]-b.counts[META.years.indexOf(t.from)])));
  const deltaMax=comparisonDeltaMax;
  const countRamp=[[245,222,178],[223,174,106],[193,124,57],[149,82,35],[102,48,24]];
  // Store colours with this data snapshot. GPU accessors must not read a later
  // mode/filter state while an earlier layer is being updated or finalized.
  temporalData=temporalData.map(b=>({...b,fill:t.mode==="year"
    ?countRamp[Math.min(4,Math.floor(b.after/temporalCountMax*4.999))].concat(220)
    :b.delta===0?[104,113,119,180]:(b.delta>0?[180,81,38]:[43,105,153]).concat(Math.round(90+150*Math.abs(b.delta)/deltaMax))}));
  const ranked=state.groupFocus&&t.mode==="compare"?temporalData.filter(b=>b.group===state.groupFocus):temporalData;
  const more=ranked.filter(b=>b.delta>0).sort((a,b)=>b.delta-a.delta||b.after-a.after);
  const fewer=ranked.filter(b=>b.delta<0).sort((a,b)=>a.delta-b.delta||b.before-a.before);
  temporalRank=t.mode==="year"?[...temporalData].sort((a,b)=>b.after-a.after).slice(0,6)
    :[...more.slice(0,3),...fewer.slice(0,3)];
  if(!temporalRank.length)temporalRank=[...ranked].sort((a,b)=>b.after-a.after).slice(0,6);
}
function hexName(bin,urgent=false) {
  const place=placeName(bin.centre,urgent);
  return place ? `${place}${bin.road?` · ${bin.road}`:""}` : bin.road ? `Near ${bin.road}` : "Local roads";
}
function selectionIds(sel) {
  return sel ? (sel.type === 'hotspot' ? HS[sel.id].members : sel.ids) : [];
}
function comparisonSelections(){return [state.selA,state.selB,...state.extraAreas].filter(Boolean);}
function editingArea(target){return target==='A'?state.selA:target==='B'?state.selB:state.extraAreas[Number(target.slice(1))];}
function assignArea(target,sel){if(target==='A')state.selA=sel;else if(target==='B')state.selB=sel;else state.extraAreas[Number(target.slice(1))]=sel;}
function analysisScopeIds(){return state.selA?new Set((state.selB?comparisonSelections():[state.selA]).flatMap(selectionIds)):null;}
function selectHex(id) {
  const bin=geographicalHexagons.find(b=>b.id===id);if(!bin)return;
  state.patternHighlight=null;
  if(state.groupFocus&&areaClassification?.areas.get(id)!==state.groupFocus){state.groupFocus=null;state.patternGroup=null;}
  const target=state.pickExtra ? `C${state.extraAreas.length}` : state.pickB ? 'B' : state.multiHex ? state.editArea : 'A';
  const current=editingArea(target);
  if(state.multiHex && (current?.hexIds || current?.hexId)) {
    const ids=new Set(current.hexIds || [current.hexId]);
    if(ids.has(id))ids.delete(id);else ids.add(id);
    const bins=geographicalHexagons.filter(b=>ids.has(b.id));
    assignArea(target,bins.length ? {type:'area',tool:'hexagon group',gridSize:state.temporal.size,hexIds:[...ids],polys:bins.map(b=>b.polygon),poly:bins[0].polygon,
      ids:[...new Set(bins.flatMap(b=>b.members))],centre:bins[0].centre,label:`${bins.length} hexagons`} : null);
    state.pickB=false;state.editArea=target;update();return;
  }
  const sel={type:'area',tool:'hexagon',gridSize:state.temporal.size,hexId:id,hexIds:[id],poly:bin.polygon,ids:bin.members,centre:bin.centre,label:hexName(bin,true)};
  if(state.multiHex && target!=='A'&&!state.pickExtra) {assignArea(target,sel);state.pickB=false;update();return;}
  setSelection(sel);
}

// --------------------------------------------------
// Selections
// --------------------------------------------------
function selPoints(sel) {
  if (!sel) return [];
  const ids = sel.type === "hotspot" ? HS[sel.id].members : sel.ids;
  return ids.filter((i) => inF.has(i)).map((i) => P[i]);
}

// --------------------------------------------------
// Names: the place name comes from OpenStreetMap (placeNames.js);
// until it arrives, or if the service is unavailable, the name is
// built from the data (main road).
// --------------------------------------------------
let namer = null;
const placeName = (position, urgent = false) => (namer ? namer.get(position, urgent) : null);

function hotspotName(h, urgent = false) {
  const place = placeName(h.centre, urgent);
  if (place) return h.road ? `${place} · ${h.road}` : place;
  return h.road ? `${h.road} hotspot` : `Hotspot at ${h.centre[1].toFixed(3)}, ${h.centre[0].toFixed(3)}`;
}

function selName(sel) {
  if (!sel) return "";
  if (sel.label) return sel.label;
  // Selected areas are named first.
  if (sel.type === "hotspot") return hotspotName(HS[sel.id], true);
  const place = placeName(sel.centre, true);
  return place ? `Area near ${place}` : `Drawn area (${sel.ids.length} collisions)`;
}

function setSelection(sel) {
  state.patternHighlight=null;
  if(state.pickExtra && state.selA){
    state.extraAreas.push(sel);state.editArea=`C${state.extraAreas.length-1}`;state.pickExtra=false;
  } else if (state.pickB && state.selA) {
    state.selB = sel;
    state.editArea="B";
    state.pickB = false;
  } else {
    state.selA = sel;
    state.extraAreas=[];state.pickExtra=false;
    state.editArea="A";
    state.selB = null;
    state.pickB = false;
  }
  update();
  if(!state.multiHex)zoomToSelection();
}

function selectHotspot(id) {
  setSelection({ type: "hotspot", id });
}

function clearSelection() {
  state.extraAreas=[];state.pickExtra=false;
  state.selA = null;
  state.selB = null;
  state.pickB = false;
  state.drawer = false;
  state.editArea="A";state.patternHighlight=null;
  update();
  fitBounds(META.bounds);
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

function risingOf(yrs) {
  const n = yrs.length;
  if (n < 2) return 0;
  const half = Math.min(2, Math.floor(n / 2));
  const sum = (from, to) => yrs.slice(from, to).reduce((a, b) => a + b, 0);
  return sum(n - half, n) - sum(n - 2 * half, n - half);
}

function computeHotspotStats() {
  const all = HS.map((h) => {
    const members = h.members.filter((i) => inF.has(i)).map((i) => P[i]);
    // Keep annual context when one year is selected. Other filters still apply;
    // excluded years must not become artificial zeros in the trend.
    const annualMembers = h.members.map((i) => P[i]).filter((r) => passes(r, "yr"));
    const yrs = META.years.map((year) => annualMembers.filter((r) => r.yr === year).length);
    const k = ksiShare(members);
    return {
      h, n: members.length, ksi: k, ped: share(members, (r) => r.user === 1), yrs,
      // Risk score: more collisions and a higher KSI share rank higher.
      score: members.length * (1 + k / 100),
      // Rising: collisions in the last two years minus the two years before.
      rising: risingOf(yrs),
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
  const fit = new WebMercatorViewport({ width, height }).fitBounds(META.bounds, { padding: Math.min(40, width / 8, height / 8) });
  overviewZoom = fit.zoom;
  return { longitude: fit.longitude, latitude: fit.latitude, zoom: fit.zoom };
}

// Neutral start; replaced by the data's own extent once it has loaded.
let viewState = { longitude: 0, latitude: 30, zoom: 1, pitch: 0, bearing: 0 };
let cameraFrame = 0;

function viewport() {
  const { width, height } = mapSize();
  return new WebMercatorViewport({ ...viewState, width, height });
}

// Keep the view on the study area (the extent of the collisions, plus a margin).
function clampView(next) {
  const bounds = META.bounds;
  if (!bounds) return next;
  const marginLon = Math.max(0.02, (bounds[1][0] - bounds[0][0]) * 0.25);
  const marginLat = Math.max(0.02, (bounds[1][1] - bounds[0][1]) * 0.25);
  return {
    ...next,
    zoom: Math.max(overviewZoom - 0.6, Math.min(18, next.zoom)),
    longitude: Math.max(bounds[0][0] - marginLon, Math.min(bounds[1][0] + marginLon, next.longitude)),
    latitude: Math.max(bounds[0][1] - marginLat, Math.min(bounds[1][1] + marginLat, next.latitude)),
    pitch: 0,
    bearing: 0,
  };
}

function setView(next, animate) {
  cancelAnimationFrame(cameraFrame);
  cameraFrame=0;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = clampView({
    ...viewState,
    ...next,
    transitionDuration: 0,
    transitionInterpolator: undefined,
  });
  const apply = camera => {
    viewState=camera;
    deck.setProps({viewState});
    hideTip();
    scheduleFrame();
  };
  if(!animate||reduce){apply(target);return;}
  // One interruptible camera animation. A second selection starts from the
  // currently displayed camera, without restarting deck.gl's transition loop.
  const start={...viewState}, started=performance.now();
  const step=now=>{
    const t=Math.min(1,(now-started)/650);
    const eased=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    apply({...target,
      longitude:start.longitude+(target.longitude-start.longitude)*eased,
      latitude:start.latitude+(target.latitude-start.latitude)*eased,
      zoom:start.zoom+(target.zoom-start.zoom)*eased});
    cameraFrame=t<1?requestAnimationFrame(step):0;
  };
  cameraFrame=requestAnimationFrame(step);
}

function fitBounds(bounds, animate = true) {
  const { width, height } = mapSize();
  const card = $("card");
  let right = card.hidden ? 30 : card.offsetWidth + 36;
  if (width - right - 40 < 120) right = 30;
  const small = height < 260;
  const fit = new WebMercatorViewport({ width, height }).fitBounds(bounds, {
    padding: { top: small ? 10 : 50, bottom: small ? 10 : (state.hex&&state.selA?Math.min(155,height*.32):40), left: 40, right },
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
  const records = comparisonSelections().flatMap(selPoints);
  if (records.length) fitBounds(boundsOf(records));
}

// Point size grows a little as you zoom in.
const pointRadius = () => Math.max(2.4, Math.min(6, 2.4 + (viewState.zoom - overviewZoom) * 0.9));

function pointColor(record) {
  return state.hex || state.colorBy === "sev" ? SEVERITY_RGB[record.sev - 1] : (META.yearColors[record.yr] || [128, 128, 128]);
}
let SEVERITY_RGB = [[122, 26, 20], [216, 73, 43], [242, 154, 91]];

// Fixed geographical hexagons; zoom and pan never change membership.
let ringRecord = null; // collision shown in the details panel

function buildLayers() {
  const layers = [basemap];
  const A = state.selA ? new Set(selPoints(state.selA).map((r) => r.i)) : null;
  const B = state.selB ? new Set(selPoints(state.selB).map((r) => r.i)) : null;
  const extraIds=new Set(state.extraAreas.filter(Boolean).flatMap(selPoints).map(r=>r.i));
  const anySelection = Boolean(A || B || extraIds.size);
  const scopeIds=analysisScopeIds();
  const selRgb = hexToRgb(css("--sel"));
  const cmpRgb = hexToRgb(css("--cmp"));
  const inkRgb = hexToRgb(css("--text"));
  const selectionKey = version;
  const activePatternIds=state.patternHighlight?new Set((patternRecords()||[]).map(r=>r.i)):null;

  if (state.hex) {
    layers.push(new PolygonLayer({
      // Different identities prevent polygon tessellation/colour buffers from
      // being reused between the count and year-difference representations.
      id: state.temporal.mode==="compare" ? "hexagons-compare" : "hexagons-selected-years",
      data: temporalData,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => activePatternIds&&!d.members.some(i=>activePatternIds.has(i)) ? d.fill.slice(0,3).concat(18) : state.groupFocus&&state.temporal.mode==="compare"&&d.group!==state.groupFocus ? d.fill.slice(0,3).concat(30) : d.fill,
      stroked: true,
      getLineColor: (d) => {
        if(activePatternIds&&!d.members.some(i=>activePatternIds.has(i)))return [255,254,250,25];
        if((state.selA?.hexIds||[state.selA?.hexId]).includes(d.id))return selRgb;
        if((state.selB?.hexIds||[state.selB?.hexId]).includes(d.id))return cmpRgb;
        if(state.extraAreas.some(s=>(s?.hexIds||[s?.hexId]).includes(d.id)))return [83,105,77];
        if(state.groupFocus&&state.temporal.mode==="compare"&&d.group!==state.groupFocus)return [255,254,250,60];
        return state.temporal.mode==="compare"&&d.delta===0?[76,84,89,210]:[255,254,250,180];
      },
      getLineWidth: (d) => ([...(state.selA?.hexIds||[state.selA?.hexId]),...(state.selB?.hexIds||[state.selB?.hexId]),...state.extraAreas.flatMap(s=>s?.hexIds||[s?.hexId])].includes(d.id) ? 2.5 : (state.temporal.mode==="compare"&&d.delta===0?0.9:0.65)),
      updateTriggers:{getFillColor:version,getLineColor:version,getLineWidth:version},
      lineWidthUnits: "pixels",
      pickable: true,
    }));
  }

  // Hotspot outlines (also the click / hover target for a hotspot).
  layers.push(new PolygonLayer({
    id: "hotspots",
    data: state.hex ? [] : hotspotPolygons,
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
  const areas = [[state.selA, selRgb], [state.selB, cmpRgb],...state.extraAreas.map(s=>[s,[83,105,77]])]
    .filter(([sel]) => sel && sel.type === "area")
    .flatMap(([sel, rgb]) => (sel.polys||[sel.poly]).map(polygon=>({polygon,rgb})));
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

  if (!state.hex || state.showPoints || anySelection || state.patternHighlight) {
    const radius = pointRadius();
    const metric=POINT_PATTERNS.find(m=>m.label===state.patternHighlight?.label);
    const highlighted=r=>!metric || ((!scopeIds||scopeIds.has(r.i)) && inFocusedGroup(r) && (state.patternHighlight.other ? !metric.test(r) : metric.test(r)));
    layers.push(new ScatterplotLayer({
      id: state.hex ? `selected-collisions-${version}` : "collisions",
      // Slight first, so serious and fatal collisions are drawn on top.
      // Details on demand: reveal the actual collision locations in selected
      // hexagons or drawn areas without replacing the geographical overview.
      data: drawOrder.filter(r=>!state.hex||state.showPoints||A?.has(r.i)||B?.has(r.i)||extraIds.has(r.i)||(metric&&highlighted(r))).sort((a,b)=>Number(highlighted(a))-Number(highlighted(b))||b.sev-a.sev),
      getPosition: (r) => r.position,
      getRadius: (r) => ((A && A.has(r.i)) || (B && B.has(r.i)) ? radius + 0.6 : radius) + (metric&&highlighted(r)?2:0),
      radiusUnits: "pixels",
      getFillColor: (r) => pointColor(r).concat(!highlighted(r)?24:242),
      stroked: true,
      getLineColor: r=>[255,254,250,highlighted(r)?230:20],
      getLineWidth: () => 0.8,
      lineWidthUnits: "pixels",
      pickable: true,
      parameters:{depthCompare:"always",depthWriteEnabled:false},
      updateTriggers: {
        getPosition:selectionKey,
        getRadius: [selectionKey, radius],
        getFillColor: [selectionKey, state.colorBy],
        getLineWidth: [selectionKey], getLineColor:selectionKey,
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
  if ((layer?.id === "collisions" || layer?.id.startsWith("selected-collisions-")) && object) {
    changed = state.hoverPt !== object.i || state.hoverHs !== null;
    state.hoverPt = object.i;
    state.hoverHs = null;
    showTip(x, y, tipFor(object));
  } else if (layer?.id === "hotspots" && object) {
    changed = state.hoverHs !== object.h.id || state.hoverPt !== null;
    state.hoverHs = object.h.id;
    state.hoverPt = null;
    showTip(x, y, `<b>${escapeHtml(hotspotName(object.h))}</b><span>${object.n} collisions · ${Math.round(object.ksi)}% KSI · click to select</span>`);
  } else if (layer?.id.startsWith("hexagons-") && object) {
    showTip(x, y, `<b>${escapeHtml(hexName(object,true))}</b><span>${state.temporal.mode==="compare"?`${state.temporal.from}: ${object.baselineBefore??object.before} collisions · ${state.temporal.to}: ${object.baselineAfter??object.after} collisions<br>${differenceWords(object.delta)}<br>${object.before+object.after} match the active years and filters`:`${object.after} collisions in ${selectedYearWords(state.temporal)}`}<br>Click for the area profile and records.</span>`);
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
  if ((layer?.id === "collisions" || layer?.id.startsWith("selected-collisions-")) && object) {
    const sameLocation = F.filter((r) => r.lon === object.lon && r.lat === object.lat);
    details.open(object, sameLocation);
    return;
  }
  if (layer?.id.startsWith("hexagons-") && object) { selectHex(object.id); return; }
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
    cancelAnimationFrame(cameraFrame);
    cameraFrame=0;
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
  // Town and street names come from the basemap itself, so none are drawn here.

  // Hotspot rank numbers (top 10, plus selected / hovered)
  (state.hex ? [] : stats).forEach((s) => {
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
      }, overlay, `${hotspotName(s.h)} · ${s.n} collisions · ${Math.round(s.ksi)}% KSI`);
    }
  });

  const overlayPatternIds=state.patternHighlight?new Set((patternRecords()||[]).map(r=>r.i)):null;
  if(state.hex)temporalRank.forEach((b,i)=>{
    const opacity=overlayPatternIds && !b.members.some(i=>overlayPatternIds.has(i)) ? 0.15 : 1;
    const [x,y]=vp.project(b.centre);
    if(x<0||y<0||x>width||y>height)return;
    svgEl("circle",{opacity,cx:x,cy:y,r:9,fill:css("--paper"),stroke:css("--text"),"stroke-width":1},overlay);
    svgEl("text",{opacity,x,y:y+3.5,"text-anchor":"middle","font-size":10,"font-weight":700},overlay,i+1);
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
  setSelection({ type: "area", tool, poly, ids, centre: [lon, lat] });
});

// --------------------------------------------------
// Tooltip
// --------------------------------------------------
function tipFor(r) {
  return `<b>${SEVERITY_NAMES[r.sev - 1]} · ${USERS[r.user].toLowerCase()}</b><span>${escapeHtml(r.date)} · ${escapeHtml(r.time)}</span>
    <dl><dt>Casualties</dt><dd>${r.cas}</dd><dt>Vehicles</dt><dd>${r.veh}</dd>
    <dt>Speed limit</dt><dd>${r.spd >= 0 ? `${META.speeds[r.spd]} mph` : "—"}</dd><dt>Light</dt><dd>${LIGHT[r.light]}</dd>
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
  spd: (v) => `${META.speeds[v]} mph`,
  yr: (v) => String(v),
  cell: (v) => {
    const [d, h] = v.split("-");
    return `${DAYS[d]} ${String(h).padStart(2, "0")}:00`;
  },
};

function yearRange() {
  const years = META.years;
  return years.length > 1 ? `${years[0]} – ${years[years.length - 1]}` : String(years[0] ?? "");
}

function renderHeader() {
  $("kpi-n").textContent = fmt(F.length);
  const count = Object.entries(state.filters).reduce((sum, [key,set]) => sum + (state.hex&&key==="yr"?0:key==="cell"?Number(set.size>0):set.size), 0);
  $("kpi-sub").textContent = count
    ? `of ${fmt(P.length)} · ${count} filter${count > 1 ? "s" : ""} active`
    : state.hex ? (state.temporal.mode==="compare"?`${state.temporal.from} and ${state.temporal.to} combined`:`Years ${selectedYearWords(state.temporal)}`) : `${yearRange()} · all collisions`;

  let html = "";
  if (state.selA) html += `<span class="chip sel">Area: ${escapeHtml(selName(state.selA))}<button type="button" data-clear="A" aria-label="Clear selected area">×</button></span>`;
  if (state.selB) html += `<span class="chip cmp">Compare: ${escapeHtml(selName(state.selB))}<button type="button" data-clear="B" aria-label="Clear compared area">×</button></span>`;
  Object.entries(state.filters).filter(([key])=>!state.hex||key!=="yr").forEach(([key,set])=>{
    if(key==='cell'&&set.size>1){
      const values=[...set].map(v=>v.split('-').map(Number));
      const ds=[...new Set(values.map(v=>v[0]))].sort((a,b)=>a-b),hs=values.map(v=>v[1]);
      const label=`${ds.map(d=>DAYS[d]).join(', ')} · ${String(Math.min(...hs)).padStart(2,'0')}:00–${String(Math.max(...hs)+1).padStart(2,'0')}:00 (${set.size} time cells)`;
      html+=`<span class="chip">${label}<button type="button" data-clear-time aria-label="Clear time selection">×</button></span>`;return;
    }
    set.forEach(value=>{html+=`<span class="chip">${escapeHtml(FILTER_LABEL[key](value))}<button type="button" data-unfilter="${key}|${value}" aria-label="Remove filter">×</button></span>`;});
  });
  if (count) html += `<span class="chip clear"><button type="button" data-clear-all="1">Clear all filters</button></span>`;
  $("chips").innerHTML = html;


}

function renderTemporal() {
  const controls=$("temporal-controls"),caption=$("time-map-caption");
  if(!controls)return;
  controls.hidden=!state.hex;caption.hidden=!state.hex;
  if(!state.hex)return;
  const wasOpen=controls.querySelector("details")?.open;
  controls.innerHTML=temporalControls(META,state,temporalTotals);
  if(wasOpen)controls.querySelector("details").open=true;
  caption.innerHTML=temporalLegend(state,temporalData,temporalCountMax,SEVERITY_RGB,comparisonDeltaMax);
}

function renderRank() {
  $("rank").classList.toggle("time-list",state.hex);
  document.querySelector(".side-body .sec-h h2").textContent=state.hex?(state.temporal.mode==="compare"?"Where collisions increased or decreased":"Where most collisions occurred"):"Where to look first";
  if(state.hex){
    $("hs-count").textContent=`${temporalData.length} areas`;
    $("hs-hint").textContent=state.temporal.mode==="compare"?`${temporalData.filter(b=>b.delta>0).length} areas recorded more collisions; ${temporalData.filter(b=>b.delta<0).length} recorded fewer. Largest differences are listed below. Numbers match the map.`:`Areas with the most recorded collisions in ${selectedYearWords(state.temporal)}. Numbers match the map.`;
    $("rank").innerHTML=temporalList(temporalRank,state,hexName);
    return;
  }
  $("hs-hint").textContent=`Dense collision areas across all years (DBSCAN: ${META.hotspots.minCollisions} collisions within ${META.hotspots.radiusMetres} m).`;

  $("hs-count").textContent = `${stats.length} ${stats.length === 1 ? "area" : "areas"}`;
  $("rank").innerHTML = stats.map((s) => {
    const max = Math.max(1, ...s.yrs);
    const up = s.rising > 0;
    const stepX = s.yrs.length > 1 ? 55 / (s.yrs.length - 1) : 0;
    const line = s.yrs.map((v, j) => `${2 + j * stepX},${17 - (v / max) * 13}`).join(" ");
    const cls = state.selA?.type === "hotspot" && state.selA.id === s.h.id ? "sel"
      : state.selB?.type === "hotspot" && state.selB.id === s.h.id ? "cmp"
      : state.hoverHs === s.h.id ? "hov" : "";
    const trendColor = up ? "var(--risk)" : "var(--muted)";
    return `<li data-hs="${s.h.id}" class="${cls}" tabindex="0">
      <span class="rk">${s.rank}</span>
      <div class="nm">${escapeHtml(hotspotName(s.h))}
        <div class="mini"><span><i style="width:${Math.round(s.ksi * 0.55)}px;background:var(--risk)"></i>${Math.round(s.ksi)}% KSI</span>
        <span><i style="width:${Math.round(s.ped * 0.55)}px;background:var(--muted)"></i>${Math.round(s.ped)}% ped.</span></div></div>
      <div class="ct">${s.n}<svg width="60" height="20" aria-label="Collisions per year, ${yearRange()}"><polyline points="${line}" fill="none" stroke="${trendColor}" stroke-width="1.5"/>
        <circle cx="${2 + (s.yrs.length - 1) * stepX}" cy="${17 - (s.yrs[s.yrs.length - 1] / max) * 13}" r="2" fill="${trendColor}"/></svg></div>
    </li>`;
  }).join("") || '<li class="empty"><span class="hint">No hotspot has collisions matching these filters.</span></li>';
  document.querySelectorAll("#sort [data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
}

// --------------------------------------------------
// Selected-area card
// --------------------------------------------------
function renderCard() {
  const card = $("card");
  const pattern=patternRecords();
  card.hidden=state.hex&&!state.selA&&!pattern;
  if (!state.selA && !pattern) {
    card.className = "card empty";
    card.innerHTML = `<div class="k">Start here</div><h3>Select an area to see what makes it different</h3>
      <ol><li>Click a hotspot in the list or on the map, or</li><li>choose <b>Lasso area</b> or <b>Box</b> and draw on the map.</li><li>Click chart bars to filter everything at once.</li></ol>`;
    return;
  }
  card.className = "card";
  const A = pattern || selPoints(state.selA);
  const B = !pattern && state.selB ? selPoints(state.selB) : null;
  const reference = B || (pattern ? F.filter(inFocusedGroup).filter(r=>!analysisScopeIds()||analysisScopeIds().has(r.i)) : F);
  const referenceLabel = B ? selName(state.selB) : pattern&&state.selA ? selName(state.selA) : "all matching collisions";
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
      ? `This area looks like ${B ? escapeHtml(referenceLabel) : "the rest of ${escapeHtml(META.name)}"}; nothing stands out by more than 5 points.`
      : `<b>Stands out:</b> ${top.label.toLowerCase()} in ${Math.round(top.v)}% of collisions vs ${Math.round(top.r)}% ${B ? `in ${escapeHtml(referenceLabel)}` : "overall"}${ratio >= 1.6 ? ` (${ratio.toFixed(1)}×)` : ""}.`;

  const stat = (value, label, other) => `<div><b>${value}</b><span>${label}</span>${b ? `<div class="b2">${other}</div>` : ""}</div>`;
  card.innerHTML = `<div class="k">${pattern?"Selected circumstance":state.selA.type === "hotspot" ? "Selected hotspot" : `Selected area · ${state.selA.tool}`}</div>
    <h3>${escapeHtml(pattern?patternName():selName(state.selA))}${B ? `<small>compared with ${escapeHtml(referenceLabel)}</small>` : ""}</h3>
    ${!pattern&&state.selA?.hexId?(()=>{const b=temporalData.find(b=>b.id===state.selA.hexId);return b?`<p class="time-summary"><b>${state.temporal.mode==="compare"?differenceWords(b.delta):`${b.after} collisions in ${selectedYearWords(state.temporal)}`}</b>Matching collisions by year: ${META.years.map((y,i)=>`${y}: ${b.counts[i]}`).join(" · ")}</p>`:"";})():""}
    ${!A.length?'<p class="time-summary">No collisions in this area match the selected years and filters. Clear a filter to see more records.</p>':""}
    <div class="stats">
      ${stat(a.n, "collisions", b?.n)}${stat(a.cas, "casualties", b?.cas)}${stat(`${a.k}%`, "KSI", `${b?.k}%`)}${stat(a.f, "fatal", b?.f)}
    </div>
    <div class="prof-h"><span>Compared with ${escapeHtml(referenceLabel)}</span><span>dashed line = ${B ? "compared area" : "average"}</span></div>
    ${profile}
    <p class="standout">${standout}</p>
    ${state.hex?`<p class="hint">Click a collision point for full details.</p>`:""}
    ${!pattern&&state.hex?`<div class="group-hex-controls"><label><input id="multi-hex" type="checkbox" ${state.multiHex?"checked":""}> Select multiple hexagons</label>${state.multiHex?`<label>Add to <select id="hex-target"><option value="A">Area 1</option><option value="B" ${state.editArea==="B"?"selected":""}>Area 2</option>${state.extraAreas.map((a,i)=>`<option value="C${i}" ${state.editArea===`C${i}`?"selected":""}>Area ${i+3}</option>`).join("")}</select></label>`:""}</div>`:""}
    <div class="btns">
      <button type="button" class="btn primary" data-card="table">Show these ${a.n} in a table</button>
      ${!pattern?`<button type="button" class="btn" data-card="compare">${state.selB ? "Change comparison" : state.pickB ? "Picking… (Esc to cancel)" : "Compare with…"}</button>`:""}
      ${!pattern&&state.selB?`<button type="button" class="btn" data-card="add-area">${state.pickExtra?'Pick another area…':'Add another area'}</button><button type="button" class="btn" data-card="save-comparison">Save comparison</button>`:''}
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
  drawer.hidden = !state.drawer || (!state.selA&&!state.patternHighlight);
  $("map-pane").classList.toggle("has-drawer", !drawer.hidden);
  if (drawer.hidden) return;
  const rows = (patternRecords() || selPoints(state.selA)).slice();
  const { key, dir } = state.tableSort;
  rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
  $("drawer-title").textContent = `${rows.length} collisions · ${state.patternHighlight?patternName():selName(state.selA)}`;
  $("thead").innerHTML = `<tr>${COLUMNS.map(([k, label]) => `<th><button type="button" data-table-sort="${k}">${label}${k === key ? (dir > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("")}</tr>`;
  $("tbody").innerHTML = rows.map((r) => `<tr data-record="${r.i}">
    <td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.time)}</td>
    <td><span class="dot" style="background:rgb(${SEVERITY_RGB[r.sev - 1].join(",")});margin-right:6px"></span>${SEVERITY_NAMES[r.sev - 1]}</td>
    <td>${r.cas}</td><td>${USERS[r.user]}</td><td>${r.spd >= 0 ? META.speeds[r.spd] : "—"}</td><td>${LIGHT[r.light]}</td><td>${escapeHtml(r.road)}</td></tr>`).join("");
}

// --------------------------------------------------
// Charts
// --------------------------------------------------
function chartContext() {
  const grouped=state.hex&&state.temporal.mode==="compare";
  const analysisPasses=(r,skip)=>passes(r,skip)&&(!grouped||inFocusedGroup(r));
  return {
    records:P, passes:analysisPasses, filters:state.filters,
    selA:(patternRecords()||selPoints(state.selA)).filter(r=>analysisPasses(r)),
    selB:!state.patternHighlight&&state.selB?selPoints(state.selB).filter(r=>analysisPasses(r)):null,
    hasSelection: Boolean(state.selA||state.patternHighlight),
    selectionLabel:state.patternHighlight?"Circumstance":"Area",
    areaRecords: skip => (patternRecords()||selPoints(state.selA)).filter(r => analysisPasses(r, skip)),
    comparedRecords: skip => selPoints(state.selB).filter(r => analysisPasses(r, skip)),
    toggle:toggleFilter,color:css,
    pattern:state.patternHighlight,selectPattern:togglePattern,
    selectTimeCells: (keys,add) => {state.filters.cell=add?new Set([...state.filters.cell,...keys]):new Set(keys);update();},
  };
}
function patternRecords(){
  const metric=POINT_PATTERNS.find(m=>m.label===state.patternHighlight?.label);
  if(!metric)return null;
  const ids=analysisScopeIds();
  return F.filter(r=>(!ids||ids.has(r.i))&&inFocusedGroup(r)&&(state.patternHighlight.other?!metric.test(r):metric.test(r)));
}
function patternName(){return state.patternHighlight ? `${state.patternHighlight.other?'Other collisions: ':''}${state.patternHighlight.label}` : '';}
function togglePattern(label) {
  state.patternHighlight=state.patternHighlight?.label===label?null:{label,other:false};
  update();
}
function renderGroups() {
  const root=$("group-analysis");if(!root)return;
  root.hidden=!state.hex;if(root.hidden)return;
  const scope=state.selA?{ids:analysisScopeIds(),label:state.selB?"compared areas":selName(state.selA)}:null;
  const records=F.filter(inFocusedGroup);
  const selectedRecords=scope?records.filter(r=>scope.ids.has(r.i)):records;
  if(state.selA&&state.selB){
    renderComparison(root,{state,areas:comparisonSelections().map((s,i)=>({name:selName(s),selection:s,records:selPoints(s),index:i})),
      onPattern:togglePattern,onAdd:()=>{state.pickExtra=true;state.pickB=false;state.mode='select';renderCard();renderNote();},
      onFocus:i=>{const records=selPoints(comparisonSelections()[i]);if(records.length)fitBounds(boundsOf(records));},
      onRemove:i=>{const areas=comparisonSelections();areas.splice(i,1);state.selA=areas[0]||null;state.selB=areas[1]||null;state.extraAreas=areas.slice(2);state.editArea='A';update();},onSave:saveComparison});
  } else if(state.temporal.mode!=="compare"){
    renderSelectedYearsAnalysis(root,{state,records:selectedRecords,areas:geographicalHexagons,scope,
      areaName:b=>b.road?`Near ${b.road}`:"Local roads",onArea:selectHex,onPattern:togglePattern});
  } else {
    renderGroupAnalysis(root,{groups:groupProfiles,state,year:state.temporal.to,scope,records,
      allMatching:new Set(selectedRecords.map(r=>r.i)),recordById:new Map(P.map(r=>[r.i,r])),
      areaName:b=>b.road?`Near ${b.road}`:"Local roads",onArea:selectHex,onPattern:togglePattern,
      onFocus:id=>{state.groupFocus=id;state.patternGroup=id;state.selA=state.selB=null;state.extraAreas=[];state.pickExtra=false;state.pickB=false;state.drawer=false;state.patternHighlight=null;update();fitBounds(META.bounds);}
    });
  }
  const hint=document.createElement('div');hint.className='pattern-highlight-control';
  const metric=POINT_PATTERNS.find(m=>m.label===state.patternHighlight?.label);
  if(metric){
    const n=selectedRecords.filter(r=>state.patternHighlight.other?!metric.test(r):metric.test(r)).length;
    hint.innerHTML=`<span><b>${n} points emphasised</b> · ${escapeHtml(metric.label)} ${state.patternHighlight.other?'— other collisions':'— matching collisions'}</span><button data-pattern-other>${state.patternHighlight.other?'Highlight matching':'Highlight the others'}</button><button data-pattern-clear>Clear highlight</button>`;
    hint.querySelector('[data-pattern-other]').onclick=()=>{state.patternHighlight.other=!state.patternHighlight.other;update();};
    hint.querySelector('[data-pattern-clear]').onclick=()=>{state.patternHighlight=null;update();};
  }else hint.textContent='Click a circumstance to highlight its collision points. Counts and filters stay unchanged.';
  root.querySelector('.pattern-changes').after(hint);
}
function saveComparison(){
  if(!state.selA||!state.selB)return;
  const id=state.nextAreaNumber++;
  state.savedComparisons.push({id,name:comparisonSelections().map(selName).join(" vs "),
    snapshot:structuredClone({selA:state.selA,selB:state.selB,extraAreas:state.extraAreas,temporal:state.temporal,filters:state.filters,hex:state.hex,groupFocus:state.groupFocus,patternGroup:state.patternGroup})});
  renderAreaWorkspace();
}
function renderAreaWorkspace(){
  const root=$('saved-comparisons');if(!root)return;
  renderSavedComparisons(root,{state,
    onLoad:id=>{
      const saved=state.savedComparisons.find(a=>a.id===id);if(!saved)return;
      const snapshot=structuredClone(saved.snapshot);
      if(snapshot.temporal.size!==state.temporal.size){geographicalHexagons=buildConcentrations(P,META.years,snapshot.temporal.size);classificationKey='';}
      Object.assign(state,snapshot);state.hex=true;state.patternHighlight=null;state.multiHex=false;state.editArea='A';state.pickB=false;state.pickExtra=false;state.drawer=false;
      update();zoomToSelection();
    },
    onRemove:id=>{state.savedComparisons=state.savedComparisons.filter(a=>a.id!==id);renderAreaWorkspace();}
  });
}

function renderCharts() {
  const ctx=chartContext(),ids=analysisScopeIds();
  const geo=r=>(!ids||ids.has(r.i))&&(!state.hex||inFocusedGroup(r));
  const metric=state.patternHighlight?POINT_PATTERNS.find(m=>m.label===state.patternHighlight.label):null;
  const condition=r=>!metric||(state.patternHighlight.other?!metric.test(r):metric.test(r));
  const annual=P.filter(r=>passes(r,['yr','user'])&&geo(r)&&condition(r));
  const scope=state.selB?`${comparisonSelections().length} selected areas`:state.selA?selName(state.selA):state.groupFocus?`${state.groupFocus==='same'?'Same-count':state.groupFocus==='more'?'More-collision':'Fewer-collision'} areas`:'All Calderdale';
  const showYear=year=>{state.temporal.mode='year';state.temporal.years=new Set([year]);state.groupFocus=null;state.patternGroup=null;update();};
  renderUserYears($('risk-chart'),{records:annual,years:[...state.filters.yr].sort((a,b)=>a-b).length?[...state.filters.yr].sort((a,b)=>a-b):META.years,activeYears:state.filters.yr,scope:scope+(metric?` · ${patternName()}`:''),users:USERS,activeUsers:state.filters.user,onUser:u=>toggleFilter('user',u),onYear:showYear,areaScopes:state.selB?comparisonSelections().map(sel=>({name:selName(sel),records:P.filter(r=>passes(r,['yr','user'])&&selectionIds(sel).includes(r.i)&&condition(r))})):null});
  renderConditions($('condition-chart'),{records:F.filter(geo),scope,years:[...state.filters.yr].sort((a,b)=>a-b),active:state.patternHighlight,onPattern:togglePattern});
  renderSpeed($('speed-chart'),ctx);
  renderHeat($('heat-chart'),ctx);
  const profileMetric=metric?.learnedProfile;
  const profileRecords=F.filter(r=>geo(r)&&(profileMetric||condition(r)));
  const areas=state.selB?comparisonSelections().map(sel=>({name:selName(sel),ids:new Set(selectionIds(sel))})):[{name:scope,ids:null}];
  const years=[...state.filters.yr].sort((a,b)=>a-b);
  const cells=areas.flatMap(a=>(state.temporal.mode==='compare'?years:[null]).map(y=>({label:`${a.name} · ${y??years.join(', ')}`,ids:profileRecords.filter(r=>(!a.ids||a.ids.has(r.i))&&(y===null||r.yr===y)).map(r=>String(r.feature.properties.collision_index))})));
  renderProfiles({cells,active:state.patternHighlight?.label,onReset:()=>{state.patternHighlight=null;update();},onProfile:(label,members)=>{
    let p=POINT_PATTERNS.find(p=>p.label===label);
    if(!p){p={label,learnedProfile:true};POINT_PATTERNS.push(p);}
    p.test=r=>members.has(String(r.feature.properties.collision_index));
    togglePattern(label);
  }});
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
  const quiet=state.hex&&state.mode==="select"&&!state.pickB&&!state.pickExtra&&!noteOverride;
  note.hidden=quiet;
  const caption=$("time-map-caption");
  if(caption)caption.hidden=!state.hex;
  note.classList.toggle("alert", state.pickB);
  note.textContent = noteOverride
    || (state.pickExtra ? "Add another area: click a hexagon or draw a box/lasso. Then group more hexagons if needed." : state.pickB ? "Pick a second area to compare: click a hotspot, a row in the list, or draw a lasso or box."
      : state.mode === "lasso" ? "Drag on the map to draw around an area."
      : state.mode === "box" ? "Drag on the map to draw a box."
      : state.hex ? "Each hexagon is a fixed geographical area. Hover for counts; click for severity, road users and conditions."
      : "Drag to pan, scroll to zoom. Hover a point for a summary, click it for full details. Click a hotspot outline to select it.");
  noteOverride = "";
  const A = selPoints(state.selA);
  const chartYears = [...state.filters.yr].sort((a,b)=>a-b);
  const yearLabel = chartYears.length ? chartYears.join(', ') : META.years.join(', ');
  const scopeLabel = state.hex && state.temporal.mode === "compare" && state.groupFocus
    ? areaClassification.groups.find(g=>g.id===state.groupFocus).label.toLowerCase() + " areas"
    : "all areas";
  $("an-status").textContent = `${yearLabel}${chartYears.length>1?" combined":""} · Overall: ${scopeLabel}`
    + (state.patternHighlight?` · Selected circumstance: ${patternName()}`:state.selA ? ` · Selected: ${selName(state.selA)}` : "");
  $("leg-b").hidden = !state.selB||Boolean(state.patternHighlight);
  document.querySelectorAll(".tool[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  $("show-bin-points").hidden=!state.hex;
  $("show-bin-points").checked=state.showPoints;
  $("points-switch").hidden=!state.hex;
  overlay.classList.toggle("drawing", state.mode !== "select");
}

// --------------------------------------------------
// Render everything from the state
// --------------------------------------------------
function renderAll() {
  renderHeader();
  renderTemporal();
  renderRank();
  renderCard();
  renderGroups();
  renderAreaWorkspace();
  renderCharts();
  renderTable();
  renderNote();
  scheduleFrame();
}

function update() {
  if(state.hex)state.filters.yr=new Set(state.temporal.mode==="compare"?[state.temporal.from,state.temporal.to]:[...state.temporal.years]);
  version += 1;
  recompute();
  // No selected outline, points or table from an excluded year/filter may leak
  // into the next analytical view. Fixed grid geometry stays shared; data does not.
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
$("show-bin-points").addEventListener("change", event => {state.showPoints=event.target.checked;update();});
const rank = $("rank");
rank.addEventListener("click", (event) => {
  const hex=event.target.closest("[data-hex]")?.dataset.hex;
  if(hex){selectHex(hex);return;}
  const id = event.target.closest("[data-hs]")?.dataset.hs;
  if (id != null) selectHotspot(Number(id));
});
rank.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const hex=event.target.closest("[data-hex]")?.dataset.hex;
  if(hex){event.preventDefault();selectHex(hex);return;}
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
  if(event.target.closest("[data-clear-time]")){state.filters.cell.clear();update();return;}
  const clear = event.target.closest("[data-clear]")?.dataset.clear;
  if(clear==='A'||clear==='B'){
    const areas=comparisonSelections();areas.splice(clear==='A'?0:1,1);
    if(!areas.length){clearSelection();return;}
    state.selA=areas[0];state.selB=areas[1]||null;state.extraAreas=areas.slice(2);state.editArea='A';state.pickB=false;state.pickExtra=false;state.patternHighlight=null;update();return;
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

$("card").addEventListener("change", event=>{
  if(event.target.id==='multi-hex'){state.multiHex=event.target.checked;state.mode='select';update();}
  if(event.target.id==='hex-target'){state.editArea=event.target.value;update();}
});
$("card").addEventListener("click", (event) => {
  const action = event.target.closest("[data-card]")?.dataset.card;
  if (action === "table") {
    state.drawer = true;
    renderTable();
  } else if (action === "compare") {
    state.pickB = true;
    state.editArea="B";
    state.selB = null;
    update();
  } else if (action === "zoom") {
    const points=patternRecords();if(points?.length)fitBounds(boundsOf(points));else zoomToSelection();
  } else if (action === "add-area") {
    state.pickExtra=true;state.pickB=false;state.mode="select";renderCard();renderNote();
  } else if (action === "save-comparison") {
    saveComparison();
  } else if (action === "clear") {
    if(state.patternHighlight){state.patternHighlight=null;update();}else clearSelection();
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
$("zoom-home").addEventListener("click", () => fitBounds(META.bounds));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (drawing) {
    drawing = null;
    drawOverlay();
  } else if (state.pickB||state.pickExtra) {
    state.pickB = false;state.pickExtra=false;
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
  try {
    P = await loadAllData((progress) => {
      $("loading").textContent = `Loading collision data… ${Math.round(progress * 100)}%`;
    });
  } catch (error) {
    console.error(error);
    $("loading").textContent = "Could not load the data. Check public/dataset.json and the data files it lists, then reload the page.";
    return;
  }
  if (!P.length) {
    $("loading").textContent = "The data files contain no collisions with coordinates.";
    return;
  }
  // Area name and period from the settings file.
  document.title = `IncidentVis · ${META.name} collisions`;
  $("area-label").textContent = `${META.name} / ${yearRange()}`;
  $("zoom-home").setAttribute("aria-label", `Show all of ${META.name}`);

  namer = createPlaceNamer({ enabled: META.useOpenStreetMap, onName: () => renderAll() });
  HS = [];
  setView(overviewView(), false);
  $("hs-hint").textContent = `Dense collision areas, found automatically (DBSCAN: at least ${META.hotspots.minCollisions} collisions within ${META.hotspots.radiusMetres} m). Hover a row to find it on the map. Click to select it.`;
  $("loading").hidden = true;
  const groupRoot=document.createElement("section");groupRoot.id="group-analysis";
  groupRoot.setAttribute("aria-label","Patterns across area groups");$("analysis").prepend(groupRoot);
  state.temporal.from=META.years[0];state.temporal.to=META.years.at(-1);state.temporal.years=new Set([state.temporal.to]);
  geographicalHexagons=buildConcentrations(P,META.years,state.temporal.size);
  const controls=document.createElement("section");controls.id="temporal-controls";
  controls.setAttribute("aria-label","Year comparison");$("chips").after(controls);
  const saved=document.createElement("section");saved.id="saved-comparisons";$("rank").after(saved);
  const caption=document.createElement("div");caption.id="time-map-caption";$("sidebar").append(caption);
  controls.addEventListener("click",event=>{
    const b=event.target.closest("button");if(!b)return;
    const hadSelection=Boolean(state.selA);
    cancelAnimationFrame(cameraFrame);cameraFrame=0;
    if(b.dataset.timeMode){state.temporal.mode=b.dataset.timeMode;state.groupFocus=null;state.patternGroup=null;}
    if(b.dataset.timeFrom){state.temporal.from=Number(b.dataset.timeFrom);state.groupFocus=null;state.patternGroup=null;}
    if(b.dataset.timeTo){state.temporal.to=Number(b.dataset.timeTo);state.groupFocus=null;state.patternGroup=null;}
    if(b.dataset.timeYears){const year=Number(b.dataset.timeYears);if(state.temporal.years.has(year)){if(state.temporal.years.size>1)state.temporal.years.delete(year);}else state.temporal.years.add(year);}
    if(b.dataset.timeAll)state.temporal.years=new Set(META.years);
    update();
    if(state.selA)zoomToSelection();
    else if(hadSelection)fitBounds(META.bounds);
  });
  controls.addEventListener("change",event=>{
    if(event.target.id!=="time-size")return;
    state.temporal.size=Number(event.target.value);classificationKey="";state.groupFocus=null;state.patternGroup=null;
    geographicalHexagons=buildConcentrations(P,META.years,state.temporal.size);
    state.selA=state.selB=null;state.extraAreas=[];state.pickExtra=false;update();
  });
  update();

}

start();
