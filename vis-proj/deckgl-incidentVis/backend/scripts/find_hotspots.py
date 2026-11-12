"""
Hotspot analysis for IncidentVis (Calderdale road collisions, 2020-2025).

Reproduces the clustering behind the hotspot list in the app:

1. Loads every collision (and its casualties) from the project's GeoJSON files.
2. Converts longitude / latitude to metres, so distances are real distances.
3. k-distance check: for every collision, the distance to its k-th nearest
   neighbour (k = min_samples). The bend in the sorted curve suggests eps.
4. Parameter sweep: runs DBSCAN for a grid of eps (search radius, metres) and
   min_samples (collisions needed within eps, including the collision itself)
   and reports the number of hotspots, the share of collisions inside them and
   the size of the largest one.
5. Final run with the chosen setting (default 120 m / 10), summarised per
   hotspot and ranked by risk score = collisions x (1 + KSI share).

The app (src/hotspots.js) runs the same DBSCAN in the browser with the same
settings; this script is the documented, reproducible version of that analysis.

Usage (from the deckgl-incidentVis folder):
    pip install numpy scikit-learn scipy
    python scripts/find_hotspots.py --data public --out scripts/output

Outputs (in --out):
    parameter_sweep.csv   one row per (eps, min_samples) setting
    k_distance.csv        sorted distance to the k-th nearest collision
    hotspots.json         the final hotspots (members, outline, summary)
"""

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.spatial import ConvexHull
from sklearn.cluster import DBSCAN
from sklearn.neighbors import NearestNeighbors

YEARS = range(2020, 2026)
MOTORCYCLE_TYPES = {"2", "3", "4", "5", "23", "97"}
ROAD_PREFIX = {"1": "M", "2": "A", "3": "A", "4": "B"}

# Approximate centres of Calderdale towns and villages (same list as src/places.js).
PLACES = {
    "Halifax centre": (-1.8600, 53.7225), "Brighouse": (-1.7826, 53.7034),
    "Elland": (-1.8389, 53.6853), "Sowerby Bridge": (-1.9076, 53.7086),
    "Hebden Bridge": (-2.0130, 53.7420), "Todmorden": (-2.0990, 53.7135),
    "Ripponden": (-1.9430, 53.6730), "King Cross": (-1.8780, 53.7130),
    "Illingworth": (-1.8820, 53.7480), "Shelf": (-1.8180, 53.7480),
    "Hipperholme": (-1.8110, 53.7260), "Ovenden": (-1.8700, 53.7400),
    "Siddal": (-1.8460, 53.7090), "Rastrick": (-1.7950, 53.6930),
    "Mytholmroyd": (-1.9820, 53.7300), "Northowram": (-1.8310, 53.7360),
    "Boothtown": (-1.8600, 53.7350), "Pellon": (-1.8800, 53.7300),
    "Southowram": (-1.8350, 53.7120), "Greetland": (-1.8700, 53.6900),
}

# Metres per degree at Calderdale's latitude (local equirectangular projection).
METRES_PER_DEG_LAT = 110540
METRES_PER_DEG_LON = 111320 * math.cos(math.radians(53.7))


def load_collisions(data_dir: Path):
    """All collisions with coordinates, each with its most vulnerable road user."""
    casualties = defaultdict(list)
    for year in YEARS:
        path = data_dir / "casualties" / f"calderdale_casualties_{year}.geojson"
        for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
            props = feature["properties"]
            casualties[(year, props["collision_index"])].append(props)

    collisions = []
    for year in YEARS:
        path = data_dir / "collisions" / f"calderdale_collisions_{year}.geojson"
        for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
            if not feature.get("geometry"):
                continue
            props = feature["properties"]
            lon, lat = feature["geometry"]["coordinates"][:2]
            types = {str(c["casualty_type"]) for c in casualties[(year, props["collision_index"])]}
            road_class = str(props.get("first_road_class"))
            road_number = str(props.get("first_road_number"))
            collisions.append({
                "year": year,
                "collision_index": props["collision_index"],
                "lon": lon,
                "lat": lat,
                "severity": int(props["collision_severity"]),  # 1 fatal, 2 serious, 3 slight
                "pedestrian": "0" in types,
                "road": (ROAD_PREFIX[road_class] + road_number)
                if road_class in ROAD_PREFIX and road_number not in ("0", "-1") else "",
            })
    return collisions


def to_metres(collisions):
    return np.array([[c["lon"] * METRES_PER_DEG_LON, c["lat"] * METRES_PER_DEG_LAT] for c in collisions])


def k_distances(xy, k):
    """Sorted distance from each collision to its k-th nearest collision (itself counts as the 1st)."""
    distances, _ = NearestNeighbors(n_neighbors=k).fit(xy).kneighbors(xy)
    return np.sort(distances[:, -1])


