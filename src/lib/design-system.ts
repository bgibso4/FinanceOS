// Design system - centralized styling classes
// Use these instead of hardcoded Tailwind classes

export const ds = {
  // Text colors
  text: {
    primary: "text-slate-900 dark:text-slate-100",
    secondary: "text-slate-600 dark:text-slate-400",
    muted: "text-slate-500 dark:text-slate-500",
    heading: "text-slate-900 dark:text-slate-100",
  },
  
  // Background colors
  bg: {
    primary: "bg-white dark:bg-slate-800",
    secondary: "bg-slate-50 dark:bg-slate-900",
    tertiary: "bg-slate-100 dark:bg-slate-700",
    hover: "hover:bg-slate-50 dark:hover:bg-slate-700",
  },
  
  // Border colors
  border: {
    default: "border-slate-200 dark:border-slate-700",
    hover: "hover:border-slate-300 dark:hover:border-slate-600",
  },
  
  // Status colors (these work in both themes)
  status: {
    success: {
      bg: "bg-green-50 dark:bg-green-500/10",
      bgRow: "bg-green-100 dark:bg-green-500/10", // Full color in light mode
      text: "text-green-700 dark:text-green-400",
      border: "border-green-200 dark:border-green-500/30",
      accent: "border-l-4 border-l-green-500",
    },
    warning: {
      bg: "bg-yellow-50 dark:bg-yellow-500/10",
      bgRow: "bg-yellow-100 dark:bg-yellow-500/10",
      text: "text-yellow-700 dark:text-yellow-400",
      border: "border-yellow-200 dark:border-yellow-500/30",
      accent: "border-l-4 border-l-yellow-500",
    },
    error: {
      bg: "bg-red-50 dark:bg-red-500/10",
      bgRow: "bg-red-100 dark:bg-red-500/10",
      text: "text-red-700 dark:text-red-400",
      border: "border-red-200 dark:border-red-500/30",
      accent: "border-l-4 border-l-red-500",
    },
    info: {
      bg: "bg-blue-50 dark:bg-blue-500/10",
      bgRow: "bg-blue-100 dark:bg-blue-500/10",
      text: "text-blue-700 dark:text-blue-400",
      border: "border-blue-200 dark:border-blue-500/30",
      accent: "border-l-4 border-l-blue-500",
    },
    purple: {
      bg: "bg-purple-50 dark:bg-purple-500/10",
      bgRow: "bg-purple-100 dark:bg-purple-500/10",
      text: "text-purple-700 dark:text-purple-400",
      border: "border-purple-200 dark:border-purple-500/30",
      accent: "border-l-4 border-l-purple-500",
    },
  },
  
  // Interactive elements
  interactive: {
    default: "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700",
    active: "bg-slate-900 dark:bg-slate-700 text-white",
  },
  
  // Cards and containers
  card: {
    default: "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700",
    hover: "hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md",
  },
  
  // Table rows
  table: {
    header: "bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400",
    row: "border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700",
    rowAlt: "bg-slate-50/30 dark:bg-slate-800/30",
  },
};

// Helper to combine design system classes
export function combine(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}
