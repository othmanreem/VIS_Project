import { Deck } from '@deck.gl/core';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import './style.css';

const INITIAL_VIEW_STATE = {
    longitude: -1.82,
    latitude: 53.72,
    zoom: 10,
    pitch: 0,
    bearing: 0
};

// --------------------------------------------------
// One fixed color for each year.
// The same color is used in the dropdown, legend,
// and collision points on the map.
// --------------------------------------------------
const YEAR_COLORS = {
    2020: [230, 126, 34, 210],
    2021: [52, 152, 219, 210],
    2022: [46, 204, 113, 210],
    2023: [155, 89, 182, 210],
    2024: [241, 196, 15, 220],
    2025: [231, 76, 60, 210]
};

const YEARS = Object.keys(YEAR_COLORS);

// --------------------------------------------------
// Base map
// --------------------------------------------------
const mapLayer = new TileLayer({
    id: 'basemap',
    data: 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png?key=cb1_304d_1_6699e7fd199a1afd970583e4',
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,

    renderSubLayers: props => {
        const {
            bbox: {
                west,
                south,
                east,
                north
            }
        } = props.tile;

        return new BitmapLayer(props, {
            data: null,
            image: props.data,
            bounds: [west, south, east, north]
        });
    }
});

// --------------------------------------------------
// Load the GeoJSON belonging to one year.
// Expected files:
// /calderdale_collisions_2020.geojson
// ...
// /calderdale_collisions_2025.geojson
// --------------------------------------------------
async function loadYearData(year) {
    const response = await fetch(`/calderdale_collisions_${year}.geojson`);

    if (!response.ok) {
        throw new Error(`Could not load collision data for ${year}.`);
    }

    return await response.json();
}

// --------------------------------------------------
// Create one layer per selected year.
// This makes it possible to display multiple years
// simultaneously while keeping their colors separate.
// --------------------------------------------------
function createYearLayer(year, data) {
    return new GeoJsonLayer({
        id: `collisions-${year}`,
        data,

        pointType: 'circle',
        filled: true,
        stroked: true,

        // Different color for each selected year.
        getFillColor: YEAR_COLORS[year],
        getLineColor: [255, 255, 255, 255],

        getPointRadius: 45,
        pointRadiusMinPixels: 4,
        pointRadiusMaxPixels: 12,

        lineWidthMinPixels: 1,

        pickable: true,
        autoHighlight: true,

        updateTriggers: {
            getFillColor: [year]
        }
    });
}

// --------------------------------------------------
// Tooltip
// --------------------------------------------------
function getTooltip({ object }) {
    if (!object) {
        return null;
    }

    const p = object.properties || {};

    return {
        html: `
            <div class="tooltip-content">
                <strong>Road Collision</strong>
                <br>
                <span class="tooltip-year">
                    Year: ${p.collision_year ?? p.year ?? 'N/A'}
                </span>
                <br>
                Date: ${p.date ?? 'N/A'}
                <br>
                Time: ${p.time ?? 'N/A'}
                <br>
                Severity: ${p.collision_severity ?? 'N/A'}
                <br>
                Casualties: ${p.number_of_casualties ?? 'N/A'}
                <br>
                Vehicles: ${p.number_of_vehicles ?? 'N/A'}
                <br>
                Speed limit: ${p.speed_limit ?? 'N/A'} mph
                <br>
                Road number: ${p.first_road_number ?? 'N/A'}
                <br>
                Road surface: ${p.road_surface_conditions ?? 'N/A'}
                <br>
                Weather: ${p.weather_conditions ?? 'N/A'}
                <br>
                Latitude: ${p.latitude ?? 'N/A'}
                <br>
                Longitude: ${p.longitude ?? 'N/A'}
            </div>
        `
    };
}

// --------------------------------------------------
// Deck instance
// --------------------------------------------------
const deck = new Deck({
    parent: document.getElementById('map'),
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    layers: [mapLayer],
    getTooltip
});

