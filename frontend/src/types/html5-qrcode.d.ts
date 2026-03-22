// frontend/src/types/html5-qrcode.d.ts
declare module "html5-qrcode" {
  export class Html5QrcodeScanner {
    constructor(
      elementId: string,
      config: {
        fps: number;
        qrbox: { width: number; height: number };
        [key: string]: any;
      },
      verbose: boolean,
    );
    render(
      onScanSuccess: (decodedText: string, decodedResult: any) => void,
      onScanFailure: (error: string) => void,
    ): void;
    clear(): Promise<void>;
  }
}
