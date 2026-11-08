import type { IndexObservation, IndexRegion } from './types';

/** Body of GET /api/price-index. */
export type PriceIndexResponse = {
  selected: IndexRegion;
  regions: {
    region: IndexRegion;
    name: string;
    attribution: string;
    fetchedAt: string | null;
    months: IndexObservation[];
  }[];
};
