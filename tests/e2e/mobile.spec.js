import { expect, test } from '@playwright/test';

test('GPS-only self-report works at 320px with touch-sized controls', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 740 },
    geolocation: { latitude: 14.5995, longitude: 120.9842 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();
  const eventRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/events') eventRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#overview-map')).toBeVisible();
  await expect(page.locator('.overview-map__viewport')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-map-tile-url', /dark_all/);
  const locationMarker = page.locator('.user-location-marker');
  await expect(locationMarker).toBeVisible();
  await expect(locationMarker).toHaveCSS('width', '28px');
  await expect(locationMarker).toHaveCSS('height', '28px');
  await expect(page.locator('.leaflet-control-zoom')).toHaveCount(0);
  const zoomLevel = page.locator('#zoom-level');
  await expect(zoomLevel).toHaveText('');
  await expect(zoomLevel).toHaveAttribute('aria-hidden', 'true', { timeout: 3_000 });
  await expect.poll(() => eventRequests.length).toBeGreaterThan(0);
  await expect(page.locator('#map')).not.toHaveClass(/is-zooming/);
  await expect(page.locator('#map .leaflet-heatmap-layer')).not.toHaveCSS('opacity', '0');
  const heatmapLegend = page.locator('.heatmap-legend');
  await expect(heatmapLegend).toBeVisible();
  await expect(heatmapLegend).toHaveText('1–3\n4–9\n10–24\n25–99\n100+');
  await expect(heatmapLegend).toHaveCSS('background-image', /linear-gradient/);
  const heatmapLegendBox = await heatmapLegend.boundingBox();
  expect(heatmapLegendBox.x).toBeGreaterThanOrEqual(0);
  expect(heatmapLegendBox.x + heatmapLegendBox.width).toBeLessThanOrEqual(320);
  const historySlider = page.locator('#history-slider');
  await expect(historySlider).toBeVisible();
  await expect(historySlider).toHaveAttribute('max', '180');
  const historyBox = await page.locator('#history-roller').boundingBox();
  expect(historyBox.x).toBeCloseTo(0, 1);
  expect(historyBox.width).toBeCloseTo(320, 1);
  expect(historyBox.height).toBeLessThanOrEqual(105);
  expect(historyBox.y + historyBox.height).toBeCloseTo(740, 1);
  await historySlider.fill('180');
  const earliestPoint = await page.evaluate(() => {
    const dock = document.querySelector('#history-roller').getBoundingClientRect();
    const timeline = document.querySelector('.history-roller__timeline').getBoundingClientRect();
    const labelElement = document.querySelector('#history-time-label');
    const label = labelElement.getBoundingClientRect();
    const pointer = getComputedStyle(labelElement, '::after');
    return {
      labelInsideDock: label.left >= dock.left,
      pointerOffsetFromCenter: Number.parseFloat(pointer.left) - label.width / 2,
      pointerPosition: label.left + Number.parseFloat(pointer.left) - timeline.left
    };
  });
  expect(earliestPoint.labelInsideDock).toBe(true);
  expect(earliestPoint.pointerOffsetFromCenter).toBeCloseTo(0, 1);
  expect(earliestPoint.pointerPosition).toBeCloseTo(0, 1);
  await historySlider.fill('15');
  const historyTimeLabel = page.locator('#history-time-label');
  await expect(historyTimeLabel).toHaveText('15 min ago');
  await expect(historyTimeLabel).toHaveCSS('box-shadow', 'none');
  const labelLayout = await historyTimeLabel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    whiteSpace: getComputedStyle(element).whiteSpace
  }));
  expect(labelLayout.whiteSpace).toBe('nowrap');
  expect(labelLayout.scrollWidth).toBeLessThanOrEqual(labelLayout.clientWidth);
  await historySlider.fill('0');
  await expect(historyTimeLabel).toHaveText('Now');
  const dockControlGap = await page.evaluate(() => {
    const locationButton = document.querySelector('#recenter-button').getBoundingClientRect();
    const timeLabel = document.querySelector('#history-time-label').getBoundingClientRect();
    return timeLabel.top - locationButton.bottom;
  });
  expect(dockControlGap).toBeGreaterThanOrEqual(6);
  expect(dockControlGap).toBeLessThanOrEqual(10);
  const timePointerLayout = await historyTimeLabel.evaluate((element) => {
    const label = element.getBoundingClientRect();
    const dock = document.querySelector('#history-roller').getBoundingClientRect();
    const pointer = getComputedStyle(element, '::after');
    const timeline = document.querySelector('.history-roller__timeline').getBoundingClientRect();
    const pointerPosition = Number.parseFloat(pointer.left);
    return {
      labelBottomToDockTop: dock.top - label.bottom,
      pointerDepth: Number.parseFloat(pointer.borderTopWidth),
      pointerOffsetFromCenter: pointerPosition - label.width / 2,
      pointerToTimelineEnd: timeline.right - (label.left + pointerPosition),
      labelInsideTimeline: label.left >= timeline.left && label.right <= timeline.right
    };
  });
  expect(Math.abs(timePointerLayout.labelBottomToDockTop)).toBeLessThanOrEqual(1);
  expect(timePointerLayout.pointerDepth).toBeGreaterThanOrEqual(7);
  expect(timePointerLayout.pointerOffsetFromCenter).toBeGreaterThan(20);
  expect(timePointerLayout.pointerToTimelineEnd).toBeCloseTo(0, 1);
  expect(timePointerLayout.labelInsideTimeline).toBe(true);
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);

  const reportButton = page.locator('#report-button');
  await expect(reportButton).toHaveText('I am stranded :(');
  const reportBox = await reportButton.boundingBox();
  const panelBox = await page.locator('.control-panel').boundingBox();
  const reportControlsBox = await page.locator('.report-controls').boundingBox();
  expect(reportBox.height).toBeGreaterThanOrEqual(44);
  expect(reportControlsBox.x).toBeCloseTo(panelBox.x, 1);
  expect(reportControlsBox.width).toBeCloseTo(panelBox.width, 1);
  expect(panelBox.x).toBeCloseTo((320 - panelBox.width) / 2, 1);
  await reportButton.click();

  await expect(page.locator('#active-reports .message')).toHaveCount(0);
  await expect(page.locator('.active-report-state')).toHaveCount(1);
  await expect.poll(() =>
    page.locator('#map .leaflet-heatmap-layer').getAttribute('data-cell-count')
  ).toBe('1');
  await expect.poll(() =>
    page.locator('#overview-map .leaflet-heatmap-layer').getAttribute('data-cell-count')
  ).toBe('1');
  const maxHeatAlpha = await page.locator('#map .leaflet-heatmap-layer').evaluate((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let maximum = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      maximum = Math.max(maximum, pixels[index]);
    }
    return maximum;
  });
  expect(maxHeatAlpha).toBeGreaterThanOrEqual(50);
  await expect(reportButton).toBeEnabled();
  await expect(reportButton).toHaveText('Click again to mark yourself safe');
  await expect(reportButton).toHaveAttribute('data-mode', 'active');
  await expect.poll(() =>
    reportButton.evaluate((button) =>
      Number.parseFloat(button.style.getPropertyValue('--report-progress'))
    )
  ).toBeGreaterThan(95);
  const progressAtStart = await reportButton.evaluate((button) =>
    Number.parseFloat(button.style.getPropertyValue('--report-progress'))
  );
  await page.waitForTimeout(250);
  const progressAfterAnimation = await reportButton.evaluate((button) =>
    Number.parseFloat(button.style.getPropertyValue('--report-progress'))
  );
  expect(progressAfterAnimation).toBeLessThan(progressAtStart);

  await page.locator('.active-report-state').evaluate((report) => {
    report.dataset.createdAt = String(Date.now() - 291_000);
    report.dataset.expiresAt = String(Date.now() + 9_000);
  });
  await expect(reportButton).toHaveClass(/is-countdown-ending/, { timeout: 2_000 });

  await page.evaluate(() => {
    document.body.dispatchEvent(
      new CustomEvent('reportLimited', { detail: { cooldownMs: 1_500 } })
    );
  });
  await expect(reportButton).toHaveText('Relax!');
  await expect(reportButton).toBeDisabled();
  await page.waitForTimeout(1_100);
  await expect(reportButton).toHaveText('Relax!');
  await expect(reportButton).toBeDisabled();
  await expect(reportButton).toHaveText('Click again to mark yourself safe', { timeout: 2_000 });
  await expect(reportButton).toBeEnabled();

  await reportButton.click();
  await expect(page.locator('.active-report-state')).toHaveCount(0);
  await expect(reportButton).toHaveText('I am stranded :(');
  await context.close();
});

