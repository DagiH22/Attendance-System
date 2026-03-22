// frontend/src/types/html5-qrcode.d.ts
declare module "html5-qrcode" {
  export type Html5QrcodeCamera = { id: string; label: string };
  export type Html5QrcodeResult = { decodedText: string; decodedResult: any };
  export type Html5QrcodeError = any;

  export class Html5Qrcode {
    constructor(elementId: string);
    static getCameras(): Promise<Html5QrcodeCamera[]>;
    start(
      cameraIdOrConfig: string | { facingMode?: string },
      config?: {
        fps?: number;
        qrbox?: number | { width: number; height: number };
      },
      qrCodeSuccessCallback?: (
        decodedText: string,
        decodedResult?: any,
      ) => void,
      qrCodeErrorCallback?: (
        errorMessage: string,
        error?: Html5QrcodeError,
      ) => void,
    ): Promise<void>;
    stop(): Promise<void>;
    clear(): Promise<void>;
    // optional helpers
    isScanning?: boolean;
  }

  export class Html5QrcodeScanner {
    constructor(elementId: string, config?: any, verbose?: boolean);
    render(
      onScanSuccess: (decodedText: string, decodedResult: any) => void,
      onScanFailure?: (error: string) => void,
    ): void;
    clear(): Promise<void>;
  }
}
