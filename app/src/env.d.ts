/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "ocrad.js" {
  type OCRInput = HTMLCanvasElement | CanvasRenderingContext2D | ImageData;
  function OCRAD(input: OCRInput): string;
  export default OCRAD;
}
