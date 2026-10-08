import { Deck } from '@deck.gl/core';
import { BitmapLayer, GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { CATEGORIES } from './codes.js';
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
// collision points and text labels on the map.
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
// Data loading (cached, so re-pressing View is fast)
// Expected files:
// /calderdale_collisions_YYYY.geojson
// /calderdale_vehicles_YYYY.geojson   (only needed for driver filters)
// --------------------------------------------------
const fetchCache = new Map();

function fetchGeoJson(url, errorMessage) {
    if (!fetchCache.has(url)) {
        const request = fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(errorMessage);
                }
                return response.json();
            })
            .catch(error => {
                fetchCache.delete(url);
                throw error;
            });

        fetchCache.set(url, request);
    }

    return fetchCache.get(url);
}

function loadYearData(year) {
    return fetchGeoJson(
        `collisions/calderdale_collisions_${year}.geojson`,
        `Could not load collision data for ${year}.`
    );
}

// --------------------------------------------------
// Vehicles are joined to collisions with collision_index.
// For every collision we keep, per vehicle-based category,
// the set of codes found among its drivers.
// Result: Map(collision_index -> { driverGender: Set, driverAge: Set })
// --------------------------------------------------
const vehicleIndexCache = new Map();
const VEHICLE_CATEGORIES = CATEGORIES.filter(cat => cat.source === 'vehicle');

async function loadVehicleIndex(year) {
    if (vehicleIndexCache.has(year)) {
        return vehicleIndexCache.get(year);
    }

    const data = await fetchGeoJson(
        `vehicles/calderdale_vehicles_${year}.geojson`,
        `Could not load vehicle data for ${year}.`
    );

    const index = new Map();

    for (const feature of data.features) {
        const props = feature.properties || {};
        let entry = index.get(props.collision_index);

        if (!entry) {
            entry = {};
            VEHICLE_CATEGORIES.forEach(cat => {
                entry[cat.key] = new Set();
            });
            index.set(props.collision_index, entry);
        }

        VEHICLE_CATEGORIES.forEach(cat => {
            const value = props[cat.field];
            if (value !== undefined && value !== null) {
                entry[cat.key].add(String(value));
            }
        });
    }

    vehicleIndexCache.set(year, index);
    return index;
}

// --------------------------------------------------
// Codes of one collision for one category.
// Collision-based categories have a single code.
// Vehicle-based categories can have several (one per driver).
// --------------------------------------------------
function getCodes(category, feature, vehicleIndex) {
    if (category.source === 'collision') {
        const value = feature.properties?.[category.field];
        return value === undefined || value === null ? [] : [String(value)];
    }

    const entry = vehicleIndex?.get(feature.properties?.collision_index);
    return entry ? Array.from(entry[category.key]) : [];
}

// code -> label lookup for each category (built once)
const LABELS = {};
CATEGORIES.forEach(cat => {
    LABELS[cat.key] = Object.fromEntries(cat.codes.map(c => [c.code, c.label]));
});