test('PWA is installable without overriding the browser install prompt', async ({ page }) => {
  await page.goto('/?devGps=manila');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest'
  );
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new URL(registration.scope).pathname;
  })).toBe('/');
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.updateViaCache;
  })).toBe('none');
  await expect(page.getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);
  const browserPromptWasPrevented = await page.evaluate(() => {
    const installEvent = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(installEvent);
    return installEvent.defaultPrevented;
  });
  expect(browserPromptWasPrevented).toBe(false);
});

test('installed PWA disables browser chrome gestures and text selection', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: true
    });
  });

  await page.goto('/?devGps=manila');
  await expect(page.locator('html')).toHaveClass(/is-installed-pwa/);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /maximum-scale=1, user-scalable=no/
  );
  await expect(page.locator('body')).toHaveCSS('user-select', 'none');
  await expect(page.locator('body')).toHaveCSS('overscroll-behavior', 'none');
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  await expect(page.locator('html')).toHaveCSS('min-height', `${viewportHeight}px`);
  await expect(page.locator('body')).toHaveCSS('min-height', `${viewportHeight}px`);
  await expect(page.locator('#history-roller')).toHaveCSS('padding-bottom', '0px');
  await expect(page.locator('.control-panel')).toHaveCSS('bottom', '121px');
  const dockBottom = await page.locator('#history-roller').evaluate(
    (dock) => dock.getBoundingClientRect().bottom
  );
  expect(dockBottom).toBeCloseTo(viewportHeight, 1);

  const contextMenuPrevented = await page.evaluate(() => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(contextMenuPrevented).toBe(true);
});

