import { useEffect, useState } from 'react';
import { DEFAULT_FILTERS, FILTERS_KEY, readFilters, type ChallengeFilters } from '@/lib/learn/pick';

/** The challenge filters, remembered on this device (never sent anywhere). */
export function useStoredFilters(): [ChallengeFilters, (next: ChallengeFilters) => void] {
  const [filters, setFilters] = useState<ChallengeFilters>(() => {
    try {
      return readFilters(JSON.parse(localStorage.getItem(FILTERS_KEY) ?? 'null'));
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Private browsing: the filters are simply not remembered.
    }
  }, [filters]);
  return [filters, setFilters];
}
