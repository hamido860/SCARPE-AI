import React, { useState, useEffect } from "react";
import { 
  X, Download, FileJson, FileSpreadsheet, CheckSquare, Square, 
  Settings2, Info, Check, Eye, HelpCircle, LayoutGrid, CheckCircle
} from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { StagedPdf } from "../../../types/pdf";

export interface CustomExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  stagedPdfs: StagedPdf[];
}

interface SchemaField {
  id: string;
  label: string;
  category: "metadata" | "curriculum" | "visibility" | "generation" | "taxonomy";
  description: string;
  type: "string" | "boolean" | "number" | "array";
  accessor: (row: any, fallbackPdf?: any) => any;
}

const AVAILABLE_SCHEMA_FIELDS: SchemaField[] = [
  // 1. Metadata
  { 
    id: "asset_id", 
    label: "Asset Unique ID", 
    category: "metadata", 
    description: "Unique SHA-256 identifier key of the document", 
    type: "string", 
    accessor: (row, pdf) => row.asset_id || pdf?.hash || "" 
  },
  { 
    id: "clean_filename", 
    label: "Clean Filename", 
    category: "metadata", 
    description: "Sanitized academic output filename structure", 
    type: "string", 
    accessor: (row, pdf) => row.clean_filename || pdf?.cleanTitle || pdf?.originalName || "" 
  },
  { 
    id: "original_filename", 
    label: "Original Filename", 
    category: "metadata", 
    description: "Source filename of PDF on download", 
    type: "string", 
    accessor: (row, pdf) => row.original_filename || pdf?.originalName || "" 
  },
  { 
    id: "source_url", 
    label: "Source Crawl URL", 
    category: "metadata", 
    description: "Full crawl address of primary source document", 
    type: "string", 
    accessor: (row, pdf) => row.source_url || pdf?.url || "" 
  },
  { 
    id: "source_domain", 
    label: "Source Domain", 
    category: "metadata", 
    description: "Hostname of primary source website (e.g. moutamadris.ma)", 
    type: "string", 
    accessor: (row, pdf) => row.source_domain || (pdf?.url ? new URL(pdf.url).hostname : "") 
  },
  { 
    id: "language", 
    label: "Academic Language", 
    category: "metadata", 
    description: "The primary document translation code (e.g. 'ar', 'fr')", 
    type: "string", 
    accessor: (row) => row.language || "ar" 
  },
  { 
    id: "text_source", 
    label: "Raw Text Source", 
    category: "metadata", 
    description: "Method used to index contents ('ocr_text' or 'pdf_text')", 
    type: "string", 
    accessor: (row, pdf) => row.text_source || (pdf?.extractionStatus === "success" ? "pdf_text" : "ocr_text") 
  },
  { 
    id: "needs_ocr", 
    label: "Needs OCR Processing", 
    category: "metadata", 
    description: "Whether the pdf required image parsing processing", 
    type: "boolean", 
    accessor: (row, pdf) => row.needs_ocr !== undefined ? row.needs_ocr : (pdf?.extractionStatus === "needs_ocr") 
  },
  { 
    id: "raw_text_path", 
    label: "Raw PDF Sandbox Path", 
    category: "metadata", 
    description: "Absolute filepath to original downloaded copy in workstation", 
    type: "string", 
    accessor: (row, pdf) => row.raw_text_path || `/workspace/downloads/${row.asset_id || pdf?.hash || 'hash'}.original.pdf` 
  },
  { 
    id: "clean_text_path", 
    label: "Clean Text Sandbox Path", 
    category: "metadata", 
    description: "Absolute filepath to processed OCR-corrected text file", 
    type: "string", 
    accessor: (row, pdf) => row.clean_text_path || `/workspace/ocr/${row.asset_id || pdf?.hash || 'hash'}.ocr.txt` 
  },
  { 
    id: "clean_pdf_path", 
    label: "Clean PDF Asset Path", 
    category: "metadata", 
    description: "Absolute path to stamped, unwatermarked clean PDF production copy", 
    type: "string", 
    accessor: (row, pdf) => row.clean_pdf_path || `/workspace/clean-pdfs/${row.clean_filename || pdf?.originalName || 'output.pdf'}` 
  },

  // 2. Curriculum Mapping
  { 
    id: "levelspace_grade_id", 
    label: "Levelspace Grade ID", 
    category: "curriculum", 
    description: "Standards-aligned classroom Grade directory index", 
    type: "string", 
    accessor: (row, pdf) => row.levelspace_grade_id || pdf?.gradeId || "unknown" 
  },
  { 
    id: "levelspace_grade_name", 
    label: "Levelspace Grade Name", 
    category: "curriculum", 
    description: "Standard grade path title in French", 
    type: "string", 
    accessor: (row, pdf) => row.levelspace_grade_name || pdf?.gradeId || "unknown" 
  },
  { 
    id: "levelspace_subject_id", 
    label: "Levelspace Subject ID", 
    category: "curriculum", 
    description: "Academic standard syllabus course tag", 
    type: "string", 
    accessor: (row, pdf) => row.levelspace_subject_id || pdf?.subjectId || "unknown" 
  },
  { 
    id: "levelspace_subject_name", 
    label: "Levelspace Subject Name", 
    category: "curriculum", 
    description: "Academic course subject classification title", 
    type: "string", 
    accessor: (row, pdf) => row.levelspace_subject_name || pdf?.subjectId || "unknown" 
  },
  { 
    id: "levelspace_module_id", 
    label: "Levelspace Module ID", 
    category: "curriculum", 
    description: "Curriculum group chapter segment code", 
    type: "string", 
    accessor: (row) => row.levelspace_module_id || "unknown" 
  },
  { 
    id: "levelspace_module_name", 
    label: "Levelspace Module Name", 
    category: "curriculum", 
    description: "Syllabus subdivision chapter section heading", 
    type: "string", 
    accessor: (row) => row.levelspace_module_name || "unknown" 
  },
  { 
    id: "levelspace_topic_id", 
    label: "Levelspace Topic ID", 
    category: "curriculum", 
    description: "Lower level granular concept topic ID", 
    type: "string", 
    accessor: (row, pdf) => row.levelspace_topic_id || pdf?.topicId || "unknown" 
  },
  { 
    id: "levelspace_topic_name", 
    label: "Levelspace Topic Name", 
    category: "curriculum", 
    description: "Targeted educational concept topic name", 
    type: "string", 
    accessor: (row, pdf) => row.levelspace_topic_name || pdf?.topicId || "unknown" 
  },
  { 
    id: "levelspace_lesson_id", 
    label: "Levelspace Lesson ID", 
    category: "curriculum", 
    description: "Aligned specific course lesson record key", 
    type: "string", 
    accessor: (row) => row.levelspace_lesson_id || null 
  },
  { 
    id: "levelspace_lesson_title", 
    label: "Levelspace Lesson Title", 
    category: "curriculum", 
    description: "Aligned dynamic course lesson title matched", 
    type: "string", 
    accessor: (row) => row.levelspace_lesson_title || null 
  },
  { 
    id: "curriculum_path", 
    label: "Curriculum Segment Breadcrumb", 
    category: "curriculum", 
    description: "Slash string pathway format representing current node depth alignment", 
    type: "string", 
    accessor: (row, pdf) => row.curriculum_path || `${pdf?.gradeId || "unknown"} / ${pdf?.subjectId || "unknown"} / ${pdf?.topicId || "unknown"}` 
  },
  { 
    id: "curriculum_confidence", 
    label: "Alignment Confidence Rating", 
    category: "curriculum", 
    description: "Confidence degree evaluation by classifier system (out of 100)", 
    type: "number", 
    accessor: (row) => row.curriculum_confidence || 100 
  },
  { 
    id: "index_status", 
    label: "Syllabus Index Status", 
    category: "curriculum", 
    description: "Target validation status index within repository", 
    type: "string", 
    accessor: (row) => row.index_status || "indexed" 
  },

  // 3. Document Roles & Visibility
  { 
    id: "document_type_id", 
    label: "Document Type Classification", 
    category: "visibility", 
    description: "Category index tag representing document schema (e.g. 'cours')", 
    type: "string", 
    accessor: (row, pdf) => row.document_type_id || pdf?.documentTypeId || "cours" 
  },
  { 
    id: "document_role", 
    label: "Instructional Document Role ID", 
    category: "visibility", 
    description: "Target teaching purpose allocation descriptor", 
    type: "string", 
    accessor: (row) => row.document_role || "student_lesson_source" 
  },
  { 
    id: "student_visible", 
    label: "Student Client Visibility", 
    category: "visibility", 
    description: "Allows final children students to check document files", 
    type: "boolean", 
    accessor: (row) => row.student_visible ?? true 
  },
  { 
    id: "teacher_visible", 
    label: "Educator Client Visibility", 
    category: "visibility", 
    description: "Enables classroom teachers to download document files", 
    type: "boolean", 
    accessor: (row) => row.teacher_visible ?? true 
  },
  { 
    id: "admin_visible", 
    label: "Director Panel Visibility", 
    category: "visibility", 
    description: "Displays document index record to root site administrators", 
    type: "boolean", 
    accessor: (row) => row.admin_visible ?? true 
  },
  { 
    id: "ai_visible", 
    label: "AI RAG Extractor Visibility", 
    category: "visibility", 
    description: "Includes raw document copy vectors inside dynamic contexts", 
    type: "boolean", 
    accessor: (row) => row.ai_visible ?? true 
  },

  // 4. Generation Controls
  { 
    id: "use_for_lesson_generation", 
    label: "Enable AI Lesson Scaffolding", 
    category: "generation", 
    description: "Feeds document context into the dynamic Lesson Generation engine", 
    type: "boolean", 
    accessor: (row) => row.use_for_lesson_generation ?? true 
  },
  { 
    id: "use_for_quiz_generation", 
    label: "Enable AI Quiz Questioning", 
    category: "generation", 
    description: "Leverages text schemas to write customized, grading-aligned practice mock items", 
    type: "boolean", 
    accessor: (row) => row.use_for_quiz_generation ?? true 
  },
  { 
    id: "use_for_roadmap_generation", 
    label: "Enable AI Course Roadmaps", 
    category: "generation", 
    description: "Integrates standard roadmap chapters utilizing the asset information scope", 
    type: "boolean", 
    accessor: (row) => row.use_for_roadmap_generation ?? true 
  },

  // 5. Taxonomy & Analytics Tags
  { 
    id: "skill_ids", 
    label: "Mapped Skill Elements IDs", 
    category: "taxonomy", 
    description: "Standards-matching academic competence identifiers parsed", 
    type: "array", 
    accessor: (row) => row.skill_ids || [] 
  },
  { 
    id: "objective_ids", 
    label: "Syllabus Lesson Objectives IDs", 
    category: "taxonomy", 
    description: "Aligned structural classroom instruction target values mapping", 
    type: "array", 
    accessor: (row) => row.objective_ids || [] 
  },
  { 
    id: "matched_terms", 
    label: "Semantic Matched Terminology", 
    category: "taxonomy", 
    description: "List of keyword items identified inside indexed documents text", 
    type: "array", 
    accessor: (row) => row.matched_terms || [] 
  },
  { 
    id: "matched_fields", 
    label: "Academic Topic Sectors Identified", 
    category: "taxonomy", 
    description: "Classification vectors derived from taxonomy keyword lookup", 
    type: "array", 
    accessor: (row) => row.matched_fields || [] 
  },
  { 
    id: "candidate_lessons", 
    label: "Syllabus Alternate Matches", 
    category: "taxonomy", 
    description: "Other curriculum lesson mappings parsed as likely candidate alignment paths", 
    type: "array", 
    accessor: (row) => row.candidate_lessons || [] 
  },
  { 
    id: "suggested_action", 
    label: "System Proposed Pipeline Action", 
    category: "taxonomy", 
    description: "Next workflow action recommended by index validation checks", 
    type: "string", 
    accessor: (row) => row.suggested_action || null 
  }
];

