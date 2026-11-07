import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodPicker } from '@/components/ui/period-picker';

const NOW = new Date(2026, 10, 4);

describe('PeriodPicker', () => {
  it('monthModeStepsAcrossYearEnd', async () => {
    const onChange = vi.fn();
    render(
      <PeriodPicker mode="month" now={new Date(2027, 5, 1)} value="2026-12" onChange={onChange} />
    );
    expect(screen.getByRole('button', { name: /December 2026/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(onChange).toHaveBeenCalledWith('2027-01');
  });

  it('monthModeDisablesFutureMonths', async () => {
    const onChange = vi.fn();
    render(<PeriodPicker mode="month" now={NOW} value="2026-11" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /November 2026/ }));
    expect(screen.getByRole('button', { name: 'Dec' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Oct' }));
    expect(onChange).toHaveBeenCalledWith('2026-10');
  });

  it('yearModeStepsAndStopsAtCurrentYear', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PeriodPicker mode="year" now={NOW} value="2025" onChange={onChange} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(onChange).toHaveBeenCalledWith('2026');
    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(onChange).toHaveBeenCalledWith('2024');
    rerender(<PeriodPicker mode="year" now={NOW} value="2026" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
  });

  it('yearModeListsYearsFromMin', async () => {
    const onChange = vi.fn();
    render(<PeriodPicker minYear={2025} mode="year" now={NOW} value="2026" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /2026/ }));
    expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2024' })).toBeNull();
    expect(screen.queryByRole('button', { name: '2027' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '2025' }));
    expect(onChange).toHaveBeenCalledWith('2025');
  });

  it('yearModeHonoursMaxYear', async () => {
    const onChange = vi.fn();
    render(
      <PeriodPicker
        maxYear={2028}
        minYear={2026}
        mode="year"
        now={NOW}
        value="2027"
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(onChange).toHaveBeenCalledWith('2028');
    await userEvent.click(screen.getByRole('button', { name: /2027/ }));
    expect(screen.getByRole('button', { name: '2028' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2029' })).not.toBeInTheDocument();
  });

  it('yearModeStopsAtMaxYear', () => {
    render(<PeriodPicker maxYear={2027} mode="year" now={NOW} value="2027" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
  });
});
