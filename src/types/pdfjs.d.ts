declare module '../../node_modules/pdfjs-dist/build/pdf.mjs' {
  export interface PDFDocumentProxy {
    getPage(pageNumber: number): Promise<PDFPageProxy>;
    destroy(): Promise<void>;
  }

  export interface PDFPageProxy {
    getViewport(params: { scale: number }): PDFViewport;
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: PDFViewport }): { promise: Promise<void> };
    cleanup?(): void;
  }

  export interface PDFViewport {
    width: number;
    height: number;
  }

  export interface GlobalWorkerOptions {
    workerSrc: string;
  }

  export const GlobalWorkerOptions: GlobalWorkerOptions;
  export function getDocument(params: { url: string }): { promise: Promise<PDFDocumentProxy> };
}
