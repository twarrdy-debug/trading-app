import { encode } from 'uqr';

/**
 * A QR code drawn as SVG (for the authenticator app link). Always dark on light, whatever the theme,
 * because phone cameras read that most reliably; the colours are the `--qr-*` tokens.
 */
export function QrCode({ value, label, size = 184 }: { value: string; label: string; size?: number }) {
  const { data, size: modules } = encode(value, { border: 2 });
  const path = data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ''))).join('');
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${modules} ${modules}`} shapeRendering="crispEdges" className="rounded-lg">
      <rect width={modules} height={modules} fill="var(--qr-paper)" />
      <path d={path} fill="var(--qr-ink)" />
    </svg>
  );
}