export function CustomExportModal({ isOpen, onClose, stagedPdfs }: CustomExportModalProps) {
  const [filename, setFilename] = useState("document_dataset_custom");
  const [format, setFormat] = useState<"json" | "csv" | "jsonl">("jsonl");
  const [selectedFields, setSelectedFields] = useState<string[]>(
    AVAILABLE_SCHEMA_FIELDS.map(f => f.id) // Default all checked
  );
  const [serverRows, setServerRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<"all" | "metadata" | "curriculum" | "visibility" | "generation" | "taxonomy">("all");

  useEffect(() => {
    if (isOpen) {
      loadServerDatasetRows();
    }
  }, [isOpen]);

  const loadServerDatasetRows = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get("/api/pipeline/dataset-rows");
      if (res.data && Array.isArray(res.data)) {
        setServerRows(res.data);
      }
    } catch (err: any) {
      console.warn("Failed to fetch backend compiled dataset rows, will generate clean schema falls-back directly from staged PDFs.", err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const toggleField = (id: string) => {
    if (selectedFields.includes(id)) {
      setSelectedFields(selectedFields.filter(f => f !== id));
    } else {
      setSelectedFields([...selectedFields, id]);
    }
  };

  const handleSelectAll = () => {
    setSelectedFields(AVAILABLE_SCHEMA_FIELDS.map(f => f.id));
  };

  const handleSelectNone = () => {
    setSelectedFields([]);
  };

  const handleSelectCategoryOnly = (cat: SchemaField["category"]) => {
    setSelectedFields(AVAILABLE_SCHEMA_FIELDS.filter(f => f.category === cat).map(f => f.id));
  };

  const getReconciledData = (): any[] => {
    // If we have actual compiled rows from server, leverage them.
    // If not, we bootstrap 100% compliant custom document schema rows directly using the live Staged PDFs!
    const effectiveRows: any[] = [];
    
    // Create a lookup for server-computed rows
    const serverRowMap = new Map<string, any>();
    serverRows.forEach(row => {
      const key = row.asset_id || row.id;
      if (key) {
        serverRowMap.set(String(key).toLowerCase(), row);
      }
    });

    // Make sure we encompass all staged files to maintain indexing integrity
    stagedPdfs.forEach(pdf => {
      const hashKey = String(pdf.hash || "").toLowerCase();
      const matchedRow = hashKey ? serverRowMap.get(hashKey) : null;
      effectiveRows.push({
        _row: matchedRow || {},
        _pdf: pdf
      });
    });

    // If no staged documents are available but server has index records, export those!
    if (stagedPdfs.length === 0 && serverRows.length > 0) {
      serverRows.forEach(row => {
        effectiveRows.push({
          _row: row,
          _pdf: null
        });
      });
    }

    return effectiveRows;
  };

  const handleExport = () => {
    const dataRecords = getReconciledData();
    if (dataRecords.length === 0) {
      toast.error("There is no compiled workstation data to export yet.");
      return;
    }

    const activeFields = AVAILABLE_SCHEMA_FIELDS.filter(f => selectedFields.includes(f.id));
    if (activeFields.length === 0) {
      toast.error("Please toggle at least one document schema field to include in the output.");
      return;
    }

    // Build filename
    const sanitizedName = filename.trim().replace(/[/\\?%*:|"<>\s]/g, "_") || "custom_schema_export";
    const finalFilename = `${sanitizedName}.${format}`;

    let fileContent = "";
    let mimeType = "";

    // Array of rows projected according to checked properties
    const projectedData = dataRecords.map(item => {
      const rowObj: Record<string, any> = {};
      activeFields.forEach(field => {
        const val = field.accessor(item._row, item._pdf);
        rowObj[field.id] = val;
      });
      return rowObj;
    });

    if (format === "json") {
      fileContent = JSON.stringify(projectedData, null, 2);
      mimeType = "application/json;charset=utf-8;";
    } else if (format === "jsonl") {
      fileContent = projectedData.map(record => JSON.stringify(record)).join("\n");
      mimeType = "text/plain;charset=utf-8;";
    } else {
      // Build CSV
      const headers = activeFields.map(f => f.label);
      const csvRows = [headers.join(",")];

      projectedData.forEach(record => {
        const rowValues = activeFields.map(field => {
          let value = record[field.id];
          if (value === null || value === undefined) {
            value = "";
          }
          if (Array.isArray(value)) {
            value = value.join("; "); // Semitransparent join
          }
          let strVal = String(value).replace(/\r?\n|\r/g, " ");
          if (strVal.includes(",") || strVal.includes('"') || strVal.includes("\n")) {
            strVal = `"${strVal.replace(/"/g, '""')}"`;
          }
          return strVal;
        });
        csvRows.push(rowValues.join(","));
      });
      fileContent = csvRows.join("\n");
      mimeType = "text/csv;charset=utf-8;";
    }

    // Trigger download
    const blob = new Blob([fileContent], { type: mimeType });
    const downloadUrl = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = downloadUrl;
    downloadAnchor.setAttribute("download", finalFilename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(downloadUrl);

    toast.success(`Successfully exported ${projectedData.length} records to ${format.toUpperCase()} format!`);
    onClose();
  };

  const filteredFields = activeCategory === "all" 
    ? AVAILABLE_SCHEMA_FIELDS 
    : AVAILABLE_SCHEMA_FIELDS.filter(f => f.category === activeCategory);

  const stats = {
    totalDocs: stagedPdfs.length || serverRows.length,
    compiledRows: serverRows.length,
    activeFieldsCount: selectedFields.length
  };

  return (
    <div className="fixed inset-0 bg-neutral-900/75 backdrop-blur-xs flex items-center justify-center z-[90] p-4 animate-fade-in font-mono text-[11px] text-neutral-800">
      <div className="bg-white border-2 border-neutral-900 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-4xl flex flex-col h-[85vh] max-h-[700px]">
        {/* Header */}
        <div className="bg-neutral-900 text-white p-4 flex items-center justify-between border-b-2 border-neutral-900">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-600 text-white border border-indigo-500">
              <Settings2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider">
                Document Schema Indexing Exporter
              </h2>
              <p className="text-[9px] text-neutral-400 font-sans mt-0.5 font-normal">
                Select precise properties and constraints to build standard learning datasets
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors bg-neutral-800 hover:bg-neutral-750 px-2 py-1 text-xs border border-neutral-700"
            title="Cancel and close export options"
          >
            [✕]
          </button>
        </div>

        {/* Content body split */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          
          {/* Sider options left */}
          <div className="w-full md:w-80 border-r-2 border-neutral-900 p-4 space-y-4 overflow-y-auto bg-neutral-50/50">
            
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-neutral-500 block">
                Target Export Name
              </label>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="Enter document export filename..."
                className="w-full bg-white border-2 border-neutral-900 px-3 py-1.5 font-bold h-8 rounded-none text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase text-neutral-500 block">
                Select Export Format
              </label>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setFormat("jsonl")}
                  className={`w-full h-8 px-3 text-left border-2 transition-all flex items-center justify-between font-bold ${
                    format === "jsonl"
                      ? "bg-indigo-600 border-neutral-900 text-white"
                      : "bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                    Dataset JSONL (Line-delimited)
                  </span>
                  <span className="text-[8px] bg-neutral-200/80 text-neutral-700 px-1 py-0.5 rounded-none font-normal uppercase">
                    Best for RAG
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setFormat("json")}
                  className={`w-full h-8 px-3 text-left border-2 transition-all flex items-center justify-between font-bold ${
                    format === "json"
                      ? "bg-indigo-600 border-neutral-900 text-white"
                      : "bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <FileJson className="w-3.5 h-3.5 shrink-0" />
                    Structured JSON Array
                  </span>
                  <span className="text-[8px] bg-neutral-200/80 text-neutral-700 px-1 py-0.5 rounded-none font-normal uppercase">
                    JS Readable
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setFormat("csv")}
                  className={`w-full h-8 px-3 text-left border-2 transition-all flex items-center justify-between font-bold ${
                    format === "csv"
                      ? "bg-emerald-600 border-neutral-900 text-white"
                      : "bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                    Syllabus CSV spreadsheet
                  </span>
                  <span className="text-[8px] bg-neutral-200/80 text-neutral-700 px-1 py-0.5 rounded-none font-normal uppercase">
                    Excel/Sheets
                  </span>
                </button>
              </div>
            </div>

            <div className="border border-neutral-200 bg-white p-3 space-y-2">
              <h3 className="text-[10px] font-bold text-neutral-800 uppercase flex items-center gap-1.5 border-b border-neutral-100 pb-1">
                <Info className="w-3.5 h-3.5 text-neutral-600" />
                Workstation Summary
              </h3>
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Total Scoped Files:</span>
                  <span className="font-bold text-neutral-900">{stats.totalDocs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Fully Mapped Files:</span>
                  <span className="font-bold text-emerald-600">{stats.compiledRows}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Selected Fields:</span>
                  <span className="font-bold text-indigo-600">{stats.activeFieldsCount} / {AVAILABLE_SCHEMA_FIELDS.length}</span>
                </div>
              </div>
            </div>

            <div className="bg-neutral-900 text-white p-3 space-y-1.5 text-[9.5px] leading-relaxed font-sans">
              <span className="font-bold uppercase text-[9.5px] tracking-wide text-indigo-400 block font-mono">
                Schema Alignment Info
              </span>
              Our export engine automatically aligns and maps properties into the Levelspace-v1 standard schema format:
              <ul className="list-disc pl-4 space-y-1 mt-1 text-[9px] text-neutral-300">
                <li>Automatic nested array projection (Skill Objectives, Matched Terms).</li>
                <li>Dynamic fallback triggers using live browser staged PDFs if JSON files are building async.</li>
                <li>MIME-type sanitized exports preventing comma collisions in raw cells.</li>
              </ul>
            </div>

          </div>

          {/* Database field schema checkboxes section */}
          <div className="flex-1 flex flex-col min-w-0">
            
            {/* Filter Tabs */}
            <div className="border-b-2 border-neutral-900 flex flex-wrap bg-neutral-100 text-[10px]">
              <button
                type="button"
                onClick={() => setActiveCategory("all")}
                className={`px-3 h-10 border-r border-neutral-200 font-bold ${
                  activeCategory === "all" ? "bg-white border-b-2 border-b-indigo-600 text-indigo-900" : "hover:bg-neutral-50 text-neutral-500"
                }`}
              >
                All Fields ({AVAILABLE_SCHEMA_FIELDS.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory("metadata")}
                className={`px-3 h-10 border-r border-neutral-200 font-bold ${
                  activeCategory === "metadata" ? "bg-white border-b-2 border-b-indigo-600 text-indigo-900" : "hover:bg-neutral-50 text-neutral-500"
                }`}
              >
                Physical & Paths ({AVAILABLE_SCHEMA_FIELDS.filter(f => f.category === "metadata").length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory("curriculum")}
                className={`px-3 h-10 border-r border-neutral-200 font-bold ${
                  activeCategory === "curriculum" ? "bg-white border-b-2 border-b-indigo-600 text-indigo-900" : "hover:bg-neutral-50 text-neutral-500"
                }`}
              >
                Curriculum ({AVAILABLE_SCHEMA_FIELDS.filter(f => f.category === "curriculum").length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory("visibility")}
                className={`px-3 h-10 border-r border-neutral-200 font-bold ${
                  activeCategory === "visibility" ? "bg-white border-b-2 border-b-indigo-600 text-indigo-900" : "hover:bg-neutral-50 text-neutral-500"
                }`}
              >
                Roles / Show ({AVAILABLE_SCHEMA_FIELDS.filter(f => f.category === "visibility").length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory("generation")}
                className={`px-3 h-10 border-r border-neutral-200 font-bold ${
                  activeCategory === "generation" ? "bg-white border-b-2 border-b-indigo-600 text-indigo-900" : "hover:bg-neutral-50 text-neutral-500"
                }`}
              >
                Gen AI ({AVAILABLE_SCHEMA_FIELDS.filter(f => f.category === "generation").length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory("taxonomy")}
                className={`px-3 h-10 font-bold ${
                  activeCategory === "taxonomy" ? "bg-white border-b-2 border-b-indigo-600 text-indigo-900" : "hover:bg-neutral-50 text-neutral-500"
                }`}
              >
                Taxonomy ({AVAILABLE_SCHEMA_FIELDS.filter(f => f.category === "taxonomy").length})
              </button>
            </div>

            {/* Selection tools action bar */}
            <div className="border-b border-neutral-200 p-2.5 bg-neutral-50/50 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] text-neutral-600 font-bold">
                Toggling checkboxes will include/exclude properties from the finalized document schema file.
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-2.5 py-1 bg-white border border-neutral-305 text-neutral-700 hover:bg-neutral-50 font-bold text-[10px]"
                >
                  [✓] Select All
                </button>
                <button
                  type="button"
                  onClick={handleSelectNone}
                  className="px-2.5 py-1 bg-white border border-neutral-305 text-neutral-700 hover:bg-neutral-50 font-bold text-[10px]"
                >
                  [✕] Clear selection
                </button>
                {activeCategory !== "all" && (
                  <button
                    type="button"
                    onClick={() => handleSelectCategoryOnly(activeCategory as any)}
                    className="px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-bold text-[10px]"
                  >
                    Select Only This Category
                  </button>
                )}
              </div>
            </div>

            {/* Checkbox Grid lists */}
            <div className="flex-1 p-4 overflow-y-auto space-y-2 bg-white">
              {isLoading ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-neutral-400">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-indigo-500 border-t-transparent mb-2" />
                  <span>Loading compiled workstation files and database schema elements...</span>
                </div>
              ) : filteredFields.length === 0 ? (
                <div className="h-full flex items-center justify-center p-6 text-neutral-400 font-sans">
                  No matching schema fields found for this category segment.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {filteredFields.map(field => {
                    const isChecked = selectedFields.includes(field.id);
                    return (
                      <div 
                        key={field.id}
                        onClick={() => toggleField(field.id)}
                        className={`p-3 border cursor-pointer hover:bg-neutral-50/50 transition-all flex items-start gap-2.5 group dynamic-checkbox ${
                          isChecked 
                            ? "bg-indigo-50/20 border-indigo-900/45 text-neutral-800" 
                            : "border-neutral-200 bg-white opacity-70 hover:opacity-100"
                        }`}
                      >
                        <div className="mt-0.5 shrink-0 transition-transform group-hover:scale-105">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4 text-neutral-400" />
                          )}
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-black text-xs text-neutral-900 group-hover:text-indigo-950 font-mono">
                              {field.id}
                            </span>
                            <span className={`text-[8px] uppercase tracking-wider font-bold px-1 rounded-sm border ${
                              field.category === "metadata" ? "bg-neutral-100 text-neutral-600 border-neutral-205" :
                              field.category === "curriculum" ? "bg-cyan-50 text-cyan-700 border-cyan-200" :
                              field.category === "visibility" ? "bg-amber-50 text-amber-700 border-amber-200" :
                              field.category === "generation" ? "bg-purple-50 text-purple-700 border-purple-200" :
                              "bg-pink-50 text-pink-700 border-pink-200"
                            }`}>
                              {field.category}
                            </span>
                          </div>
                          <div className="font-bold text-[10px] text-neutral-600">
                            {field.label}
                          </div>
                          <p className="text-[9px] hover:text-neutral-700 text-neutral-405 leading-normal font-sans pt-0.5">
                            {field.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="border-t-2 border-neutral-900 p-4 bg-neutral-50 flex items-center justify-between gap-3 shrink-0">
              <div className="text-[10px] text-neutral-500 font-sans hidden sm:block">
                Including <strong className="font-bold text-indigo-600">{selectedFields.length} properties</strong> inside the export.
              </div>

              <div className="flex gap-2 w-full sm:w-auto ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border-2 border-neutral-900 bg-white hover:bg-neutral-100 font-bold uppercase text-xs text-neutral-700 transition-all flex-1 sm:flex-initial"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={selectedFields.length === 0}
                  className="px-5 py-2 border-2 border-neutral-900 bg-neutral-900 hover:bg-neutral-850 text-white disabled:opacity-40 transition-all flex items-center justify-center gap-1.5 text-xs font-bold uppercase cursor-pointer flex-1 sm:flex-initial"
                >
                  <Download className="w-4 h-4 text-emerald-450" />
                  Generate Export File
                </button>
              </div>

            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
