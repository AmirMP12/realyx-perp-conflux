# Docs site — static site served by nginx (unprivileged, non-root, port 8080)
FROM nginxinc/nginx-unprivileged:1.25-alpine

# Copy static assets
COPY index.html app.js styles.css robots.txt sitemap.xml /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# Liveness check — nginx serves the site on 8080 (unprivileged image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
