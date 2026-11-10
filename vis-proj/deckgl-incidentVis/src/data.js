// --------------------------------------------------
// Data loading
// All six years of collisions, vehicles and casualties are
// loaded once at start-up and joined on collision_index, so
// every view filters in memory and the details panel opens
// without further requests.
// --------------------------------------------------
export const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

// Year colours (unchanged from the first version of the map).
export const YEAR_COLORS = {
  2020: [230, 126, 34],
  2021: [52, 152, 219],
  2022: [46, 204, 113],
  2023: [155, 89, 182],
  2024: [241, 196, 15],
  2025: [231, 76, 60],
};

// Grouped values used by the charts. Index = value stored on each record.
export const USERS = ["Vehicle occupant", "Pedestrian", "Cyclist", "Motorcyclist"];
export const LIGHT = ["Daylight", "Dark – lit", "Dark – unlit", "Dark – unknown"];
export const WEATHER = ["Fine", "Rain", "Snow / fog", "Other / unknown"];
export const SPEEDS = ["20", "30", "40", "50", "60", "70"];
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const SEVERITY_NAMES = ["Fatal", "Serious", "Slight"];

const MOTORCYCLE_TYPES = new Set(["2", "3", "4", "5", "23", "97"]);
// STATS19 light_conditions → Daylight / Dark lit / Dark unlit / Dark unknown
const LIGHT_GROUP = { 1: 0, 4: 1, 5: 2, 6: 2, 7: 3 };
// STATS19 weather_conditions → Fine / Rain / Snow or fog / Other
const WEATHER_GROUP = { 1: 0, 4: 0, 2: 1, 5: 1, 3: 2, 6: 2, 7: 2 };
const ROAD_PREFIX = { 1: "M", 2: "A", 3: "A", 4: "B" };

const fetchCache = new Map();

export function fetchGeoJson(url) {
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
  const speedIndex = SPEEDS.indexOf(String(p.speed_limit));
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
    spd: speedIndex,
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

export async function loadAllData(onProgress = () => {}) {
  let done = 0;
  const total = YEARS.length * 3;
  const step = (value) => {
    done += 1;
    onProgress(done / total);
    return value;
  };

  const perYear = await Promise.all(YEARS.map((year) => Promise.all([
    fetchGeoJson(`collisions/calderdale_collisions_${year}.geojson`).then(step),
    fetchGeoJson(`vehicles/calderdale_vehicles_${year}.geojson`).then(step),
    fetchGeoJson(`casualties/calderdale_casualties_${year}.geojson`).then(step),
  ])));

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
  return records;
}