// --------------------------------------------------
// Render selected years
// --------------------------------------------------
async function showSelectedYears(selectedYears) {
    const info = document.getElementById('info');

    if (selectedYears.length === 0) {
        deck.setProps({
            layers: [mapLayer]
        });

        info.innerHTML = `
            <p>Please select at least one year and press <strong>View</strong>.</p>
        `;
        return;
    }

    info.innerHTML = `<p>Loading ${selectedYears.join(', ')}...</p>`;

    try {
        const results = await Promise.all(
            selectedYears.map(async year => {
                const data = await loadYearData(year);
                return {
                    year,
                    data
                };
            })
        );

        const collisionLayers = results.map(({ year, data }) =>
            createYearLayer(year, data)
        );

        deck.setProps({
            layers: [
                mapLayer,
                ...collisionLayers
            ]
        });

        const yearLabel = selectedYears.length === 1 ? 'year' : 'years';

        info.innerHTML = `
            <p>
                Showing <strong>${selectedYears.length}</strong> ${yearLabel}:
                <strong>${selectedYears.join(', ')}</strong>
            </p>
        `;
    } catch (error) {
        console.error(error);

        info.innerHTML = `
            <p class="error-message">
                Could not load one or more selected years.
                Make sure the corresponding GeoJSON files exist.
            </p>
        `;
    }
}

// --------------------------------------------------
// Dropdown behaviour
// --------------------------------------------------
const dropdown = document.getElementById('year-dropdown');
const dropdownButton = document.getElementById('year-dropdown-button');
const yearMenu = document.getElementById('year-menu');
const selectedYearsText = document.getElementById('selected-years-text');
const viewButton = document.getElementById('view-button');

function updateSelectedYearsText() {
    const selectedYears = Array.from(
        document.querySelectorAll('#year-menu input[type="checkbox"]:checked')
    ).map(input => input.value);

    if (selectedYears.length === 0) {
        selectedYearsText.textContent = 'Select year(s)';
    } else if (selectedYears.length === 1) {
        selectedYearsText.textContent = selectedYears[0];
    } else {
        selectedYearsText.textContent = `${selectedYears.length} years selected`;
    }
}

dropdownButton.addEventListener('click', () => {
    const isOpen = !yearMenu.hidden;

    yearMenu.hidden = isOpen;
    dropdownButton.setAttribute('aria-expanded', String(!isOpen));
    dropdown.classList.toggle('open', !isOpen);
});

document.querySelectorAll('#year-menu input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', updateSelectedYearsText);
});

const clearButton = document.getElementById('clear-button');

clearButton.addEventListener('click', () => {
    // Uncheck every year checkbox
    document
        .querySelectorAll('#year-menu input[type="checkbox"]')
        .forEach(input => {
            input.checked = false;
        });

    updateSelectedYearsText();

    // Remove all collision layers, keeping only the basemap
    deck.setProps({
        layers: [mapLayer]
    });

    document.getElementById('info').innerHTML = `
        <p>Map cleared. Select one or more years and press <strong>View</strong> to display the collisions.</p>
    `;

    yearMenu.hidden = true;
    dropdownButton.setAttribute('aria-expanded', 'false');
    dropdown.classList.remove('open');
});

viewButton.addEventListener('click', async () => {
    const selectedYears = Array.from(
        document.querySelectorAll('#year-menu input[type="checkbox"]:checked')
    ).map(input => input.value);

    await showSelectedYears(selectedYears);

    yearMenu.hidden = true;
    dropdownButton.setAttribute('aria-expanded', 'false');
    dropdown.classList.remove('open');
});

// Close the dropdown when clicking outside it.
document.addEventListener('click', event => {
    if (!dropdown.contains(event.target)) {
        yearMenu.hidden = true;
        dropdownButton.setAttribute('aria-expanded', 'false');
        dropdown.classList.remove('open');
    }
});

updateSelectedYearsText();