import { StagedPdf } from "../types/pdf";

export interface LevelspaceNamingMetadata {
  grade?: string | null;
  subject?: string | null;
  track?: string | null;
  documentType?: string | null;
  schoolYear?: string | null;
  region?: string | null;
  source?: string | null;
}

export function formatLevelspaceReviewTitle(metadata: LevelspaceNamingMetadata): string {
  const parts = [
    metadata.grade,
    metadata.subject,
    metadata.track,
    metadata.documentType,
    metadata.schoolYear,
    metadata.region,
    metadata.source
  ].filter(Boolean).map(p => p?.trim()).filter(Boolean);

  if (parts.length === 0) return "Levelspace · Unnamed Document";
  return `Levelspace · ${parts.join(" · ")}`;
}

export function formatLevelspaceSafeFilename(metadata: LevelspaceNamingMetadata): string {
  const parts = [
    metadata.grade,
    metadata.subject,
    metadata.track,
    metadata.documentType,
    metadata.schoolYear,
    metadata.region,
    metadata.source
  ].filter(Boolean).map(p => p?.trim()).filter(Boolean);

  if (parts.length === 0) return "Levelspace_Unnamed_Document.pdf";

  
  const removeAccents = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  const formattedParts = parts.map(p => {
    return removeAccents(p!)
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-");
  });

  return `Levelspace_${formattedParts.join("_")}.pdf`;
}

/**
 * Clean a string by removing common generic Moroccan school terms and punctuation,
 * returning a hyphenated topic slug. Supports Arabic and French.
 */