test('public frontend reports through its configured API without cookies', async ({ browser }) => {
  const context = await browser.newContext({
    geolocation: { latitude: 14.5995, longitude: 120.9842 },
    permissions: ['geolocation']
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest() && url.pathname === '/') {
      const response = await route.fetch();
      const html = (await response.text())
        .replace(
          'data-api-base-url=""',
          'data-api-base-url="http://127.0.0.1:4173"'
        )
        .replace(
          'action="/reports"',
          'action="http://127.0.0.1:4173/reports"'
        )
        .replace(
          'hx-post="/reports"',
          'hx-post="http://127.0.0.1:4173/reports"'
        );
      await route.fulfill({ response, body: html });
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  const reportRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/reports') {
      reportRequests.push(request);
    }
  });

  await page.goto('/?devGps=manila');
  await page.locator('#report-button').click();
  await expect(page.locator('.active-report-state')).toHaveCount(1);
  expect(reportRequests).toHaveLength(1);
  expect(reportRequests[0].headers()['x-device-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(reportRequests[0].headers()['hx-request']).toBe('true');

  await page.locator('#report-button').click();
  await expect(page.locator('.active-report-state')).toHaveCount(0);
  await context.close();
});

test('denied GPS prevents reporting at 390px', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  const eventRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/events') eventRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Allow GPS location?' })).toHaveCount(0);
  await expect(page.locator('#report-status')).toHaveText(/GPS permission was denied/);
  await page.waitForTimeout(500);
  expect(eventRequests).toHaveLength(1);
  expect(eventRequests[0]).toContain('bbox=116.5%2C4.3%2C127%2C21.3');
  await page.getByRole('button', { name: 'I am stranded :(', exact: true }).click();
  await expect(page.locator('#report-status')).toHaveText(/GPS permission was denied/);
  await expect(page.locator('.active-report-state')).toHaveCount(0);
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
  await context.close();
});

