# PromiseDecay — nginx vhost
#
# TLS terminates here. The web app and the API stay on loopback; only nginx is public.
# /api is proxied to the Fastify process, everything else to the static SPA.
#
# Install:
#   cp promisedecay.bydx.fun /etc/nginx/sites-available/promisedecay.bydx.fun
#   ln -s /etc/nginx/sites-available/promisedecay.bydx.fun /etc/nginx/sites-enabled/
#   nginx -t && systemctl reload nginx

# ---- HTTP: redirect everything to HTTPS -------------------------------------------------
server {
    listen 80;
    listen [::]:80;
    server_name promisedecay.bydx.fun;

    # Leave ACME challenges reachable over plain HTTP.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# ---- HTTPS ------------------------------------------------------------------------------
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name promisedecay.bydx.fun;

    # ---- TLS -------------------------------------------------------------------------
    ssl_certificate     /etc/letsencrypt/live/promisedecay.bydx.fun/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/promisedecay.bydx.fun/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:PromiseDecayTLS:10m;
    ssl_session_timeout 1d;
    ssl_stapling        on;
    ssl_stapling_verify on;

    # ---- Transport ------------------------------------------------------------------

    # These are also set by the app. Repeating them here means a direct hit on the app
    # port is safe too, and a proxy in front of this is still protected.
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy        "camera=(), microphone=(), geolocation=(), interest-cohort=()" always;

    # ---- Compression ----------------------------------------------------------------
    gzip              on;
    gzip_vary         on;
    gzip_comp_level   6;
    gzip_min_length   1024;
    gzip_proxied      any;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/xml
        image/svg+xml;

    client_max_body_size 64k;

    # ---- API ------------------------------------------------------------------------
    location /api/ {
        proxy_pass         http://127.0.0.1:4182;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";

        proxy_connect_timeout 5s;
        proxy_read_timeout    30s;

        # API responses are never cached.
        # `add_header` is NOT inherited once a location declares its own, so every
        # location that sets Cache-Control must also restate HSTS or lose it.
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header Cache-Control "no-store" always;
    }

    # Liveness and readiness are explicit API routes, not SPA paths.
    location ~ ^/health/(live|ready)$ {
        proxy_pass         http://127.0.0.1:4182;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
        proxy_connect_timeout 5s;
        proxy_read_timeout    30s;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header Cache-Control "no-store" always;
    }

    # ---- Hashed build assets: immutable -------------------------------------------------
    location /assets/ {
        proxy_pass         http://127.0.0.1:4180;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection "";

        expires    1y;
        # `add_header` is NOT inherited once a location declares its own, so every
        # location that sets Cache-Control must also restate HSTS or lose it.
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # ---- Everything else: the SPA ------------------------------------------------------
    location / {
        proxy_pass         http://127.0.0.1:4180;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";

        # The shell must never be cached or a deploy stays invisible.
        # `add_header` is NOT inherited once a location declares its own, so every
        # location that sets Cache-Control must also restate HSTS or lose it.
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }
}
