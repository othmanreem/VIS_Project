// --------------------------------------------------
// Data loading
// Which data to load is described in public/dataset.json
// (area name, years, file name pattern, hotspot settings), so a
// different area or period only needs a different settings file.
// Everything else (map bounds, speed limits, year colours) is
// derived from the data itself.
//
// All years of collisions, vehicles and casualties are loaded once
// and joined on collision_index, so every view filters in memory.
// The grouping below follows the STATS19 coding used for all road
// collisions in Great Britain.
// --------------------------------------------------

// Grouped values used by the charts. Index = value stored on each record.
export const USERS = ["Vehicle occupant", "Pedestrian", "Cyclist", "Motorcyclist"];
export const LIGHT = ["Daylight", "Dark – lit", "Dark – unlit", "Dark – unknown"];
export const WEATHER = ["Fine", "Rain", "Snow / fog", "Other / unknown"];
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const SEVERITY_NAMES = ["Fatal", "Serious", "Slight"];

// Filled in by loadAllData() from the settings file and the data.
export const META = {
  name: "",
  years: [], // e.g. [2020, …, 2025]
  speeds: [], // speed limits present in the data, e.g. ["20", "30", …]
  bounds: null, // [[minLon, minLat], [maxLon, maxLat]] of all collisions
  yearColors: {}, // year → [r, g, b]
  hotspots: { radiusMetres: 120, minCollisions: 10 },
  useOpenStreetMap: true,
};

// Year colours, in year order (the first six are the original map colours).
const YEAR_PALETTE = [
  [230, 126, 34], [52, 152, 219], [46, 204, 113], [155, 89, 182], [241, 196, 15], [231, 76, 60],
  [22, 160, 133], [211, 84, 0], [41, 128, 185], [142, 68, 173], [127, 140, 141], [192, 57, 43],
];

const MOTORCYCLE_TYPES = new Set(["2", "3", "4", "5", "23", "97"]);
// STATS19 light_conditions → Daylight / Dark lit / Dark unlit / Dark unknown
const LIGHT_GROUP = { 1: 0, 4: 1, 5: 2, 6: 2, 7: 3 };
// STATS19 weather_conditions → Fine / Rain / Snow or fog / Other
const WEATHER_GROUP = { 1: 0, 4: 0, 2: 1, 5: 1, 3: 2, 6: 2, 7: 2 };
const ROAD_PREFIX = { 1: "M", 2: "A", 3: "A", 4: "B" };

const fetchCache = new Map();

