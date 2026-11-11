// --------------------------------------------------
// Place names for hotspots and drawn areas, for any area.
// Names come from OpenStreetMap's reverse geocoding service
// (Nominatim): coordinates in, neighbourhood / town name out.
//
// Following the Nominatim usage policy:
// - at most one request per second (requests wait in a queue),
// - results are cached in this browser, so a reload asks again
//   only for new locations,
// - OpenStreetMap is credited on the map.
// If the service cannot be reached, callers fall back to a name
// built from the data (the main road).
// --------------------------------------------------
const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const STORAGE_KEY = "incidentvis-place-names-v1";
const MIN_GAP_MS = 1100;

const keyOf = ([lon, lat]) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage can be full or blocked; names are then simply asked for again next time.
  }
}

// The most local named area in the address: neighbourhood, suburb, village, town or city.
function placeFromAddress(address = {}) {
  return address.neighbourhood || address.suburb || address.quarter || address.city_district
    || address.hamlet || address.village || address.town || address.city || address.municipality || null;
}

/**
 * @param {{ enabled: boolean, onName: () => void }} options
 *   onName is called whenever a new name arrives, so the views can redraw.
 */
export function createPlaceNamer({ enabled, onName }) {
  const cache = readCache(); // key → name (or "" when the service had no name)
  const queue = [];
  const queued = new Set();
  let running = false;
  let failed = false; // stop asking after a network failure in this session

  async function work() {
    running = true;
    while (queue.length && !failed) {
      const position = queue.shift();
      const key = keyOf(position);
      try {
        const url = `${ENDPOINT}?format=jsonv2&zoom=16&addressdetails=1&accept-language=en`
          + `&lat=${position[1].toFixed(6)}&lon=${position[0].toFixed(6)}`;
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Place name service answered ${response.status}`);
        const result = await response.json();
        cache[key] = placeFromAddress(result.address) || "";
        writeCache(cache);
        onName();
      } catch (error) {
        console.warn("Place names unavailable; using road names instead.", error);
        failed = true;
      }
      queued.delete(key);
      await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS));
    }
    running = false;
  }

  return {
    /**
     * Name for a [lon, lat] position, or null while unknown. Unknown positions are queued;
     * urgent ones (what the user is looking at now) go to the front of the queue.
     */
    get(position, urgent = false) {
      const key = keyOf(position);
      if (key in cache) return cache[key] || null;
      if (!enabled || failed) return null;
      if (queued.has(key)) {
        if (urgent) {
          const index = queue.findIndex((p) => keyOf(p) === key);
          if (index > 0) queue.unshift(...queue.splice(index, 1));
        }
        return null;
      }
      queued.add(key);
      if (urgent) queue.unshift(position);
      else queue.push(position);
      if (!running) work();
      return null;
    },
  };
}