test('allowed GPS outside the Philippines is reported accurately', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 31.2304, longitude: 121.4737 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();

  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Allow GPS location?' })).toHaveCount(0);
  await expect(page.locator('#report-status')).toHaveText(/outside the Philippines/);
  await page.getByRole('button', { name: 'I am stranded :(', exact: true }).click();
  await expect(page.locator('#report-status')).toHaveText(/outside the Philippines/);
  await expect(page.locator('.active-report-state')).toHaveCount(0);
  await context.close();
});

test('My Location returns to the simulated GPS location', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();

  await page.goto('/?devGps=manila');
  const recenterButton = page.getByRole('button', {
    name: 'My Location',
    exact: true
  });
  await expect(recenterButton).toBeVisible();
  const visualCenterError = () => page.evaluate(() => {
    const marker = document.querySelector('.user-location-marker').getBoundingClientRect();
    const map = document.querySelector('#map').getBoundingClientRect();
    const controls = document.querySelector('.report-controls').getBoundingClientRect();
    const markerCenter = marker.top + marker.height / 2;
    const usableMapCenter = map.top + (controls.top - map.top) / 2;
    return Math.abs(markerCenter - usableMapCenter);
  });
  await expect.poll(visualCenterError).toBeLessThan(2);

  await page.mouse.move(195, 420);
  await page.mouse.down();
  await page.mouse.move(150, 420, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.user-location-marker')).toBeVisible();
  await expect(recenterButton).toBeVisible();
  await expect(recenterButton).toHaveCSS('border-radius', /^(?!0px$)/);
  const locationButtonBox = await recenterButton.boundingBox();
  const reportButtonBox = await page.locator('#report-button').boundingBox();
  expect(locationButtonBox.width).toBe(56);
  expect(locationButtonBox.height).toBe(reportButtonBox.height);
  expect(locationButtonBox.x - (reportButtonBox.x + reportButtonBox.width)).toBeCloseTo(8, 1);
  expect(locationButtonBox.y).toBeCloseTo(reportButtonBox.y, 1);

  const recenterStartedAt = Date.now();
  await recenterButton.click();
  await expect(recenterButton).toBeVisible();
  await expect(page.locator('.user-location-marker')).toBeVisible();
  await expect.poll(visualCenterError, { intervals: [25, 50, 75] }).toBeLessThan(2);
  expect(Date.now() - recenterStartedAt).toBeLessThanOrEqual(650);

  await page.setViewportSize({ width: 390, height: 700 });
  await expect.poll(visualCenterError).toBeLessThan(2);
  await context.close();
});

