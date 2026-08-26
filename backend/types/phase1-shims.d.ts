declare const process: {
  env: Record<string, string | undefined>;
};

declare const global: any;

declare module 'express-rate-limit' {
  const rateLimit: any;
  export = rateLimit;
}

declare module 'axios' {
  const axios: any;
  export = axios;
}

declare module '@google/generative-ai' {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: any): any;
  }
}

declare module 'fs' {
  const fs: any;
  export = fs;
}

declare module 'path' {
  const path: any;
  export = path;
}

declare module 'os' {
  const os: any;
  export = os;
}

declare module 'crypto' {
  const crypto: any;
  export = crypto;
}

declare module 'jszip' {
  const JSZip: any;
  export = JSZip;
}

declare module 'mammoth' {
  const mammoth: any;
  export = mammoth;
}

declare module 'pdf-parse' {
  export const PDFParse: any;
  const pdfParse: any;
  export = pdfParse;
}

declare module 'pdf-parse/worker' {
  export const getData: any;
}

// exceljs ships its own index.d.ts, but tsconfig sets `noResolve: true`, so
// node_modules types are never read and every dependency needs a shim here.
declare module 'exceljs' {
  const ExcelJS: any;
  export = ExcelJS;
}
