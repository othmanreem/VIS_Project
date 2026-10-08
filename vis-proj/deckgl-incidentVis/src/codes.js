// Generated from official_data_guide_2025.xlsx (sheet: 2024_code_list).
// Codes are strings because the GeoJSON files store them as strings.
// source: 'collision' = read from the collision feature itself,
//         'vehicle'   = read from the vehicle features joined on collision_index.
export const CATEGORIES = [
    {
        key: 'severity', label: 'Severity', short: 'Severity',
        source: 'collision', field: 'collision_severity',
        codes: [
            {"code": "1", "label": "Fatal"},
            {"code": "2", "label": "Serious"},
            {"code": "3", "label": "Slight"},
        ]
    },
    {
        key: 'roadType', label: 'Road type', short: 'Road',
        source: 'collision', field: 'first_road_class',
        codes: [
            {"code": "1", "label": "Motorway"},
            {"code": "2", "label": "A(M)"},
            {"code": "3", "label": "A"},
            {"code": "4", "label": "B"},
            {"code": "5", "label": "C"},
            {"code": "6", "label": "Unclassified"},
            {"code": "-1", "label": "Data missing or out of range"},
        ]
    },
    {
        key: 'lighting', label: 'Lighting', short: 'Light',
        source: 'collision', field: 'light_conditions',
        codes: [
            {"code": "1", "label": "Daylight"},
            {"code": "4", "label": "Darkness - lights lit"},
            {"code": "5", "label": "Darkness - lights unlit"},
            {"code": "6", "label": "Darkness - no lighting"},
            {"code": "7", "label": "Darkness - lighting unknown"},
            {"code": "-1", "label": "Data missing or out of range"},
        ]
    },
    {
        key: 'weather', label: 'Weather', short: 'Weather',
        source: 'collision', field: 'weather_conditions',
        codes: [
            {"code": "1", "label": "Fine no high winds"},
            {"code": "2", "label": "Raining no high winds"},
            {"code": "3", "label": "Snowing no high winds"},
            {"code": "4", "label": "Fine + high winds"},
            {"code": "5", "label": "Raining + high winds"},
            {"code": "6", "label": "Snowing + high winds"},
            {"code": "7", "label": "Fog or mist"},
            {"code": "8", "label": "Other"},
            {"code": "9", "label": "Unknown"},
            {"code": "-1", "label": "Data missing or out of range"},
        ]
    },
    {
        key: 'driverGender', label: 'Driver gender', short: 'Gender',
        source: 'vehicle', field: 'sex_of_driver',
        codes: [
            {"code": "1", "label": "Male"},
            {"code": "2", "label": "Female"},
            {"code": "3", "label": "Not known"},
            {"code": "-1", "label": "Data missing or out of range"},
        ]
    },
    {
        key: 'driverAge', label: 'Driver age range', short: 'Age',
        source: 'vehicle', field: 'age_band_of_driver',
        codes: [
            {"code": "3", "label": "11 - 15"},
            {"code": "4", "label": "16 - 20"},
            {"code": "5", "label": "21 - 25"},
            {"code": "6", "label": "26 - 35"},
            {"code": "7", "label": "36 - 45"},
            {"code": "8", "label": "46 - 55"},
            {"code": "9", "label": "56 - 65"},
            {"code": "10", "label": "66 - 75"},
            {"code": "11", "label": "Over 75"},
            {"code": "-1", "label": "Data missing or out of range"},
        ]
    },
];