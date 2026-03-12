import React, { useEffect, useMemo, useRef, useState } from "react";

export type DropdownOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

type DropdownProps = {
  id?: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
  disabled?: boolean;
};

const Dropdown: React.FC<DropdownProps> = ({
  id,
  label,
  required = false,
  placeholder = "Select an option",
  value,
  options,
  onChange,
  error,
  helperText,
  disabled = false,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  useEffect(() => {
    const updateWidth = () => {
      if (wrapperRef.current) {
        setMenuWidth(wrapperRef.current.getBoundingClientRect().width);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);

    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!wrapperRef.current) {
        return;
      }

      if (!wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  const buttonClasses = [
    "w-full text-left px-4 py-3 bg-white border rounded-2xl shadow-sm focus:outline-none focus:ring-2 transition-colors flex items-center justify-between text-base",
    error
      ? "border-red-300 bg-red-50 focus:ring-red-200 focus:border-red-400"
      : "border-gray-200 focus:ring-blue-500 focus:border-blue-500",
    disabled ? "cursor-not-allowed bg-gray-100 text-gray-400" : "text-gray-900",
  ].join(" ");

  return (
    <div>
      {label && (
        <label
          htmlFor={id}
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}

      <div ref={wrapperRef} className="relative w-full">
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setIsOpen((current) => !current);
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={buttonClasses}
        >
          <span className={selectedOption ? "text-gray-900" : "text-gray-400"}>
            {selectedOption?.label ?? placeholder}
          </span>
          <svg
            className="h-4 w-4 text-gray-500"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5 7l5 5 5-5"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {isOpen && !disabled && (
          <div
            role="listbox"
            className="absolute left-0 z-30 mt-2 max-h-60 overflow-auto rounded-2xl border border-gray-200 bg-white py-1 shadow-lg"
            style={{ width: menuWidth }}
          >
            {options.map((option) => {
              const isSelected = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) {
                      return;
                    }

                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={[
                    "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors",
                    option.disabled
                      ? "cursor-not-allowed text-gray-300"
                      : isSelected
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-50",
                  ].join(" ")}
                >
                  <span>{option.label}</span>
                  {isSelected && (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M5 10.5l3 3 7-7"
                        stroke="currentColor"
                        strokeWidth={1.75}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {helperText && !error && (
        <p className="mt-1 text-xs text-gray-500">{helperText}</p>
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
};

export default Dropdown;
