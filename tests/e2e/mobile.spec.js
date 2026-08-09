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
  await expect(page.locator('.leaflet-heatmap-layer')).not.toHaveCSS('opacity', '0');
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
    page.locator('.leaflet-heatmap-layer').getAttribute('data-cell-count')
  ).toBe('1');
  const maxHeatAlpha = await page.locator('.leaflet-heatmap-layer').evaluate((canvas) => {
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
  await expect(page.getByRole('dialog', { name: 'Allow GPS location?' })).toBeVisible();
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.waitForTimeout(500);
  expect(eventRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'I am stranded :(', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Allow GPS location?' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow GPS', exact: true }).click();
  await expect(page.locator('#gps-permission-status')).toHaveText(/GPS permission was denied/);
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
  await page.getByRole('button', { name: 'I am stranded :(', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Allow GPS location?' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow GPS', exact: true }).click();
  await expect(page.locator('#gps-permission-status')).toHaveText(
    /outside the Philippines/
  );
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

  await recenterButton.click();
  await expect(recenterButton).toBeVisible();
  await expect(page.locator('.user-location-marker')).toBeVisible();
  await expect.poll(visualCenterError).toBeLessThan(2);

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
  const heatLayer = page.locator('.leaflet-heatmap-layer');
  await expect(heatLayer).toHaveCount(1);

  await page.mouse.move(195, 360);
  await page.mouse.down();
  await page.mouse.move(80, 280, { steps: 8 });
  await expect(heatLayer).not.toHaveCSS('opacity', '0');

  await page.mouse.up();
  await expect(heatLayer).not.toHaveCSS('opacity', '0');
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
