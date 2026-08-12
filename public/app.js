(() => {
  const body = document.body;
  const tileUrl = body.dataset.mapTileUrl;
  const attribution = body.dataset.mapAttribution;
  const devGpsEnabled = body.dataset.enableDevGps === 'true';
  const apiBaseUrl = (body.dataset.apiBaseUrl || '').replace(/\/+$/, '');
  const reportForm = document.querySelector('#report-form');
  const reportButton = document.querySelector('#report-button');
  const latitudeInput = document.querySelector('#latitude');
  const longitudeInput = document.querySelector('#longitude');
  const reportStatus = document.querySelector('#report-status');
  const zoomLevelIndicator = document.querySelector('#zoom-level');
  const recenterButton = document.querySelector('#recenter-button');
  const reportControls = document.querySelector('.report-controls');
  const historyRoller = document.querySelector('#history-roller');
  const historySlider = document.querySelector('#history-slider');
  const historyTimeLabel = document.querySelector('#history-time-label');
  const historyPlayButton = document.querySelector('#history-play');
  const overviewMapShell = document.querySelector('.overview-map');
  const overviewMapToggle = document.querySelector('#overview-map-toggle');
  const REPORT_BUTTON_LABEL = 'I am stranded :(';
  const ACTIVE_REPORT_BUTTON_LABEL = 'Click again to mark yourself safe';
  const COOLDOWN_BUTTON_LABEL = 'Relax!';
  const HEAT_SCALE_MAX = 100;
  const GPS_MIN_ZOOM = 10;
  const GPS_DEFAULT_ZOOM = 20;
  const GPS_TRANSITION_SECONDS = 0.45;
  const HISTORY_MAX_MINUTES = 180;
  const HISTORY_STEP_MINUTES = 5;
  const HISTORY_CACHE_TTL_MS = 60_000;
  const DEVICE_TOKEN_STORAGE_KEY = 'stranded-detector-device-token';
  const HEAT_GRADIENT = {
    0.2: '#f59e0b',
    0.4: '#f97316',
    0.6: '#ef4444',
    0.8: '#dc2626',
    1: '#7f1d1d'
  };

  const installedPwa = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;

  if (installedPwa) {
    document.documentElement.classList.add('is-installed-pwa');
    document.querySelector('meta[name="viewport"]')?.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    );

    const preventNativeGesture = (event) => event.preventDefault();
    document.addEventListener('contextmenu', preventNativeGesture);
    document.addEventListener('gesturestart', preventNativeGesture, { passive: false });
    document.addEventListener('wheel', (event) => {
      if (event.ctrlKey) event.preventDefault();
    }, { passive: false });
    document.addEventListener('keydown', (event) => {
      if (
        (event.ctrlKey || event.metaKey)
        && ['+', '-', '=', '0'].includes(event.key)
      ) event.preventDefault();
    });
  }

  function apiUrl(pathname) {
    return apiBaseUrl ? `${apiBaseUrl}${pathname}` : pathname;
  }

  function createBrowserDeviceToken() {
    if (!apiBaseUrl) return '';

    try {
      const existing = window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
      if (/^[A-Za-z0-9_-]{43}$/.test(existing || '')) return existing;
    } catch {
      // An in-memory token still preserves ownership for this PWA session.
    }

    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    const token = window
      .btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    try {
      window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
    } catch {
      // Storage can be unavailable in private or restored standalone sessions.
    }
    return token;
  }

  const browserDeviceToken = createBrowserDeviceToken();

  document.body.addEventListener('htmx:configRequest', (event) => {
    if (apiBaseUrl && typeof event.detail.path === 'string' && event.detail.path.startsWith('/')) {
      event.detail.path = apiUrl(event.detail.path);
    }
    if (browserDeviceToken) {
      event.detail.headers['X-Device-Token'] = browserDeviceToken;
    }
  });

  const PHILIPPINES = {
    center: [12.8797, 121.774],
    south: 4.3,
    west: 116.5,
    north: 21.3,
    east: 127
  };
  const philippinesBounds = L.latLngBounds(
    [PHILIPPINES.south, PHILIPPINES.west],
    [PHILIPPINES.north, PHILIPPINES.east]
  );
  const philippinesBbox = [
    PHILIPPINES.west,
    PHILIPPINES.south,
    PHILIPPINES.east,
    PHILIPPINES.north
  ].join(',');

  function readDevGps() {
    if (!devGpsEnabled) return null;
    const value = new URLSearchParams(window.location.search).get('devGps');
    if (!value) return null;

    if (value === '1' || value.toLowerCase() === 'manila') {
      return { latitude: 14.5995, longitude: 120.9842, accuracy: 12 };
    }

    const [latitudeText, longitudeText, ...extra] = value.split(',');
    if (extra.length > 0) return null;
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const position = L.latLng(latitude, longitude);
    if (!philippinesBounds.contains(position)) return null;
    return { latitude, longitude, accuracy: 12 };
  }

  function readDevHeatCount() {
    if (!devGpsEnabled) return 0;
    const value = new URLSearchParams(window.location.search).get('devHeat');
    if (!/^\d+$/.test(value || '')) return 0;
    return Math.min(500, Math.max(0, Number(value)));
  }

  function createDevHeatCells(count) {
    const clusters = [
      [14.5995, 120.9842, 0.42],
      [14.676, 121.0437, 0.68],
      [14.5547, 121.0244, 0.84],
      [14.5378, 120.9896, 0.94],
      [14.6507, 120.9668, 1]
    ];
    const usedPerCluster = Array(clusters.length).fill(0);

    return Array.from({ length: count }, (_, index) => {
      const progress = (index + 0.5) / count;
      const clusterIndex = clusters.findIndex((cluster) => progress <= cluster[2]);
      const [centerLatitude, centerLongitude] = clusters[clusterIndex];
      const localIndex = usedPerCluster[clusterIndex]++;
      const angle = localIndex * 2.399963229728653 + clusterIndex * 0.7;
      const distanceKm = 0.08 + Math.sqrt(localIndex + 1) * 0.11;
      const latitudeOffset = Math.cos(angle) * distanceKm / 111;
      const longitudeOffset = Math.sin(angle) * distanceKm
        / (111 * Math.cos(centerLatitude * Math.PI / 180));

      return {
        latitude: centerLatitude + latitudeOffset,
        longitude: centerLongitude + longitudeOffset,
        count: 1
      };
    });
  }

  const devGps = readDevGps();
  const devHeatCount = readDevHeatCount();
  const devHeatCells = createDevHeatCells(devHeatCount);
  document.documentElement.classList.toggle('is-dev-gps', Boolean(devGps));

  const map = L.map('map', {
    zoomControl: false,
    minZoom: 5,
    maxZoom: 20,
    worldCopyJump: false,
    maxBounds: philippinesBounds,
    maxBoundsViscosity: 1
  }).setView(PHILIPPINES.center, 6);

  L.tileLayer(tileUrl, {
    attribution,
    maxNativeZoom: 19,
    maxZoom: 20,
    crossOrigin: true
  }).addTo(map);

  const heatLayer = L.heatLayer([], {
    radius: 34,
    blur: 24,
    minOpacity: 0.08,
    max: HEAT_SCALE_MAX,
    maxZoom: GPS_MIN_ZOOM,
    gradient: HEAT_GRADIENT
  }).addTo(map);

  const overviewMap = L.map('overview-map', {
    attributionControl: false,
    boxZoom: false,
    doubleClickZoom: false,
    dragging: false,
    fadeAnimation: false,
    keyboard: false,
    minZoom: 3,
    maxZoom: 7,
    scrollWheelZoom: false,
    touchZoom: false,
    zoomAnimation: false,
    zoomControl: false
  });

  L.tileLayer(tileUrl, {
    attribution: '',
    maxNativeZoom: 19,
    maxZoom: 7,
    opacity: 0.78,
    crossOrigin: true
  }).addTo(overviewMap);
  overviewMap.fitBounds(philippinesBounds, { animate: false, padding: [5, 5] });

  const overviewHeatLayer = L.heatLayer([], {
    radius: 12,
    blur: 9,
    minOpacity: 0.08,
    max: HEAT_SCALE_MAX,
    maxZoom: 3,
    gradient: HEAT_GRADIENT
  }).addTo(overviewMap);
  const overviewViewport = L.rectangle(map.getBounds(), {
    className: 'overview-map__viewport',
    color: 'rgba(255, 255, 255, 0.95)',
    fill: true,
    fillColor: '#ffffff',
    fillOpacity: 0.04,
    interactive: false,
    weight: 1
  }).addTo(overviewMap);

  let eventSource;
  let zoomIndicatorTimer;
  let countdownTimer;
  let countdownAnimationFrame;
  let countdownAnimationExpiry;
  let cooldownTimer;
  let expiryRefreshPending = false;
  let latestHeatCells = [];
  let lastKnownLocation;
  let locationMarker;
  let locationWatchId;
  let gpsZoomLocked = false;
  let followingGps = true;
  let heatSyncFrame;
  let mapResizeFrame;
  let displayedHeatCells = [];
  let historyOffsetMinutes = 0;
  let historyRequestId = 0;
  let historyAbortController;
  let historyTimelineCache = new Map();
  let historyTimelineCachedAt = 0;
  let historyTimelinePromise;
  let historyTimelineUnsupported = false;
  let historyPlaybackTimer;
  let historyRefreshTimer;
  let historyPlaying = false;
  let heatStyleZoom;
  let overviewExpanded = false;
  let overviewPointerId;
  let overviewPointerMoved = false;
  let overviewPointerStart;

  function isInPhilippines(latlng) {
    return philippinesBounds.contains(latlng);
  }

  function showLocationIndicator(position) {
    if (!locationMarker) {
      const locationIcon = L.divIcon({
        className: 'user-location-marker',
        html: '<span aria-hidden="true"></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      locationMarker = L.marker(position, {
        icon: locationIcon,
        interactive: false,
        keyboard: false,
        alt: 'Your location',
        title: 'Your location'
      }).addTo(map);
    } else {
      locationMarker.setLatLng(position);
    }
  }

  function updateRecenterButton() {
    recenterButton.hidden = false;
  }

  function gpsAwareMapCenter(position, zoom = map.getZoom()) {
    const mapBounds = map.getContainer().getBoundingClientRect();
    const obstructionTop = Math.min(
      reportControls.getBoundingClientRect().top,
      historyRoller.getBoundingClientRect().top
    );
    const visibleBottom = Math.max(mapBounds.top, Math.min(mapBounds.bottom, obstructionTop));
    const hiddenHeight = Math.max(0, mapBounds.bottom - visibleBottom);
    const projectedPosition = map.project(position, zoom);

    return map.unproject(
      projectedPosition.add(L.point(0, hiddenHeight / 2)),
      zoom
    );
  }

  function focusOnGpsLocation(position, { animate = true } = {}) {
    followingGps = true;
    recenterButton.hidden = false;
    map.setMaxZoom(GPS_DEFAULT_ZOOM);
    const centeredPosition = gpsAwareMapCenter(position, GPS_DEFAULT_ZOOM);
    if (!animate) {
      map.setView(centeredPosition, GPS_DEFAULT_ZOOM, { animate: false });
      map.setMinZoom(GPS_MIN_ZOOM);
      gpsZoomLocked = true;
      return;
    }

    if (!gpsZoomLocked) {
      map.once('moveend', () => {
        map.setMinZoom(GPS_MIN_ZOOM);
        gpsZoomLocked = true;
      });
    }
    map.flyTo(centeredPosition, GPS_DEFAULT_ZOOM, {
      duration: GPS_TRANSITION_SECONDS
    });
  }

  function heatmapWeight(count) {
    const value = Number(count);
    if (!Number.isFinite(value) || value <= 0) return 0;
    const capped = Math.min(value, HEAT_SCALE_MAX);
    if (capped < 4) return 20 + (capped - 1) / 3 * 20;
    if (capped < 10) return 40 + (capped - 4) / 6 * 20;
    if (capped < 25) return 60 + (capped - 10) / 15 * 20;
    return 80 + (capped - 25) / 75 * 20;
  }

  function aggregateHeatCells(cells, targetMap, radius, blur) {
    const zoom = targetMap.getZoom();
    const cellSize = Math.max(1, (radius + blur) / 2);
    const grid = new Map();

    for (const cell of cells) {
      const count = Number(cell.count);
      if (!Number.isFinite(count) || count <= 0) continue;
      const point = targetMap.project([cell.latitude, cell.longitude], zoom);
      const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
      const cluster = grid.get(key) || {
        latitudeTotal: 0,
        longitudeTotal: 0,
        count: 0
      };
      cluster.latitudeTotal += Number(cell.latitude) * count;
      cluster.longitudeTotal += Number(cell.longitude) * count;
      cluster.count += count;
      grid.set(key, cluster);
    }

    return Array.from(grid.values(), (cluster) => ({
      latitude: cluster.latitudeTotal / cluster.count,
      longitude: cluster.longitudeTotal / cluster.count,
      count: cluster.count
    }));
  }

  function renderHeatCells(cells = historyOffsetMinutes === 0 ? latestHeatCells : displayedHeatCells) {
    const visibleCells = [
      ...cells.map((cell) => ({ ...cell })),
      ...devHeatCells
    ];
    const mainClusters = aggregateHeatCells(
      visibleCells,
      map,
      heatLayer.options.radius,
      heatLayer.options.blur
    );
    const overviewClusters = aggregateHeatCells(
      visibleCells,
      overviewMap,
      overviewHeatLayer.options.radius,
      overviewHeatLayer.options.blur
    );
    const heatPoints = mainClusters.map((cell) => [
      cell.latitude,
      cell.longitude,
      heatmapWeight(cell.count)
    ]);
    const overviewHeatPoints = overviewClusters.map((cell) => [
      cell.latitude,
      cell.longitude,
      heatmapWeight(cell.count)
    ]);

    heatLayer.setOptions({ max: HEAT_SCALE_MAX });
    heatLayer.setLatLngs(heatPoints);
    overviewHeatLayer.setOptions({ max: HEAT_SCALE_MAX });
    overviewHeatLayer.setLatLngs(overviewHeatPoints);

    const heatCanvas = map.getContainer().querySelector('.leaflet-heatmap-layer');
    heatCanvas?.setAttribute('data-cell-count', String(visibleCells.length));
    heatCanvas?.setAttribute('data-cluster-count', String(mainClusters.length));
    heatCanvas?.setAttribute(
      'data-peak-count',
      String(Math.max(0, ...mainClusters.map((cell) => cell.count)))
    );
    heatCanvas?.setAttribute('data-dev-report-count', String(devHeatCount));
    heatCanvas?.setAttribute('data-scale-max', String(HEAT_SCALE_MAX));
    overviewMap.getContainer()
      .querySelector('.leaflet-heatmap-layer')
      ?.setAttribute('data-cell-count', String(visibleCells.length));
  }

  function formatHistoryOffset(minutes) {
    if (minutes === 0) return 'Now';
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours === 0) return `${minutes} min ago`;
    if (remainingMinutes === 0) return `${hours} hr ago`;
    return `${hours} hr ${remainingMinutes} min ago`;
  }

  function positionHistoryTimeLabel() {
    const timeline = historyTimeLabel.parentElement;
    const timelineBounds = timeline.getBoundingClientRect();
    const timelineWidth = timelineBounds.width;
    const labelWidth = Math.min(historyTimeLabel.getBoundingClientRect().width, timelineWidth);
    const timelineProgress = 1 - historyOffsetMinutes / HISTORY_MAX_MINUTES;
    const targetPosition = timelineWidth * timelineProgress;
    const viewportWidth = document.documentElement.clientWidth;
    const availableSpaceBeforeTimeline = timelineBounds.left;
    const availableSpaceAfterTimeline = viewportWidth - timelineBounds.right;
    const labelCenter = Math.max(
      labelWidth / 2 - availableSpaceBeforeTimeline,
      Math.min(
        timelineWidth - labelWidth / 2 + availableSpaceAfterTimeline,
        targetPosition
      )
    );
    const pointerPosition = Math.max(
      0,
      Math.min(labelWidth, targetPosition - labelCenter + labelWidth / 2)
    );

    historyTimeLabel.style.setProperty('--history-label-center', `${labelCenter}px`);
    historyTimeLabel.style.setProperty('--history-pointer-position', `${pointerPosition}px`);
  }

  function updateHistoryLabel() {
    historyTimeLabel.textContent = formatHistoryOffset(historyOffsetMinutes);
    historyRoller.classList.toggle('is-historical', historyOffsetMinutes > 0);
    historySlider.style.setProperty(
      '--history-progress',
      `${((historyOffsetMinutes / HISTORY_MAX_MINUTES) * 100).toFixed(2)}%`
    );
    historyRoller.style.setProperty(
      '--history-position',
      `${(100 - (historyOffsetMinutes / HISTORY_MAX_MINUTES) * 100).toFixed(2)}%`
    );
    positionHistoryTimeLabel();
  }

  function stopHistoryPlayback() {
    if (historyPlaybackTimer) {
      clearInterval(historyPlaybackTimer);
      historyPlaybackTimer = undefined;
    }
    historyPlaying = false;
    historyPlayButton.classList.remove('is-playing');
    historyPlayButton.textContent = '▶';
    historyPlayButton.setAttribute('aria-label', 'Play heatmap history');
  }

  function closeLiveEvents() {
    if (eventSource) {
      eventSource.close();
      eventSource = undefined;
    }
  }

  function historyCacheIsFresh() {
    return historyTimelineCache.size > 0
      && Date.now() - historyTimelineCachedAt < HISTORY_CACHE_TTL_MS;
  }

  function fetchHistoryTimeline() {
    if (historyCacheIsFresh()) return Promise.resolve(historyTimelineCache);
    if (historyTimelineUnsupported) return Promise.resolve(historyTimelineCache);
    if (historyTimelinePromise) return historyTimelinePromise;

    historyAbortController = new AbortController();
    historyTimelinePromise = fetch(
      apiUrl(
        `/history?bbox=${encodeURIComponent(philippinesBbox)}`
        + `&minutes=${HISTORY_MAX_MINUTES}&step=${HISTORY_STEP_MINUTES}`
      ),
      { cache: 'no-store', signal: historyAbortController.signal }
    )
      .then((response) => {
        if (response.status === 400 || response.status === 404) {
          historyTimelineUnsupported = true;
          return null;
        }
        if (!response.ok) throw new Error(`History request failed: ${response.status}`);
        return response.json();
      })
      .then((timeline) => {
        if (!timeline) return historyTimelineCache;
        const nextCache = new Map();
        for (const snapshot of timeline.snapshots || []) {
          nextCache.set(Number(snapshot.offsetMinutes), snapshot.cells || []);
        }
        historyTimelineCache = nextCache;
        historyTimelineCachedAt = Date.now();
        return historyTimelineCache;
      })
      .finally(() => {
        historyTimelinePromise = undefined;
      });

    return historyTimelinePromise;
  }

  async function fetchLegacyHistorySnapshot(offsetMinutes) {
    // Older deployments reject the exact three-hour boundary because the
    // server clock advances between the browser calculation and validation.
    const safeOffsetMinutes = Math.min(
      offsetMinutes,
      HISTORY_MAX_MINUTES - HISTORY_STEP_MINUTES
    );
    const observedAt = Date.now() - safeOffsetMinutes * 60 * 1000;
    const response = await fetch(
      apiUrl(`/history?bbox=${encodeURIComponent(philippinesBbox)}&at=${observedAt}`),
      { cache: 'no-store' }
    );
    if (!response.ok) throw new Error(`History request failed: ${response.status}`);
    const snapshot = await response.json();
    const cells = snapshot.cells || [];
    historyTimelineCache.set(offsetMinutes, cells);
    historyTimelineCachedAt = Date.now();
    return cells;
  }

  async function loadHistory() {
    const requestedOffset = historyOffsetMinutes;
    const requestId = ++historyRequestId;
    const cachedCells = historyTimelineCache.get(requestedOffset);

    if (cachedCells) {
      displayedHeatCells = cachedCells;
      renderHeatCells(displayedHeatCells);
      if (historyCacheIsFresh()) return;
    }

    try {
      const timeline = await fetchHistoryTimeline();
      if (
        requestId !== historyRequestId ||
        historyOffsetMinutes === 0 ||
        historyOffsetMinutes !== requestedOffset
      ) return;
      let cells = timeline.get(requestedOffset);
      if (!cells && historyTimelineUnsupported) {
        cells = await fetchLegacyHistorySnapshot(requestedOffset);
      }
      if (
        requestId !== historyRequestId ||
        historyOffsetMinutes === 0 ||
        historyOffsetMinutes !== requestedOffset
      ) return;
      displayedHeatCells = cells || [];
      renderHeatCells(displayedHeatCells);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (requestId !== historyRequestId || historyOffsetMinutes === 0) return;
      displayedHeatCells = cachedCells || [];
      renderHeatCells(displayedHeatCells);
    }
  }

  function setHistoryOffset(value) {
    historyOffsetMinutes = Math.max(
      0,
      Math.min(HISTORY_MAX_MINUTES, Math.round(Number(value) / HISTORY_STEP_MINUTES) * HISTORY_STEP_MINUTES)
    );
    historySlider.value = String(historyOffsetMinutes);
    updateHistoryLabel();

    if (historyOffsetMinutes === 0) {
      historyRequestId += 1;
      displayedHeatCells = latestHeatCells;
      renderHeatCells();
      connectEvents();
      return;
    }

    closeLiveEvents();
    loadHistory();
  }

  function toggleHistoryPlayback() {
    if (historyPlaying) {
      stopHistoryPlayback();
      return;
    }

    historyPlaying = true;
    historyPlayButton.classList.add('is-playing');
    historyPlayButton.textContent = 'Ⅱ';
    historyPlayButton.setAttribute('aria-label', 'Pause heatmap history');
    if (historyOffsetMinutes === 0) setHistoryOffset(HISTORY_MAX_MINUTES);
    historyPlaybackTimer = setInterval(() => {
      const nextOffset = Math.max(0, historyOffsetMinutes - HISTORY_STEP_MINUTES);
      setHistoryOffset(nextOffset);
      if (nextOffset === 0) stopHistoryPlayback();
    }, 850);
  }

  function connectEvents() {
    closeLiveEvents();

    if (historyOffsetMinutes !== 0) return;

    eventSource = new EventSource(apiUrl(`/events?bbox=${encodeURIComponent(philippinesBbox)}`));
    eventSource.addEventListener('snapshot', (event) => {
      const snapshot = JSON.parse(event.data);
      latestHeatCells = snapshot.cells;
      displayedHeatCells = latestHeatCells;
      renderHeatCells();
    });
  }

  function syncMapOverlays() {
    if (heatSyncFrame !== undefined) return;
    heatSyncFrame = requestAnimationFrame(() => {
      heatSyncFrame = undefined;
      updateOverviewViewport();
    });
  }

  function updateHeatmapScale(requestedZoom = map.getZoom()) {
    const zoom = Math.round(requestedZoom * 2) / 2;
    if (zoom === heatStyleZoom) return;
    heatStyleZoom = zoom;

    const zoomRange = GPS_DEFAULT_ZOOM - GPS_MIN_ZOOM;
    const zoomProgress = Math.max(0, Math.min(1, (zoom - GPS_MIN_ZOOM) / zoomRange));
    const radius = Math.round(18 + (34 - 18) * zoomProgress);
    const blur = Math.round(12 + (24 - 12) * zoomProgress);
    heatLayer.setOptions({ radius, blur, max: HEAT_SCALE_MAX });
    renderHeatCells();

    const canvas = map.getContainer().querySelector('.leaflet-heatmap-layer');
    canvas?.setAttribute('data-radius', String(radius));
    canvas?.setAttribute('data-blur', String(blur));
  }

  function overviewViewportBounds() {
    const mainBounds = map.getBounds();
    const overviewZoom = overviewMap.getZoom();
    const centerPoint = overviewMap.project(map.getCenter(), overviewZoom);
    const northWest = overviewMap.project(mainBounds.getNorthWest(), overviewZoom);
    const southEast = overviewMap.project(mainBounds.getSouthEast(), overviewZoom);
    const width = Math.max(Math.abs(southEast.x - northWest.x), Number.EPSILON);
    const height = Math.max(Math.abs(southEast.y - northWest.y), Number.EPSILON);
    const visibilityScale = Math.max(1, 12 / width, 12 / height);
    const halfSize = L.point(width * visibilityScale / 2, height * visibilityScale / 2);

    return L.latLngBounds(
      overviewMap.unproject(centerPoint.subtract(halfSize), overviewZoom),
      overviewMap.unproject(centerPoint.add(halfSize), overviewZoom)
    );
  }

  function updateOverviewViewport() {
    overviewViewport.setBounds(overviewViewportBounds());
  }

  function setOverviewExpanded(expanded) {
    overviewExpanded = expanded;
    overviewMapShell.classList.toggle('is-expanded', expanded);
    overviewMapToggle.setAttribute('aria-expanded', String(expanded));
    overviewMapToggle.setAttribute(
      'aria-label',
      expanded ? 'Collapse Philippines overview' : 'Expand Philippines overview'
    );
    resizeMaps();
  }

  function fitOverviewMap() {
    const padding = overviewExpanded ? [1, 1] : [5, 5];
    overviewMap.fitBounds(philippinesBounds, { animate: false, padding });
  }

  function overviewPointerLatLng(event) {
    return overviewMap.mouseEventToLatLng(event);
  }

  function panMainMapFromOverview(event) {
    followingGps = false;
    map.panTo(overviewPointerLatLng(event), { animate: false });
  }

  overviewMapToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOverviewExpanded(!overviewExpanded);
  });

  overviewMapShell.addEventListener('click', (event) => {
    if (event.target.closest('.overview-map__toggle')) return;
    if (!overviewExpanded) setOverviewExpanded(true);
  });

  overviewMapShell.addEventListener('pointerdown', (event) => {
    if (!overviewExpanded || event.target.closest('.overview-map__toggle')) return;
    overviewPointerId = event.pointerId;
    overviewPointerMoved = false;
    overviewPointerStart = L.point(event.clientX, event.clientY);
    overviewMapShell.setPointerCapture(event.pointerId);
    overviewMapShell.classList.add('is-dragging');
    event.preventDefault();
  });

  overviewMapShell.addEventListener('pointermove', (event) => {
    if (event.pointerId !== overviewPointerId || !overviewPointerStart) return;
    const current = L.point(event.clientX, event.clientY);
    if (current.distanceTo(overviewPointerStart) >= 3) overviewPointerMoved = true;
    if (overviewPointerMoved) panMainMapFromOverview(event);
  });

  function finishOverviewPointer(event) {
    if (event.pointerId !== overviewPointerId) return;
    if (!overviewPointerMoved) panMainMapFromOverview(event);
    overviewMapShell.classList.remove('is-dragging');
    overviewPointerId = undefined;
    overviewPointerMoved = false;
    overviewPointerStart = undefined;
  }

  overviewMapShell.addEventListener('pointerup', finishOverviewPointer);
  overviewMapShell.addEventListener('pointercancel', finishOverviewPointer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overviewExpanded) setOverviewExpanded(false);
  });

  function resizeMaps() {
    if (mapResizeFrame !== undefined) cancelAnimationFrame(mapResizeFrame);
    mapResizeFrame = requestAnimationFrame(() => {
      mapResizeFrame = undefined;
      map.invalidateSize({ animate: false, pan: false });
      overviewMap.invalidateSize({ animate: false, pan: false });
      fitOverviewMap();
      updateOverviewViewport();
      renderHeatCells();
    });
  }

  const mapResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(resizeMaps)
    : undefined;
  mapResizeObserver?.observe(map.getContainer());
  mapResizeObserver?.observe(overviewMap.getContainer());
  window.addEventListener('resize', resizeMaps);
  window.visualViewport?.addEventListener('resize', resizeMaps);

  map.on('moveend', () => {
    syncMapOverlays();
    updateRecenterButton();
  });
  map.on('move', syncMapOverlays);
  map.on('resize', () => {
    syncMapOverlays();
    positionHistoryTimeLabel();
    if (!followingGps || !gpsZoomLocked || !lastKnownLocation) return;
    requestAnimationFrame(() => {
      map.setView(
        gpsAwareMapCenter(lastKnownLocation, map.getZoom()),
        map.getZoom(),
        { animate: false }
      );
    });
  });
  map.on('dragstart', () => {
    followingGps = false;
  });

  function showZoomLevel() {
    if (!devGps) return;
    clearTimeout(zoomIndicatorTimer);
    zoomLevelIndicator.textContent = `Zoom ${Math.round(map.getZoom())}`;
    zoomLevelIndicator.classList.add('is-visible');
    zoomLevelIndicator.setAttribute('aria-hidden', 'false');
  }

  function hideZoomLevelSoon() {
    if (!devGps) return;
    showZoomLevel();
    zoomIndicatorTimer = setTimeout(() => {
      zoomLevelIndicator.classList.remove('is-visible');
      zoomLevelIndicator.setAttribute('aria-hidden', 'true');
    }, 900);
  }

  function beginZoom() {
    showZoomLevel();
  }

  function finishZoom() {
    updateHeatmapScale();
    syncMapOverlays();
    if (devGps) hideZoomLevelSoon();
  }

  map.on('zoomstart', beginZoom);
  map.on('zoom', () => {
    showZoomLevel();
    syncMapOverlays();
  });
  map.on('zoomanim', syncMapOverlays);
  map.on('zoomend', finishZoom);

  updateHeatmapScale();

  historySlider.addEventListener('input', () => {
    if (historyPlaying) stopHistoryPlayback();
    setHistoryOffset(historySlider.value);
  });
  historyPlayButton.addEventListener('click', toggleHistoryPlayback);
  updateHistoryLabel();
  connectEvents();

  recenterButton.addEventListener('click', () => {
    if (lastKnownLocation) focusOnGpsLocation(lastKnownLocation);
    else requestDeviceLocation({
      updateMainMap: true,
      fresh: true,
      onError: showGpsError
    });
  });

  function updateTrackedLocation(coords) {
    const position = L.latLng(coords.latitude, coords.longitude);
    if (!isInPhilippines(position)) return;
    lastKnownLocation = position;
    showLocationIndicator(position);

    if (followingGps && gpsZoomLocked) {
      map.panTo(gpsAwareMapCenter(position), {
        animate: true,
        duration: GPS_TRANSITION_SECONDS
      });
    } else {
      updateRecenterButton();
    }
  }

  function startLocationWatch() {
    if (devGps || locationWatchId !== undefined || !navigator.geolocation) return;
    locationWatchId = navigator.geolocation.watchPosition(
      ({ coords }) => updateTrackedLocation(coords),
      () => {},
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 5_000
      }
    );
  }

  function requestDeviceLocation({
    updateMainMap = false,
    instantFocus = false,
    fresh = false,
    onSuccess,
    onError
  } = {}) {
    if (fresh && locationWatchId !== undefined && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchId);
      locationWatchId = undefined;
    }

    const acceptCoordinates = (coords) => {
      const position = L.latLng(coords.latitude, coords.longitude);
      if (!isInPhilippines(position)) {
        onError?.('outside');
        return;
      }

      lastKnownLocation = position;
      showLocationIndicator(position);
      if (updateMainMap) {
        focusOnGpsLocation(position, { animate: !instantFocus });
      } else if (followingGps && gpsZoomLocked) {
        map.panTo(gpsAwareMapCenter(position), {
          animate: true,
          duration: GPS_TRANSITION_SECONDS
        });
      } else {
        updateRecenterButton();
      }
      startLocationWatch();
      onSuccess?.(position);
    };

    if (devGps) {
      acceptCoordinates(devGps);
      return;
    }

    if (!navigator.geolocation) {
      onError?.('unsupported');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => acceptCoordinates(coords),
      (error) => {
        const reason =
          error.code === error.PERMISSION_DENIED
            ? 'denied'
            : error.code === error.POSITION_UNAVAILABLE
              ? 'unavailable'
              : 'timeout';
        onError?.(reason);
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: fresh ? 0 : 30_000
      }
    );
  }

  function postGpsReport(position) {
    reportButton.disabled = true;
    reportButton.dataset.mode = 'submitting';
    reportButton.querySelector('strong').textContent = 'Reporting…';
    focusOnGpsLocation(position);
    latitudeInput.value = position.lat.toFixed(7);
    longitudeInput.value = position.lng.toFixed(7);
    reportForm.requestSubmit();
  }

  function gpsErrorMessage(reason) {
    if (reason === 'insecure') return 'GPS requires HTTPS or localhost.';
    if (reason === 'outside') return 'Your GPS location is outside the Philippines.';
    if (reason === 'unavailable') return 'Your device could not determine its GPS location.';
    if (reason === 'timeout') return 'GPS timed out. Please try again.';
    if (reason === 'unsupported') return 'GPS is unavailable in this browser.';
    return 'GPS permission was denied. Enable location in browser settings.';
  }

  function showGpsError(reason) {
    reportStatus.innerHTML =
      `<p class="message message--error">${gpsErrorMessage(reason)}</p>`;
  }

  function initializeGps() {
    if (devGps) {
      requestDeviceLocation({ updateMainMap: true, instantFocus: true });
      return;
    }

    if (!window.isSecureContext) {
      showGpsError('insecure');
      return;
    }

    requestDeviceLocation({
      updateMainMap: true,
      instantFocus: true,
      onError: showGpsError
    });
  }

  initializeGps();

  function submitGpsReport() {
    reportStatus.replaceChildren();
    reportButton.disabled = true;
    reportButton.dataset.mode = 'locating';
    reportButton.querySelector('strong').textContent = 'Locating…';
    requestDeviceLocation({
      fresh: true,
      onSuccess: postGpsReport,
      onError: (reason) => {
        resetReportButton();
        showGpsError(reason);
      }
    });
  }

  function resetReportButton() {
    stopActiveCountdownAnimation();
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = undefined;
    }
    reportButton.disabled = false;
    reportButton.dataset.mode = 'report';
    reportButton.style.removeProperty('--report-progress');
    reportButton.style.removeProperty('--cooldown-duration');
    reportButton.removeAttribute('aria-label');
    reportButton.querySelector('strong').textContent = REPORT_BUTTON_LABEL;
  }

  function startReportCooldown(durationMs = 5000) {
    stopActiveCountdownAnimation();
    if (cooldownTimer) clearTimeout(cooldownTimer);
    reportStatus.replaceChildren();
    reportButton.disabled = true;
    reportButton.dataset.mode = 'cooldown';
    reportButton.style.setProperty('--report-progress', '100%');
    reportButton.style.setProperty('--cooldown-duration', `${durationMs}ms`);
    reportButton.setAttribute('aria-label', COOLDOWN_BUTTON_LABEL);
    reportButton.querySelector('strong').textContent = COOLDOWN_BUTTON_LABEL;

    cooldownTimer = setTimeout(() => {
      cooldownTimer = undefined;
      const report = activeReportState();
      const remaining = report
        ? Number(report.dataset.expiresAt) - Date.now()
        : 0;
      if (report && remaining > 0) showActiveReportButton(report, remaining);
      else resetReportButton();
    }, durationMs);
  }

  function activeReportState() {
    return document.querySelector('.active-report-state[data-expires-at]');
  }

  function stopActiveCountdownAnimation() {
    if (countdownAnimationFrame !== undefined) {
      cancelAnimationFrame(countdownAnimationFrame);
      countdownAnimationFrame = undefined;
    }
    countdownAnimationExpiry = undefined;
    reportButton.classList.remove('is-countdown-ending');
  }

  function animateActiveCountdown() {
    const report = activeReportState();
    const expiresAt = Number(report?.dataset.expiresAt);
    const createdAt = Number(report?.dataset.createdAt);

    if (
      !report ||
      reportButton.dataset.mode !== 'active' ||
      expiresAt !== countdownAnimationExpiry
    ) {
      stopActiveCountdownAnimation();
      return;
    }

    const duration = Math.max(1, expiresAt - createdAt);
    const remaining = Math.max(0, expiresAt - Date.now());
    const progress = Math.max(0, Math.min(100, (remaining / duration) * 100));
    reportButton.style.setProperty('--report-progress', `${progress.toFixed(3)}%`);
    reportButton.classList.toggle('is-countdown-ending', remaining > 0 && remaining <= 10_000);

    if (remaining > 0) {
      countdownAnimationFrame = requestAnimationFrame(animateActiveCountdown);
    } else {
      countdownAnimationFrame = undefined;
    }
  }

  function startActiveCountdownAnimation(report) {
    const expiresAt = Number(report.dataset.expiresAt);
    if (countdownAnimationFrame !== undefined && countdownAnimationExpiry === expiresAt) return;
    stopActiveCountdownAnimation();
    countdownAnimationExpiry = expiresAt;
    animateActiveCountdown();
  }

  function showActiveReportButton(report, remaining) {
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = undefined;
    }
    reportButton.style.removeProperty('--cooldown-duration');
    const createdAt = Number(report.dataset.createdAt);
    const expiresAt = Number(report.dataset.expiresAt);
    const duration = Math.max(1, expiresAt - createdAt);
    const progress = Math.max(0, Math.min(100, (remaining / duration) * 100));

    reportButton.disabled = false;
    reportButton.dataset.mode = 'active';
    reportButton.style.setProperty('--report-progress', `${progress.toFixed(2)}%`);
    reportButton.setAttribute('aria-label', ACTIVE_REPORT_BUTTON_LABEL);
    reportButton.querySelector('strong').textContent = ACTIVE_REPORT_BUTTON_LABEL;
    startActiveCountdownAnimation(report);
  }

  function handleReportButtonClick() {
    const activeReport = activeReportState();
    if (!activeReport) {
      submitGpsReport();
      return;
    }

    reportButton.disabled = true;
    reportButton.dataset.mode = 'resolving';
    stopActiveCountdownAnimation();
    reportButton.querySelector('strong').textContent = 'Resolving…';
    activeReport.requestSubmit();
  }

  reportButton.addEventListener('click', handleReportButtonClick);
  reportForm.addEventListener('htmx:afterRequest', (event) => {
    if (!event.detail.successful && event.detail.xhr.status !== 429) {
      resetReportButton();
    }
  });

  function updateCountdowns() {
    // The active-report countdown also runs once per second. Do not let it
    // replace the rate-limit cooldown label or re-enable the button early.
    if (reportButton.dataset.mode === 'cooldown') return;

    const report = activeReportState();
    if (!report) {
      if (!['locating', 'submitting', 'cooldown'].includes(reportButton.dataset.mode)) {
        resetReportButton();
      }
      return;
    }

    const remaining = Number(report.dataset.expiresAt) - Date.now();
    if (remaining > 0) {
      showActiveReportButton(report, remaining);
      return;
    }

    reportButton.style.setProperty('--report-progress', '0%');
    if (!expiryRefreshPending && (apiBaseUrl || window.htmx)) {
      expiryRefreshPending = true;
      if (apiBaseUrl) loadActiveReportsFromApi();
      else {
        window.htmx.ajax('GET', '/reports/mine', {
          target: '#active-reports',
          swap: 'outerHTML'
        });
      }
    }
  }

  function startCountdowns() {
    clearInterval(countdownTimer);
    updateCountdowns();
    countdownTimer = setInterval(updateCountdowns, 1000);
  }

  document.body.addEventListener('htmx:beforeSwap', (event) => {
    if (event.detail.xhr.status === 429) {
      event.detail.shouldSwap = false;
      event.detail.isError = false;
      return;
    }
    if (event.detail.xhr.status >= 400) {
      event.detail.shouldSwap = true;
      event.detail.isError = false;
    }
  });
  document.body.addEventListener('htmx:afterSwap', () => {
    expiryRefreshPending = false;
    startCountdowns();
    renderHeatCells();
  });
  document.body.addEventListener('htmx:afterRequest', (event) => {
    if (
      event.detail.elt?.matches?.('.active-report-state') &&
      !event.detail.successful
    ) {
      resetReportButton();
      startCountdowns();
    }
  });
  document.body.addEventListener('reportSaved', () => {
    startCountdowns();
    renderHeatCells();
    latitudeInput.value = '';
    longitudeInput.value = '';
    reportStatus.replaceChildren();
  });
  document.body.addEventListener('reportLimited', (event) => {
    startReportCooldown(Number(event.detail?.cooldownMs) || 5000);
  });

  function apiHeaders(includeContentType = false) {
    const headers = {
      Accept: 'text/html',
      'HX-Request': 'true'
    };
    if (browserDeviceToken) headers['X-Device-Token'] = browserDeviceToken;
    if (includeContentType) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    return headers;
  }

  function dispatchResponseTriggers(value) {
    if (!value) return;
    try {
      const triggers = JSON.parse(value);
      if (typeof triggers === 'string') {
        document.body.dispatchEvent(new CustomEvent(triggers));
        return;
      }
      for (const [name, detail] of Object.entries(triggers)) {
        document.body.dispatchEvent(new CustomEvent(name, { detail }));
      }
    } catch {
      document.body.dispatchEvent(new CustomEvent(value));
    }
  }

  function replaceActiveReports(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const replacement = template.content.querySelector('#active-reports');
    const current = document.querySelector('#active-reports');
    if (!replacement || !current) throw new Error('Invalid reporting response');
    current.replaceWith(replacement);
    expiryRefreshPending = false;
    startCountdowns();
    renderHeatCells();
  }

  async function loadActiveReportsFromApi() {
    if (!apiBaseUrl) return;

    try {
      const response = await fetch(apiUrl('/reports/mine'), {
        cache: 'no-store',
        credentials: 'omit',
        headers: apiHeaders()
      });
      if (!response.ok) throw new Error(`Reports request failed: ${response.status}`);
      replaceActiveReports(await response.text());
    } catch {
      expiryRefreshPending = false;
      reportStatus.innerHTML =
        '<p class="message message--error">Reporting service unavailable. Check your connection.</p>';
    }
  }

  async function submitCrossOriginReportForm(event) {
    if (!apiBaseUrl) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.matches('.gps-report-form, .active-report-state')) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const body = new URLSearchParams();
    for (const [name, value] of new FormData(form)) body.append(name, String(value));

    try {
      const response = await fetch(apiUrl(form.getAttribute('action')), {
        method: 'POST',
        credentials: 'omit',
        headers: apiHeaders(true),
        body
      });
      const html = await response.text();
      const trigger = response.headers.get('HX-Trigger');

      if (response.status === 429) {
        dispatchResponseTriggers(trigger);
        return;
      }
      if (!response.ok) {
        reportStatus.innerHTML = html
          || '<p class="message message--error">Unable to save this report.</p>';
        resetReportButton();
        return;
      }

      replaceActiveReports(html);
      dispatchResponseTriggers(trigger);
    } catch {
      resetReportButton();
      reportStatus.innerHTML =
        '<p class="message message--error">Reporting service unavailable. Check your connection.</p>';
    }
  }

  if (apiBaseUrl) {
    document.addEventListener('submit', submitCrossOriginReportForm, true);
    window.addEventListener('DOMContentLoaded', loadActiveReportsFromApi, { once: true });
  }

  if ('serviceWorker' in navigator) {
    const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
    let reloadingForServiceWorkerUpdate = false;

    if (hadServiceWorkerController) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForServiceWorkerUpdate) return;
        reloadingForServiceWorkerUpdate = true;
        window.location.reload();
      });
    }

    window.addEventListener('load', () => {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const pwaRoot = new URL('./', manifestLink.href);
      const serviceWorkerUrl = new URL('service-worker.js', pwaRoot);
      navigator.serviceWorker.register(serviceWorkerUrl, {
        scope: pwaRoot.pathname,
        updateViaCache: 'none'
      })
        .then((registration) => {
          registration.waiting?.postMessage('SKIP_WAITING');
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                worker.postMessage('SKIP_WAITING');
              }
            });
          });
          return registration.update();
        })
        .catch(() => {
          // Installation remains available through the browser menu if registration fails.
        });
    }, { once: true });
  }

  startCountdowns();

  window.addEventListener('beforeunload', () => {
    if (eventSource) eventSource.close();
    if (locationWatchId !== undefined) {
      navigator.geolocation.clearWatch(locationWatchId);
    }
    clearTimeout(zoomIndicatorTimer);
    clearInterval(countdownTimer);
    clearTimeout(cooldownTimer);
    clearTimeout(historyRefreshTimer);
    stopHistoryPlayback();
    historyAbortController?.abort();
    if (heatSyncFrame !== undefined) cancelAnimationFrame(heatSyncFrame);
    if (mapResizeFrame !== undefined) cancelAnimationFrame(mapResizeFrame);
    mapResizeObserver?.disconnect();
    window.removeEventListener('resize', resizeMaps);
    window.visualViewport?.removeEventListener('resize', resizeMaps);
  });
})();
