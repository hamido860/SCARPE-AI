export interface PipelineStats {
  originalDownloads: number;
  cleanCopies: number;
  datasetRows: number;
  localRoot: string;
}

export type OcrBatchMode = "Disabled" | "Safe" | "Balanced" | "Fast";
