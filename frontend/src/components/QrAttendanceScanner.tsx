import React, { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import api from "../lib/api";

interface QrAttendanceScannerProps {
  eventId: string;
  onScanSuccess: (result: { memberId: string; memberName?: string }) => void;
  onApiError: (error: any) => void;
  /** Optional function to map a scanned code to a UUID before sending to the backend */
  resolveMemberId?: (scannedCode: string) => string;
}

type ScannerState =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "SCANNING"
  | "PROCESSING"
  | "SUCCESS"
  | "ERROR";

const QrAttendanceScanner: React.FC<QrAttendanceScannerProps> = ({
  eventId,
  onScanSuccess,
  onApiError,
  resolveMemberId,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isProcessingRef = useRef(false);
  const [scannerState, setScannerState] = useState<ScannerState>("IDLE");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [apiErrorMsg, setApiErrorMsg] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {
            // Ignore unmount stop errors
          })
          .finally(() => {
            scannerRef.current = null;
          });
      }
    };
  }, []);

  const handleStart = async () => {
    setScannerState("REQUESTING_PERMISSION");
    setPermissionError(null);
    setApiErrorMsg(null);
    isProcessingRef.current = false;

    // Use a unique ID for the scanner region to avoid conflicts if multiple instances exist
    const elementId = "qr-scanner-region";

    // Ensure cleanup of any existing instance before creating a new one
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch (err: unknown) {
        // Ignore stop errors on restart
      }
    }

    const qrScanner = new Html5Qrcode(elementId);
    scannerRef.current = qrScanner;

    try {
      const cameras: any[] = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        setPermissionError("No cameras found on this device.");
        setScannerState("ERROR");
        return;
      }

      // Prefer back camera (environment) if available
      const backCamera = cameras.find(
        (c: any) =>
          String(c.label || "")
            .toLowerCase()
            .includes("back") ||
          String(c.label || "")
            .toLowerCase()
            .includes("environment"),
      );

      const cameraId = backCamera ? backCamera.id : cameras[0].id;

      await qrScanner.start(
        cameraId,
        {
          fps: 5,
          qrbox: { width: 250, height: 250 },
          // aspectRatio: 1.0,
        },
        (decodedText: string) => {
          // Success callback
          // Prevent multiple triggers using ref
          if (isProcessingRef.current) return;
          isProcessingRef.current = true;

          void handleScan(decodedText);
        },
        (errorMessage: string) => {
          // Error callback
          // Ignore the common "No MultiFormat Readers" error (scanning in progress)
          if (errorMessage.includes("No MultiFormat Readers")) {
            return;
          }
          // Intentionally omitting console log here to respect user requirement
        },
      );

      setScannerState("SCANNING");
    } catch (err: any) {
      setPermissionError(
        "Camera permission was denied or camera is unavailable. Please check your browser settings.",
      );
      setScannerState("ERROR");
    }
  };

  const handleStop = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch (err: unknown) {
        // Ignore stop errors
      } finally {
        scannerRef.current.clear(); // Clear the canvas
      }
    }
    setScannerState("IDLE");
    isProcessingRef.current = false;
  };

  const handleScan = async (qrCodeValue: string) => {
    // Immediate UI feedback
    setScannerState("PROCESSING");
    setLastScannedCode(qrCodeValue);

    // Pause scanning instead of stopping it completely
    if (scannerRef.current) {
      try {
        // Try to pause if supported
        if (typeof (scannerRef.current as any).pause === "function") {
          (scannerRef.current as any).pause(true);
        }
      } catch (e) {
        console.warn("Could not pause scanner", e);
      }
    }

    try {
      const parentResolvedId = resolveMemberId
        ? resolveMemberId(qrCodeValue)
        : qrCodeValue;

      const response = await api.post("/attendance", {
        memberId: parentResolvedId,
        eventId: eventId,
        method: "QR",
      });

      setScannerState("SUCCESS");
      onScanSuccess({
        memberId: parentResolvedId,
        memberName: response.data?.member?.name,
      });

      // Auto-resume scanner after brief delay
      setTimeout(() => {
        resumeScanner();
      }, 2000);
    } catch (error: any) {
      setScannerState("ERROR");
      const message =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        "Failed to mark attendance.";
      setApiErrorMsg(message);
      onApiError(error);

      // Allow user to see error for a moment, then reset
      setTimeout(() => {
        resumeScanner();
      }, 3000);
    }
  };

  const resumeScanner = () => {
    if (scannerRef.current) {
      try {
        if (typeof (scannerRef.current as any).resume === "function") {
          (scannerRef.current as any).resume();
        }
      } catch (e) {
        console.warn("Could not resume scanner", e);
      }
    }
    setScannerState("SCANNING");
    // Delay setting isProcessingRef to false just slightly to prevent immediate double-read
    setTimeout(() => {
      isProcessingRef.current = false;
    }, 500);
  };

  // Helper for TS issue in handleScan above
  // Since we are unmounting/stopping, we need to be careful about state updates if component unmounts.
  // But here we are just stopping the scanner, component remains mounted.

  const renderScannerState = () => {
    switch (scannerState) {
      case "IDLE":
        return (
          <button
            onClick={handleStart}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Start Camera
          </button>
        );
      case "REQUESTING_PERMISSION":
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
            <p className="mt-4 text-sm text-slate-500">
              Requesting camera access...
            </p>
          </div>
        );
      case "SCANNING":
      case "PROCESSING":
      case "SUCCESS":
      case "ERROR":
        return (
          <div className="mt-4 space-y-4">
            {/* Feedback Content */}
            <div className="min-h-[80px] flex items-center justify-center transition-all">
              {scannerState === "SCANNING" && (
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-700">
                    Ready to Scan
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Point camera at a QR code
                  </p>
                </div>
              )}
              {scannerState === "PROCESSING" && (
                <div className="flex flex-col items-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600 mb-2" />
                  <p className="text-sm font-medium text-slate-700">
                    Verifying...
                  </p>
                  <p className="text-xs text-slate-500 font-mono mt-1 w-full max-w-[200px] truncate text-center">
                    {lastScannedCode}
                  </p>
                </div>
              )}
              {scannerState === "SUCCESS" && (
                <div className="text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100 mb-2">
                    <svg
                      className="h-5 w-5 text-green-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <p className="text-sm font-bold text-green-600">
                    Scan Successful!
                  </p>
                </div>
              )}
              {scannerState === "ERROR" && (
                <div className="text-center w-full px-2">
                  <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-red-100 mb-2">
                    <svg
                      className="h-4 w-4 text-red-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </div>
                  <p className="text-xs font-semibold text-red-600 mb-1 max-w-[250px] mx-auto line-clamp-2">
                    {apiErrorMsg ||
                      permissionError ||
                      "Invalid or already scanned QR code"}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={handleStop}
              className="w-full rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 border border-red-200 transition-colors"
            >
              Stop Scanning
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 p-2">
      {/* Scanner Region */}
      <div
        id="qr-scanner-region"
        className={`w-full bg-black rounded-xl overflow-hidden transition-all duration-300 ${
          ["SCANNING", "PROCESSING", "SUCCESS", "ERROR"].includes(scannerState)
            ? "min-h-[250px]"
            : "h-0"
        }`}
      />

      {/* Controls & Feedback Area */}
      <div className="p-0">{renderScannerState()}</div>
    </div>
  );
};

export default QrAttendanceScanner;
