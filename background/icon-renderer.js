// background/icon-renderer.js — Draws the toolbar icon at runtime.
//
// v2: "Color is the signal." The entire icon changes color to communicate state,
// and whatever sits inside (bar, number, ×, pause bars) is the information.
// No separate badge overlay — Chrome's native badge is kept empty.
//
// State → Color → Interior:
//   default → red   → white bar (brand mark; shown when nothing is active)
//   timer   → green → minute count as number ("20", "14", "5")
//   urgent  → amber → second count as number ("45", "12")
//   blocked → red   → white ×
//   paused  → gray  → two white pause bars
//
// Because green=minutes and amber=seconds, we drop the "m"/"s" suffix — the color
// communicates the unit, and each digit gets ~2× more pixel budget at toolbar size.

const COLORS = {
  default: '#D94A3D',  // Brand red — idle
  timer:   '#2D9A4E',  // Green — minutes remaining
  urgent:  '#E5A100',  // Amber — seconds remaining (<60s)
  blocked: '#D94A3D',  // Brand red — budget spent / outside window
  paused:  '#B8B2A5',  // Warm gray — blocking temporarily off
};

// ---------- Drawing primitives ----------

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function drawCircle(ctx, size, color) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.48;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// Default idle — the "do not enter" brand mark.
function drawBar(ctx, size) {
  const cx = size / 2;
  const cy = size / 2;
  const diameter = size * 0.48 * 2;
  const barW = diameter * 0.65;
  const barH = diameter * 0.16;
  roundedRectPath(ctx, cx - barW / 2, cy - barH / 2, barW, barH, barH / 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
}

// Number (minutes or seconds — color signals which). Inter Black, heavy letter-spacing.
function drawNumber(ctx, size, text) {
  const str = String(text);
  // Scale font based on character count so 1–3 char strings all fit.
  const baseFactor = str.length >= 3 ? 0.42 : str.length === 2 ? 0.56 : 0.66;
  const fontSize = Math.round(size * baseFactor);
  ctx.font = `900 ${fontSize}px -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  // Slight vertical nudge to optically center heavy sans
  ctx.fillText(str, size / 2, size / 2 + size * 0.02);
}

// White × for the blocked state. Drawn as two crossing strokes with rounded caps.
function drawX(ctx, size) {
  const cx = size / 2;
  const cy = size / 2;
  const half = size * 0.18;
  const thickness = Math.max(1.5, size * 0.11);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - half, cy - half);
  ctx.lineTo(cx + half, cy + half);
  ctx.moveTo(cx + half, cy - half);
  ctx.lineTo(cx - half, cy + half);
  ctx.stroke();
}

// Two vertical rounded rects = pause glyph.
function drawPauseBars(ctx, size) {
  const cx = size / 2;
  const cy = size / 2;
  const barW = size * 0.11;
  const barH = size * 0.36;
  const gap = size * 0.08;
  const totalW = barW * 2 + gap;
  const startX = cx - totalW / 2;
  const startY = cy - barH / 2;
  const radius = barW / 3;

  ctx.fillStyle = '#FFFFFF';
  roundedRectPath(ctx, startX, startY, barW, barH, radius);
  ctx.fill();
  roundedRectPath(ctx, startX + barW + gap, startY, barW, barH, radius);
  ctx.fill();
}

function drawIcon(ctx, size, state, text) {
  ctx.clearRect(0, 0, size, size);
  const color = COLORS[state] || COLORS.default;
  drawCircle(ctx, size, color);

  switch (state) {
    case 'timer':
    case 'urgent':
      if (text) {
        drawNumber(ctx, size, text);
      } else {
        drawBar(ctx, size); // fallback: brand mark if number missing
      }
      break;
    case 'blocked':
      drawX(ctx, size);
      break;
    case 'paused':
      drawPauseBars(ctx, size);
      break;
    default:
      drawBar(ctx, size);
  }
}

// ---------- Rendering ----------

// Supersample at 4× then downscale for crisp anti-aliasing at 16/32/48px.
// Drawing a 7px font directly at 16×16 is illegible; downscaling from 64×64 isn't.
function createCrispIconImageData(displaySize, state, text) {
  const SUPERSAMPLE = 4;
  const srcSize = displaySize * SUPERSAMPLE;
  const srcCanvas = new OffscreenCanvas(srcSize, srcSize);
  drawIcon(srcCanvas.getContext('2d'), srcSize, state, text);

  const dstCanvas = new OffscreenCanvas(displaySize, displaySize);
  const dstCtx = dstCanvas.getContext('2d');
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = 'high';
  dstCtx.drawImage(srcCanvas, 0, 0, displaySize, displaySize);
  return dstCtx.getImageData(0, 0, displaySize, displaySize);
}

// 128 is big enough that we don't need supersampling there.
function createDirectIconImageData(size, state, text) {
  const canvas = new OffscreenCanvas(size, size);
  drawIcon(canvas.getContext('2d'), size, state, text);
  return canvas.getContext('2d').getImageData(0, 0, size, size);
}

function buildAllSizes(state, text) {
  return {
    16:  createCrispIconImageData(16,  state, text),
    32:  createCrispIconImageData(32,  state, text),
    48:  createCrispIconImageData(48,  state, text),
    128: createDirectIconImageData(128, state, text),
  };
}

// ---------- Public API ----------

// Signature simplified vs v1: state implies color, and for blocked/paused the interior
// content is built-in, so callers don't need to pass it.
//
// updateIcon('default')        — red circle + white bar
// updateIcon('timer',  '20')   — green circle + "20"
// updateIcon('urgent', '45')   — amber circle + "45"
// updateIcon('blocked')        — red circle + white ×
// updateIcon('paused')         — gray circle + pause bars
export async function updateIcon(state, text = '') {
  if (!updateIcon.cache) {
    updateIcon.cache = { key: null };
  }
  const cache = updateIcon.cache;
  const key = `${state}|${text}`;
  if (cache.key === key) return;

  try {
    const imageData = buildAllSizes(state, text);
    await chrome.action.setIcon({ imageData });
    // Native badge is always blank — the number is drawn inside the icon itself.
    await chrome.action.setBadgeText({ text: '' });
    cache.key = key;
  } catch (e) {
    console.warn('Icon render failed:', e);
  }
}

// Returns just the number as a string (no unit suffix).
// Color communicates the unit: green = minutes, amber = seconds.
export function formatBadgeTime(seconds) {
  if (seconds <= 0) return '';
  if (seconds < 60) return String(seconds);
  return String(Math.ceil(seconds / 60));
}

export { COLORS };
