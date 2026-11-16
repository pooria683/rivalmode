/**
 * Hand-rolled SVG helpers. No dependencies: RivalMode ships with zero runtime
 * deps and the SVGs it writes must survive being committed, cached, and served
 * from GitHub's Camo proxy — so: no external refs, no scripts, no fonts.
 *
 * Fonts are a stack of fonts that exist on GitHub, macOS, Windows and Linux,
 * which keeps the layout predictable without embedding a webfont.
 */

export const FONT_SANS =
  "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, 'Noto Sans', sans-serif";
export const FONT_MONO =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace";

/* ------------------------------------------------------------------ text --- */

const NARROW = new Set("iljItf.,:;'`|!()[]{}/*\\ ");
const WIDE = new Set('mwMW@%');
const MONO_RATIO = 0.6;

/** Approximate advance width of `text` in px at `size` px. */
export function textWidth(text, size = 12, { mono = false, bold = false } = {}) {
  const s = String(text ?? '');
  if (mono) return s.length * size * MONO_RATIO * (bold ? 1.02 : 1);
  let units = 0;
  for (const ch of s) {
    if (NARROW.has(ch)) units += 0.36;
    else if (WIDE.has(ch)) units += 0.96;
    else if (/[A-Z0-9#&]/.test(ch)) units += 0.66;
    else if (ch === ' ') units += 0.3;
    else units += 0.56;
  }
  const boldFactor = bold ? 1.045 : 1;
  return units * size * boldFactor;
}

/** Truncate `text` with an ellipsis so it fits `maxWidth` px. */
export function fitText(text, maxWidth, size = 12, opts = {}) {
  const s = String(text ?? '');
  if (textWidth(s, size, opts) <= maxWidth) return s;
  const ellipsis = '…';
  let out = '';
  for (const ch of s) {
    if (textWidth(out + ch + ellipsis, size, opts) > maxWidth) break;
    out += ch;
  }
  return (out + ellipsis).trim();
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u001f\u007f]/g, '');
}

/** `<text>` element with sensible defaults. */
export function text(content, x, y, opts = {}) {
  const {
    size = 12,
    fill = '#e6edf3',
    weight = 400,
    anchor = 'start',
    family = FONT_SANS,
    mono = false,
    opacity,
    class: cls,
    letterSpacing,
    baseline,
  } = opts;
  const attrs = [
    `x="${round(x)}"`,
    `y="${round(y)}"`,
    `font-size="${size}"`,
    `fill="${escapeXml(fill)}"`,
    `font-family="${mono ? FONT_MONO : family}"`,
    weight !== 400 ? `font-weight="${weight}"` : '',
    anchor !== 'start' ? `text-anchor="${anchor}"` : '',
    opacity != null ? `opacity="${round(opacity)}"` : '',
    letterSpacing ? `letter-spacing="${letterSpacing}"` : '',
    baseline ? `dominant-baseline="${baseline}"` : '',
    cls ? `class="${escapeXml(cls)}"` : '',
  ].filter(Boolean);
  return `<text ${attrs.join(' ')}>${escapeXml(content)}</text>`;
}

/* ---------------------------------------------------------------- shapes --- */

export function rect(x, y, w, h, opts = {}) {
  const { fill = 'none', rx = 0, stroke, strokeWidth = 1, opacity, extra = '' } = opts;
  const attrs = [
    `x="${round(x)}"`,
    `y="${round(y)}"`,
    `width="${round(Math.max(0, w))}"`,
    `height="${round(Math.max(0, h))}"`,
    `fill="${escapeXml(fill)}"`,
    rx ? `rx="${round(rx)}"` : '',
    stroke ? `stroke="${escapeXml(stroke)}"` : '',
    stroke ? `stroke-width="${strokeWidth}"` : '',
    opacity != null ? `opacity="${round(opacity)}"` : '',
    extra,
  ].filter(Boolean);
  return `<rect ${attrs.join(' ')}/>`;
}

export function circle(cx, cy, r, opts = {}) {
  const { fill = '#e6edf3', stroke, strokeWidth = 1, opacity } = opts;
  return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${escapeXml(fill)}"${
    stroke ? ` stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}"` : ''
  }${opacity != null ? ` opacity="${round(opacity)}"` : ''}/>`;
}

export function line(x1, y1, x2, y2, opts = {}) {
  const { stroke = '#30363d', strokeWidth = 1, opacity, dash, cap = 'round' } = opts;
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" stroke-linecap="${cap}"${
    dash ? ` stroke-dasharray="${dash}"` : ''
  }${opacity != null ? ` opacity="${round(opacity)}"` : ''}/>`;
}

/** Polyline through points — used for sparklines. */
export function polyline(points, opts = {}) {
  const { stroke = '#58a6ff', strokeWidth = 2, fill = 'none', opacity } = opts;
  if (!points.length) return '';
  const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join(' ');
  return `<path d="${d}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${
    opacity != null ? ` opacity="${round(opacity)}"` : ''
  }/>`;
}

/** Closed area under a sparkline. */
export function areaUnder(points, baselineY, opts = {}) {
  if (!points.length) return '';
  const { fill = '#58a6ff', opacity = 0.14 } = opts;
  const first = points[0];
  const last = points[points.length - 1];
  const d =
    `M${round(first[0])} ${round(baselineY)} ` +
    points.map(([x, y]) => `L${round(x)} ${round(y)}`).join(' ') +
    ` L${round(last[0])} ${round(baselineY)} Z`;
  return `<path d="${d}" fill="${escapeXml(fill)}" opacity="${round(opacity)}"/>`;
}

