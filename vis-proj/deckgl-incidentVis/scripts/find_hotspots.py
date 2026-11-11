"""
Hotspot analysis for IncidentVis (Calderdale road collisions, 2020-2025).

Reproduces the clustering behind the hotspot list in the app:

1. Reads public/dataset.json (area name, years, file names, hotspot settings)
   and loads every collision and its casualties from the files it lists.
2. Converts longitude / latitude to metres at the data's average latitude,
   so distances are real distances for any area.
3. k-distance check: for every collision, the distance to its k-th nearest
   neighbour (k = min_samples). The bend in the sorted curve suggests eps.
4. Parameter sweep: runs DBSCAN for a grid of eps (search radius, metres) and
   min_samples (collisions needed within eps, including the collision itself)
   and reports the number of hotspots, the share of collisions inside them and
   the size of the largest one.
5. Final run with the setting from dataset.json (or --eps / --min-samples),
   summarised per hotspot and ranked by risk score = collisions x (1 + KSI share).
   Hotspots are described by their centre and main road; the app adds place
   names from OpenStreetMap, so no place list is hard-coded.

The app (src/hotspots.js) runs the same DBSCAN in the browser with the same
settings; this script is the documented, reproducible version of that analysis.

Usage (from the deckgl-incidentVis folder):
    pip install numpy scikit-learn scipy
    python scripts/find_hotspots.py --data public --out scripts/output
    (settings are read from public/dataset.json)

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

MOTORCYCLE_TYPES = {"2", "3", "4", "5", "23", "97"}
ROAD_PREFIX = {"1": "M", "2": "A", "3": "A", "4": "B"}

# Metres per degree of latitude; longitude is scaled by the data's average latitude.
METRES_PER_DEG_LAT = 110540


def load_config(data_dir: Path):
    return json.loads((data_dir / "dataset.json").read_text(encoding="utf-8"))


def load_collisions(data_dir: Path, config):
    """All collisions with coordinates, each with its most vulnerable road user."""
    years = config["years"]
    files = config["files"]
    casualties = defaultdict(list)
    for year in years:
        path = data_dir / files["casualties"].replace("{year}", str(year))
        for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
            props = feature["properties"]
            casualties[(year, props["collision_index"])].append(props)

    collisions = []
    for year in years:
        path = data_dir / files["collisions"].replace("{year}", str(year))
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
    mean_lat = sum(c["lat"] for c in collisions) / len(collisions)
    metres_per_deg_lon = 111320 * math.cos(math.radians(mean_lat))
    return np.array([[c["lon"] * metres_per_deg_lon, c["lat"] * METRES_PER_DEG_LAT] for c in collisions])


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


def summarise_hotspots(collisions, labels, years):
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
            "centre": [round(float(lon), 6), round(float(lat), 6)],
            "main_road": roads.most_common(1)[0][0] if roads else "",
            "collisions": n,
            "ksi_share_pct": round(100 * ksi, 1),
            "pedestrian_share_pct": round(100 * sum(c["pedestrian"] for c in members) / n, 1),
            "collisions_per_year": {str(y): sum(c["year"] == y for c in members) for y in years},
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
    parser.add_argument("--data", default="public", help="folder containing dataset.json and the data files")
    parser.add_argument("--out", default="scripts/output", help="folder for the output files")
    parser.add_argument("--eps", type=float, help="search radius in metres (default: dataset.json)")
    parser.add_argument("--min-samples", type=int, help="collisions needed within eps (default: dataset.json)")
    args = parser.parse_args()

    data_dir = Path(args.data)
    config = load_config(data_dir)
    args.eps = args.eps or float(config.get("hotspots", {}).get("radiusMetres", 120))
    args.min_samples = args.min_samples or int(config.get("hotspots", {}).get("minCollisions", 10))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    collisions = load_collisions(data_dir, config)
    xy = to_metres(collisions)
    print(f"{config.get('name', 'Study area')}: {len(collisions)} collisions with coordinates")

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
    hotspots = summarise_hotspots(collisions, labels, config["years"])
    (out / "hotspots.json").write_text(json.dumps(hotspots, indent=2), encoding="utf-8")
    inside = int((labels >= 0).sum())
    print(f"\nChosen setting: eps = {args.eps:.0f} m, min_samples = {args.min_samples}")
    print(f"{len(hotspots)} hotspots containing {inside} collisions ({100 * inside / len(collisions):.0f}%)\n")
    print(f"{'#':>2}  {'Main road @ centre (lat, lon)':<34} {'n':>4} {'KSI %':>6} {'Ped %':>6} {'score':>6}")
    for h in hotspots:
        name = f'{h["main_road"] or "—"} @ {h["centre"][1]:.4f}, {h["centre"][0]:.4f}'
        print(f'{h["rank"]:>2}  {name:<34} {h["collisions"]:>4} {h["ksi_share_pct"]:>6.0f} '
              f'{h["pedestrian_share_pct"]:>6.0f} {h["risk_score"]:>6.1f}')


if __name__ == "__main__":
    main()
