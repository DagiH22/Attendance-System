import React, { useState, useEffect, useRef, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Zap, ZapOff, CheckCircle2, AlertCircle, AlertTriangle, RotateCcw } from "lucide-react";
import api from "../lib/api";

interface QrAttendanceScannerProps {
  eventId: string;
  onScanSuccess: (result: { memberId: string; memberName?: string; status?: string }) => void;
  onApiError: (error: any) => void;
  /** Optional function to map a scanned code to a UUID before sending to the backend */
  resolveMemberId?: (scannedCode: string) => string;
  allowOverride?: boolean;
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
  allowOverride = false,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const wakeLockRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const autoResumeTimerRef = useRef<any>(null);

  const [scannerState, setScannerState] = useState<ScannerState>("IDLE");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [apiErrorMsg, setApiErrorMsg] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [lastMemberName, setLastMemberName] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);

  // Torch state
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Vibration feedback helper
  const triggerVibrate = useCallback((pattern: number | number[] = 100) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // ignore vibration permission or hardware lack
      }
    }
  }, []);

  // Screen Wake Lock API
  const requestWakeLock = useCallback(async () => {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator && !wakeLockRef.current) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      } catch (err) {
        // Wake lock may fail if battery is low or not permitted
      }
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
    }
  }, []);

  // Check torch capability on the current video track
  const checkTorchCapability = useCallback(() => {
    try {
      const videoEl = document.querySelector("#qr-scanner-region video") as HTMLVideoElement | null;
      const stream = videoEl?.srcObject as MediaStream | null;
      const track = stream?.getVideoTracks?.()[0];
      if (track) {
        const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
        if (capabilities?.torch) {
          setTorchSupported(true);
          return;
        }
      }
      setTorchSupported(false);
    } catch {
      setTorchSupported(false);
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    try {
      const videoEl = document.querySelector("#qr-scanner-region video") as HTMLVideoElement | null;
      const stream = videoEl?.srcObject as MediaStream | null;
      const track = stream?.getVideoTracks?.()[0];
      if (track) {
        const nextState = !torchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextState }],
        });
        setTorchOn(nextState);
      }
    } catch (err) {
      console.warn("Failed to toggle torch", err);
    }
  }, [torchOn]);

  // Handle visibility change to re-acquire wake lock when tab returns
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && scannerState === "SCANNING") {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [scannerState, requestWakeLock]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoResumeTimerRef.current) {
        clearTimeout(autoResumeTimerRef.current);
      }
      void releaseWakeLock();
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current = null;
          });
      }
    };
  }, [releaseWakeLock]);

  const resumeScanner = useCallback(() => {
    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }

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
    // Delay releasing processing lock slightly to prevent immediate double-read of the same code
    setTimeout(() => {
      isProcessingRef.current = false;
    }, 400);
  }, []);

  const handleStart = async () => {
    setScannerState("REQUESTING_PERMISSION");
    setPermissionError(null);
    setApiErrorMsg(null);
    isProcessingRef.current = false;

    const elementId = "qr-scanner-region";

    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // ignore stop error
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
          String(c.label || "").toLowerCase().includes("back") ||
          String(c.label || "").toLowerCase().includes("environment"),
      );

      const cameraId = backCamera ? backCamera.id : cameras[0].id;

      // Sized for portrait on mobile (aspectRatio < 1.0)
      const isMobile = window.innerWidth < 640;
      await qrScanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: isMobile ? { width: 220, height: 220 } : { width: 250, height: 250 },
        },
        (decodedText: string) => {
          if (isProcessingRef.current) return;
          isProcessingRef.current = true;
          void handleScan(decodedText);
        },
        (errorMessage: string) => {
          if (errorMessage.includes("No MultiFormat Readers")) {
            return;
          }
        },
      );

      setScannerState("SCANNING");
      void requestWakeLock();
      setTimeout(checkTorchCapability, 600);
    } catch (err: any) {
      setPermissionError(
        "Camera permission was denied or camera is unavailable. Please check your browser settings.",
      );
      setScannerState("ERROR");
    }
  };

  const handleStop = async () => {
    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }
    void releaseWakeLock();
    if (torchOn) {
      void toggleTorch();
    }
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // ignore
      } finally {
        scannerRef.current.clear();
      }
    }
    setScannerState("IDLE");
    isProcessingRef.current = false;
  };

  const handleScan = async (qrCodeValue: string) => {
    setScannerState("PROCESSING");
    setIsDuplicate(false);

    if (scannerRef.current) {
      try {
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
        allowOverride,
      });

      const attendanceStatus = response.data?.attendance?.status ?? "PRESENT";
      const memberName = response.data?.member?.name || "";
      setLastStatus(attendanceStatus);
      setLastMemberName(memberName);
      setScannerState("SUCCESS");

      // Vibration: double short pulse on success
      triggerVibrate([80, 40, 80]);

      onScanSuccess({
        memberId: parentResolvedId,
        memberName,
        status: attendanceStatus,
      });

      // Fast auto-resume after 1.2s for rapid queue scanning
      autoResumeTimerRef.current = setTimeout(() => {
        resumeScanner();
      }, 1200);
    } catch (error: any) {
      const message =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        "Failed to mark attendance.";
      
      const isAlreadyCheckedIn =
        message.toLowerCase().includes("already") ||
        error?.response?.status === 409;

      setIsDuplicate(isAlreadyCheckedIn);
      setLastStatus(isAlreadyCheckedIn ? "ALREADY_PRESENT" : "ERROR");
      setScannerState("ERROR");
      setApiErrorMsg(message);

      // Vibration: longer warning buzz on duplicate/error
      triggerVibrate(isAlreadyCheckedIn ? [120, 60, 120] : 200);

      onApiError(error);

      // Auto-resume after 2s or user can tap to resume immediately
      autoResumeTimerRef.current = setTimeout(() => {
        resumeScanner();
      }, 2000);
    }
  };

  return (
    <div className="w-full max-w-sm sm:max-w-md mx-auto overflow-hidden rounded-3xl bg-white shadow-md ring-1 ring-slate-200/80 p-3 sm:p-4">
      {/* Scanner Viewfinder Region with Portrait Aspect Ratio */}
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <div
          id="qr-scanner-region"
          className={`w-full transition-all duration-300 ${
            ["SCANNING", "PROCESSING", "SUCCESS", "ERROR"].includes(scannerState)
              ? "aspect-[3/4] sm:aspect-square max-h-[55vh]"
              : "h-0"
          }`}
        />

        {/* Overlay Controls (Torch Toggle & Quick Actions) */}
        {scannerState === "SCANNING" && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md transition shadow-lg ${
                  torchOn
                    ? "bg-amber-400 text-slate-900 ring-2 ring-white"
                    : "bg-black/50 text-white hover:bg-black/70"
                }`}
                title={torchOn ? "Turn Torch Off" : "Turn Torch On"}
              >
                {torchOn ? <Zap className="h-5 w-5 fill-slate-900" /> : <ZapOff className="h-5 w-5" />}
              </button>
            )}
          </div>
        )}

        {/* Large Result Banner Overlay on Camera View */}
        {scannerState === "SUCCESS" && (
          <div
            onClick={resumeScanner}
            className={`absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center cursor-pointer transition animate-in fade-in backdrop-blur-sm ${
              lastStatus === "LATE"
                ? "bg-amber-600/90 text-white"
                : "bg-emerald-600/90 text-white"
            }`}
          >
            <CheckCircle2 className="h-16 w-16 mb-3 animate-bounce" />
            <h3 className="text-2xl font-black tracking-tight">
              {lastStatus === "LATE" ? "Marked Late" : "Checked In!"}
            </h3>
            {lastMemberName && (
              <p className="mt-1 text-lg font-bold">{lastMemberName}</p>
            )}
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-1.5 text-xs font-semibold">
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Tap anywhere to scan next</span>
            </p>
          </div>
        )}

        {scannerState === "ERROR" && (
          <div
            onClick={resumeScanner}
            className={`absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center cursor-pointer transition animate-in fade-in backdrop-blur-sm ${
              isDuplicate ? "bg-amber-600/90 text-white" : "bg-rose-600/90 text-white"
            }`}
          >
            {isDuplicate ? (
              <AlertTriangle className="h-16 w-16 mb-3" />
            ) : (
              <AlertCircle className="h-16 w-16 mb-3" />
            )}
            <h3 className="text-xl font-black">
              {isDuplicate ? "Already Checked In" : "Scan Error"}
            </h3>
            <p className="mt-2 text-sm font-semibold max-w-[280px]">
              {apiErrorMsg || permissionError || "Invalid or unrecognized QR code"}
            </p>
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-1.5 text-xs font-semibold">
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Tap anywhere to re-scan</span>
            </p>
          </div>
        )}
      </div>

      {/* Primary Action Button (Start / Stop) with >= 44px tap target */}
      <div className="mt-4">
        {scannerState === "IDLE" && (
          <button
            type="button"
            onClick={handleStart}
            className="w-full min-h-[48px] rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white shadow-md hover:bg-blue-700 active:scale-[0.99] transition"
          >
            Start Camera Scanner
          </button>
        )}

        {scannerState === "REQUESTING_PERMISSION" && (
          <div className="flex flex-col items-center justify-center py-6">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
            <p className="mt-3 text-sm font-semibold text-slate-600">
              Requesting camera permission...
            </p>
          </div>
        )}

        {["SCANNING", "PROCESSING", "SUCCESS", "ERROR"].includes(scannerState) && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleStop}
              className="flex-1 min-h-[44px] rounded-2xl bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
            >
              Stop Camera
            </button>
            {scannerState === "SCANNING" && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QrAttendanceScanner;

