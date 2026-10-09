// Browser and ffmpeg plumbing for the worker. Works in Claude's cloud (Ubuntu + Chrome for Testing
// installed by routine/setup.sh) and on a Windows dev machine (installed Edge + ffmpeg).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const roots = [
    ['/opt/chrome/chrome-headless-shell', 'chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['/opt/chrome/chrome', 'chrome-linux64', 'chrome'],
  ];
  for (const [root, dir, exe] of roots) {
    if (!fs.existsSync(root)) continue;
    for (const v of fs.readdirSync(root).sort().reverse()) {
      const p = path.join(root, v, dir, exe);
      if (fs.existsSync(p)) return p;
    }
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  const args = ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--no-sandbox'];
  const exe = findChrome();
  if (exe) return chromium.launch({ executablePath: exe, headless: true, args });
  if (process.platform === 'win32') return chromium.launch({ channel: 'msedge', headless: true, args });
  throw new Error('No Chrome found. Run routine/setup.sh (cloud) or set CHROME_PATH.');
}

export function ffmpegPath() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

/** Run ffmpeg to completion; rejects with stderr on failure. */
export function ffmpeg(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + err.slice(-1500)))));
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

/** Start an ffmpeg process that reads JPEG frames from stdin. Returns {write(buf), end()}. */
export function ffmpegFrameSink(args) {
  const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + err.slice(-1500)))));
  });
  return {
    write(buf) {
      return new Promise((resolve, reject) => {
        const ok = p.stdin.write(buf, (e) => (e ? reject(e) : null));
        if (ok) resolve(); else p.stdin.once('drain', resolve);
      });
    },
    async end() { p.stdin.end(); await done; },
  };
}

export function probeDuration(file) {
  return new Promise((resolve) => {
    const probe = ffmpegPath().replace(/ffmpeg(\.exe)?$/i, (m, ext) => 'ffprobe' + (ext || ''));
    const p = spawn(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => resolve(parseFloat(out) || null));
  });
}