export function cleanTopicText(text: string): string {
  if (!text) return "";
  
  // Try to decode URI component if URL-encoded
  try {
    text = decodeURIComponent(text);
  } catch {}

  // Split off file extension
  text = text.replace(/\.pdf$/i, "");

  // Terms to remove (case-insensitive)
  const genericWords = [
    "cours", "exercice", "exercices", "corrige", "correction", "pdf", "fr", "ar", 
    "html", "lesson", "lecon", "dars", "serie", "solutions", "solution", "devoir", 
    "controle", "exam", "examen", "talamidi", "talamidi.com", "moutamadris", 
    "moutamadris.ma", "جميع", "دروس", "درس", "تمارين", "حلول", "تصحيح", "ملخص", 
    "فرض", "امتحان", "موقع", "تلاميذي", "تحميل", "الملف"
  ];

  // Structural grade/subject indicators to skip in the topic segment
  const structuralLabels = [
    "1ac", "2ac", "3ac", "tcs", "1bac", "2bac", "math", "maths", 
    "mathematiques", "mathématiques", "pc", "physique", "chimie", "svt", 
    "french", "francais", "français"
  ];

  // Split by safe boundary characters
  const words = text.split(/[\s\-_,.:;@+()\[\]{}'"’`|\\/]+/).filter(Boolean);

  const cleanedWords = words.filter(word => {
    const lw = word.toLowerCase().trim();
    if (genericWords.includes(lw) || structuralLabels.includes(lw)) {
      return false;
    }
    // Filter out pure numbers (usually sequence counts like "01", "2")
    if (/^\d+$/.test(lw)) {
      return false;
    }
    return true;
  });

  if (cleanedWords.length === 0) return "";

  // Join back with hyphens
  return cleanedWords.join("-");
}

/**
 * Extract source site label from a URL
 */
export function extractSource(url: string): string {
  if (!url) return "Source";
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const parts = hostname.replace("www.", "").split(".");
    const sld = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    if (sld === "talamidi") return "Talamidi";
    if (sld === "moutamadris") return "Moutamadris";
    return sld.charAt(0).toUpperCase() + sld.slice(1);
  } catch {
    return "Source";
  }
}

interface GenerateFilenameResult {
  filename: string;
  extractedTopic: string;
  documentType: string;
  confidence: number;
}

/**
 * Generates a clean, systematic filename adhering to the Morocco curriculum pipeline spec.
 */
export function generateCurriculumFilename(params: {
  url: string;
  htmlTitle?: string;
  pdfTitle?: string;
  grade?: string;
  subject?: string;
  documentType?: string;
  fallbackSeq?: string;
  existingFilenamesAndHashes?: Array<{ filename: string; hash?: string }>;
  currentHash?: string;
}): GenerateFilenameResult {
  const { 
    url, 
    htmlTitle, 
    pdfTitle, 
    grade, 
    subject, 
    documentType, 
    fallbackSeq,
    existingFilenamesAndHashes = [],
    currentHash
  } = params;
  
  const urlLower = url.toLowerCase();

  // 1. Determine Grade Code
  let gradeCode = "1AC";
  if (grade) {
    const gClean = grade.toUpperCase().replace("_", "");
    if (["1AC", "2AC", "3AC", "TC", "1BAC", "2BAC"].includes(gClean)) {
      gradeCode = gClean;
    } else if (gClean.includes("1ERE") && gClean.includes("COLLEGE")) {
      gradeCode = "1AC";
    } else if (gClean.includes("2EME") && gClean.includes("COLLEGE")) {
      gradeCode = "2AC";
    } else if (gClean.includes("3EME") && gClean.includes("COLLEGE")) {
      gradeCode = "3AC";
    } else {
      gradeCode = gClean;
    }
  } else {
    if (urlLower.includes("1ac") || urlLower.includes("1ere_annee_college") || urlLower.includes("الأولى إعدادي") || urlLower.includes("الاولى اعدادي")) {
      gradeCode = "1AC";
    } else if (urlLower.includes("2ac") || urlLower.includes("2eme_annee_college") || urlLower.includes("الثانية إعدادي") || urlLower.includes("الثانية اعدادي")) {
      gradeCode = "2AC";
    } else if (urlLower.includes("3ac") || urlLower.includes("3eme_annee_college") || urlLower.includes("الثالثة إعدادي") || urlLower.includes("الثالثة اعدادي")) {
      gradeCode = "3AC";
    } else if (urlLower.includes("tcs") || urlLower.includes("tronc_commun") || urlLower.includes("جذع مشترك")) {
      gradeCode = "TC";
    } else if (urlLower.includes("1bac") || urlLower.includes("الأولى بكالوريا")) {
      gradeCode = "1BAC";
    } else if (urlLower.includes("2bac") || urlLower.includes("الثانية بكالوريا")) {
      gradeCode = "2BAC";
    }
  }

  // 2. Determine Subject Code
  let subjectCode = "Math";
  if (subject) {
    const sLower = subject.toLowerCase();
    if (sLower.includes("math")) subjectCode = "Math";
    else if (sLower.includes("pc") || sLower.includes("physique") || sLower.includes("chimie") || sLower.includes("pc_")) subjectCode = "PC";
    else if (sLower.includes("svt")) subjectCode = "SVT";
    else if (sLower.includes("francais") || sLower.includes("français") || sLower.includes("french")) subjectCode = "French";
    else subjectCode = subject.charAt(0).toUpperCase() + subject.slice(1);
  } else {
    if (urlLower.includes("math") || urlLower.includes("رياضيات") || urlLower.includes("الرياضيات")) {
      subjectCode = "Math";
    } else if (urlLower.includes("physique") || urlLower.includes("chimie") || urlLower.includes(" pc ") || urlLower.includes("pc_")) {
      subjectCode = "PC";
    } else if (urlLower.includes("svt") || urlLower.includes("علوم الحياة")) {
      subjectCode = "SVT";
    } else if (urlLower.includes("francais") || urlLower.includes("français") || urlLower.includes("الفرنسية")) {
      subjectCode = "French";
    }
  }

  // 3. Document Type mapped to: Cours, Exercices, Correction, Resume, Devoir, Controle
  let docTypeSegment = "Cours";
  const rawFile = (url.split("/").pop() || "").toLowerCase();
  const rawTitle = (htmlTitle || "").toLowerCase();
  const checkDocType = (documentType || rawFile || rawTitle).toLowerCase();

  if (checkDocType.includes("corrige") || checkDocType.includes("corrigé") || checkDocType.includes("correction") || checkDocType.includes("solution") || checkDocType.includes("تصحيح") || checkDocType.includes("حلول") || checkDocType.includes("حل")) {
    docTypeSegment = "Correction";
  } else if (checkDocType.includes("exercice") || checkDocType.includes("exercise") || checkDocType.includes("serie") || checkDocType.includes("سلسلة") || checkDocType.includes("تمارين")) {
    docTypeSegment = "Exercices";
  } else if (checkDocType.includes("resume") || checkDocType.includes("résumé") || checkDocType.includes("summary") || checkDocType.includes("ملخص")) {
    docTypeSegment = "Resume";
  } else if (checkDocType.includes("devoir") || checkDocType.includes("فرض")) {
    docTypeSegment = "Devoir";
  } else if (checkDocType.includes("controle") || checkDocType.includes("contrôle") || checkDocType.includes("examen") || checkDocType.includes("امتحان")) {
    docTypeSegment = "Controle";
  } else if (checkDocType.includes("cours") || checkDocType.includes("lesson") || checkDocType.includes("lecon") || checkDocType.includes("درس") || checkDocType.includes("dars")) {
    docTypeSegment = "Cours";
  } else {
    if (urlLower.includes("cours") || urlLower.includes("lesson") || urlLower.includes("درس")) docTypeSegment = "Cours";
    else if (urlLower.includes("exercice") || urlLower.includes("تمارين")) docTypeSegment = "Exercices";
    else if (urlLower.includes("corrige") || urlLower.includes("correction") || urlLower.includes("تصحيح")) docTypeSegment = "Correction";
    else if (urlLower.includes("resume") || urlLower.includes("ملخص")) docTypeSegment = "Resume";
    else if (urlLower.includes("devoir") || urlLower.includes("فرض")) docTypeSegment = "Devoir";
    else if (urlLower.includes("controle") || urlLower.includes("امتحان")) docTypeSegment = "Controle";
  }

  // 4. Extract Topic Topic extraction order: URL slug first, then HTML Title, then PDF Title metadata, fallback to Sequence
  let extractedTopic = "";
  let confidenceSource = "url_slug";

  // A. Try URL path slug backwards
  let urlTopicCandidate = "";
  try {
    const parsedUrl = new URL(url);
    const pathname = decodeURIComponent(parsedUrl.pathname);
    const pathSegments = pathname.split("/").filter(Boolean);
    const isLastSegmentFile = pathSegments[pathSegments.length - 1]?.toLowerCase().endsWith(".pdf");
    const searchSegments = isLastSegmentFile ? pathSegments.slice(0, pathSegments.length - 1) : pathSegments;
    
    const ignoredSegments = new Set([
      "college", "1ac", "2ac", "3ac", "tc", "1bac", "2bac", "math", "mathematiques", "mathématiques", 
      "pc", "physique", "chimie", "svt", "french", "francais", "français", "talamidi", "talamidi.com", 
      "cours", "exercices", "exercice", "correction", "corrige", "corrigé", "pdf", "maroc", "lessons", "lecons"
    ]);

    for (let i = searchSegments.length - 1; i >= 0; i--) {
      const seg = searchSegments[i];
      const cleaned = cleanTopicText(seg);
      if (cleaned && !ignoredSegments.has(seg.toLowerCase())) {
        urlTopicCandidate = cleaned;
        break;
      }
    }
  } catch {}

  if (urlTopicCandidate) {
    extractedTopic = urlTopicCandidate;
  } else if (htmlTitle) {
    const cleanedHtml = cleanTopicText(htmlTitle);
    if (cleanedHtml) {
      extractedTopic = cleanedHtml;
      confidenceSource = "html_title";
    }
  } else if (pdfTitle) {
    const cleanedPdf = cleanTopicText(pdfTitle);
    if (cleanedPdf) {
      extractedTopic = cleanedPdf;
      confidenceSource = "pdf_metadata";
    }
  }

  // Fallback to sequence
  if (!extractedTopic) {
    const filenameFromUrl = url.split("/").pop() || "";
    const matchNum = url.match(/_(\d+)\.pdf/i) || url.match(/[_-](\d+)/) || filenameFromUrl.match(/[_-](\d+)/);
    const seqNum = matchNum ? matchNum[1].padStart(2, "0") : (fallbackSeq || "01");
    extractedTopic = `Sequence-${seqNum}`;
    confidenceSource = "fallback_seq";
  }

  // 5. Build base name
  const sourceSegment = extractSource(url);
  
  const sanitizeSegment = (text: string): string => {
    return text
      .trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[\s\-_]+/g, "-")
      .replace(/-+/g, "-");
  };

  const finalTopic = sanitizeSegment(extractedTopic);
  let baseFilename = `${gradeCode}_${subjectCode}_${finalTopic}_${docTypeSegment}_${sourceSegment}.pdf`;

  // Prevent filenames starting with -_-_ or other special prefix symbols
  baseFilename = baseFilename.replace(/^[-_\s]+/, "");

  // Shorten base filename if it exceeds 140 chars
  let finalFilename = baseFilename;
  const maxFilenameLength = 140;
  if (baseFilename.length > maxFilenameLength) {
    const extension = ".pdf";
    const availableLength = maxFilenameLength - extension.length;
    const prefix = `${gradeCode}_${subjectCode}_`;
    const suffix = `_${docTypeSegment}_${sourceSegment}`;
    const overage = baseFilename.length - maxFilenameLength;
    if (finalTopic.length > overage) {
      const shortenedTopic = finalTopic.substring(0, finalTopic.length - overage);
      finalFilename = `${prefix}${shortenedTopic}${suffix}${extension}`;
    } else {
      finalFilename = baseFilename.substring(0, availableLength) + extension;
    }
  }

  // Handle Collisions
  // Existing files checking:
  // - if SAME content hash exists: treated as "exact_duplicate" (caller handles this or we denote in status)
  // - if filename already exists for a DIFFERENT content hash, append short hash suffix.
  let isFilenameDuplicate = existingFilenamesAndHashes.some(e => e.filename === finalFilename);
  if (isFilenameDuplicate && currentHash) {
    const exactMatch = existingFilenamesAndHashes.find(e => e.filename === finalFilename && e.hash === currentHash);
    if (!exactMatch) {
      // Append short hash suffix since content is different
      const shortSuffix = currentHash.substring(0, 6);
      const parts = finalFilename.split(".");
      const ext = parts.pop();
      finalFilename = `${parts.join(".")}_${shortSuffix}.${ext}`;
    }
  }

  // Set confidence level
  let confidence = 0.95;
  if (confidenceSource === "html_title") confidence = 0.85;
  if (confidenceSource === "pdf_metadata") confidence = 0.75;
  if (confidenceSource === "fallback_seq") confidence = 0.60;

  return {
    filename: finalFilename,
    extractedTopic: finalTopic,
    documentType: docTypeSegment,
    confidence
  };
}
