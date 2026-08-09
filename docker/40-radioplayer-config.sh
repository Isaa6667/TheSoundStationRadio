#!/bin/sh
# Gera config.js e manifest.json a partir das variáveis de ambiente.
# Executado pelo entrypoint da imagem oficial do nginx, antes do servidor subir.
set -e

HTML_DIR="${HTML_DIR:-/usr/share/nginx/html}"

# Escapa para uso dentro de uma string JSON/JS entre aspas duplas.
esc() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# --- config.js -------------------------------------------------------------
{
    echo '// Gerado automaticamente pelo container a partir das variáveis de'
    echo '// ambiente. Não edite: qualquer alteração some no próximo restart.'
    echo 'window.RADIO_CONFIG = {'
    echo "    RADIO_NAME: \"$(esc "$RADIO_NAME")\","
    echo "    URL_STREAMING: \"$(esc "$URL_STREAMING")\","
    if [ -n "$API_URL" ]; then echo "    API_URL: \"$(esc "$API_URL")\","; fi
    if [ -n "$FALLBACK_API_URL" ]; then echo "    FALLBACK_API_URL: \"$(esc "$FALLBACK_API_URL")\","; fi
    if [ -n "$ACCENT_COLOR" ]; then echo "    ACCENT_COLOR: \"$(esc "$ACCENT_COLOR")\","; fi
    if [ -n "$BG_COLOR" ]; then echo "    BG_COLOR: \"$(esc "$BG_COLOR")\","; fi
    echo '};'
} > "$HTML_DIR/config.js"

# --- manifest.json ---------------------------------------------------------
# PWA_NAME/PWA_SHORT_NAME são opcionais; por padrão seguem o nome da rádio.
PWA_NAME="${PWA_NAME:-$RADIO_NAME}"
PWA_SHORT_NAME="${PWA_SHORT_NAME:-$PWA_NAME}"
BG="${BG_COLOR:-#0b0e13}"

cat > "$HTML_DIR/manifest.json" <<EOF
{
  "name": "$(esc "$PWA_NAME")",
  "short_name": "$(esc "$PWA_SHORT_NAME")",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "$(esc "$BG")",
  "theme_color": "$(esc "$THEME_COLOR")",
  "icons": [
    {
      "src": "img/cover.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
EOF

echo "radioplayer: configurado para \"$RADIO_NAME\" ($URL_STREAMING)"
