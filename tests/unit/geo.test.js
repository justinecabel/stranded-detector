import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRID_SIZE_METERS,
  gridCenter,
  parseBbox,
  projectToGrid,
  validateCoordinates,
  validatePhilippinesCoordinates
} from '../../src/geo.js';

test('validates finite coordinates within Web Mercator bounds', () => {
  assert.equal(validateCoordinates(14.5995, 120.9842), true);
  assert.equal(validateCoordinates(86, 120), false);
  assert.equal(validateCoordinates(10, 181), false);
  assert.equal(validateCoordinates(Number.NaN, 0), false);
});

test('accepts report coordinates only inside the Philippines bounds', () => {
  assert.equal(validatePhilippinesCoordinates(14.5995, 120.9842), true);
  assert.equal(validatePhilippinesCoordinates(35.6762, 139.6503), false);
  assert.equal(validatePhilippinesCoordinates(1.3521, 103.8198), false);
});

test('projects a location to a stable 128 metre grid', () => {
  const location = { latitude: 14.5995, longitude: 120.9842 };
  const grid = projectToGrid(location.latitude, location.longitude);
  const sameGrid = projectToGrid(location.latitude, location.longitude);
  const center = gridCenter(grid.gridX, grid.gridY);

  assert.equal(GRID_SIZE_METERS, 128);
  assert.deepEqual(sameGrid, grid);
  assert.notEqual(center.latitude, location.latitude);
  assert.notEqual(center.longitude, location.longitude);
});

test('parses only ordered, supported bounding boxes', () => {
  assert.deepEqual(parseBbox('120,14,122,16'), {
    west: 120,
    south: 14,
    east: 122,
    north: 16
  });
  assert.equal(parseBbox('122,14,120,16'), null);
  assert.equal(parseBbox('not,a,bbox'), null);
  assert.equal(parseBbox('-181,-20,20,20'), null);
});