export function fetchJson(url) {
  if (!fetchCache.has(url)) {
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${url}`);
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

function groupByCollision(features) {
  const index = new Map();
  for (const feature of features) {
    const props = feature.properties || {};
    if (!index.has(props.collision_index)) index.set(props.collision_index, []);
    index.get(props.collision_index).push(props);
  }
  return index;
}

// Most vulnerable road user among the casualties:
// pedestrian, then cyclist, then motorcyclist, then vehicle occupant.
function roadUserOf(casualties) {
  const types = casualties.map((c) => String(c.casualty_type));
  if (types.includes("0")) return 1;
  if (types.includes("1")) return 2;
  if (types.some((type) => MOTORCYCLE_TYPES.has(type))) return 3;
  return 0;
}

function hourOf(time) {
  const match = String(time ?? "").match(/^(\d{1,2})\s*:/);
  const hour = match ? Number(match[1]) : -1;
  return hour >= 0 && hour <= 23 ? hour : -1;
}

function isoDate(props) {
  if (props.date_iso) return String(props.date_iso);
  const match = String(props.date ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
}

function roadOf(props) {
  const prefix = ROAD_PREFIX[props.first_road_class];
  const number = String(props.first_road_number ?? "");
  return prefix && number && number !== "0" && number !== "-1" ? `${prefix}${number}` : "Unclassified";
}

function toRecord(feature, i, vehicles, casualties) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  return {
    i,
    feature,
    vehicles,
    casualties,
    lon,
    lat,
    position: [lon, lat],
    sev: Number(p.collision_severity),
    cas: Number(p.number_of_casualties) || casualties.length,
    veh: Number(p.number_of_vehicles) || vehicles.length,
    user: roadUserOf(casualties),
    yr: Number(p.collision_year),
    spd: META.speeds.indexOf(String(p.speed_limit)),
    light: LIGHT_GROUP[p.light_conditions] ?? 3,
    wx: WEATHER_GROUP[p.weather_conditions] ?? 3,
    hr: hourOf(p.time),
    // day_of_week in STATS19: 1 = Sunday … 7 = Saturday → 0 = Monday … 6 = Sunday
    dow: (Number(p.day_of_week) + 5) % 7,
    wet: ["2", "3", "4"].includes(String(p.road_surface_conditions)) ? 1 : 0,
    junc: ["0", "-1", "99"].includes(String(p.junction_detail)) ? 0 : 1,
    date: isoDate(p),
    time: String(p.time ?? "").slice(0, 5),
    road: roadOf(p),
  };
}

const fileFor = (pattern, year) => pattern.replaceAll("{year}", String(year));

export async function loadAllData(onProgress = () => {}) {
  // 1. Settings
  const config = await fetchJson("dataset.json");
  META.name = config.name || "Study area";
  META.years = (config.years || []).map(Number).sort((a, b) => a - b);
  META.hotspots = {
    radiusMetres: Number(config.hotspots?.radiusMetres) || 120,
    minCollisions: Number(config.hotspots?.minCollisions) || 10,
  };
  META.useOpenStreetMap = config.placeNames?.useOpenStreetMap !== false;
  META.years.forEach((year, i) => {
    META.yearColors[year] = YEAR_PALETTE[i % YEAR_PALETTE.length];
  });

  // 2. Data files for every year
  let done = 0;
  const total = META.years.length * 3;
  const step = (value) => {
    done += 1;
    onProgress(done / total);
    return value;
  };
  const perYear = await Promise.all(META.years.map((year) => Promise.all([
    fetchJson(fileFor(config.files.collisions, year)).then(step),
    fetchJson(fileFor(config.files.vehicles, year)).then(step),
    fetchJson(fileFor(config.files.casualties, year)).then(step),
  ])));

  // 3. Speed limits that actually occur, in numeric order
  const speeds = new Set();
  perYear.forEach(([collisions]) => collisions.features.forEach((feature) => {
    const value = Number(feature.properties?.speed_limit);
    if (value > 0) speeds.add(String(value));
  }));
  META.speeds = [...speeds].sort((a, b) => Number(a) - Number(b));

  // 4. One record per collision, joined with its vehicles and casualties
  const records = [];
  perYear.forEach(([collisions, vehicles, casualties]) => {
    const vehicleIndex = groupByCollision(vehicles.features);
    const casualtyIndex = groupByCollision(casualties.features);
    collisions.features
      .filter((feature) => feature.geometry && feature.geometry.coordinates)
      .forEach((feature) => {
        const key = feature.properties.collision_index;
        records.push(toRecord(
          feature,
          records.length,
          (vehicleIndex.get(key) || []).slice().sort((a, b) => Number(a.vehicle_reference) - Number(b.vehicle_reference)),
          (casualtyIndex.get(key) || []).slice().sort((a, b) => Number(a.casualty_reference) - Number(b.casualty_reference)),
        ));
      });
  });

  // 5. Map extent of all collisions
  if (records.length) {
    const bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];
    for (const r of records) {
      bounds[0][0] = Math.min(bounds[0][0], r.lon);
      bounds[0][1] = Math.min(bounds[0][1], r.lat);
      bounds[1][0] = Math.max(bounds[1][0], r.lon);
      bounds[1][1] = Math.max(bounds[1][1], r.lat);
    }
    META.bounds = bounds;
  }
  return records;
}
