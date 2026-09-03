# Deploying Vantage Fleet OS on EC2 behind nginx

Target host: `vantage-fleet.duckdns.org` (A record -> EC2 public IP).

## What the app requests

The built client is a static bundle that calls two path prefixes on its own
origin:

| Prefix | Handled by |
| --- | --- |
| `/auth/*` | Node API (login) |
| `/api/*` | Node API (everything else) |
| everything else | the static bundle, with SPA fallback to `index.html` |

Both API prefixes must be proxied. Proxying only `/api` leaves login broken,
because nginx then treats `/auth/login` as a static path and answers `405 Not
Allowed` to the POST.

There is no `/api/v1` prefix in this application. `POST /api/v1/auth/login`
returns `401 Missing or malformed Authorization header`, which comes from the
`authenticate` middleware mounted at `app.use("/api", authenticate)` rejecting
an unauthenticated request to a path that does not exist. It returns 401 for
valid credentials too, so that response is not evidence the endpoint is live.

## nginx server block

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name vantage-fleet.duckdns.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name vantage-fleet.duckdns.org;

    root /home/ubuntu/workspace/build;
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/vantage-fleet.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vantage-fleet.duckdns.org/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Required. Login lives at /auth/login, not under /api. Without this
    # block nginx treats it as a static path, try_files falls back to
    # index.html, and the POST is refused with 405 Not Allowed.
    location /auth/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Single-page app: unknown paths return index.html so client-side
    # routes such as /app/loads/<id> survive a refresh.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Apply with:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Build and place the client

`vite.config.ts` sets `build.outDir` to `build`, matching the nginx root.

```bash
cd client
npm run build
sudo rsync -a --delete build/ /home/ubuntu/workspace/build/
```

Because client and API share one origin, no `VITE_API_BASE_URL` is needed.
Set it only if the API moves to its own hostname, and add that hostname to
`CORS_ORIGIN` on the API if so.

## Run the API as a service

A `502 Bad Gateway` on `/api/*` means nginx is up but nothing is listening on
port 3001. Check, then run it under systemd so it survives a reboot:

```bash
curl -s localhost:3001/health     # expect {"status":"ok",...}
ss -lntp | grep 3001              # expect a listener
```

`/etc/systemd/system/vantage-api.service`:

```ini
[Unit]
Description=Vantage Fleet API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/vantage-fleet/server
EnvironmentFile=/home/ubuntu/vantage-fleet/server/.env
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vantage-api
sudo systemctl status vantage-api
journalctl -u vantage-api -f      # logs, if it fails to start
```

The API binds `0.0.0.0:3001`, but only nginx needs to reach it. Keep 3001
closed in the security group and expose 80 and 443 only.

## Server environment

`server/.env` on the host needs the same keys as `.env.example`. For a
same-origin deployment `CORS_ORIGIN` is not strictly required, since the
browser makes no cross-origin request, but setting it is harmless and covers a
later split:

```
CORS_ORIGIN=https://vantage-fleet.duckdns.org,http://vantage-fleet.duckdns.org
```

## Database

The API talks to the hosted PostgreSQL instance in `DATABASE_URL`. Apply
migrations on release, and seed once on a fresh database:

```bash
cd server
npx prisma migrate deploy
npm run db:seed        # first deployment only, it is not idempotent
```

## TLS

DuckDNS provides the name, not a certificate, so the site is HTTP until one is
issued. Certbot will obtain one and rewrite the server block above:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d vantage-fleet.duckdns.org
```

## Troubleshooting map

| Symptom | Cause |
| --- | --- |
| `502` on `/api/*` | API process not running, or not on port 3001 |
| `405` on `POST /auth/login` | nginx is missing the `/auth/` proxy block |
| `401 Missing or malformed Authorization header` | a path under `/api` that does not exist, caught by the auth middleware. Not a credentials failure |
| Login page loads, every action fails | one of the two above |
| `404` on refresh of `/app/...` | SPA fallback missing from `location /` |
| `Blocked request. This host is not allowed` | serving via `vite dev` instead of the built bundle; the host is in `vite.config.ts` `allowedHosts` |
| Browser console CORS error | client and API on different origins; add the client origin to `CORS_ORIGIN` |
