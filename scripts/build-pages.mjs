import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ejs from 'ejs';
import {
  DEFAULT_ATTRIBUTION,
  DEFAULT_TILE_URL
} from '../src/config.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(projectRoot, 'dist');
const backendValue = process.env.BACKEND_URL?.trim();
const siteValue = process.env.SITE_URL?.trim();
const seoTitle = 'Stranded Philippines – Live Stranded Reports & Heatmap';
const seoDescription =
  'View anonymous, short-lived reports of stranded people across the Philippines on a live heatmap. Report your location and mark yourself safe.';

if (!backendValue) {
  throw new Error('BACKEND_URL is required, for example https://stranded-detector.example.ts.net');
}

if (!siteValue) {
  throw new Error('SITE_URL is required, for example https://owner.github.io/stranded-detector');
}

const backendUrl = new URL(backendValue);
if (backendUrl.protocol !== 'https:' || backendUrl.origin !== backendValue.replace(/\/$/, '')) {
  throw new Error('BACKEND_URL must be an HTTPS origin without a path, query, or fragment');
}

const siteUrl = new URL(siteValue);
if (
  siteUrl.protocol !== 'https:' ||
  siteUrl.username ||
  siteUrl.password ||
  siteUrl.search ||
  siteUrl.hash
) {
  throw new Error('SITE_URL must be an HTTPS URL without credentials, query, or fragment');
}
siteUrl.pathname = `${siteUrl.pathname.replace(/\/+$/, '')}/`;
const canonicalUrl = siteUrl.href;

const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${canonicalUrl}#website`,
      name: 'Stranded Philippines',
      url: canonicalUrl,
      description: seoDescription,
      inLanguage: 'en-PH',
      areaServed: {
        '@type': 'Country',
        name: 'Philippines'
      }
    },
    {
      '@type': 'WebApplication',
      '@id': `${canonicalUrl}#application`,
      name: 'Stranded Philippines',
      url: canonicalUrl,
      description: seoDescription,
      applicationCategory: 'SafetyApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript and location access for reporting',
      isAccessibleForFree: true,
      inLanguage: 'en-PH',
      areaServed: {
        '@type': 'Country',
        name: 'Philippines'
      }
    }
  ]
}).replace(/</g, '\\u003c');
const structuredDataHash = createHash('sha256')
  .update(structuredData)
  .digest('base64');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const copies = [
  ['public/styles.css', 'assets/styles.css'],
  ['public/app.js', 'assets/app.js'],
  ['node_modules/htmx.org/dist/htmx.min.js', 'vendor/htmx/htmx.min.js'],
  ['node_modules/leaflet/dist/leaflet.css', 'vendor/leaflet/leaflet.css'],
  ['node_modules/leaflet/dist/leaflet.js', 'vendor/leaflet/leaflet.js'],
  ['node_modules/leaflet/dist/images', 'vendor/leaflet/images'],
  ['node_modules/leaflet.heat/dist/leaflet-heat.js', 'vendor/leaflet-heat/leaflet-heat.js']
];

await Promise.all(
  copies.map(async ([source, destination]) => {
    const destinationPath = path.join(outputDirectory, destination);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(path.join(projectRoot, source), destinationPath, { recursive: true });
  })
);

const contentSecurityPolicy = [
  "default-src 'self'",
  `connect-src 'self' ${backendUrl.origin}`,
  "img-src 'self' data: blob: https:",
  `script-src 'self' 'sha256-${structuredDataHash}'`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ');

const html = await ejs.renderFile(path.join(projectRoot, 'views/index.ejs'), {
  activeReports: [],
  now: Date.now(),
  mapTileUrl: process.env.MAP_TILE_URL || DEFAULT_TILE_URL,
  mapAttribution: process.env.MAP_ATTRIBUTION || DEFAULT_ATTRIBUTION,
  enableDevGps: false,
  assetBaseUrl: '.',
  apiBaseUrl: backendUrl.origin,
  staticContentSecurityPolicy: contentSecurityPolicy,
  seoTitle,
  seoDescription,
  canonicalUrl,
  allowIndexing: true,
  structuredData
});

const sitemapUrl = new URL('sitemap.xml', canonicalUrl).href;
const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(canonicalUrl)}</loc>
  </url>
</urlset>
`;
const robots = `User-agent: *
Allow: /
Sitemap: ${sitemapUrl}
`;

await Promise.all([
  writeFile(path.join(outputDirectory, 'index.html'), html, 'utf8'),
  writeFile(path.join(outputDirectory, 'robots.txt'), robots, 'utf8'),
  writeFile(path.join(outputDirectory, 'sitemap.xml'), sitemap, 'utf8'),
  writeFile(path.join(outputDirectory, '.nojekyll'), '', 'utf8')
]);

console.log(`Built GitHub Pages frontend in ${outputDirectory}`);
console.log(`Public site: ${canonicalUrl}`);
console.log(`Backend API: ${backendUrl.origin}`);
