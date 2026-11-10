// --------------------------------------------------
// Collision details panel (details on demand).
// Same content as before: collision attributes, plus every
// linked vehicle and casualty, with less common fields under
// "More details". Records are already loaded in data.js.
// --------------------------------------------------
import { CATEGORIES } from "./codes.js";
import { DETAIL_CODES } from "./detailCodes.js";

const LABELS = {};
CATEGORIES.forEach((cat) => {
  LABELS[cat.key] = Object.fromEntries(cat.codes.map((c) => [c.code, c.label]));
});

// Labels verified against the stored official DfT code guide.
const SURFACE_LABELS = {
  1: "Dry", 2: "Wet or damp", 3: "Snow", 4: "Frost or ice",
  5: "Flood over 3 cm deep", 6: "Oil or diesel", 7: "Mud",
  9: "Unknown (self-reported)",
};

const RECORD_FIELDS = {
  vehicle: [
    ["vehicle_type", "Vehicle type"],
    ["generic_make_model", "Make / model"],
    ["vehicle_manoeuvre", "Manoeuvre"],
    ["sex_of_driver", "Driver sex"],
    ["age_of_driver", "Driver age"],
    ["journey_purpose_of_driver", "Journey purpose"],
    ["age_band_of_driver", "Driver age band"],
    ["age_of_vehicle", "Vehicle age"],
    ["engine_capacity_cc", "Engine capacity"],
    ["propulsion_code", "Propulsion"],
    ["escooter_flag", "E-scooter"],
    ["first_point_of_impact", "First impact"],
    ["towing_and_articulation", "Towing / articulation"],
    ["skidding_and_overturning", "Skidding / overturning"],
    ["hit_object_in_carriageway", "Object hit on road"],
    ["hit_object_off_carriageway", "Object hit off road"],
    ["junction_location", "Junction location"],
    ["vehicle_direction_from", "Direction from"],
    ["vehicle_direction_to", "Direction to"],
    ["vehicle_leaving_carriageway", "Leaving the road"],
    ["vehicle_left_hand_drive", "Left-hand drive"],
    ["vehicle_location_restricted_lane", "Restricted lane"],
    ["driver_distance_banding", "Driver distance band"],
    ["driver_imd_decile", "Driver IMD decile"],
    ["lsoa_of_driver", "Driver LSOA"],
    ["journey_purpose_of_driver_historic", "Journey purpose (historic)"],
    ["vehicle_manoeuvre_historic", "Manoeuvre (historic)"],
    ["vehicle_location_restricted_lane_historic", "Restricted lane (historic)"],
  ],
  casualty: [
    ["casualty_severity", "Injury severity"],
    ["casualty_class", "Person's role"],
    ["casualty_type", "Road user type"],
    ["sex_of_casualty", "Sex"],
    ["age_of_casualty", "Age"],
    ["vehicle_reference", "Linked vehicle"],
    ["age_band_of_casualty", "Age band"],
    ["enhanced_casualty_severity", "Detailed severity"],
    ["casualty_injury_based", "Severity reporting"],
    ["car_passenger", "Car passenger"],
    ["bus_or_coach_passenger", "Bus / coach passenger"],
    ["pedestrian_location", "Pedestrian location"],
    ["pedestrian_movement", "Pedestrian movement"],
    ["pedestrian_road_maintenance_worker", "Road maintenance worker"],
    ["casualty_distance_banding", "Distance band"],
    ["casualty_imd_decile", "IMD decile"],
    ["lsoa_of_casualty", "LSOA"],
    ["casualty_adjusted_severity_serious", "Serious severity adjustment"],
    ["casualty_adjusted_severity_slight", "Slight severity adjustment"],
  ],
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function recordedValue(value) {
  return value === undefined || value === null || value === "" || String(value) === "-1"
    ? "Not recorded"
    : String(value);
}

function categoryLabel(key, value) {
  const recorded = recordedValue(value);
  return recorded === "Not recorded" ? recorded : LABELS[key]?.[String(value)] || `Unknown code (${recorded})`;
}

function recordValue(kind, field, value) {
  const recorded = recordedValue(value);
  if (recorded === "Not recorded") return recorded;
  const codes = DETAIL_CODES[kind][field];
  if (codes) return codes[recorded] || `Unknown code (${recorded})`;
  if (["age_of_driver", "age_of_casualty", "age_of_vehicle"].includes(field)) return `${recorded} years`;
  if (field === "engine_capacity_cc") return `${recorded} cc`;
  if (field === "vehicle_reference") return `Vehicle ${recorded}`;
  return recorded;
}

function collisionRows(record) {
  const p = record.feature.properties;
  const speed = recordedValue(p.speed_limit);
  const surface = recordedValue(p.road_surface_conditions);
  return [
    ["Collision severity", categoryLabel("severity", p.collision_severity)],
    ["Date", recordedValue(p.date)],
    ["Time", recordedValue(p.time)],
    ["Lighting", categoryLabel("lighting", p.light_conditions)],
    ["Weather", categoryLabel("weather", p.weather_conditions)],
    ["Road class", categoryLabel("roadClass", p.first_road_class)],
    ["Road type", categoryLabel("roadType", p.road_type)],
    ["Road number", recordedValue(p.first_road_number)],
    ["Road surface", SURFACE_LABELS[surface] || surface],
    ["Speed limit", speed === "Not recorded" ? speed : `${speed} mph`],
    ["Vehicles", recordedValue(p.number_of_vehicles)],
    ["Casualties", recordedValue(p.number_of_casualties)],
  ];
}

function renderRecordRows(kind, record, fields) {
  return `<dl class="detail-rows">${fields.map(([field, label]) =>
    `<div><dt>${label}</dt><dd>${escapeHtml(recordValue(kind, field, record[field]))}</dd></div>`,
  ).join("")}</dl>`;
}

function renderLinkedRecords(kind, collision) {
  const records = kind === "vehicle" ? collision.vehicles : collision.casualties;
  const name = kind === "vehicle" ? "vehicle" : "casualty";
  if (records.length === 0) return `<p class="control-hint">No linked ${name} records found in this year's data.</p>`;
  const expected = collision.feature.properties[kind === "vehicle" ? "number_of_vehicles" : "number_of_casualties"];
  const mismatch = Number(expected) !== records.length;
  const hint = kind === "vehicle"
    ? "All vehicles in this collision."
    : "Each injured person is listed separately. Injury severity can differ from the overall collision severity.";
  return `<p class="control-hint">${hint}</p>
    ${mismatch ? `<p class="control-hint">${escapeHtml(expected)} reported in the collision record; ${records.length} linked records available.</p>` : ""}
    ${records.map((record, index) => {
      const reference = record[`${kind}_reference`];
      const title = kind === "vehicle"
        ? `Vehicle ${recordedValue(reference)} · ${recordValue(kind, "vehicle_type", record.vehicle_type)}`
        : `Casualty ${recordedValue(reference)} · ${recordValue(kind, "casualty_severity", record.casualty_severity)}`;
      const subtitle = kind === "vehicle"
        ? `${recordValue(kind, "sex_of_driver", record.sex_of_driver)} · ${recordValue(kind, "age_of_driver", record.age_of_driver)}`
        : `${recordValue(kind, "casualty_class", record.casualty_class)} · ${recordValue(kind, "age_of_casualty", record.age_of_casualty)}`;
      return `<details class="linked-record" ${index === 0 ? "open" : ""}>
        <summary><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></summary>
        ${renderRecordRows(kind, record, RECORD_FIELDS[kind].slice(0, 6))}
        <details class="more-record-details"><summary>More ${name} details</summary>
          ${renderRecordRows(kind, record, RECORD_FIELDS[kind].slice(6))}
          <p class="control-hint">Not recorded means the source has no usable value. Historic fields use the earlier recording format.
            IMD is the Index of Multiple Deprivation. LSOA is a small statistical area.
            ${kind === "casualty" ? "Severity adjustments are statistical weights, not extra casualties or injury diagnoses." : ""}</p>
        </details>
      </details>`;
    }).join("")}`;
}

// Creates the panel controller. onChange(record|null) is called when the
// shown collision changes (so the map can ring it).
export function createDetailsPanel(onChange) {
  const panel = document.getElementById("collision-details");
  const content = document.getElementById("details-content");
  const tabs = panel.querySelector(".details-tabs");
  let current = null;
  let group = [];
  let activeTab = "collision";

  function render() {
    if (!current) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const p = current.feature.properties;
    tabs.querySelectorAll("[data-details-tab]").forEach((button) => {
      const kind = button.dataset.detailsTab;
      const active = kind === activeTab;
      button.textContent = kind === "collision" ? "Collision"
        : kind === "vehicle" ? `Vehicles (${current.vehicles.length})` : `Casualties (${current.casualties.length})`;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    content.setAttribute("aria-labelledby", `details-tab-${activeTab}`);
    const index = group.indexOf(current);
    content.innerHTML = `
      <div class="detail-heading"><span class="detail-year" style="background:rgb(var(--year-${p.collision_year}))">${escapeHtml(p.collision_year)}</span>
        <strong>${escapeHtml(categoryLabel("severity", p.collision_severity))} collision</strong></div>
      <p class="record-reference">${escapeHtml(p.collision_index)}</p>
      ${group.length > 1 ? `<div class="location-records">
        <span>${group.length} collisions at this location<br><strong>Record ${index + 1} of ${group.length}</strong></span>
        <button type="button" data-record-step="-1" aria-label="Previous collision at this location" ${index === 0 ? "disabled" : ""}>←</button>
        <button type="button" data-record-step="1" aria-label="Next collision at this location" ${index === group.length - 1 ? "disabled" : ""}>→</button>
      </div>` : ""}
      ${activeTab === "collision"
        ? `<dl class="detail-rows">${collisionRows(current).map(([name, value]) => `<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
          <div><dt>Coordinates</dt><dd>${current.lon.toFixed(5)}, ${current.lat.toFixed(5)}</dd></div></dl>`
        : renderLinkedRecords(activeTab, current)}`;
  }

  function open(record, sameLocation) {
    if (current !== record && !sameLocation) activeTab = "collision";
    current = record;
    group = sameLocation || [record];
    content.scrollTop = 0;
    render();
    onChange(record);
  }

  function close() {
    if (!current) return;
    current = null;
    group = [];
    render();
    onChange(null);
  }

  document.getElementById("close-details").addEventListener("click", close);
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-details-tab]");
    if (!button) return;
    activeTab = button.dataset.detailsTab;
    render();
    content.scrollTop = 0;
  });
  tabs.addEventListener("keydown", (event) => {
    const buttons = Array.from(tabs.querySelectorAll("[data-details-tab]"));
    const index = buttons.indexOf(document.activeElement);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    activeTab = buttons[next].dataset.detailsTab;
    render();
    buttons[next].focus();
  });
  content.addEventListener("click", (event) => {
    const button = event.target.closest("[data-record-step]");
    if (!button || button.disabled) return;
    const next = group[group.indexOf(current) + Number(button.dataset.recordStep)];
    if (next) open(next, group);
  });

  return { open, close, isOpen: () => current !== null, current: () => current };
}
