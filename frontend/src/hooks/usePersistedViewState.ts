import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type ViewStateSchema<T> = {
  defaults: T;
  serialize?: Partial<Record<keyof T, (val: any) => string>>;
  deserialize?: Partial<Record<keyof T, (raw: string) => any>>;
};

/**
 * Reusable hook to preserve UI view state across navigation:
 * 1. URL search params are the SOURCE OF TRUTH (allows browser back/forward, refresh, deep linking).
 * 2. sessionStorage acts as per-page persistence when navigating back without params.
 * 3. Defaults apply only when neither URL nor sessionStorage has user choices.
 */
export function usePersistedViewState<T extends Record<string, any>>(
  pageKey: string,
  schema: ViewStateSchema<T>,
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const storageKey = `view_state:${pageKey}`;

  // Helper to read cached values from sessionStorage safely
  const getStoredState = useCallback((): Partial<T> => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn(`[usePersistedViewState] Failed reading sessionStorage for ${pageKey}:`, e);
    }
    return {};
  }, [storageKey, pageKey]);

  // Compute active state: URL param -> sessionStorage -> default
  const viewState = useMemo<T>(() => {
    const stored = getStoredState();
    const result: any = { ...schema.defaults };

    for (const key of Object.keys(schema.defaults) as Array<keyof T>) {
      const paramValue = searchParams.get(key as string);

      if (paramValue !== null) {
        // Deserialization
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
        result[key] = stored[key];
      }
    }

    return result as T;
  }, [searchParams, getStoredState, schema]);

  // Update state: writes to URL search params and updates sessionStorage
  const setViewState = useCallback(
    (updater: Partial<T> | ((prev: T) => Partial<T>)) => {
      const updates = typeof updater === "function" ? updater(viewState) : updater;
      const nextState: T = { ...viewState, ...updates };

      // 1. Save to sessionStorage
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(nextState));
      } catch (e) {
        console.warn(`[usePersistedViewState] Failed saving to sessionStorage for ${pageKey}:`, e);
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

  return { viewState, setViewState, setField };
}

export default usePersistedViewState;
