import { useState, useEffect, useRef, useCallback } from "react";

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 5000
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
        setError(null);
        setIsLoading(false);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err);
        setIsLoading(false);
      }
    }
  }, [fetcher]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    intervalRef.current = setInterval(fetchData, intervalMs);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, intervalMs]);

  return { data, error, isLoading, refetch };
}
