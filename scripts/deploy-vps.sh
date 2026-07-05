#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/revelox}"
WEB_DIR="${WEB_DIR:-/var/www/revelox}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-revelox-api}"

echo "→ Entrando a ${APP_DIR}"
cd "$APP_DIR"

echo "→ Descargando cambios desde GitHub (${BRANCH})"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "→ Instalando dependencias"
npm ci

echo "→ Construyendo frontend"
npm run build

echo "→ Publicando archivos web en ${WEB_DIR}"
install -d "$WEB_DIR"
find "$WEB_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a dist/. "$WEB_DIR/"

echo "→ Reiniciando API (${SERVICE_NAME})"
systemctl restart "$SERVICE_NAME"

echo "→ Recargando Nginx"
nginx -t
systemctl reload nginx

echo "→ Verificando servicios"
systemctl is-active --quiet "$SERVICE_NAME"
systemctl is-active --quiet nginx

echo "✓ Despliegue completado"