test('heatmap stays synchronized while browsing the map', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();

  await page.goto('/?devGps=manila');
  const heatLayer = page.locator('#map .leaflet-heatmap-layer');
  await expect(heatLayer).toHaveCount(1);
  await expect(page.locator('#overview-map .leaflet-heatmap-layer')).toHaveCount(1);
  await page.locator('#report-button').click();
  await expect(page.locator('.active-report-state')).toHaveCount(1);
  await expect.poll(() => heatLayer.getAttribute('data-cell-count')).toBe('1');

  const heatOffsetFromGps = () => heatLayer.evaluate((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let alphaTotal = 0;
    let xTotal = 0;
    let yTotal = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const alpha = pixels[(y * canvas.width + x) * 4 + 3];
        alphaTotal += alpha;
        xTotal += x * alpha;
        yTotal += y * alpha;
      }
    }
    const canvasBox = canvas.getBoundingClientRect();
    const gpsBox = document.querySelector('.user-location-marker').getBoundingClientRect();
    const heatX = canvasBox.left + xTotal / alphaTotal * canvasBox.width / canvas.width;
    const heatY = canvasBox.top + yTotal / alphaTotal * canvasBox.height / canvas.height;
    return {
      x: heatX - (gpsBox.left + gpsBox.width / 2),
      y: heatY - (gpsBox.top + gpsBox.height / 2)
    };
  });

  const offsetBeforeDrag = await heatOffsetFromGps();
  const heatTransformBeforeDrag = await heatLayer.evaluate((element) => element.style.transform);

  await page.mouse.move(195, 360);
  await page.mouse.down();
  await page.mouse.move(80, 280, { steps: 8 });
  await expect(heatLayer).not.toHaveCSS('opacity', '0');
  const heatTransformDuringDrag = await heatLayer.evaluate((element) => element.style.transform);
  expect(heatTransformDuringDrag).toBe(heatTransformBeforeDrag);
  const offsetDuringDrag = await heatOffsetFromGps();
  expect(Math.abs(offsetDuringDrag.x - offsetBeforeDrag.x)).toBeLessThanOrEqual(1.1);
  expect(Math.abs(offsetDuringDrag.y - offsetBeforeDrag.y)).toBeLessThanOrEqual(1.1);

  await page.mouse.up();
  await expect(heatLayer).not.toHaveCSS('opacity', '0');
  await expect.poll(async () =>
    Math.abs((await heatOffsetFromGps()).x - offsetBeforeDrag.x)
  ).toBeLessThanOrEqual(1.1);
  await expect.poll(async () =>
    Math.abs((await heatOffsetFromGps()).y - offsetBeforeDrag.y)
  ).toBeLessThanOrEqual(1.1);

  const devtools = await context.newCDPSession(page);
  const pinchPoint = (x) => ({
    x,
    y: 180,
    radiusX: 2,
    radiusY: 2,
    force: 1
  });
  await devtools.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [pinchPoint(40), pinchPoint(160)]
  });

  const pinchDrift = [];
  for (let step = 1; step <= 10; step += 1) {
    const halfSpan = 60 - step * 4;
    await devtools.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [pinchPoint(100 - halfSpan), pinchPoint(100 + halfSpan)]
    });
    await page.waitForTimeout(25);
    const offset = await heatOffsetFromGps();
    pinchDrift.push(Math.hypot(
      offset.x - offsetBeforeDrag.x,
      offset.y - offsetBeforeDrag.y
    ));
  }
  await devtools.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: []
  });

  expect(Math.max(...pinchDrift)).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 421, height: 478 });
  const overview = page.locator('.overview-map');
  const overviewToggle = page.locator('#overview-map-toggle');
  const collapsedOverviewBox = await overview.boundingBox();
  await expect(overviewToggle).toHaveAttribute('aria-expanded', 'false');
  await overview.locator('#overview-map').click({ position: { x: 12, y: 45 } });
  await expect(overview).toHaveClass(/is-expanded/);
  await expect(overviewToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(overviewToggle).toHaveAttribute('aria-label', 'Collapse Philippines overview');
  await expect.poll(async () => (await overview.boundingBox()).width).toBeGreaterThan(
    collapsedOverviewBox.width * 1.5
  );
  const expandedShape = await overview.boundingBox();
  expect(expandedShape.width / expandedShape.height).toBeCloseTo(0.62, 1);

  const viewportOutline = page.locator('.overview-map__viewport');
  await expect(viewportOutline).toHaveCSS('stroke-width', '1.25px');
  const viewportShape = await viewportOutline.boundingBox();
  expect(viewportShape.width).toBeGreaterThanOrEqual(5);
  expect(viewportShape.height).toBeGreaterThanOrEqual(5);
  expect(viewportShape.width / viewportShape.height).toBeCloseTo(421 / 478, 1);

  const expandedOverviewBox = await overview.boundingBox();
  const dragStart = {
    x: expandedOverviewBox.x + expandedOverviewBox.width * 0.45,
    y: expandedOverviewBox.y + expandedOverviewBox.height * 0.55
  };
  const dragEnd = {
    x: expandedOverviewBox.x + expandedOverviewBox.width * 0.68,
    y: expandedOverviewBox.y + expandedOverviewBox.height * 0.62
  };
  const viewportBeforeDrag = await viewportOutline.boundingBox();
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await viewportOutline.boundingBox()).x).not.toBeCloseTo(
    viewportBeforeDrag.x,
    1
  );

  await overviewToggle.click();
  await expect(overview).not.toHaveClass(/is-expanded/);
  await expect(overviewToggle).toHaveAttribute('aria-expanded', 'false');
  const resizedMap = await page.locator('#map').evaluate((element) => {
    const canvas = element.querySelector('.leaflet-heatmap-layer');
    return {
      mapWidth: element.clientWidth,
      mapHeight: element.clientHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    };
  });
  expect(resizedMap.canvasWidth).toBe(resizedMap.mapWidth);
  expect(resizedMap.canvasHeight).toBe(resizedMap.mapHeight);
  await context.close();
});

