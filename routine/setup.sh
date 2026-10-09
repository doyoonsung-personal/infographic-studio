#!/bin/bash
# Setup script for the "Infographic Studio" cloud environment.
# Paste this whole file into the environment's "Setup script" field.
# Runs as root on Ubuntu 24.04 before Claude starts; the result is cached.
export DEBIAN_FRONTEND=noninteractive

# ffmpeg for encoding, Korean/emoji fonts for rendering, shared libraries headless Chrome needs.
(
  apt-get update -qq &&
  apt-get install -y -qq --no-install-recommends \
    ffmpeg fonts-noto-cjk fonts-noto-color-emoji \
    libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2t64
) &

# Headless Chrome (Chrome for Testing) from storage.googleapis.com, which the default allowlist covers.
(
  mkdir -p /opt/chrome &&
  npx -y @puppeteer/browsers install chrome-headless-shell@stable --path /opt/chrome
) &

wait
exit 0
