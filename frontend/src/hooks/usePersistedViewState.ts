import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

export type ViewStateSchema<T> = {
  defaults: T;
  serialize?: Partial<Record<keyof T, (val: any) => string>>;
  deserialize?: Partial<Record<keyof T, (raw: string) => any>>;
};

/**
 * Clears all view_state:* entries from localStorage on user logout.
 */
export function clearAllPersistedViewStates(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith("view_state:")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn("[usePersistedViewState] Failed clearing view state from localStorage:", e);
  }
}

/**
 * Reusable hook to preserve UI view state across navigation:
 * 1. URL search params are the authoritative SOURCE OF TRUTH (browser back/forward, refresh, deep linking).
 * 2. localStorage acts as per-page persistence when navigating back via navigation links without params.
 * 3. Defaults apply only when neither URL nor localStorage has user choices.
 * 4. Provides resetFilters() to restore defaults and clears on logout.
 */
export function usePersistedViewState<T extends Record<string, any>>(
  pageKey: string,
  schema: ViewStateSchema<T>,
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const storageKey = `view_state:${pageKey}`;
  const hasSyncedUrlOnMount = useRef(false);

  // Helper to read cached values from localStorage safely
  const getStoredState = useCallback((): Partial<T> => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn(`[usePersistedViewState] Failed reading localStorage for ${pageKey}:`, e);
    }
    return {};
  }, [storageKey, pageKey]);

  // Compute active state: URL param -> localStorage -> default
  const viewState = useMemo<T>(() => {
    const stored = getStoredState();
    const result: any = { ...schema.defaults };

    for (const key of Object.keys(schema.defaults) as Array<keyof T>) {
      const paramValue = searchParams.get(key as string);

      if (paramValue !== null) {
        // Deserialization from URL
        if (schema.deserialize && schema.deserialize[key]) {
          result[key] = schema.deserialize[key]!(paramValue);
        } else if (typeof schema.defaults[key] === "boolean") {
          result[key] = paramValue === "true" || paramValue === "1";
        } else if (typeof schema.defaults[key] === "number") {
          const num = Number(paramValue);
          result[key] = isNaN(num) ? schema.defaults[key] : num;
        } else if (Array.isArray(schema.defaults[key])) {
          result[key] = paramValue ? paramValue.split(",") : [];
        } else {
          result[key] = paramValue;
        }
      } else if (stored[key] !== undefined && stored[key] !== null) {
        // Fallback to localStorage
        result[key] = stored[key];
      }
    }

    return result as T;
  }, [searchParams, getStoredState, schema]);

  // Update state: writes to localStorage and synchronizes with URL search params
  const setViewState = useCallback(
    (updater: Partial<T> | ((prev: T) => Partial<T>)) => {
      const updates = typeof updater === "function" ? updater(viewState) : updater;
      const nextState: T = { ...viewState, ...updates };

      // 1. Save to localStorage
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(nextState));
      } catch (e) {
        console.warn(`[usePersistedViewState] Failed saving to localStorage for ${pageKey}:`, e);
      }

      // 2. Sync to URL search params
      setSearchParams(
        (prevParams) => {
          const nextParams = new URLSearchParams(prevParams);

          for (const [k, v] of Object.entries(nextState)) {
            const defaultVal = schema.defaults[k as keyof T];
            const isDefault = JSON.stringify(v) === JSON.stringify(defaultVal);

            if (v === undefined || v === null || v === "" || isDefault) {
              nextParams.delete(k);
            } else if (schema.serialize && schema.serialize[k as keyof T]) {
              nextParams.set(k, schema.serialize[k as keyof T]!(v));
            } else if (Array.isArray(v)) {
              if (v.length > 0) nextParams.set(k, v.join(","));
              else nextParams.delete(k);
            } else {
              nextParams.set(k, String(v));
            }
          }

          return nextParams;
        },
        { replace: true },
      );
    },
    [viewState, storageKey, pageKey, schema, setSearchParams],
  );

  const setField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setViewState({ [field]: value } as unknown as Partial<T>);
    },
    [setViewState],
  );

  // Reset all filters and view controls to schema defaults
  const resetFilters = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch (e) {
      console.warn(`[usePersistedViewState] Failed clearing localStorage for ${pageKey}:`, e);
    }

    setSearchParams(
      (prevParams) => {
        const nextParams = new URLSearchParams(prevParams);
        for (const k of Object.keys(schema.defaults)) {
          nextParams.delete(k);
        }
        return nextParams;
      },
      { replace: true },
    );
  }, [storageKey, pageKey, schema.defaults, setSearchParams]);

  // Synchronize localStorage into URL search parameters on initial bare load
  useEffect(() => {
    if (hasSyncedUrlOnMount.current) return;
    hasSyncedUrlOnMount.current = true;

    const stored = getStoredState();
    let hasNonDefault = false;
    const initialParams = new URLSearchParams(window.location.search);

    for (const [k, v] of Object.entries(stored)) {
      if (k in schema.defaults) {
        const defaultVal = schema.defaults[k as keyof T];
        const isDefault = JSON.stringify(v) === JSON.stringify(defaultVal);
        if (!isDefault && !initialParams.has(k)) {
          hasNonDefault = true;
          if (schema.serialize && schema.serialize[k as keyof T]) {
            initialParams.set(k, schema.serialize[k as keyof T]!(v));
          } else if (Array.isArray(v)) {
            if (v.length > 0) initialParams.set(k, v.join(","));
          } else if (v !== undefined && v !== null && v !== "") {
            initialParams.set(k, String(v));
          }
        }
      }
    }

    if (hasNonDefault) {
      setSearchParams(initialParams, { replace: true });
    }
  }, [getStoredState, schema, setSearchParams]);

  return { viewState, setViewState, setField, resetFilters };
}

export default usePersistedViewState;