/** A rounded progress bar with a track. `ratio` is 0..1. */
export function bar(x, y, w, h, ratio, opts = {}) {
  const { fill = '#3fb950', track = '#21262d', rx = h / 2, opacity } = opts;
  const width = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * w;
  return [
    track ? rect(x, y, w, h, { fill: track, rx }) : '',
    width > 0 ? rect(x, y, Math.max(width, h * 0.999 > width ? width : h), h, { fill, rx, opacity }) : '',
  ].join('');
}

/* ----------------------------------------------------------------- misc --- */

export function round(n) {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n * 100) / 100;
}

export function formatCount(n) {
  const num = Number(n) || 0;
  if (Math.abs(num) >= 1_000_000) return `${trim(num / 1_000_000)}M`;
  if (Math.abs(num) >= 1000) return `${trim(num / 1000)}k`;
  return String(num);
}

function trim(n) {
  return (Math.round(n * 10) / 10).toString().replace(/\.0$/, '');
}

export function formatSigned(n) {
  const num = Number(n) || 0;
  return `${num > 0 ? '+' : ''}${formatCount(num)}`;
}

/** Deterministic pseudo-random in [0,1) — keeps snapshots stable. */
export function seededRandom(seed) {
  let h = 2166136261;
  for (let i = 0; i < String(seed).length; i += 1) {
    h ^= String(seed).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared <defs>: gradients, glow filter, background textures. */
export function themeDefs(theme, { id = 'rm', width = 100, height = 100, pattern = true } = {}) {
  const parts = [];
  if (theme.glow) {
    parts.push(
      `<filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%">` +
        `<feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    );
  }
  if (pattern && theme.pattern && theme.pattern !== 'none') {
    if (theme.pattern === 'grid' || theme.pattern === 'pitch') {
      const gap = theme.pattern === 'pitch' ? 26 : 16;
      const opacity = theme.pattern === 'pitch' ? 0.06 : 0.055;
      parts.push(
        `<pattern id="${id}-grid" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse">` +
          `<path d="M${gap} 0 L0 0 0 ${gap}" fill="none" stroke="${theme.muted}" stroke-width="0.6" opacity="${opacity}"/></pattern>`
      );
    }
    if (theme.pattern === 'scanlines') {
      parts.push(
        `<pattern id="${id}-grid" width="4" height="4" patternUnits="userSpaceOnUse">` +
          `<rect width="4" height="1" fill="${theme.accent}" opacity="0.05"/></pattern>`
      );
    }
  }
  parts.push(
    `<linearGradient id="${id}-accent" x1="0" y1="1" x2="1" y2="0">` +
      `<stop offset="0" stop-color="${theme.accentSoft}"/><stop offset="1" stop-color="${theme.accent}"/></linearGradient>`
  );
  return `<defs>${parts.join('')}</defs>`;
}

/** The card background: rounded (or sharp) panel + optional texture. */
export function cardBackground(theme, width, height, { id = 'rm', pad = 0.5 } = {}) {
  const rx = theme.shape === 'rounded' ? 14 : 3;
  const parts = [rect(pad, pad, width - pad * 2, height - pad * 2, { fill: theme.background, rx, stroke: theme.border, strokeWidth: 1 })];
  if (theme.pattern && theme.pattern !== 'none') {
    parts.push(rect(pad, pad, width - pad * 2, height - pad * 2, { fill: `url(#${id}-grid)`, rx }));
  }
  return parts.join('');
}

/** Wrap an SVG body in a document with the right attributes for GitHub. */
export function svgDocument({ width, height, theme, id = 'rm', body, title, pattern = true }) {
  const titleEl = title ? `<title>${escapeXml(title)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `role="img" aria-label="${escapeXml(title || 'RivalMode')}" font-family="${FONT_SANS}">` +
    titleEl +
    themeDefs(theme, { id, pattern }) +
    body +
    '</svg>'
  );
}

/** A chevron / triangle marker used for the momentum direction. */
export function chevron(cx, cy, size, direction, color) {
  const s = size;
  if (direction === 'up') return `<path d="M${round(cx - s)} ${round(cy + s * 0.5)} L${round(cx)} ${round(cy - s * 0.5)} L${round(cx + s)} ${round(cy + s * 0.5)} Z" fill="${escapeXml(color)}"/>`;
  if (direction === 'down') return `<path d="M${round(cx - s)} ${round(cy - s * 0.5)} L${round(cx)} ${round(cy + s * 0.5)} L${round(cx + s)} ${round(cy - s * 0.5)} Z" fill="${escapeXml(color)}"/>`;
  return rect(cx - s, cy - 1.2, s * 2, 2.4, { fill: color, rx: 1.2 });
}

/** Small stadium "pill" with a label — used for tags and streaks. */
export function pill(x, y, label, opts = {}) {
  const { size = 11, fill = '#161b22', color = '#8b949e', stroke, paddingX = 8, height = 20, mono = false, icon = '' } = opts;
  const labelW = textWidth(label, size, { mono });
  const iconW = icon ? size * 0.9 : 0;
  const w = labelW + iconW + paddingX * 2;
  return {
    width: w,
    markup:
      rect(x, y, w, height, { fill, rx: height / 2, stroke }) +
      (icon ? text(icon, x + paddingX, y + height / 2 + size * 0.36, { size, fill: color }) : '') +
      text(label, x + paddingX + iconW, y + height / 2 + size * 0.36, { size, fill: color, mono }),
  };
}
