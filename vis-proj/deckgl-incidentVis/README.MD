# IncidentVis

Visual analysis of recorded injury collisions in Calderdale, 2020–2025.

Run **both** the Vite frontend (map and charts) and Python backend (local collision-profile clustering).

## Requirements

- Node.js 22.12 or newer, with npm. Node 20.19 is also supported by the installed Vite version.
- Python 3.10 or newer, with pip and venv.
- Internet access for installing dependencies and loading online map tiles/place names.

The prepared GeoJSON files are included in `public/`. No database, API key or separate model download is required. The backend learns groups from the selected records; it does not predict future collisions or severity.

## First-time setup — Windows PowerShell

Open the project folder containing `package.json`. Change the path below if your checkout is elsewhere.

```powershell
cd "....\VIS_Project\vis-proj\deckgl-incidentVis"
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

Calling the virtual environment's Python directly avoids PowerShell activation-policy issues.

## Start the system

Keep two terminals open, both in the project folder.

### Terminal 1 — backend

```powershell
.\.venv\Scripts\python.exe backend/server.py
```

Wait for `Profile model ready: http://127.0.0.1:8001`. This address is an API, not a webpage.

### Terminal 2 — frontend

```powershell
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173**. Keep both terminals running. Press **Ctrl+C** in each terminal to stop the system.

The backend allows browser requests from `http://127.0.0.1:5173` and `http://localhost:5173`. `--strictPort` prevents Vite silently choosing another port.

### macOS / Linux

From the project folder:

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python backend/server.py
```

In a second terminal, run the same frontend command shown above.

## Verify the system

1. Confirm that the map and existing charts load.
2. **Show selected years** opens by default with the latest year selected. Add more years, or switch to **Compare two years**.
3. Scroll to **Patterns in this selection**. A loader appears while the backend fits and checks groups. New selections can take several seconds; the other charts remain usable.
4. Select an area or change a filter. The patterns update for those records. Compared areas/years share one jointly fitted model.
5. Click a profile to highlight its collisions; click again to clear it.

Small or unsuitable selections may display an insufficient-data or no-stable-group message. That is an analytical result, not a failure. The model evaluates two to five groups; the number shown is not fixed.

**Rerun analysis** retries the current selection and bypasses cached model results. It is available after results, insufficient-data messages and request failures, and disabled while running. Identical data normally produces identical results because fitting uses reproducible seeds.

## Troubleshooting

| Problem                             | Action                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Analysis could not be loaded        | Start the backend, check its terminal for errors, then click **Rerun analysis**.          |
| Port 5173 or 8001 is already in use | An earlier instance may still be running. Use it or stop it before starting another.      |
| Missing Python package              | Install `backend/requirements.txt` using the same `.venv` Python used to run the backend. |
| Unsupported Node version            | Check `node --version` against the requirements above.                                    |
| Map tiles are blank but charts work | Check the internet connection; tiles are fetched online.                                  |
| Data files were replaced            | Restart the backend and reload the frontend to refresh data and caches.                   |

If a development-tool integration prevents the normal Vite command from starting, this equivalent command starts Vite directly:

```powershell
node --input-type=module -e "import {createServer} from 'vite'; const s=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true}}); await s.listen(); s.printUrls();"
```

The separate legacy DBSCAN/risk-ranking view has been removed. Use the **All points** switch or select a hexagon/drawn area to inspect individual collision records.
