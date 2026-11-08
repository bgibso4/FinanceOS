/** Shared Recharts styling (axes, grid, tooltip), from the design tokens in globals.css. */
export const CHART_TICK = {
  fontSize: 11,
  fill: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
};

export const CHART_GRID_STROKE = 'var(--grid-line)';

export const CHART_TOOLTIP_STYLE = {
  fontSize: '12px',
  fontFamily: 'var(--font-mono)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-hover)',
  borderRadius: '8px',
  color: 'var(--text-primary)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};

export const CHART_TOOLTIP_LABEL_STYLE = { color: 'var(--text-muted)', marginBottom: 4 };
