import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Clock, Star } from "lucide-react";
import api from "../../lib/api";
import {
  DEFAULT_LOCATION_SUGGESTIONS,
  normalizeLocation,
} from "../../config/location.config";

export interface LocationComboboxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
}

export const LocationCombobox: React.FC<LocationComboboxProps> = ({
  value,
  onChange,
  placeholder = "Optional — e.g. ማዕከል 4ኛ ፎቅ",
  className = "",
  id,
  disabled = false,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch distinct past locations from backend (most used first)
  const { data: pastLocations = [] } = useQuery<string[]>({
    queryKey: ["session-locations"],
    queryFn: async () => {
      try {
        const res = await api.get("/events/locations");
        return res.data?.locations || [];
      } catch (err) {
        return [];
      }
    },
    staleTime: 60 * 1000,
  });

  // Combine: 3 defaults first, then past locations not in defaults
  const allSuggestions = useMemo(() => {
    const list: Array<{ text: string; isPreset: boolean }> = [];
    const seen = new Set<string>();

    for (const preset of DEFAULT_LOCATION_SUGGESTIONS) {
      const norm = normalizeLocation(preset);
      list.push({ text: preset, isPreset: true });
      seen.add(norm);
    }

    for (const past of pastLocations) {
      const norm = normalizeLocation(past);
      if (norm && !seen.has(norm)) {
        list.push({ text: norm, isPreset: false });
        seen.add(norm);
      }
    }

    return list;
  }, [pastLocations]);

  // Filter suggestions dynamically as user types
  const filteredSuggestions = useMemo(() => {
    const query = normalizeLocation(value).toLowerCase();
    if (!query) return allSuggestions;
    return allSuggestions.filter((item) =>
      item.text.toLowerCase().includes(query),
    );
  }, [allSuggestions, value]);

  // Handle clicking outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (text: string) => {
    onChange(normalizeLocation(text));
    setIsFocused(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition ${className}`}
        />
      </div>

      {/* Suggestion Combobox Dropdown (Only appears when focused) */}
      {isFocused && filteredSuggestions.length > 0 && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md shadow-xl max-h-56 overflow-y-auto divide-y divide-slate-100 animate-in fade-in slide-in-from-top-1">
          <div className="px-3 py-1.5 bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Location Suggestions</span>
            <span>Click to fill</span>
          </div>
          {filteredSuggestions.map((item) => (
            <button
              key={item.text}
              type="button"
              onMouseDown={(e) => {
                // Prevent input blur before click handler completes
                e.preventDefault();
                handleSelect(item.text);
              }}
              className="w-full text-left px-3.5 py-2.5 min-h-[44px] flex items-center justify-between hover:bg-blue-50/70 active:bg-blue-100/70 transition group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {item.isPreset ? (
                  <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0 group-hover:text-blue-500" />
                )}
                <span className="text-sm font-semibold text-slate-800 truncate">
                  {item.text}
                </span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-700 shrink-0 ml-2">
                {item.isPreset ? "Preset" : "Recent"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LocationCombobox;
