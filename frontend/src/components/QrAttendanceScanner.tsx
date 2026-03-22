import React, { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import api from "../lib/api";

interface QrAttendanceScannerProps {
  eventId: string;
  onScanSuccess: (result: { memberId: string; memberName?: string }) => void;
  onApiError: (error: any) => void;
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
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isProcessingRef = useRef(false);
  const [scannerState, setScannerState] = useState<ScannerState>("IDLE");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch((err: unknown) => {
            console.warn("Failed to stop QR scanner on unmount:", err);
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
      const backCamera = cameras.find((c: any) => 
        String(c.label || "").toLowerCase().includes("back") ||
        String(c.label || "").toLowerCase().includes("environment")
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
          console.warn(`QR Scan Warning: ${errorMessage}`);
        },
      );
      
      setScannerState("SCANNING");
    } catch (err: any) {
      console.error("Camera start error:", err);
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
        console.warn("Failed to stop scanner:", err);
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
    
    // Stop scanning immediately upon detection
    if (scannerRef.current) {
        try {
            await scannerRef.current.stop();
            scannerRef.current.clear();
        } catch (e) {
            console.warn("Error stopping scanner after success:", e);
        }
    }

    try {
      const response = await api.post("/attendance", {
        memberId: qrCodeValue,
        eventId: eventId,
        method: "QR",
      });

      setScannerState("SUCCESS");
      onScanSuccess({
        memberId: qrCodeValue,
        memberName: response.data?.member?.name,
      });
    } catch (error) {
      // If error occurs, we stay in ERROR state or go back to IDLE?
      // Usually better to show error and let user try again.
      setScannerState("ERROR");
      onApiError(error);
      isProcessingRef.current = false; // Allow retrying if they restart
    }
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
            <p className="mt-4 text-sm text-slate-500">Requesting camera access...</p>
          </div>
        );
      case "SCANNING":
        return (
          <div className="mt-4">
            <button
              onClick={handleStop}
              className="w-full rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 border border-red-200"
            >
              Stop Scanning
            </button>
            <p className="mt-2 text-xs text-center text-slate-400">
              Scanning... Point camera at a QR code
            </p>
          </div>
        );
      case "PROCESSING":
        return (
          <div className="flex flex-col items-center justify-center py-4">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600 mb-2" />
            <p className="text-sm font-medium text-slate-700">Verifying...</p>
            <p className="text-xs text-slate-500 font-mono mt-1">{lastScannedCode}</p>
          </div>
        );
      case "SUCCESS":
        return (
          <div className="text-center py-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-3">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-green-600 font-medium">Scan Successful!</p>
            <button
              onClick={handleStart}
              className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700 underline"
            >
              Scan Another
            </button>
          </div>
        );
      case "ERROR":
        return (
          <div className="text-center py-4 rounded-lg bg-red-50 p-4 border border-red-100">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-100 mb-2">
              <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-sm text-red-800 font-medium mb-1">
              {permissionError || "Unable to scan"}
            </p>
            {!permissionError && (
                 <p className="text-xs text-red-600 mb-3 block">
                    Check console for details or try again.
                 </p>
            )}
            <button
              onClick={handleStart}
              className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
            >
              Try Again
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto overflow-hidden rounded-2xl bg-white">
      {/* Scanner Region */}
      <div 
        id="qr-scanner-region" 
        className={`w-full bg-black ${scannerState === "SCANNING" ? "min-h-[250px]" : "h-0"}`} 
      />
      
      {/* Controls & Feedback Area */}
      <div className="p-0"> 
        {renderScannerState()}
      </div>
    </div>
  );
};

export default QrAttendanceScanner;

