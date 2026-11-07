const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → "Jan 13". */
export const shortDate = (iso: string) => {
  const [, month, date] = iso.split('-').map(Number);
  return `${MONTHS[month - 1]} ${date}`;
};

/** 'YYYY-MM-DD' pair → "Jun 26 – Jul 6". */
export const dateRange = (start: string, end: string) => `${shortDate(start)} – ${shortDate(end)}`;

/** 'YYYY-MM-DD' → "Nov 2025". Read from the string, so no timezone can shift it. */
export const monthYear = (iso: string) => {
  const [year, month] = iso.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
};
