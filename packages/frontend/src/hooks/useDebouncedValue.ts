import { useState, useEffect } from 'react';

/**
 * Debounce a value by a given delay.
 * Returns the debounced value that only updates after the delay has passed
 * since the last change to the input value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
