import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as https from 'https';

const START_URL = 'https://moutamadris.ma/cours/';
const OUTPUT_JSON = path.join(process.cwd(), 'moutamadris_assets.json');
const OUTPUT_CSV = path.join(process.cwd(), 'moutamadris_assets.csv');

const TARGET_GRADES = [
  "الثانية باك",
  "اولى باك",
  "الجذع مشترك",
  "الثالثة اعدادي",
  "الثانية اعدادي",
  "الأولى اعدادي",
  "السادس ابتدائي",
  "الخامس ابتدائي",
  "الرابع ابتدائي",
  "الثالث ابتدائي",
  "الثاني ابتدائي",
  "الأول ابتدائي"
];

const IGNORED_DOMAINS_AND_PATHS = [
  "whatsapp.com", "facebook.com", "telegram.me", "t.me", "twitter.com", "x.com", 
  "youtube.com", "play.google.com", "play.google.com/store"
];

// To avoid re-visiting URLs
const visitedUrls = new Set<string>();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getGradeKey(label: string): string {
  if (label.includes("الثانية باك")) return "2BAC";
  if (label.includes("اولى باك")) return "1BAC";
  if (label.includes("الجذع مشترك")) return "TCS";
  if (label.includes("الثالثة اعدادي")) return "3AC";
  if (label.includes("الثانية اعدادي")) return "2AC";
  if (label.includes("الأولى اعدادي")) return "1AC";
  if (label.includes("السادس")) return "6AEP";
  if (label.includes("الخامس")) return "5AEP";
  if (label.includes("الرابع")) return "4AEP";
  if (label.includes("الثالث ابتدائي")) return "3AEP";
  if (label.includes("الثاني")) return "2AEP";
  if (label.includes("الأول ابتدائي")) return "1AEP";
  return label;
}

function guessResourceType(text: string): string {
  const norm = text.toLowerCase();
  
  if (norm.includes("ملخص")) return "summary";
  if (norm.includes("تمارين")) return "exercises";
  if (norm.includes("فرض") || norm.includes("فروض") || norm.includes("devoir") || norm.includes("controle")) return "assessment";
  if (norm.includes("جذاذة") || norm.includes("جذاذات")) return "teacher_sheet";
  if (norm.includes("امتحان") || norm.includes("exam")) return "exam";
  if (norm.includes("دروس") || norm.includes("درس") || norm.includes("cours")) return "course";
  
  // Default fallback if exam page
  return "course";
}

function guessLanguageInfo(urlStr: string, textStr: string): { language: string, track: string } {
  const norm = (urlStr + " " + textStr).toLowerCase();
  let language = "ar";
  let track = "General";
  
  if (norm.match(/\b(fr|francais|فرنسية|biof|international)\b/)) {
    language = "fr";
    track = "BIOF";
  }
  
  return { language, track };
}

const httpsAgent = new https.Agent({ 
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT 
});

async function fetchHtml(url: string): Promise<string | null> {
  if (visitedUrls.has(url)) return null;
  visitedUrls.add(url);
  
  console.log(`[CRAWL] Fetching: ${url}`);
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 15000,
      httpsAgent
    });
    await sleep(Math.floor(Math.random() * 1000) + 1000); // 1-2 sec delay
    return res.data;
  } catch (err: any) {
    console.error(`[ERROR] Failed to fetch ${url}: ${err.message}`);
    await sleep(2000); // Wait on error
    return null;
  }
}

function isUrlIgnored(url: string): boolean {
  try {
    const parsed = new URL(url);
    for (const ignored of IGNORED_DOMAINS_AND_PATHS) {
      if (parsed.hostname.includes(ignored) || parsed.href.includes(ignored)) {
        return true;
      }
    }
  } catch {
    return true; // Invalid URL
  }
  return false;
}

export interface CrawledResource {
  grade_label_ar: string;
  grade_key: string;
  subject_label_ar: string;
  subject_key: string;
  lesson_title_ar: string;
  page_url: string;
  pdf_url: string;
  resource_type: string;
  language_guess: string;
  track_guess: string;
  source_domain: string;
  discovered_at: string;
}

const resources: Map<string, CrawledResource> = new Map();

