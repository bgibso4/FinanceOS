const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whole units of the base currency: Travel figures read at a glance, not to the cent. */
export const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);

const day = (iso: string) => {
  const [, month, date] = iso.split('-').map(Number);
  return `${MONTHS[month - 1]} ${date}`;
};

/** 'YYYY-MM-DD' pair → "Jun 26 – Jul 6". */
export const dateRange = (start: string, end: string) => `${day(start)} – ${day(end)}`;

export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
