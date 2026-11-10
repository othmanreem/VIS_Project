// --------------------------------------------------
// Named places in Calderdale (approximate centres).
// Used to name each hotspot after its nearest place and to
// label towns on the map.
// --------------------------------------------------
export const PLACES = [
  { name: "Halifax centre", lon: -1.8600, lat: 53.7225, label: true },
  { name: "Brighouse", lon: -1.7826, lat: 53.7034, label: true },
  { name: "Elland", lon: -1.8389, lat: 53.6853, label: true },
  { name: "Sowerby Bridge", lon: -1.9076, lat: 53.7086, label: true },
  { name: "Hebden Bridge", lon: -2.0130, lat: 53.7420, label: true },
  { name: "Todmorden", lon: -2.0990, lat: 53.7135, label: true },
  { name: "Ripponden", lon: -1.9430, lat: 53.6730, label: true },
  { name: "King Cross", lon: -1.8780, lat: 53.7130 },
  { name: "Illingworth", lon: -1.8820, lat: 53.7480 },
  { name: "Shelf", lon: -1.8180, lat: 53.7480 },
  { name: "Hipperholme", lon: -1.8110, lat: 53.7260 },
  { name: "Ovenden", lon: -1.8700, lat: 53.7400 },
  { name: "Siddal", lon: -1.8460, lat: 53.7090 },
  { name: "Rastrick", lon: -1.7950, lat: 53.6930 },
  { name: "Mytholmroyd", lon: -1.9820, lat: 53.7300 },
  { name: "Northowram", lon: -1.8310, lat: 53.7360 },
  { name: "Boothtown", lon: -1.8600, lat: 53.7350 },
  { name: "Pellon", lon: -1.8800, lat: 53.7300 },
  { name: "Southowram", lon: -1.8350, lat: 53.7120 },
  { name: "Greetland", lon: -1.8700, lat: 53.6900 },
];

// Nearest place; longitude differences are shrunk to roughly match
// distances on the ground at this latitude.
export function nearestPlace(lon, lat) {
  let best = PLACES[0];
  let bestDistance = Infinity;
  for (const place of PLACES) {
    const dx = (place.lon - lon) * 0.6;
    const dy = place.lat - lat;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = place;
    }
  }
  return best.name;
}
