import { describe, it, expect } from 'vitest';
import { executeGenerateChart } from '@/lib/agent/tools';

describe('action tools', () => {
  describe('executeGenerateChart', () => {
    it('returns a valid ChartSpec', () => {
      const result = executeGenerateChart({
        type: 'bar',
        title: 'Spending by Category',
        series: [
          {
            label: 'Amount',
            data: [
              { x: 'Food', y: 250 },
              { x: 'Transport', y: 100 },
            ],
          },
        ],
      });
      expect(result.type).toBe('bar');
      expect(result.title).toBe('Spending by Category');
      expect(result.series).toHaveLength(1);
    });

    it('passes through optional axis labels', () => {
      const result = executeGenerateChart({
        type: 'line',
        title: 'Monthly Trend',
        xLabel: 'Month',
        yLabel: 'Amount ($)',
        series: [
          {
            label: 'Spending',
            data: [
              { x: 'Jan', y: 500 },
              { x: 'Feb', y: 600 },
            ],
          },
        ],
      });
      expect(result.xLabel).toBe('Month');
      expect(result.yLabel).toBe('Amount ($)');
    });

    it('handles multiple series', () => {
      const result = executeGenerateChart({
        type: 'area',
        title: 'Income vs Spending',
        series: [
          {
            label: 'Income',
            data: [{ x: 'Jan', y: 5000 }],
          },
          {
            label: 'Spending',
            data: [{ x: 'Jan', y: 3000 }],
          },
        ],
      });
      expect(result.series).toHaveLength(2);
      expect(result.series[0].label).toBe('Income');
      expect(result.series[1].label).toBe('Spending');
    });
  });
});
