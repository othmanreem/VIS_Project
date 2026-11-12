import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildConcentrations, compareConcentrations } from '../src/concentrations.js';
import { inPolygon } from '../src/hotspots.js';

const config=JSON.parse(fs.readFileSync(new URL('../public/dataset.json',import.meta.url)));
const years=config.years;
const records=years.flatMap(yr=>JSON.parse(fs.readFileSync(new URL('../public/'+config.files.collisions.replace('{year}',yr),import.meta.url))).features.map(f=>({lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],yr,road:''}))).map((r,i)=>({...r,i}));
for(const size of [250,500,1000]) {
  const bins=buildConcentrations(records,years,size);
  assert.equal(bins.reduce((s,b)=>s+b.members.length,0),2016);
  assert.equal(new Set(bins.flatMap(b=>b.members)).size,2016);
  for(const b of bins) {
    assert.equal(b.polygon.length,6);
    for(const i of b.members)assert.ok(inPolygon(records[i].lon,records[i].lat,b.polygon),`Collision ${i} belongs inside its hexagon`);
  }
  const {totals,rows}=compareConcentrations(bins,years,2020,2025);
  assert.deepEqual(totals,[208,318,403,357,373,357]);
  assert.equal(rows.reduce((s,b)=>s+b.delta,0),357-208);
  const share=compareConcentrations(bins,years,2020,2025,'share');
  for(let i=0;i<years.length;i++) assert.ok(Math.abs(share.rows.reduce((s,b)=>s+b.values[i],0)-100)<1e-9);
  assert.ok(Math.abs(share.rows.reduce((s,b)=>s+b.delta,0))<1e-9);
  const reversed=compareConcentrations(bins,years,2025,2020);
  rows.forEach((b,i)=>assert.ok(b.delta===-reversed.rows[i].delta));
  assert.ok(compareConcentrations(bins,years,2023,2023).rows.every(b=>b.delta===0));
  // Filtering the annual counts never changes geometry or original membership.
  const empty=bins.map(b=>({...b,counts:years.map(()=>0)}));
  const result=compareConcentrations(empty,years,2020,2025,'share');
  assert.ok(result.rows.every(b=>b.delta===0&&b.values.every(v=>v===0)));
  console.log(`${size} m: all records assigned once; annual totals, shares, reversal and empty comparisons correct`);
}
