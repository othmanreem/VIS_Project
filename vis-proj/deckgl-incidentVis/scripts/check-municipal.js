import assert from 'node:assert/strict';
import {roadUserGroups} from '../src/data.js';
import {annualUserData} from '../src/municipalCharts.js';
assert.deepEqual(new Set(roadUserGroups([{casualty_type:0},{casualty_type:1},{casualty_type:9}])),new Set([1,2,0]));
assert.deepEqual(roadUserGroups([{casualty_type:16}]),[4]);assert.deepEqual(roadUserGroups([{casualty_type:22}]),[4]);assert.deepEqual(roadUserGroups([]),[4]);
const rows=annualUserData([{yr:2020,users:[1,2],sev:1},{yr:2020,users:[1],sev:3},{yr:2025,users:[0],sev:2}], [2020,2025], ['Occupant','Pedestrian','Cyclist']);
assert.deepEqual(rows[1].cells[0].counts,[1,0,1]);assert.equal(rows[1].cells[0].share,50);assert.equal(rows[2].cells[0].n,1);assert.equal(rows[1].cells[1].share,null);assert.equal(rows[0].cells[1].share,100);
console.log('User grouping and annual severity counts passed: overlap, unknown/other types, severity distribution, zero vs missing.');
