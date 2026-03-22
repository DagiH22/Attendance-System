import React, { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";

interface QrScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanFailure?: (error: string) => void;
}

const qrcodeRegionId = "html5qr-code-full-region";

const QrScanner: React.FC<QrScannerProps> = ({
  onScanSuccess,
  onScanFailure,
}) => {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [isScannerActive, setIsScannerActive] = useState(false);

  useEffect(() => {
    if (!scannerRef.current && !isScannerActive) {
      const scanner = new Html5QrcodeScanner(
        qrcodeRegionId,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          rememberLastUsedCamera: true,
        },
        false,
      );

      const handleSuccess = (decodedText: string) => {
        onScanSuccess(decodedText);
      };

      const handleFailure = (error: string) => {
        if (onScanFailure) {
          onScanFailure(error);
        }
      };

      scanner.render(handleSuccess, handleFailure);
      scannerRef.current = scanner;
      setIsScannerActive(true);
    }

    return () => {
      if (scannerRef.current && isScannerActive) {
        scannerRef.current.clear().catch((error) => {
          console.error("Failed to clear html5-qrcode-scanner.", error);
        });
        scannerRef.current = null;
        setIsScannerActive(false);
      }
    };
  }, [onScanSuccess, onScanFailure, isScannerActive]);

  return <div id={qrcodeRegionId} />;
};

export default QrScanner;