test('development GPS query simulates Manila without browser permission', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();

  await page.goto('/?devGps=manila');
  await expect(page.locator('.user-location-marker')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Allow GPS location?' })).not.toBeVisible();
  const reportButton = page.locator('#report-button');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await reportButton.click();
    await expect(reportButton).toHaveText('Click again to mark yourself safe');
    await expect(page.locator('.active-report-state')).toHaveCount(1);
    await reportButton.click();
    await expect(page.locator('.active-report-state')).toHaveCount(0);
    await expect(reportButton).toHaveText('I am stranded :(');
  }

  await reportButton.click();
  await expect(reportButton).toHaveText('Relax!');
  await expect(reportButton).toBeDisabled();
  await expect(page.locator('#report-status .message')).toHaveCount(0);
  await expect.poll(() =>
    reportButton.evaluate((button) => {
      const style = getComputedStyle(button, '::before');
      return {
        animationDuration: style.animationDuration,
        animationName: style.animationName
      };
    })
  ).toEqual({
    animationDuration: '5s',
    animationName: 'report-cooldown-progress'
  });
  await page.waitForTimeout(300);
  await expect.poll(() =>
    reportButton.evaluate((button) => {
      const transform = getComputedStyle(button, '::before').transform;
      return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
    })
  ).toBeLessThan(1);
  await expect(reportButton).toHaveText('I am stranded :(', { timeout: 7_000 });
  await expect(reportButton).toBeEnabled();
  await expect(reportButton).toHaveText('I am stranded :(');
  await expect(reportButton).toHaveAttribute('data-mode', 'report');
  await expect.poll(() =>
    reportButton.evaluate((button) => ({
      inlineProgress: button.style.getPropertyValue('--report-progress'),
      transitionDuration: getComputedStyle(button, '::before').transitionDuration
    }))
  ).toEqual({ inlineProgress: '', transitionDuration: '0s' });

  await reportButton.click();
  await expect(reportButton).toHaveText('Click again to mark yourself safe');
  await expect(page.locator('.active-report-state')).toHaveCount(1);
  await context.close();
});

test('GPS map supports the zoom 10 to 20 navigation range', async ({ page }) => {
  await page.goto('/?devGps=manila');
  const heatLayer = page.locator('#map .leaflet-heatmap-layer');
  await expect.poll(() => heatLayer.getAttribute('data-radius')).toBe('34');
  await expect.poll(() => heatLayer.getAttribute('data-blur')).toBe('24');
  await page.mouse.move(200, 240);
  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, 1000);
    await expect(heatLayer).not.toHaveCSS('opacity', '0');
    await page.waitForTimeout(350);
  }
  await expect(page.locator('#zoom-level')).toHaveText('Zoom 10');
  await expect.poll(() => heatLayer.getAttribute('data-radius')).toBe('18');
  await expect.poll(() => heatLayer.getAttribute('data-blur')).toBe('12');
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(400);
  await expect(page.locator('#zoom-level')).toHaveText('Zoom 10');
});

