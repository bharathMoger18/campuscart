# ============================================================
# Dockerfile — CampusCart Nginx
# Base: nginx:1.25-alpine
# Role: Reverse proxy, serve frontend HTML/CSS/JS,
#       serve static files, proxy API/WebSocket to Django
# ============================================================

# nginx:1.25-alpine = official Nginx on Alpine Linux
# Alpine is tiny (~5MB) — perfect for a simple proxy container
# We don't need Python, build tools, etc. Just Nginx.
FROM nginx:1.25-alpine

# Remove the default Nginx config that comes with the image
# The default config serves a "Welcome to nginx" page on port 80
# We replace it with our custom campuscart config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom Nginx config into the container
# nginx.conf goes into conf.d/ — Nginx automatically loads all
# .conf files from this directory
COPY nginx.conf /etc/nginx/conf.d/campuscart.conf

# Port 80 is where Nginx listens for HTTP traffic
# This is documentation — actual mapping is in docker-compose.yml
EXPOSE 80

# The base nginx image already has a correct CMD to start Nginx
# We don't need to override it: CMD ["nginx", "-g", "daemon off;"]
# 'daemon off' keeps Nginx in foreground so Docker can monitor it
