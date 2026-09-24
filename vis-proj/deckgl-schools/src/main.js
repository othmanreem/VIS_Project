import { Deck } from '@deck.gl/core';
import {BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { TileLayer } from "@deck.gl/geo-layers";

import './style.css';


const INITIAL_VIEW_STATE = {
    longitude: -1.82,
    latitude: 53.72,
    zoom: 10,
    pitch: 0,
    bearing: 0
};


// ------------------------------------
// Base map
// ------------------------------------

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

            bounds: [
                west,
                south,
                east,
                north
            ]
        });
    }
});


// ------------------------------------
// Load GeoJSON
// ------------------------------------

async function loadData() {

    const response = await fetch('/calderdale_collisions_2021.geojson');

    return await response.json();
}


// ------------------------------------
// Create visualization
// ------------------------------------

async function createVisualization() {

    const data = await loadData();


    const schoolsLayer = new GeoJsonLayer({

        id: 'schools',

        data: data,

        pointType: 'circle',

        getPointRadius: 150,

        getElevation: feature => {
        
          const pupils = Number(
            feature.properties["Number of pupils on roll"]
          );
        
          return pupils * 10;
        },
        extruded: true,
        pitch: 45,

        getFillColor: [30, 120, 200, 200],

        getLineColor: [255, 255, 255, 255],

        lineWidthMinPixels: 1,

        pickable: true,

        autoHighlight: true
    });


    const deck = new Deck({

        parent: document.getElementById('map'),

        initialViewState: INITIAL_VIEW_STATE,

        controller: true,

        layers: [
            mapLayer,
            schoolsLayer
        ],

        getTooltip: ({ object }) => {

          if (!object) {
              return null;
          }
      
          const p = object.properties;
      
          return {
              html: `
                  <strong>Road Collision</strong>
                  <br>
                  Date: ${p.date}
                  <br>
                  Time: ${p.time}
                  <br>
                  Severity: ${p.collision_severity}
                  <br>
                  Casualties: ${p.number_of_casualties}
                  <br>
                  Vehicles: ${p.number_of_vehicles}
                  <br>
                  Speed limit: ${p.speed_limit} mph
                  <br>
                  Road number: ${p.first_road_number}
                  <br>
                  Road surface: ${p.road_surface_conditions}
                  <br>
                  Weather: ${p.weather_conditions}
                  <br>
                  Latitude: ${p.latitude}
                  <br>
                  Longitude: ${p.longitude}
              `
          };
      }
    });
}


createVisualization();