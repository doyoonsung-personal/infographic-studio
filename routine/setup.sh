#!/bin/bash
# Setup script for the "Infographic Studio" cloud environment (optional: the worker installs anything
# missing itself, this just makes every run faster because the result is cached).
# Paste this whole file into the environment's "Setup script" field.
# Runs as root on Ubuntu 24.04 before Claude starts.
export DEBIAN_FRONTEND=noninteractive

# ffmpeg for encoding, Korean/emoji fonts for rendering, shared libraries headless Chrome needs.
(
  apt-get update -qq &&
  apt-get install -y -qq --no-install-recommends \
    ffmpeg fonts-noto-cjk fonts-noto-color-emoji unzip \
    libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2t64
) &

# Headless Chrome (Chrome for Testing). A pinned build downloads straight from storage.googleapis.com,
# which the default allowlist covers ("stable" would need googlechromelabs.github.io).
(
  V=131.0.6778.85
  D=/opt/chrome/chrome-headless-shell/linux-$V
  mkdir -p "$D" &&
  curl -fsSL -o /tmp/chs.zip "https://storage.googleapis.com/chrome-for-testing-public/$V/linux64/chrome-headless-shell-linux64.zip" &&
  python3 -m zipfile -e /tmp/chs.zip "$D" &&
  chmod +x "$D/chrome-headless-shell-linux64/chrome-headless-shell"
) &

wait
exit 0
