// Design system - centralized styling classes
// Uses CSS custom properties defined in globals.css
// Automatically adapts to light/dark mode via .dark class

export const ds = {
  text: {
    primary: 'text-[var(--text-primary)]',
    secondary: 'text-[var(--text-secondary)]',
    muted: 'text-[var(--text-muted)]',
    heading: 'text-[var(--text-primary)]',
  },

  bg: {
    base: 'bg-[var(--bg-base)]',
    surface: 'bg-[var(--bg-surface)]',
    card: 'bg-[var(--bg-card)]',
    elevated: 'bg-[var(--bg-elevated)]',
    // Legacy aliases for backward compatibility
    primary: 'bg-[var(--bg-card)]',
    secondary: 'bg-[var(--bg-base)]',
    tertiary: 'bg-[var(--bg-elevated)]',
    hover: 'hover:bg-[var(--bg-elevated)]',
  },

  border: {
    default: 'border-[var(--border)]',
    hover: 'hover:border-[var(--border-hover)]',
  },

  status: {
    success: {
      bg: 'bg-green/10',
      bgRow: 'bg-green/10',
      text: 'text-[var(--green)]',
      border: 'border-green/30',
      accent: 'border-l-4 border-l-[var(--green)]',
    },
    warning: {
      bg: 'bg-accent/10',
      bgRow: 'bg-accent/10',
      text: 'text-[var(--accent)]',
      border: 'border-accent/30',
      accent: 'border-l-4 border-l-[var(--accent)]',
    },
    error: {
      bg: 'bg-red/10',
      bgRow: 'bg-red/10',
      text: 'text-[var(--red)]',
      border: 'border-red/30',
      accent: 'border-l-4 border-l-[var(--red)]',
    },
    info: {
      bg: 'bg-accent/10',
      bgRow: 'bg-accent/10',
      text: 'text-[var(--accent)]',
      border: 'border-accent/30',
      accent: 'border-l-4 border-l-[var(--accent)]',
    },
    purple: {
      bg: 'bg-accent/10',
      bgRow: 'bg-accent/10',
      text: 'text-[var(--accent)]',
      border: 'border-accent/30',
      accent: 'border-l-4 border-l-[var(--accent)]',
    },
  },

  interactive: {
    default: 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]',
    active: 'bg-[var(--bg-elevated)] text-[var(--text-primary)]',
  },

  card: {
    default: 'bg-[var(--bg-card)] border-[var(--border)]',
    hover: 'hover:border-[var(--border-hover)]',
  },

  table: {
    header: 'bg-[var(--bg-base)] text-[var(--text-muted)]',
    row: 'border-[var(--border)] hover:bg-[var(--bg-elevated)]',
    rowAlt: 'bg-bg-base/30',
  },
};

// Helper to combine design system classes
export function combine(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}
