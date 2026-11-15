# Collision-pattern backend

## What happens here?

- Receives the years, filters and areas selected in the interface as lists of collision IDs.
- Finds those records in the local dataset.
- Uses **Latent Class Analysis (LCA)** to find groups with similar characteristics.
- Checks whether the groups are stable and useful enough to show.
- Returns the groups, their common characteristics, counts and recorded severity.
- Reports when there are too few records or no useful grouping.
- It does not predict future collisions or severity.

## Start the backend

Run from the project folder containing `package.json`:

```powershell
.\.venv\Scripts\python.exe backend/server.py
```

- Address: `http://127.0.0.1:8001`
- Keep the terminal open while using the application.
- Full installation and frontend startup steps are in [the project README](../README.MD).

## Request and response

### `POST /profiles`

**The frontend sends:**

- `cells`: the areas/years being compared.
- Each cell has a `label` and a list of collision `ids`.
- `force: true`: requests a fresh fit when the user clicks **Rerun analysis**.
- `requestId`: identifies that rerun so repeated requests do not fit it twice.

Example:

```json
{
  "cells": [
    {"label": "Area A - 2020", "ids": ["collision-id-1"]},
    {"label": "Area A - 2025", "ids": ["collision-id-2"]}
  ]
}
```

- Replace example IDs with IDs from the dataset.
- The frontend has already applied the selected geography, years and filters when building these lists.
- The backend learns one shared grouping from all requested cells, counting overlapping records once during fitting.

**The backend returns:**

- `status`: `ready`, `insufficient` or `unstable`.
- `labels` and `descriptions`: names and common characteristics of the learned groups.
- `cells`: counts and serious/fatal counts for each area/year and group.
- `members`: collision IDs for highlighting groups on the map.
- `reason`: explanation when no grouping can be shown.
- `chosen` and `checks`: model-selection details used to inspect the result.

**The frontend then:**

- Draws the pattern comparison bars.
- Shows a message if useful groups cannot be found.
- Highlights matching collisions when the user clicks a group.

### Other requests

- `OPTIONS /profiles`: allows browser requests from the local frontend.
- No separate health-check endpoint is provided.
- Invalid analysis requests return HTTP `400`; unknown POST paths return `404`.

## Files

| File | What it does |
|---|---|
| `features.py` | Converts dataset codes into meaningful categories, such as daylight, rain and wet surface. Builds the characteristics used for clustering. |
| `local_model.py` | Fits local LCA models, tests two to five groups, checks their quality and prepares readable descriptions. |
| `server.py` | Loads collision/casualty data, handles requests, calls the model and returns JSON results. Reuses results for repeated selections. |
| `requirements.txt` | Lists the Python packages needed to run the backend. |

## When does analysis run?

- A new selection triggers fitting and checking on those records.
- Both sides of a comparison use the same learned groups.
- Identical selections can reuse cached results.
- **Rerun analysis** requests a fresh fit.
- Small or unsuitable selections can return no groups.
- Severity, coordinates and year are not clustering inputs. Severity is summarised afterward.

## Supporting scripts

- The project-level `scripts/` folder contains visualisation checks and the maintained hotspot-analysis script. These are optional tools, not part of backend startup.
- The model-comparison notebook and evaluation results are in `output/model-study/` at the workspace root. They document the method experiments.
- The old `backend/exploratory_scripts_as_used/` and duplicate `backend/scripts/` were removed because the active system does not use them.
