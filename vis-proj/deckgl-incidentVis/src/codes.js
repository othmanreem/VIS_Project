// Generated from official_data_guide_2025.xlsx (sheet: 2024_code_list).
// Speed limit options use the values present in the collision files.
// Codes are strings because the GeoJSON files store them as strings.
// source identifies the records that must match the chosen conditions.
export const CATEGORIES = [
    {
        key: 'severity', label: 'Collision severity', short: 'Severity',
        source: 'collision', field: 'collision_severity',
        codes: [
            {"code": "1", "label": "Fatal"},
            {"code": "2", "label": "Serious"},
            {"code": "3", "label": "Slight"},
        ]
    },
    {
        key: 'roadClass', label: 'Road class', short: 'Road class',
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
        key: 'roadType', label: 'Road type', short: 'Road type',
        source: 'collision', field: 'road_type',
        codes: [
            {"code": "1", "label": "Roundabout"},
            {"code": "2", "label": "One way street"},
            {"code": "3", "label": "Dual carriageway"},
            {"code": "6", "label": "Single carriageway"},
            {"code": "7", "label": "Slip road"},
            {"code": "9", "label": "Unknown"},
            {"code": "12", "label": "One way street/Slip road"},
            {"code": "-1", "label": "Data missing or out of range"},
        ]
    },
    {
        key: 'roadSurface', label: 'Road surface', short: 'Surface',
        source: 'collision', field: 'road_surface_conditions',
        codes: [
            {"code": "1", "label": "Dry"},
            {"code": "2", "label": "Wet or damp"},
            {"code": "3", "label": "Snow"},
            {"code": "4", "label": "Frost or ice"},
            {"code": "5", "label": "Flood over 3cm. deep"},
            {"code": "6", "label": "Oil or diesel"},
            {"code": "7", "label": "Mud"},
            {"code": "-1", "label": "Data missing or out of range"},
            {"code": "9", "label": "unknown (self reported)"},
        ]
    },
    {
        key: 'speedLimit', label: 'Speed limit', short: 'Speed',
        source: 'collision', field: 'speed_limit',
        codes: [
            {"code": "20", "label": "20 mph"},
            {"code": "30", "label": "30 mph"},
            {"code": "40", "label": "40 mph"},
            {"code": "50", "label": "50 mph"},
            {"code": "60", "label": "60 mph"},
            {"code": "70", "label": "70 mph"},
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
        key: 'vehicleType', label: 'Vehicle type', short: 'Vehicle',
        source: 'vehicle', field: 'vehicle_type',
        codes: [
            {"code": "1", "label": "Pedal cycle"},
            {"code": "2", "label": "Motorcycle 50cc and under"},
            {"code": "3", "label": "Motorcycle 125cc and under"},
            {"code": "4", "label": "Motorcycle over 125cc and up to 500cc"},
            {"code": "5", "label": "Motorcycle over 500cc"},
            {"code": "8", "label": "Taxi/Private hire car"},
            {"code": "9", "label": "Car"},
            {"code": "10", "label": "Minibus (8 - 16 passenger seats)"},
            {"code": "11", "label": "Bus or coach (17 or more pass seats)"},
            {"code": "16", "label": "Ridden horse"},
            {"code": "17", "label": "Agricultural vehicle"},
            {"code": "18", "label": "Tram"},
            {"code": "19", "label": "Van / Goods 3.5 tonnes mgw or under"},
            {"code": "20", "label": "Goods over 3.5t. and under 7.5t"},
            {"code": "21", "label": "Goods 7.5 tonnes mgw and over"},
            {"code": "22", "label": "Mobility scooter"},
            {"code": "23", "label": "Electric motorcycle"},
            {"code": "90", "label": "Other vehicle"},
            {"code": "97", "label": "Motorcycle - unknown cc"},
            {"code": "98", "label": "Goods vehicle - unknown weight"},
            {"code": "99", "label": "Unknown vehicle type (self rep only)"},
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
            {"code": "1", "label": "0 - 5"},
            {"code": "2", "label": "6 - 10"},
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
    {
        key: 'casualtySeverity', label: 'Casualty severity', short: 'Injury severity',
        source: 'casualty', field: 'casualty_severity',
        codes: [
            {"code": "1", "label": "Fatal"},
            {"code": "2", "label": "Serious"},
            {"code": "3", "label": "Slight"},
        ]
    },
    {
        key: 'casualtyRole', label: 'Casualty role', short: 'Role',
        source: 'casualty', field: 'casualty_class',
        codes: [
            {"code": "1", "label": "Driver or rider"},
            {"code": "2", "label": "Passenger"},
            {"code": "3", "label": "Pedestrian"},
        ]
    },
    {
        key: 'casualtyType', label: 'Casualty road user type', short: 'Road user',
        source: 'casualty', field: 'casualty_type',
        codes: [
            {"code": "0", "label": "Pedestrian"},
            {"code": "1", "label": "Cyclist"},
            {"code": "2", "label": "Motorcycle 50cc and under rider or passenger"},
            {"code": "3", "label": "Motorcycle 125cc and under rider or passenger"},
            {"code": "4", "label": "Motorcycle over 125cc and up to 500cc rider or  passenger"},
            {"code": "5", "label": "Motorcycle over 500cc rider or passenger"},
            {"code": "8", "label": "Taxi/Private hire car occupant"},
            {"code": "9", "label": "Car occupant"},
            {"code": "10", "label": "Minibus (8 - 16 passenger seats) occupant"},
            {"code": "11", "label": "Bus or coach occupant (17 or more pass seats)"},
            {"code": "16", "label": "Horse rider"},
            {"code": "17", "label": "Agricultural vehicle occupant"},
            {"code": "18", "label": "Tram occupant"},
            {"code": "19", "label": "Van / Goods vehicle (3.5 tonnes mgw or under) occupant"},
            {"code": "20", "label": "Goods vehicle (over 3.5t. and under 7.5t.) occupant"},
            {"code": "21", "label": "Goods vehicle (7.5 tonnes mgw and over) occupant"},
            {"code": "22", "label": "Mobility scooter rider"},
            {"code": "23", "label": "Electric motorcycle rider or passenger"},
            {"code": "90", "label": "Other vehicle occupant"},
            {"code": "97", "label": "Motorcycle - unknown cc rider or passenger"},
            {"code": "98", "label": "Goods vehicle (unknown weight) occupant"},
            {"code": "99", "label": "Unknown vehicle type (self rep only)"},
            {"code": "-1", "label": "Data missing or out of range"},
        ]
    },
    {
        key: 'casualtyAge', label: 'Casualty age range', short: 'Age',
        source: 'casualty', field: 'age_band_of_casualty',
        codes: [
            {"code": "1", "label": "0 - 5"},
            {"code": "2", "label": "6 - 10"},
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
    {
        key: 'casualtySex', label: 'Casualty sex', short: 'Sex',
        source: 'casualty', field: 'sex_of_casualty',
        codes: [
            {"code": "1", "label": "Male"},
            {"code": "2", "label": "Female"},
            {"code": "9", "label": "unknown (self reported)"},
            {"code": "-1", "label": "Data missing or out of range"},
        ]
    },
];
