export interface ScrapeResult {
  url: string;
  title: string;
  description: string;
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
    h4: string[];
    h5: string[];
    h6: string[];
  };
  links: { text: string; href: string }[];
  images: { alt: string; src: string }[];
  rawText: string;
  isPdf?: boolean;
  country?: string;
  pdfAnalysis?: AnalysisResult;
}

export interface AnalysisResult {
  summary: string;
  keyPoints: string[];
  sentiment: string;
  entities: string[];
  followUpQuestion?: string;
  detectedCountry?: string;
  languages?: string[];
  fullContent?: string;
  source_type?: string;
}

export interface Favorite {
  url: string;
  title: string;
  addedAt: number;
  country?: string;
}