test('development heatmap combines 100 dummy reports by volume', async ({ page }) => {
  await page.goto('/?devGps=manila&devHeat=100');
  const heatLayer = page.locator('#map .leaflet-heatmap-layer');

  await expect.poll(() => heatLayer.getAttribute('data-dev-report-count')).toBe('100');
  await expect.poll(() => heatLayer.getAttribute('data-scale-max')).toBe('100');
  await expect.poll(async () => Number(await heatLayer.getAttribute('data-cell-count')))
    .toBeGreaterThanOrEqual(100);
  const closeZoomPeak = Number(await heatLayer.getAttribute('data-peak-count'));
  const closeZoomClusters = Number(await heatLayer.getAttribute('data-cluster-count'));

  await page.mouse.move(200, 240);
  for (let step = 0; step < 10; step += 1) {
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(350);
  }

  await expect(page.locator('#zoom-level')).toHaveText('Zoom 10');
  await expect.poll(() => heatLayer.getAttribute('data-radius')).toBe('18');
  await expect.poll(async () => Number(await heatLayer.getAttribute('data-peak-count')))
    .toBeGreaterThan(closeZoomPeak);
  await expect.poll(async () => Number(await heatLayer.getAttribute('data-cluster-count')))
    .toBeLessThan(closeZoomClusters);
  await expect(heatLayer).not.toHaveCSS('opacity', '0');
});

test('history label uses the free viewport margin at wide widths', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 921, height: 934 } });
  const page = await context.newPage();

  await page.goto('/?devGps=manila');
  const historySlider = page.locator('#history-slider');
  await historySlider.fill('0');

  const layout = await page.locator('#history-time-label').evaluate((element) => {
    const label = element.getBoundingClientRect();
    const dock = document.querySelector('#history-roller').getBoundingClientRect();
    const timeline = document.querySelector('.history-roller__timeline').getBoundingClientRect();
    const pointer = getComputedStyle(element, '::after');
    const pointerPosition = Number.parseFloat(pointer.left);

    return {
      labelUsesRightMargin: label.right > dock.right,
      labelInsideViewport: label.right <= document.documentElement.clientWidth,
      pointerOffsetFromCenter: pointerPosition - label.width / 2,
      pointerToTimelineEnd: timeline.right - (label.left + pointerPosition)
    };
  });

  expect(layout.labelUsesRightMargin).toBe(true);
  expect(layout.labelInsideViewport).toBe(true);
  expect(layout.pointerOffsetFromCenter).toBeCloseTo(0, 1);
  expect(layout.pointerToTimelineEnd).toBeCloseTo(0, 1);

  await context.close();
});

test('history scrubber reuses one cached timeline request', async ({ page }) => {
  let historyRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/history')) historyRequests += 1;
  });

  await page.goto('/?devGps=manila');
  const historySlider = page.locator('#history-slider');
  const timelineResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/history')
      && url.searchParams.get('minutes') === '180'
      && url.searchParams.get('step') === '5';
  });

  await historySlider.fill('180');
  await timelineResponse;
  for (const offset of ['175', '120', '60', '15', '5', '90', '0', '30']) {
    await historySlider.fill(offset);
  }
  await page.waitForTimeout(150);

  expect(historyRequests).toBe(1);
});

test('history falls back safely when the backend predates timeline batches', async ({ page }) => {
  let timelineRequests = 0;
  let legacyRequests = 0;
  let legacyObservedAt = 0;

  await page.route('**/history?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('minutes')) {
      timelineRequests += 1;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'A valid time within the last three hours is required' })
      });
      return;
    }

    legacyRequests += 1;
    legacyObservedAt = Number(url.searchParams.get('at'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cells: [{ latitude: 14.5995, longitude: 120.9842, people: 3 }]
      })
    });
  });

  await page.goto('/?devGps=manila');
  const historySlider = page.locator('#history-slider');
  await historySlider.fill('180');

  await expect.poll(() => timelineRequests).toBe(1);
  await expect.poll(() => legacyRequests).toBe(1);
  await expect.poll(() =>
    page.locator('#map .leaflet-heatmap-layer').getAttribute('data-cell-count')
  ).toBe('1');

  const fallbackAgeMinutes = (Date.now() - legacyObservedAt) / 60_000;
  expect(fallbackAgeMinutes).toBeGreaterThanOrEqual(174.9);
  expect(fallbackAgeMinutes).toBeLessThan(176);

  await historySlider.fill('0');
  await historySlider.fill('180');
  await page.waitForTimeout(100);
  expect(timelineRequests).toBe(1);
  expect(legacyRequests).toBe(1);
});