function saveOutput() {
  const data = Array.from(resources.values());
  
  // JSON
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(data, null, 2));
  
  // CSV
  if (data.length > 0) {
    const headers = Object.keys(data[0]) as (keyof CrawledResource)[];
    const csvRows = [headers.join(',')];
    
    for (const row of data) {
      const values = headers.map(h => {
        let val = String(row[h] || '');
        // escape quotes and wrap in quotes if contains comma
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(values.join(','));
    }
    
    fs.writeFileSync(OUTPUT_CSV, csvRows.join('\n'));
  }
  
  console.log(`[SAVED] ${data.length} resources saved to JSON & CSV.`);
}

async function run() {
  console.log("Starting Moutamadris Crawler...");
  
  const html = await fetchHtml(START_URL);
  if (!html) return;
  
  const $ = cheerio.load(html);
  
  const gradeLinks: { href: string; label: string }[] = [];
  $('a').each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (href && TARGET_GRADES.some(tg => text.includes(tg))) {
      gradeLinks.push({ href: new URL(href, START_URL).href, label: text });
    }
  });

  console.log(`Found ${gradeLinks.length} target grade pages.`);

  for (const grade of gradeLinks) {
    console.log(`\n--- Processing Grade: ${grade.label} ---`);
    const gradeHtml = await fetchHtml(grade.href);
    if (!gradeHtml) continue;
    
    const $g = cheerio.load(gradeHtml);
    const subjectLinks: { href: string; label: string }[] = [];
    
    $g('a').each((_, el) => {
      const href = $g(el).attr('href');
      const text = $g(el).text().trim();
      if (href && href.includes('moutamadris.ma') && text.length > 3) {
        // Simple heuristic to ignore navigation
        if (!isUrlIgnored(href) && href !== grade.href && !href.includes('/category/')) {
           // On moutamadris, subjects are usually just links containing the subject logic.
           subjectLinks.push({ href: new URL(href, grade.href).href, label: text });
        }
      }
    });

    console.log(`Found ${subjectLinks.length} potential subject/module links.`);
    
    for (const subject of subjectLinks) {
       // Filter out clear nav links here if needed. 
       if (subject.href.includes("#") || subject.href.includes("page/")) continue;
       
       const subjectHtml = await fetchHtml(subject.href);
       if (!subjectHtml) continue;
       
       const $s = cheerio.load(subjectHtml);
       const lessonLinks: { href: string; label: string }[] = [];
       
       $s('a').each((_, el) => {
          const href = $s(el).attr('href');
          const text = $s(el).text().trim();
          if (href && !isUrlIgnored(href)) {
             // In Moutamadris, lessons are often linked directly from the subject table.
             if (href.includes("moutamadris.ma") && href !== subject.href) {
                lessonLinks.push({ href: new URL(href, subject.href).href, label: text });
             }
          }
       });
       
       for (const lesson of lessonLinks) {
          if (visitedUrls.has(lesson.href)) continue;
          
          const lessonHtml = await fetchHtml(lesson.href);
          if (!lessonHtml) continue;
          
          const $l = cheerio.load(lessonHtml);
          
          $l('a').each((_, el) => {
             const fileHref = $l(el).attr('href');
             const fileText = $l(el).text().trim();
             
             if (!fileHref || isUrlIgnored(fileHref)) return;
             
             const targetUrl = new URL(fileHref, lesson.href).href;
             const isPdf = targetUrl.toLowerCase().endsWith('.pdf') || fileHref.toLowerCase().includes('/wp-content/uploads/') || targetUrl.includes('drive.google.com');
             const hasArabicKeywords = fileText.match(/(تحميل|درس|ملخص|تمارين|جذاذة|فرض)/);
             
             if (isPdf || hasArabicKeywords) {
                // Determine resource type using link context mostly
                // Use a wider context including the element's parent or closest heading if text is short
                let contextText = fileText;
                if (contextText.length < 5) {
                   contextText = $l(el).parent().text() || fileText;
                }
                
                const { language, track } = guessLanguageInfo(targetUrl, contextText + " " + grade.label + " " + subject.label);
                
                // Keep the final normalized URL as dedup key
                const dedupKey = targetUrl.split(/[?#]/)[0].toLowerCase();
                
                if (!resources.has(dedupKey) && targetUrl.startsWith("http")) {
                   resources.set(dedupKey, {
                      grade_label_ar: grade.label,
                      grade_key: getGradeKey(grade.label),
                      subject_label_ar: subject.label,
                      subject_key: subject.label, // Just use the label for now
                      lesson_title_ar: lesson.label,
                      page_url: lesson.href,
                      pdf_url: targetUrl,
                      resource_type: guessResourceType(contextText + " " + lesson.label),
                      language_guess: language,
                      track_guess: track,
                      source_domain: new URL(targetUrl).hostname,
                      discovered_at: new Date().toISOString()
                   });
                }
             }
          });
          
          // Incremental save every 20 links
          if (resources.size % 20 === 0) {
             saveOutput();
          }
       }
    }
  }
  
  saveOutput();
  console.log("Crawl completed.");
}

run().catch(console.error);
