// background/icon-renderer.js — Draws state-colored shield icons at runtime

const COLORS = {
  default: '#4A90D9',  // Blue - no match
  timer: '#34A853',    // Green - tracking with time remaining
  urgent: '#F4B400',   // Orange - ≤60s remaining
  blocked: '#EA4335',  // Red - blocked
  paused: '#9E9E9E',   // Gray - paused
};

function drawShield(ctx, size, color) {
  const s = size;
  ctx.clearRect(0, 0, s, s);

  ctx.beginPath();
  // Shield path scaled to size
  const cx = s / 2;
  const top = s * 0.05;
  const sideTop = s * 0.15;
  const sideX = s * 0.1;
  const rightX = s * 0.9;
  const midY = s * 0.55;
  const bottomY = s * 0.95;

  ctx.moveTo(cx, top);
  ctx.lineTo(rightX, sideTop);
  ctx.lineTo(rightX, midY);
  ctx.quadraticCurveTo(rightX, bottomY * 0.85, cx, bottomY);
  ctx.quadraticCurveTo(sideX, bottomY * 0.85, sideX, midY);
  ctx.lineTo(sideX, sideTop);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();

  // Inner highlight
  ctx.beginPath();
  const inset = s * 0.08;
  const innerCx = cx;
  const innerTop = top + inset;
  const innerSideTop = sideTop + inset * 0.5;
  const innerSideX = sideX + inset;
  const innerRightX = rightX - inset;
  const innerMidY = midY - inset * 0.3;
  const innerBottomY = bottomY - inset;

  ctx.moveTo(innerCx, innerTop);
  ctx.lineTo(innerRightX, innerSideTop);
  ctx.lineTo(innerRightX, innerMidY);
  ctx.quadraticCurveTo(innerRightX, innerBottomY * 0.85, innerCx, innerBottomY);
  ctx.quadraticCurveTo(innerSideX, innerBottomY * 0.85, innerSideX, innerMidY);
  ctx.lineTo(innerSideX, innerSideTop);
  ctx.closePath();

  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fill();
}

function createIconImageData(size, color) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  drawShield(ctx, size, color);
  return ctx.getImageData(0, 0, size, size);
}

export function getIconImageData(state) {
  const color = COLORS[state] || COLORS.default;
  return {
    16: createIconImageData(16, color),
    32: createIconImageData(32, color),
    48: createIconImageData(48, color),
    128: createIconImageData(128, color),
  };
}

export async function updateIcon(state, badgeText = '', badgeBgColor = '#4A90D9') {
  try {
    const imageData = getIconImageData(state);
    await chrome.action.setIcon({ imageData });
  } catch (e) {
    // Fallback if OffscreenCanvas fails — keep default icon
    console.warn('Icon render failed, using default:', e);
  }

  await chrome.action.setBadgeText({ text: badgeText });
  if (badgeText) {
    await chrome.action.setBadgeBackgroundColor({ color: badgeBgColor });
  }
}

export function formatBadgeTime(seconds) {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.ceil(seconds / 60);
  return `${mins}m`;
}

export { COLORS };