def parameter_sweep(xy, eps_values, min_samples_values):
    rows = []
    for min_samples in min_samples_values:
        for eps in eps_values:
            labels = DBSCAN(eps=eps, min_samples=min_samples).fit_predict(xy)
            sizes = Counter(labels[labels >= 0]).values()
            rows.append({
                "eps_m": eps,
                "min_samples": min_samples,
                "hotspots": int(labels.max() + 1),
                "share_in_hotspots_pct": round(100 * float((labels >= 0).mean()), 1),
                "largest_hotspot": max(sizes) if sizes else 0,
            })
    return rows


def nearest_place(lon, lat):
    return min(PLACES, key=lambda name: ((PLACES[name][0] - lon) * 0.6) ** 2 + (PLACES[name][1] - lat) ** 2)


def summarise_hotspots(collisions, labels):
    hotspots = []
    for label in range(labels.max() + 1):
        members = [c for c, l in zip(collisions, labels) if l == label]
        points = np.array([[c["lon"], c["lat"]] for c in members])
        hull = points[ConvexHull(points).vertices].tolist() if len(points) >= 3 else points.tolist()
        n = len(members)
        ksi = sum(c["severity"] <= 2 for c in members) / n
        roads = Counter(c["road"] for c in members if c["road"])
        lon, lat = points[:, 0].mean(), points[:, 1].mean()
        hotspots.append({
            "name": nearest_place(lon, lat),
            "main_road": roads.most_common(1)[0][0] if roads else "",
            "collisions": n,
            "ksi_share_pct": round(100 * ksi, 1),
            "pedestrian_share_pct": round(100 * sum(c["pedestrian"] for c in members) / n, 1),
            "collisions_per_year": {str(y): sum(c["year"] == y for c in members) for y in YEARS},
            "risk_score": round(n * (1 + ksi), 1),
            "outline": hull,
            "members": [f'{c["year"]}:{c["collision_index"]}' for c in members],
        })
    hotspots.sort(key=lambda h: -h["risk_score"])
    for rank, hotspot in enumerate(hotspots, start=1):
        hotspot["rank"] = rank
    return hotspots


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default="public", help="folder containing collisions/ and casualties/")
    parser.add_argument("--out", default="scripts/output", help="folder for the output files")
    parser.add_argument("--eps", type=float, default=120, help="search radius in metres (default 120)")
    parser.add_argument("--min-samples", type=int, default=10, help="collisions needed within eps (default 10)")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    collisions = load_collisions(Path(args.data))
    xy = to_metres(collisions)
    print(f"Collisions with coordinates: {len(collisions)}")

    # k-distance check
    kd = k_distances(xy, args.min_samples)
    with open(out / "k_distance.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["rank", f"distance_to_{args.min_samples}th_nearest_m"])
        writer.writerows([[i, round(float(d), 1)] for i, d in enumerate(kd)])
    within = 100 * float((kd <= args.eps).mean())
    print(f"\nk-distance (k = {args.min_samples}): median {np.median(kd):.0f} m; "
          f"{within:.0f}% of collisions have {args.min_samples} collisions within {args.eps:.0f} m (core points)")

    # Parameter sweep
    rows = parameter_sweep(xy, [60, 90, 120, 150, 180, 210], [5, 8, 10, 12, 15])
    with open(out / "parameter_sweep.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print("\nParameter sweep (hotspots / % of collisions in hotspots / largest hotspot):")
    print("min_samples | " + " | ".join(f"{eps:>4} m" for eps in [60, 90, 120, 150, 180, 210]))
    for min_samples in [5, 8, 10, 12, 15]:
        cells = [r for r in rows if r["min_samples"] == min_samples]
        print(f"{min_samples:>11} | " + " | ".join(
            f'{r["hotspots"]:>2}/{r["share_in_hotspots_pct"]:>4.0f}%/{r["largest_hotspot"]:>3}' for r in cells))

    # Final run
    labels = DBSCAN(eps=args.eps, min_samples=args.min_samples).fit_predict(xy)
    hotspots = summarise_hotspots(collisions, labels)
    (out / "hotspots.json").write_text(json.dumps(hotspots, indent=2), encoding="utf-8")
    inside = int((labels >= 0).sum())
    print(f"\nChosen setting: eps = {args.eps:.0f} m, min_samples = {args.min_samples}")
    print(f"{len(hotspots)} hotspots containing {inside} collisions ({100 * inside / len(collisions):.0f}%)\n")
    print(f"{'#':>2}  {'Hotspot':<30} {'n':>4} {'KSI %':>6} {'Ped %':>6} {'score':>6}")
    for h in hotspots:
        name = h["name"] + (f' · {h["main_road"]}' if h["main_road"] else "")
        print(f'{h["rank"]:>2}  {name:<30} {h["collisions"]:>4} {h["ksi_share_pct"]:>6.0f} '
              f'{h["pedestrian_share_pct"]:>6.0f} {h["risk_score"]:>6.1f}')


if __name__ == "__main__":
    main()
