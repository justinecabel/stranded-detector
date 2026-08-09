const EARTH_RADIUS_METERS = 6_378_137;
const MAX_MERCATOR_LATITUDE = 85.05112878;
export const GRID_SIZE_METERS = 128;
export const PHILIPPINES_BOUNDS = Object.freeze({
  south: 4.3,
  west: 116.5,
  north: 21.3,
  east: 127
});

export function parseCoordinate(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
  return Number(value);
}

export function validateCoordinates(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -MAX_MERCATOR_LATITUDE &&
    latitude <= MAX_MERCATOR_LATITUDE &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function validatePhilippinesCoordinates(latitude, longitude) {
  return (
    validateCoordinates(latitude, longitude) &&
    latitude >= PHILIPPINES_BOUNDS.south &&
    latitude <= PHILIPPINES_BOUNDS.north &&
    longitude >= PHILIPPINES_BOUNDS.west &&
    longitude <= PHILIPPINES_BOUNDS.east
  );
}

export function projectToGrid(latitude, longitude) {
  if (!validateCoordinates(latitude, longitude)) {
    throw new RangeError('Coordinates are outside supported map bounds');
  }

  const x = EARTH_RADIUS_METERS * (longitude * Math.PI / 180);
  const latitudeRadians = latitude * Math.PI / 180;
  const y =
    EARTH_RADIUS_METERS *
    Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2));

  return {
    gridX: Math.floor(x / GRID_SIZE_METERS),
    gridY: Math.floor(y / GRID_SIZE_METERS)
  };
}

export function gridCenter(gridX, gridY) {
  const x = (gridX + 0.5) * GRID_SIZE_METERS;
  const y = (gridY + 0.5) * GRID_SIZE_METERS;

  return {
    longitude: x / EARTH_RADIUS_METERS * 180 / Math.PI,
    latitude:
      (2 * Math.atan(Math.exp(y / EARTH_RADIUS_METERS)) - Math.PI / 2) *
      180 /
      Math.PI
  };
}

export function parseBbox(value) {
  if (typeof value !== 'string') return null;
  const values = value.split(',').map(parseCoordinate);
  if (values.length !== 4 || values.some((coordinate) => !Number.isFinite(coordinate))) {
    return null;
  }

  const [west, south, east, north] = values;
  if (
    west < -180 ||
    east > 180 ||
    south < -MAX_MERCATOR_LATITUDE ||
    north > MAX_MERCATOR_LATITUDE ||
    west >= east ||
    south >= north
  ) {
    return null;
  }

  return { west, south, east, north };
}

export { MAX_MERCATOR_LATITUDE };