// --------------------------------------------------
// Layers for one year:
//  - one scatterplot (GeoJsonLayer), filtered by the chosen options
//  - one TextLayer per category that has something selected,
//    showing the code's label for every displayed collision
//    (same color as the year's points)
// --------------------------------------------------
function createYearLayers(year, collisions, vehicleIndex, filters) {
    const activeCategories = CATEGORIES.filter(cat => filters[cat.key]);

    // A collision is kept if, for every active category,
    // at least one of its codes is among the selected options.
    const features = collisions.features.filter(feature =>
        feature.geometry &&
        activeCategories.every(cat =>
            getCodes(cat, feature, vehicleIndex).some(code => filters[cat.key].has(code))
        )
    );

    const pointLayer = new GeoJsonLayer({
        id: `collisions-${year}`,
        data: { type: 'FeatureCollection', features },

        pointType: 'circle',
        filled: true,
        stroked: true,

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

    const textColor = [...YEAR_COLORS[year].slice(0, 3), 255];

    const textLayers = activeCategories.map((cat, i) => {
        const labelData = [];

        for (const feature of features) {
            // Labels come from the guide's mapping, whatever the user selected.
            const labels = [...new Set(
                getCodes(cat, feature, vehicleIndex)
                    .map(code => LABELS[cat.key][code])
                    .filter(Boolean)
            )];

            if (labels.length > 0) {
                labelData.push({
                    position: feature.geometry.coordinates,
                    text: `${cat.short}: ${labels.join(', ')}`
                });
            }
        }

        return new TextLayer({
            id: `labels-${year}-${cat.key}`,
            data: labelData,

            getPosition: d => d.position,
            getText: d => d.text,
            getColor: textColor,
            getSize: 12,

            // Stack labels of different categories above the point
            getPixelOffset: [0, -(12 + i * 15)],
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'bottom',

            fontFamily: 'Arial, Helvetica, sans-serif',
            fontWeight: 700,
            fontSettings: { sdf: true },
            outlineWidth: 3,
            outlineColor: [255, 255, 255, 255]
        });
    });

    return { pointLayer, textLayers, count: features.length };
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
// Build the year rows + filter sub-menus
// --------------------------------------------------
const yearOptions = document.getElementById('year-options');

function buildYearMenu() {
    yearOptions.innerHTML = YEARS.map(year => `
        <div class="year-block" data-year="${year}">
            <div class="year-row">
                <label class="year-option">
                    <input type="checkbox" class="year-checkbox" value="${year}">
                    <span class="color-dot year-${year}"></span>
                    <span>${year}</span>
                </label>
                <button type="button" class="expand-btn year-toggle"
                        aria-expanded="false"
                        aria-label="Filters for ${year}">▸</button>
            </div>

            <div class="sub-menu" hidden>
                ${CATEGORIES.map(cat => `
                    <div class="category" data-cat="${cat.key}">
                        <div class="category-row">
                            <label class="category-option">
                                <input type="checkbox" class="category-checkbox">
                                <span>${cat.label}</span>
                            </label>
                            <button type="button" class="expand-btn category-toggle"
                                    aria-expanded="false"
                                    aria-label="Show ${cat.label} options">▸</button>
                        </div>

                        <div class="option-list" hidden>
                            ${cat.codes.map(c => `
                                <label class="sub-option">
                                    <input type="checkbox" class="code-checkbox" value="${c.code}">
                                    <span>${c.label}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

buildYearMenu();

// --------------------------------------------------
// Read what the user has selected.
// Returns [{ year, filters: { categoryKey: Set(codes) } }]
// Categories with nothing ticked are not filtered.
// --------------------------------------------------
function getSelections() {
    return Array.from(yearOptions.querySelectorAll('.year-block'))
        .filter(block => block.querySelector('.year-checkbox').checked)
        .map(block => {
            const filters = {};

            block.querySelectorAll('.category').forEach(categoryEl => {
                const codes = Array.from(
                    categoryEl.querySelectorAll('.code-checkbox:checked')
                ).map(input => input.value);

                if (codes.length > 0) {
                    filters[categoryEl.dataset.cat] = new Set(codes);
                }
            });

            return { year: block.dataset.year, filters };
        });
}

// --------------------------------------------------
// Render selected years
// --------------------------------------------------
async function showSelectedYears(selections) {
    const info = document.getElementById('info');

    if (selections.length === 0) {
        deck.setProps({
            layers: [mapLayer]
        });

        info.innerHTML = `
            <p>Please select at least one year and press <strong>View</strong>.</p>
        `;
        return;
    }

    const years = selections.map(s => s.year);
    info.innerHTML = `<p>Loading ${years.join(', ')}...</p>`;

    try {
        const results = await Promise.all(
            selections.map(async ({ year, filters }) => {
                const needsVehicles = VEHICLE_CATEGORIES.some(cat => filters[cat.key]);

                const [collisions, vehicleIndex] = await Promise.all([
                    loadYearData(year),
                    needsVehicles ? loadVehicleIndex(year) : Promise.resolve(null)
                ]);

                return createYearLayers(year, collisions, vehicleIndex, filters);
            })
        );

        // Points first, text labels on top of all points.
        const pointLayers = results.map(r => r.pointLayer);
        const textLayers = results.flatMap(r => r.textLayers);
        const total = results.reduce((sum, r) => sum + r.count, 0);

        deck.setProps({
            layers: [mapLayer, ...pointLayers, ...textLayers]
        });

        const yearLabel = years.length === 1 ? 'year' : 'years';

        info.innerHTML = `
            <p>
                Showing <strong>${total}</strong> collisions for
                <strong>${years.length}</strong> ${yearLabel}:
                <strong>${years.join(', ')}</strong>
            </p>
        `;
    } catch (error) {
        console.error(error);

        info.innerHTML = `
            <p class="error-message">
                Could not load one or more selected years.
                Make sure the corresponding GeoJSON files exist
                (collisions, and vehicles for the driver filters).
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
const clearButton = document.getElementById('clear-button');

function closeDropdown() {
    yearMenu.hidden = true;
    dropdownButton.setAttribute('aria-expanded', 'false');
    dropdown.classList.remove('open');
}

function updateSelectedYearsText() {
    const selectedYears = Array.from(
        yearOptions.querySelectorAll('.year-checkbox:checked')
    ).map(input => input.value);

    if (selectedYears.length === 0) {
        selectedYearsText.textContent = 'Select year(s)';
    } else if (selectedYears.length === 1) {
        selectedYearsText.textContent = selectedYears[0];
    } else {
        selectedYearsText.textContent = `${selectedYears.length} years selected`;
    }
}

// Sync a category checkbox with its option checkboxes
// (checked = all, indeterminate = some, unchecked = none).
function syncCategoryCheckbox(categoryEl) {
    const boxes = Array.from(categoryEl.querySelectorAll('.code-checkbox'));
    const checkedCount = boxes.filter(box => box.checked).length;
    const parent = categoryEl.querySelector('.category-checkbox');

    parent.checked = checkedCount === boxes.length;
    parent.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

function setExpanded(button, panel, expanded) {
    panel.hidden = !expanded;
    button.classList.toggle('expanded', expanded);
    button.setAttribute('aria-expanded', String(expanded));
}

dropdownButton.addEventListener('click', () => {
    const isOpen = !yearMenu.hidden;

    yearMenu.hidden = isOpen;
    dropdownButton.setAttribute('aria-expanded', String(!isOpen));
    dropdown.classList.toggle('open', !isOpen);
});

// Expand / collapse the sub-menus
yearOptions.addEventListener('click', event => {
    const yearToggle = event.target.closest('.year-toggle');
    const categoryToggle = event.target.closest('.category-toggle');

    if (yearToggle) {
        const panel = yearToggle.closest('.year-block').querySelector('.sub-menu');
        setExpanded(yearToggle, panel, panel.hidden);
    } else if (categoryToggle) {
        const panel = categoryToggle.closest('.category').querySelector('.option-list');
        setExpanded(categoryToggle, panel, panel.hidden);
    }
});

// Checkbox logic
yearOptions.addEventListener('change', event => {
    const input = event.target;
    const block = input.closest('.year-block');

    if (input.classList.contains('category-checkbox')) {
        // Selecting the category selects every option inside it.
        const categoryEl = input.closest('.category');
        categoryEl.querySelectorAll('.code-checkbox').forEach(box => {
            box.checked = input.checked;
        });
        input.indeterminate = false;

        // Make the options visible when a category gets selected.
        if (input.checked) {
            setExpanded(
                categoryEl.querySelector('.category-toggle'),
                categoryEl.querySelector('.option-list'),
                true
            );
        }
    }

    if (input.classList.contains('code-checkbox')) {
        syncCategoryCheckbox(input.closest('.category'));
    }

    // Choosing any filter automatically selects that year.
    if (
        (input.classList.contains('category-checkbox') ||
            input.classList.contains('code-checkbox')) &&
        block.querySelector('.code-checkbox:checked')
    ) {
        block.querySelector('.year-checkbox').checked = true;
    }

    updateSelectedYearsText();
});

viewButton.addEventListener('click', async () => {
    await showSelectedYears(getSelections());
    closeDropdown();
});

clearButton.addEventListener('click', () => {
    // Uncheck every year, category and option checkbox
    yearOptions.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.checked = false;
        input.indeterminate = false;
    });

    // Collapse all sub-menus
    yearOptions.querySelectorAll('.sub-menu, .option-list').forEach(panel => {
        panel.hidden = true;
    });
    yearOptions.querySelectorAll('.expand-btn').forEach(button => {
        button.classList.remove('expanded');
        button.setAttribute('aria-expanded', 'false');
    });

    updateSelectedYearsText();

    // Remove all collision and label layers, keeping only the basemap
    deck.setProps({
        layers: [mapLayer]
    });

    document.getElementById('info').innerHTML = `
        <p>Map cleared. Select one or more years and press <strong>View</strong> to display the collisions.</p>
    `;

    closeDropdown();
});

// Close the dropdown when clicking outside it.
document.addEventListener('click', event => {
    if (!dropdown.contains(event.target)) {
        closeDropdown();
    }
});

updateSelectedYearsText();