// background/icon-renderer.js — Draws state-colored road-closed sign icons at runtime

const COLORS = {
  default: '#EA4335',  // Red - road closed sign
  timer: '#34A853',    // Green - tracking with time remaining
  urgent: '#F4B400',   // Orange - ≤60s remaining
  blocked: '#EA4335',  // Red - blocked
  paused: '#9E9E9E',   // Gray - paused
};

function drawRoadClosed(ctx, size, color) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  ctx.clearRect(0, 0, s, s);

  // Outer filled circle (state color)
  const radius = s * 0.46;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Inner white circle (creates ring effect)
  const ringThickness = s * 0.12;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - ringThickness, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // Horizontal rounded-rect bar across center
  const barHeight = s * 0.14;
  const barWidth = (radius - ringThickness) * 2 * 0.75;
  const barX = cx - barWidth / 2;
  const barY = cy - barHeight / 2;
  const barRadius = barHeight / 2;

  ctx.beginPath();
  ctx.moveTo(barX + barRadius, barY);
  ctx.lineTo(barX + barWidth - barRadius, barY);
  ctx.arc(barX + barWidth - barRadius, barY + barRadius, barRadius, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(barX + barRadius, barY + barHeight);
  ctx.arc(barX + barRadius, barY + barRadius, barRadius, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = '#2A2A2A';
  ctx.fill();
}

function createIconImageData(size, color) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  drawRoadClosed(ctx, size, color);
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

export async function updateIcon(state, badgeText = '', badgeBgColor = '#EA4335') {
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
