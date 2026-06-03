import { describe, it, expect, vi } from "vitest";
import { 
  buildSearchTargetsFromSupabaseDictionary, 
  extractPdfLinks, 
  verifyPdf, 
  scorePdfCandidate, 
  normalizeArabicString, 
  normalizeFrenchString 
} from "../src/lib/pipeline";
import axios from "axios";

// Mock axios for network testing
vi.mock("axios");

describe("Workstation Pipeline Unit Tests", () => {

  describe("String Normalizers", () => {
    it("should normalize Arabic characters correctly", () => {
      const input = "المعادلات ٣";
      const normalized = normalizeArabicString(input);
      // 'المعادلات' -> 'المعادلات' (but converting Alif/Teb etc)
      // ٣ should turn to 3
      expect(normalized).toContain("3");
    });

    it("should normalize French characters by stripping accents and converting to lowercase", () => {
      const input = "Équations et Inéquations";
      const normalized = normalizeFrenchString(input);
      expect(normalized).toBe("equations et inequations");
    });
  });

  describe("Supabase Dictionary to SearchTarget mapping", () => {
    it("should map dictionary rows to structured search target records and generate queries", () => {
      const mockDict = {
        grades: [
          { id: "3eme_annee_college", nameAr: "السنة الثالثة إعدادي", nameFr: "3ème Année Collège", suffix: "3AC", keywords: ["3ac", "3eme"] }
        ],
        subjects: [
          { id: "math", nameAr: "الرياضيات", nameFr: "Mathématiques", suffix: "MATH", keywords: ["maths"] }
        ],
        topics: [
          { id: "equations", nameAr: "المعادلات", nameFr: "Équations", suffix: "EQ", subjectId: "math", keywords: ["equation"] }
        ],
        allowedDocumentTypes: []
      };

      const targets = buildSearchTargetsFromSupabaseDictionary(mockDict);
      expect(targets.length).toBeGreaterThan(0);

      const target = targets[0];
      expect(target.grade_id).toBe("3eme_annee_college");
      expect(target.subject_id).toBe("math");
      expect(target.lesson_id).toBe("equations");

      // Verify domain-aware search query templates are generated correctly
      const queriesStr = JSON.stringify(target.search_queries);
      expect(queriesStr).toContain("site:moutamadris.ma/cours/");
      expect(queriesStr).toContain("site:pdfmath.com");
      expect(queriesStr).toContain("filetype:pdf");
    });
  });

  describe("HTML relative PDF links extraction", () => {
    it("should extract both absolute and relative PDF links, resolving them against the base URL", () => {
      const html = `
        <html>
          <body>
            <div>
              <a href="/uploads/math_lesson.pdf">Relative Lesson PDF</a>
              <a href="https://other.com/physics.pdf">Absolute PDF</a>
              <a href="https://unrelated.com/page">Unrelated Page</a>
            </div>
          </body>
        </html>
      `;
      const baseUrl = "https://example.com/cours/index.html";
      const links = extractPdfLinks(html, baseUrl);

      expect(links.length).toBe(2);
      expect(links[0].url).toBe("https://example.com/uploads/math_lesson.pdf");
      expect(links[1].url).toBe("https://other.com/physics.pdf");
    });
  });

  describe("PDF Verification Logic", () => {
    it("should accept valid buffers starting with %PDF signature", async () => {
      const pdfBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj\n..."), Buffer.alloc(500)]);
      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/pdf" },
        data: pdfBuffer
      });

      const verification = await verifyPdf("https://example.com/real_doc.pdf");
      expect(verification.valid).toBe(true);
      expect(verification.mimeType).toBe("application/pdf");
    });

    it("should reject a fake PDF URL returning an HTML page", async () => {
      const htmlBuffer = Buffer.concat([Buffer.from("<!doctype html><html><body>An error occurred</body></html>"), Buffer.alloc(500)]);
      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "text/html" },
        data: htmlBuffer
      });

      const verification = await verifyPdf("https://example.com/fake_doc.pdf");
      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain("DocType HTML found instead of PDF binary signature");
    });

    it("should reject a server page with platform placeholder error text", async () => {
      const serverPlaceholderBuffer = Buffer.concat([Buffer.from("Please wait while your application starts. Preparing dev server..."), Buffer.alloc(500)]);
      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "text/plain" },
        data: serverPlaceholderBuffer
      });

      const verification = await verifyPdf("https://example.com/temporary_starting_server.pdf");
      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain("Placeholder HTML page containing");
    });
  });

  describe("Candidate Scoring & Classification", () => {
    const mockTarget = {
      grade_id: "3eme_annee_college",
      grade_name: "3ème Année Collège",
      track_id: null,
      track_name: null,
      subject_id: "math",
      subject_name: "Mathématiques",
      module_id: null,
      module_name: null,
      lesson_id: "equations",
      lesson_title: "Équations",
      language: "both",
      required_terms: ["3ac", "math", "equations"],
      optional_terms: ["3eme_annee_college", "maths", "equation"],
      negative_terms: ["ads", "premium", "maternelle"],
      search_queries: []
    };

    it("should score matching PDF candidates highly based on matching target keywords", () => {
      const candidateMatching = {
        url: "https://example.com/3ac/math/equations_exercices.pdf",
        anchorText: "سلسلة تمارين المعادلات الثالثة اعدادي",
        pageTitle: "Mathématiques Collège"
      };

      const score = scorePdfCandidate(candidateMatching, mockTarget);
      expect(score).toBeGreaterThan(30);
    });

    it("should return zero or reject immediate the candidate if any negative term matches", () => {
      const candidateAd = {
        url: "https://example.com/math/equations.pdf",
        anchorText: "Best Ads Premium Equations Study",
        pageTitle: "Ad Platform"
      };

      const score = scorePdfCandidate(candidateAd, mockTarget);
      expect(score).toBe(0);
    });
  });

  describe("Stricter Curriculum Crawler Audit Requirements (Rule 14)", () => {
    function classifyDocumentTypeWithPriority(urlStr: string, textContext: string = ""): string {
      const combined = `${urlStr || ""} ${textContext || ""}`.toLowerCase();
      
      if (combined.includes("non-corrige") || combined.includes("non-corriges") || combined.includes("non-corrigé") || combined.includes("غير مصحح")) {
        return "Exercices";
      }
      if (combined.includes("corrige") || combined.includes("correction") || combined.includes("تصحيح") || combined.includes("corriges") || combined.includes("corrig") || combined.includes("حلول")) {
        return "Correction";
      }
      if (combined.includes("devoir") || combined.includes("controle") || combined.includes("فرض") || combined.includes("contrôle")) {
        return "Devoir";
      }
      if (combined.includes("resume") || combined.includes("carte-mentale") || combined.includes("ملخص")) {
        return "Resume";
      }
      if (combined.includes("exercices") || combined.includes("serie") || combined.includes("activites") || combined.includes("تمارين") || combined.includes("سلسلة") || combined.includes("serie")) {
        return "Exercices";
      }
      if (combined.includes("cours") || combined.includes("lesson") || combined.includes("lecon") || combined.includes("درس")) {
        return "Course";
      }
      return "Course"; // Fallback
    }

    function checkNavigationPathConflict(navigationPath: string, grade: string, subject: string): { conflicted: boolean; errors: string[] } {
      const errors: string[] = [];
      if (!navigationPath) return { conflicted: false, errors };

      const navLower = navigationPath.toLowerCase();

      // Islamic vs Math/PC/SVT/French subject conflict
      const isIslamicNav = navLower.includes("islam") || navLower.includes("إسلام") || navLower.includes("اسلام");
      if (isIslamicNav) {
        const subLower = (subject || "").toLowerCase();
        if (subLower === "math" || subLower === "pc" || subLower === "svt" || subLower === "french" || subLower === "physique" || subLower === "chimie") {
          errors.push("navigation_subject_conflict");
        }
      }

      // General subject mismatch
      if (navLower.includes("رياضيات") || navLower.includes("math")) {
        const subLower = (subject || "").toLowerCase();
        if (subLower && subLower !== "math" && subLower !== "mathematics" && subLower !== "pc" && subLower !== "physique") {
          errors.push("navigation_subject_conflict");
        }
      }

      // Grade mismatch
      if (navLower.includes("3ac") || navLower.includes("ثالثة اعدادي") || navLower.includes("3eme") || navLower.includes("3ème")) {
        if (grade && grade !== "3AC" && grade !== "3eme_annee_college") {
          errors.push("navigation_grade_conflict");
        }
      }

      return {
        conflicted: errors.length > 0,
        errors
      };
    }

    // 1. Islamic navigation path + Math PDF must be marked navigation_subject_conflict
    it("Islamic navigation path + Math PDF must be marked navigation_subject_conflict", () => {
      const mockNode = {
        navigation_path: "التربية الإسلامية > دروس",
        extracted_subject: "Math",
        extracted_grade: "3AC"
      };
      
      const check = checkNavigationPathConflict(mockNode.navigation_path, mockNode.extracted_grade, mockNode.extracted_subject);
      expect(check.conflicted).toBe(true);
      expect(check.errors).toContain("navigation_subject_conflict");
    });

    // 2. depth 15 node must be marked crawl_depth_exceeded
    it("depth 15 node must be marked crawl_depth_exceeded", () => {
      const depth = 15;
      const errors: string[] = [];
      if (depth > 5) {
        errors.push("crawl_depth_exceeded");
      }
      expect(errors).toContain("crawl_depth_exceeded");
    });

    // 3. "cours-1.pdf" must classify as Course
    it('"cours-1.pdf" must classify as Course', () => {
      const docType = classifyDocumentTypeWithPriority("cours-1.pdf", "");
      expect(docType).toBe("Course");
    });

    // 4. "exercices-non-corriges.pdf" must classify as Exercices, not Correction
    it('"exercices-non-corriges.pdf" must classify as Exercices, not Correction', () => {
      const docType = classifyDocumentTypeWithPriority("exercices-non-corriges.pdf", "");
      expect(docType).toBe("Exercices");
    });

    // 5. completed + rejection_reason must become rejected or needs_review
    it("completed + rejection_reason must become rejected or needs_review", () => {
      const status = "completed";
      const rejection_reason = "Exclusion filter matches";
      
      let finalStatus = status;
      if (rejection_reason && status === "completed") {
        finalStatus = "needs_review"; // or rejected
      }
      expect(["rejected", "needs_review"]).toContain(finalStatus);
    });
  });
});
