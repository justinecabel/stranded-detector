# Stranded Detector

A mobile-first heat map for anonymous stranded-person reports. Reports last
five minutes, may be removed early by the originating device, and appear at
their exact submitted GPS coordinates on every connected device.

This is a community awareness signal, not an emergency-dispatch system.

## Local development

Requirements:

- Node.js 24 or newer
- npm 11 or newer

Install and run:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`. On Windows PowerShell systems with script
execution disabled, use `npm.cmd` rather than `npm`.

To keep the development command window hidden on Windows, launch it with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-dev-hidden.ps1
```

The hidden launcher writes normal output to `data/dev-server.log` and errors
to `data/dev-server-error.log`.

The development defaults use a safe local-only cookie secret and store the
database at `data/stranded.sqlite`. Copy `.env.example` values into your process
environment when you need different settings. Production refuses to start
without a cookie secret of at least 32 characters.

## Tests

```powershell
npm.cmd test
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

The Node test suite covers exact coordinates, lifecycle, ownership, validation,
rate limits, migrations, and SSE responses. Playwright
covers 320px and 390px mobile report flows, including granted and denied
geolocation.

## Docker VPS deployment

Create a strong secret and place it in the deployment environment:

```powershell
$env:COOKIE_SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose up --build -d
```

The Compose service uses a named volume for `/data`. Put an HTTPS reverse proxy
in front of port 3000 and preserve `TRUST_PROXY=1` and `COOKIE_SECURE=true`.
For plain HTTP development containers only, set `COOKIE_SECURE=false`.

## Standalone Docker deployment with Tailscale Funnel

[`compose.funnel.yaml`](./compose.funnel.yaml) runs the backend and the official
Tailscale container as one isolated stack. The backend listens on the stack's
private Docker network at `stranded-detector-backend:3000` and is exposed publicly only
through Tailscale Funnel on HTTPS port 443. No backend port is published on the
Docker host.

Before starting the stack:

1. Enable MagicDNS and HTTPS certificates for the tailnet.
2. Permit Funnel in the tailnet policy's `nodeAttrs` section.
3. Generate a non-ephemeral Tailscale auth key.
4. Copy `.env.funnel.example` to `.env.funnel`, replace both secrets, and keep
   that file out of source control.

PowerShell setup:

```powershell
Copy-Item .env.funnel.example .env.funnel
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Put the generated value in COOKIE_SECRET and your Tailscale key in TS_AUTHKEY.
docker compose --env-file .env.funnel -f compose.funnel.yaml up --build -d
```

Show the public Funnel URL and follow startup logs:

```powershell
docker compose --env-file .env.funnel -f compose.funnel.yaml exec tailscale tailscale funnel status
docker compose --env-file .env.funnel -f compose.funnel.yaml logs -f tailscale stranded-detector
```

The Tailscale identity and SQLite database are stored in separate named
volumes, so ordinary restarts and `docker compose down` preserve both. Do not
use `down --volumes` unless you intend to remove the node identity and all
report data.

The Funnel configuration is stored in
[`tailscale-config/funnel.json`](./tailscale-config/funnel.json). Tailscale
replaces `${TS_CERT_DOMAIN}` with the node's actual `*.ts.net` certificate
domain at startup.

Funnel is public internet access, not tailnet-only access. For a private
deployment, change `AllowFunnel` to `false` in that file to use Tailscale Serve
instead. See the official [Tailscale Docker configuration](https://tailscale.com/docs/features/containers/docker/docker-params)
and [Funnel requirements](https://tailscale.com/docs/reference/tailscale-cli/funnel).

## GitHub Pages frontend

The workflow in [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)
builds the EJS interface as static files and deploys them to GitHub Pages. The
live reports, history, and event stream continue to use the Docker backend over
its public Tailscale Funnel URL.

Configure both sides before the first deployment:

1. In `.env.funnel`, set `FRONTEND_ORIGINS` to the Pages origin, such as
   `https://YOUR-GITHUB-OWNER.github.io`, then restart the Funnel stack. Use
   only the origin; do not include the repository path.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions
   → Variables** and create `BACKEND_URL` with the Funnel HTTPS origin, such as
   `https://stranded-detector.example.ts.net`.
