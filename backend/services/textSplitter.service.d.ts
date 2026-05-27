export interface SplitChunk {
  content: string;
}

export function splitText(
  text: string,
  fileType?: string,
  options?: Record<string, any>
): SplitChunk[];
