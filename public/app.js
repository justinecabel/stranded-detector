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
  const gpsPermissionDialog = document.querySelector('#gps-permission');
  const allowGpsButton = document.querySelector('#allow-gps');
  const gpsLaterButton = document.querySelector('#gps-later');
  const gpsPermissionStatus = document.querySelector('#gps-permission-status');
  const zoomLevelIndicator = document.querySelector('#zoom-level');
  const recenterButton = document.querySelector('#recenter-button');
  const reportControls = document.querySelector('.report-controls');
  const historyRoller = document.querySelector('#history-roller');
  const historySlider = document.querySelector('#history-slider');
  const historyTimeLabel = document.querySelector('#history-time-label');
  const historyPlayButton = document.querySelector('#history-play');
  const REPORT_BUTTON_LABEL = 'I am stranded :(';
  const ACTIVE_REPORT_BUTTON_LABEL = 'Click again to mark yourself safe';
  const COOLDOWN_BUTTON_LABEL = 'Relax!';
  const HEAT_MIN_ZOOM = 14;
  const HEAT_MAX_ZOOM = 20;
  const HEAT_SCALE_MAX = 1;
  const GPS_MIN_ZOOM = HEAT_MIN_ZOOM;
  const GPS_DEFAULT_ZOOM = HEAT_MAX_ZOOM;
  const HISTORY_MAX_MINUTES = 180;
  const HISTORY_STEP_MINUTES = 5;
  const DEVICE_TOKEN_STORAGE_KEY = 'stranded-detector-device-token';

  function apiUrl(pathname) {
    return apiBaseUrl ? `${apiBaseUrl}${pathname}` : pathname;
  }

  function createBrowserDeviceToken() {
    if (!apiBaseUrl) return '';

    try {
      const existing = window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
      if (/^[A-Za-z0-9_-]{43}$/.test(existing || '')) return existing;

      const bytes = new Uint8Array(32);
      window.crypto.getRandomValues(bytes);
      const token = window
        .btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
      return token;
    } catch {
      return '';
    }
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

  const devGps = readDevGps();
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
    minOpacity: 0.28,
    max: HEAT_SCALE_MAX,
    maxZoom: 20,
    gradient: {
      0.2: '#f97316',
      0.4: '#fb923c',
      0.6: '#ef4444',
      0.8: '#dc2626',
      1: '#7f1d1d'
    }
  }).addTo(map);

  let eventSource;
  let reconnectTimer;
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
  let reportAfterPermission = false;
  let followingGps = true;
  let heatSyncFrame;
  let displayedHeatCells = [];
  let historyOffsetMinutes = 0;
  let historyRequestId = 0;
  let historyAbortController;
  let historyPlaybackTimer;
  let historyRefreshTimer;
  let historyPlaying = false;

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
    map.flyTo(centeredPosition, GPS_DEFAULT_ZOOM);
  }

  function heatmapWeight(count) {
    const value = Number(count);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 100) return 1;
    if (value >= 25) return 0.8;
    if (value >= 10) return 0.6;
    if (value >= 4) return 0.4;
    return 0.2;
  }

  function renderHeatCells(cells = historyOffsetMinutes === 0 ? latestHeatCells : displayedHeatCells) {
    const visibleCells = cells.map((cell) => ({ ...cell }));
    const heatCanvas = document.querySelector('.leaflet-heatmap-layer');
    heatCanvas?.setAttribute('data-cell-count', String(visibleCells.length));

    heatLayer.setOptions({ max: HEAT_SCALE_MAX });
    heatLayer.setLatLngs(
      visibleCells.map((cell) => [cell.latitude, cell.longitude, heatmapWeight(cell.count)])
    );
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

  async function loadHistory() {
    const zoom = map.getZoom();
    if (zoom < HEAT_MIN_ZOOM || zoom > HEAT_MAX_ZOOM) {
      displayedHeatCells = [];
      renderHeatCells(displayedHeatCells);
      return;
    }

    const bbox = viewportBbox();
    if (!bbox) {
      displayedHeatCells = [];
      renderHeatCells(displayedHeatCells);
      return;
    }

    historyAbortController?.abort();
    historyAbortController = new AbortController();
    const requestId = ++historyRequestId;
    const observedAt = Date.now() - historyOffsetMinutes * 60 * 1000;

    try {
      const response = await fetch(
        apiUrl(`/history?bbox=${encodeURIComponent(bbox)}&at=${observedAt}`),
        { cache: 'no-store', signal: historyAbortController.signal }
      );
      if (!response.ok) throw new Error(`History request failed: ${response.status}`);
      const snapshot = await response.json();
      if (requestId !== historyRequestId || historyOffsetMinutes === 0) return;
      displayedHeatCells = snapshot.cells;
      renderHeatCells(displayedHeatCells);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (requestId !== historyRequestId || historyOffsetMinutes === 0) return;
      displayedHeatCells = [];
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
      historyAbortController?.abort();
      historyRequestId += 1;
      displayedHeatCells = latestHeatCells;
      renderHeatCells();
      scheduleMapDataRefresh();
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

  function viewportBbox() {
    const bounds = map.getBounds();
    const west = Math.max(PHILIPPINES.west, bounds.getWest());
    const east = Math.min(PHILIPPINES.east, bounds.getEast());
    const south = Math.max(PHILIPPINES.south, bounds.getSouth());
    const north = Math.min(PHILIPPINES.north, bounds.getNorth());

    if (west >= east || south >= north) {
      return null;
    }
    return [west, south, east, north].map((value) => value.toFixed(6)).join(',');
  }

  function connectEvents() {
    closeLiveEvents();

    if (historyOffsetMinutes !== 0) return;

    const zoom = map.getZoom();
    if (zoom < HEAT_MIN_ZOOM || zoom > HEAT_MAX_ZOOM) {
      latestHeatCells = [];
      displayedHeatCells = [];
      document.querySelector('.leaflet-heatmap-layer')?.setAttribute('data-cell-count', '0');
      heatLayer.setLatLngs([]);
      return;
    }

    const bbox = viewportBbox();
    if (!bbox) {
      latestHeatCells = [];
      displayedHeatCells = [];
      document.querySelector('.leaflet-heatmap-layer')?.setAttribute('data-cell-count', '0');
      heatLayer.setLatLngs([]);
      return;
    }

    eventSource = new EventSource(apiUrl(`/events?bbox=${encodeURIComponent(bbox)}`));
    eventSource.addEventListener('snapshot', (event) => {
      const snapshot = JSON.parse(event.data);
      latestHeatCells = snapshot.cells;
      displayedHeatCells = latestHeatCells;
      renderHeatCells();
    });
  }

  function syncHeatmapToMap() {
    if (heatSyncFrame !== undefined) return;
    heatSyncFrame = requestAnimationFrame(() => {
      heatSyncFrame = undefined;
      heatLayer._reset?.();
    });
  }

  map.on('moveend', () => {
    syncHeatmapToMap();
    scheduleMapDataRefresh();
    updateRecenterButton();
  });
  map.on('move', syncHeatmapToMap);
  map.on('resize', () => {
    syncHeatmapToMap();
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
    map.getContainer().classList.add('is-zooming');
    showZoomLevel();
  }

  function finishZoom() {
    if (devGps) hideZoomLevelSoon();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        map.getContainer().classList.remove('is-zooming');
      });
    });
  }

  map.on('zoomstart', beginZoom);
  map.on('zoom', showZoomLevel);
  map.on('zoomend', finishZoom);

  function scheduleMapDataRefresh() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (historyOffsetMinutes === 0) connectEvents();
      else loadHistory();
    }, 350);
  }

  historySlider.addEventListener('input', () => {
    if (historyPlaying) stopHistoryPlayback();
    setHistoryOffset(historySlider.value);
  });
  historyPlayButton.addEventListener('click', toggleHistoryPlayback);
  updateHistoryLabel();
  connectEvents();

  recenterButton.addEventListener('click', () => {
    if (lastKnownLocation) focusOnGpsLocation(lastKnownLocation);
    else openGpsPrompt();
  });

  function updateTrackedLocation(coords) {
    const position = L.latLng(coords.latitude, coords.longitude);
    if (!isInPhilippines(position)) return;
    lastKnownLocation = position;
    showLocationIndicator(position);
    renderHeatCells();

    if (followingGps && gpsZoomLocked) {
      map.panTo(gpsAwareMapCenter(position), { animate: true });
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
      renderHeatCells();
      if (updateMainMap) {
        focusOnGpsLocation(position, { animate: !instantFocus });
      } else if (followingGps && gpsZoomLocked) {
        map.panTo(gpsAwareMapCenter(position), { animate: true });
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
        startLocationWatch();
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

  function openGpsPrompt({ forReport = false } = {}) {
    reportAfterPermission = reportAfterPermission || forReport;
    gpsPermissionStatus.replaceChildren();
    allowGpsButton.disabled = false;
    allowGpsButton.textContent = 'Allow GPS';
    if (!window.isSecureContext) {
      gpsPermissionStatus.innerHTML =
        '<p class="message message--error">GPS requires HTTPS or localhost.</p>';
    }
    if (!gpsPermissionDialog.open) gpsPermissionDialog.showModal();
  }

  function closeGpsPrompt() {
    reportAfterPermission = false;
    if (gpsPermissionDialog.open) gpsPermissionDialog.close();
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
    if (reason === 'outside') return 'Your GPS location is outside the Philippines.';
    if (reason === 'unavailable') return 'Your device could not determine its GPS location.';
    if (reason === 'timeout') return 'GPS timed out. Please try again.';
    if (reason === 'unsupported') return 'GPS is unavailable in this browser.';
    return 'GPS permission was denied. Enable location in browser settings.';
  }

  async function initializeGpsPermission() {
    if (devGps) {
      requestDeviceLocation({ updateMainMap: true, instantFocus: true });
      return;
    }

    try {
      if (navigator.permissions) {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission.state === 'granted') {
          requestDeviceLocation({ updateMainMap: true, instantFocus: true });
          return;
        }
      }
    } catch {
      // Fall back to the app prompt when the Permissions API is unavailable.
    }
    openGpsPrompt();
  }

  allowGpsButton.addEventListener('click', () => {
    if (!window.isSecureContext) {
      gpsPermissionStatus.innerHTML =
        '<p class="message message--error">This HTTP preview cannot request GPS. Open the HTTPS version.</p>';
      return;
    }

    const shouldReport = reportAfterPermission;
    allowGpsButton.disabled = true;
    allowGpsButton.textContent = 'Requesting…';
    gpsPermissionStatus.replaceChildren();

    requestDeviceLocation({
      updateMainMap: true,
      fresh: true,
      onSuccess: (position) => {
        closeGpsPrompt();
        if (shouldReport) postGpsReport(position);
      },
      onError: (reason) => {
        allowGpsButton.disabled = false;
        allowGpsButton.textContent = 'Allow GPS';
        gpsPermissionStatus.innerHTML =
          `<p class="message message--error">${gpsErrorMessage(reason)}</p>`;
      }
    });
  });

  gpsLaterButton.addEventListener('click', closeGpsPrompt);
  gpsPermissionDialog.addEventListener('cancel', () => {
    reportAfterPermission = false;
  });

  initializeGpsPermission();

  function submitGpsReport() {
    reportStatus.replaceChildren();
    if (!lastKnownLocation) {
      openGpsPrompt({ forReport: true });
      return;
    }

    reportButton.disabled = true;
    reportButton.dataset.mode = 'locating';
    reportButton.querySelector('strong').textContent = 'Locating…';
    requestDeviceLocation({
      fresh: true,
      onSuccess: postGpsReport,
      onError: (reason) => {
        resetReportButton();
        openGpsPrompt({ forReport: true });
        gpsPermissionStatus.innerHTML =
          `<p class="message message--error">${gpsErrorMessage(reason)}</p>`;
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
    if (!expiryRefreshPending && window.htmx) {
      expiryRefreshPending = true;
      window.htmx.ajax('GET', apiUrl('/reports/mine'), {
        target: '#active-reports',
        swap: 'outerHTML'
      });
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
  function loadActiveReportsFromApi() {
    if (!apiBaseUrl || !window.htmx) return;

    window.htmx.ajax('GET', apiUrl('/reports/mine'), {
      target: '#active-reports',
      swap: 'outerHTML'
    }).catch(() => {
      expiryRefreshPending = false;
    });
  }

  if (apiBaseUrl) {
    // HTMX reads the cross-origin policy from its meta tag on DOMContentLoaded.
    // Deferred app scripts run just before that event, so wait until HTMX has
    // applied the policy before making the first Funnel request.
    window.addEventListener('DOMContentLoaded', loadActiveReportsFromApi, { once: true });
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
  });
})();
