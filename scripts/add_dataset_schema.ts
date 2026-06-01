import * as fs from 'fs';

const content = fs.readFileSync('server.ts', 'utf-8');

const anchor = `      const datasetRow = {
        "$schema": "../../schemas/curriculum_asset_v1.schema.json",
        "id": datasetId,`;

const replacement = `      const { levelspace } = req.body;
      const ls = levelspace || {};
      
      const datasetRow: any = {
        "asset_id": hash,
        "source_url": url || "",
        "source_domain": url ? new URL(url).hostname : "",
        "original_filename": path.basename(url || "unnamed.pdf"),
        "clean_filename": cleanName,
        
        "levelspace_grade_id": ls.grade_id || gradeId,
        "levelspace_subject_id": ls.subject_id || subjectId,
        "levelspace_module_id": ls.module_id || "unknown",
        "levelspace_topic_id": ls.topic_id || topicId,
        "levelspace_lesson_id": ls.lesson_id || null,
        
        "levelspace_grade_name": ls.grade_name || grade.nameFr,
        "levelspace_subject_name": ls.subject_name || subject.nameFr,
        "levelspace_module_name": ls.module_name || "unknown",
        "levelspace_topic_name": ls.topic_name || topic.nameFr,
        "levelspace_lesson_title": ls.lesson_title || null,
        
        "skill_ids": ls.skill_ids || [],
        "objective_ids": ls.objective_ids || [],
        
        "document_type_id": documentTypeId || "cours",
        "document_role": ls.document_role || "student_lesson_source",
        
        "language": "ar",
        "text_source": fs.existsSync(path.join(LOCAL_OUTPUT_DIR, "ocr", \`\${hash}.ocr.txt\`)) ? "ocr_text" : "pdf_text",
        "needs_ocr": false,
        
        "raw_text_path": \`/workspace/downloads/\${hash}.original.pdf\`,
        "clean_text_path": \`/workspace/ocr/\${hash}.ocr.txt\`,
        "clean_pdf_path": \`/workspace/clean-pdfs/\${cleanName}\`,
        
        "curriculum_path": ls.curriculum_path || \`\${grade.id} / \${subject.id} / \${topic.id}\`,
        "curriculum_confidence": ls.curriculum_confidence || 100,
        "index_status": ls.index_status || "indexed",
        
        "student_visible": ls.student_visible ?? true,
        "teacher_visible": ls.teacher_visible ?? true,
        "admin_visible": ls.admin_visible ?? true,
        "ai_visible": ls.ai_visible ?? true,
        
        "use_for_lesson_generation": ls.document_role === "student_lesson_source" || ls.document_role === "pedagogical_planning_source",
        "use_for_quiz_generation": ls.document_role === "practice_source",
        "use_for_roadmap_generation": true,
        
        "matched_terms": [],
        "matched_fields": [],
        "candidate_lessons": ls.candidate_lessons || [],
        "suggested_action": ls.suggested_action || null
      };

      // Compatibility fields for the old format (just to not break previous logic accidentally)
      datasetRow.id = datasetId;
`;

const oldContentEnd = `        "content": {
          "raw_text_extracted": text || "",
          "cleaned_text": cleanedTextContent
        }
      };`;

const startIndex = content.indexOf(`      const datasetRow = {`);
const endIndex = content.indexOf(`      };`, startIndex) + 8; // length of '      };'

if (startIndex === -1 || endIndex === 7) {
  console.log("Could not find datasetRow block");
  process.exit(1);
}

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);
fs.writeFileSync('server.ts', newContent);
console.log("Successfully updated dataset row schema.");
