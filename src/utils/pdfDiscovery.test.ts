import assert from "assert/strict";
import { test } from "vitest";
import { extractClassifyingMetadata } from "./pdfDiscovery";
import { formatLevelspaceReviewTitle, formatLevelspaceSafeFilename } from "./filenameGenerator";

test("Google Drive PDF metadata parsing", () => {
  const url = "https://drive.google.com/file/d/1Pd0fSMuZ_3iFzjQRdHO43sItqhhUqSVZ/view";
  const title = "Examen régional - 3apic- Sciences de la Vie et de la Terre - Casablanca-Settat - 2022.pdf";
  const textContext = title;

  const metadata = extractClassifyingMetadata(url, textContext);

  assert.equal(metadata.source, "Google Drive");
  assert.equal(metadata.grade, "3AC");
  assert.equal(metadata.subject, "SVT");
  assert.equal(metadata.documentType, "Examen régional");
  assert.equal(metadata.region, "Casablanca-Settat");
  assert.equal(metadata.schoolYear, "2022");

  const cleanTitle = formatLevelspaceReviewTitle(metadata);
  assert.equal(cleanTitle, "Levelspace · 3AC · SVT · Examen régional · 2022 · Casablanca-Settat · Google Drive");

  const filename = formatLevelspaceSafeFilename(metadata);
  assert.equal(filename, "Levelspace_3AC_SVT_Examen-regional_2022_Casablanca-Settat_Google-Drive.pdf");
});