3. In **Settings → Pages**, choose **GitHub Actions** as the source.
4. Push to `main`, or run **Deploy frontend to GitHub Pages** manually from the
   Actions tab.

The static frontend creates a random anonymous device token in local storage
and sends it only to the configured backend. This preserves report ownership
without relying on cross-site cookies. Development GPS is intentionally
disabled in the public Pages build.

The Pages build automatically uses GitHub's deployed base URL for its canonical
link, Philippines-focused social metadata, structured data, `robots.txt`, and
`sitemap.xml`; no separate frontend URL variable is required. The Funnel-served
app is marked `noindex` so it does not compete with the Pages URL in search.
For a local static build, set both `BACKEND_URL` and `SITE_URL` before running
`npm.cmd run build:pages`.

### Install as an app

The frontend is an installable Progressive Web App on HTTPS deployments and
localhost. Use the browser's native install request or install command. On
iPhone and iPad, tap **Share**, then **Add to Home Screen**.

When launched from an installed icon, the manifest requests fullscreen mode
and falls back to standalone mode where fullscreen PWAs are not supported. The
radar-and-heatmap logo is supplied as standard, maskable, and Apple touch icons.

The service worker caches only the local interface and an offline explanation
page. Live reports, report history, event streams, and map tiles require a
network connection and are never served from the PWA cache.

The three-hour history is fetched as one five-minute timeline and reused from
an in-memory cache while scrubbing or playing. It refreshes after 60 seconds;
individual slider positions do not create separate requests.

CARTO's dark raster tiles are displayed in muted monochrome so land, roads,
and place labels remain visible without competing with the heat layer. Before meaningful production traffic,
confirm the provider terms or set `MAP_TILE_URL` and `MAP_ATTRIBUTION` to
another tile provider.

## Runtime configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener port |
| `DATABASE_PATH` | `./data/stranded.sqlite` | SQLite database file |
| `COOKIE_SECRET` | development-only value | Signs device cookies and derives device hashes |
| `COOKIE_SECURE` | production: `true` | Restricts the device cookie to HTTPS |
| `TRUST_PROXY` | `0` | Express reverse-proxy hop configuration |
| `MAP_TILE_URL` | CARTO Dark Matter | Leaflet raster tile template |
| `MAP_ATTRIBUTION` | OpenStreetMap and CARTO | Required map attribution |
| `ENABLE_DEV_GPS` | non-production: `true` | Allows explicit `?devGps=` simulated coordinates |
| `FRONTEND_ORIGINS` | empty | Comma-separated static frontend origins allowed to call the API |
| `REPORT_TTL_MS` | `300000` | Report lifetime |
| `EXPIRY_SWEEP_MS` | `1000` | Expired-report cleanup interval |
| `HEARTBEAT_MS` | `15000` | SSE keepalive interval |

### Development GPS simulator

To test on a laptop, desktop, emulator, or other device without GPS hardware:

1. Start the development server with `npm.cmd run dev`.
2. Open `http://localhost:3000/?devGps=manila`.

You can use any valid Philippines coordinate pair instead, for example
`http://localhost:3000/?devGps=14.5995,120.9842`. The dummy location uses the
normal GPS marker, recenter button, heatmap, and report flow. It is enabled by
default outside production and disabled by default in production.

Append `&devHeat=100` to add 100 deterministic, non-persistent dummy reports
around Metro Manila for checking heatmap density and collision behavior. For
example: `http://localhost:3000/?devGps=manila&devHeat=100`.

## Data and abuse controls

- Active exact coordinates are included in public SSE snapshots.
- Anonymous device tokens are signed, HTTP-only cookies; only HMAC hashes are
  stored.
- A device contributes at most once per nearby grid cell and may hold no more than
  three active locations.
- Submissions are limited to three per device and ten attempts per IP in five
  minutes.
- Resolved and expired reports are deleted rather than archived.
