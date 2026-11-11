// --------------------------------------------------
// Hotspot detection with DBSCAN.
// eps    = search radius in metres
// minPts = collisions (including itself) needed within eps
//          for a collision to be a dense "core" point.
// Both come from public/dataset.json (hotspots.radiusMetres and
// hotspots.minCollisions).
// Core points closer than eps are chained into one hotspot,
// with their neighbours as border points. Everything else is
// not part of any hotspot.
// Coordinates are converted to local metres first, so the
// distances are real distances on the ground. The conversion uses
// the data's own average latitude, so it works for any area.
// --------------------------------------------------
const METRES_PER_DEG_LAT = 110540;

// Local metres: x = east, y = north.
function projector(records) {
  const meanLat = records.reduce((sum, r) => sum + r.lat, 0) / Math.max(1, records.length);
  const metresPerDegLon = 111320 * Math.cos((meanLat * Math.PI) / 180);
  return (record) => [record.lon * metresPerDegLon, record.lat * METRES_PER_DEG_LAT];
}

export function dbscan(records, eps, minPts) {
  const points = records.map(projector(records));
  // Grid with cell size eps: neighbours can only be in the 3 × 3 cells around a point.
  const grid = new Map();
  points.forEach(([x, y], i) => {
    const key = `${Math.floor(x / eps)}:${Math.floor(y / eps)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  const neighbours = (i) => {
    const [x, y] = points[i];
    const cx = Math.floor(x / eps);
    const cy = Math.floor(y / eps);
    const found = [];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx}:${gy}`) || []) {
          const dx = points[j][0] - x;
          const dy = points[j][1] - y;
          if (dx * dx + dy * dy <= eps * eps) found.push(j);
        }
      }
    }
    return found;
  };

  const labels = new Array(points.length).fill(undefined);
  let cluster = -1;
  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== undefined) continue;
    const seeds = neighbours(i);
    if (seeds.length < minPts) {
      labels[i] = -1; // noise for now; may become a border point later
      continue;
    }
    cluster += 1;
    labels[i] = cluster;
    const queue = seeds.filter((j) => j !== i);
    while (queue.length) {
      const j = queue.pop();
      if (labels[j] === -1) labels[j] = cluster; // border point
      if (labels[j] !== undefined) continue;
      labels[j] = cluster;
      const more = neighbours(j);
      if (more.length >= minPts) queue.push(...more); // core point: keep expanding
    }
  }
  return labels;
}

// Andrew's monotone chain convex hull on [lon, lat] pairs.
export function convexHull(positions) {
  const pts = positions.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Hotspots from all records: members (record indices), outline, centre and main road.
// Names are added afterwards from the centre (see placeNames.js).
export function findHotspots(records, { radiusMetres, minCollisions }) {
  const labels = dbscan(records, radiusMetres, minCollisions);
  const groups = new Map();
  labels.forEach((label, i) => {
    if (label < 0) return;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(records[i]);
  });

  return Array.from(groups.values()).map((members, id) => {
    const lon = members.reduce((sum, r) => sum + r.lon, 0) / members.length;
    const lat = members.reduce((sum, r) => sum + r.lat, 0) / members.length;
    const roads = {};
    members.forEach((r) => {
      if (r.road !== "Unclassified") roads[r.road] = (roads[r.road] || 0) + 1;
    });
    const road = Object.entries(roads).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return {
      id,
      members: members.map((r) => r.i),
      hull: convexHull(members.map((r) => r.position)),
      centre: [lon, lat],
      road,
    };
  });
}

// Point-in-polygon test (ray casting) on [lon, lat] pairs.
export function inPolygon(lon, lat, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
