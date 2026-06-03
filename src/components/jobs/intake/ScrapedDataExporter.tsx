import React, { useState } from "react";
import { 
  Download, FileJson, FileSpreadsheet, CheckSquare, Square, SlidersHorizontal, Info
} from "lucide-react";

export interface ScrapedDataExporterProps {
  data: any[];
}

const AVAILABLE_COLUMNS = [
  { id: "id", label: "Node ID", accessor: (node: any) => node.id || "" },
  { id: "canonical_url", label: "Canonical URL", accessor: (node: any) => node.canonical_url || "" },
  { id: "navigation_path", label: "Breadcrumb Path", accessor: (node: any) => node.navigation_path || "" },
  { id: "page_role", label: "Page Role", accessor: (node: any) => node.page_role || "" },
  { id: "action", label: "Crawl Action", accessor: (node: any) => node.action || "" },
  { id: "discovered_links_count", label: "Discovered Links", accessor: (node: any) => node.discovered_links_count ?? 0 },
  { id: "extracted_grade", label: "Extracted Grade", accessor: (node: any) => node.extracted_grade || "" },
  { id: "extracted_subject", label: "Extracted Subject", accessor: (node: any) => node.extracted_subject || "" },
  { id: "extracted_document_type", label: "Document Type", accessor: (node: any) => node.extracted_document_type || "" },
  { id: "extracted_topic", label: "Extracted Topic", accessor: (node: any) => node.extracted_topic || "" },
  { id: "confidence", label: "Confidence (%)", accessor: (node: any) => node.confidence !== undefined ? Math.round(node.confidence * 100) : 0 },
  { id: "status", label: "Crawl Status", accessor: (node: any) => node.status || "" },
  { id: "rejection_reason", label: "Rejection Reason", accessor: (node: any) => node.rejection_reason || "" },
  { id: "source_domain", label: "Source Domain", accessor: (node: any) => node.source_domain || "" },
  { id: "source_url", label: "Seed Source URL", accessor: (node: any) => node.source_url || "" },
  { id: "depth", label: "Crawl Depth", accessor: (node: any) => node.depth ?? 0 },
];

export function ScrapedDataExporter({ data }: ScrapedDataExporterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filename, setFilename] = useState("scraped-data-export");
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>(
    AVAILABLE_COLUMNS.map(c => c.id) // All selected by default
  );

  const toggleColumn = (id: string) => {
    if (selectedColumnIds.includes(id)) {
      setSelectedColumnIds(selectedColumnIds.filter(cid => cid !== id));
    } else {
      setSelectedColumnIds([...selectedColumnIds, id]);
    }
  };

  const handleSelectAll = () => {
    setSelectedColumnIds(AVAILABLE_COLUMNS.map(c => c.id));
  };

  const handleSelectNone = () => {
    setSelectedColumnIds([]);
  };

  const handleReset = () => {
    // Select standard primary columns
    const standard = ["id", "canonical_url", "navigation_path", "page_role", "action", "extracted_grade", "extracted_subject", "extracted_topic", "status"];
    setSelectedColumnIds(standard);
  };

  const handleExport = () => {
    if (data.length === 0) return;
    
    // Filter active selected columns
    const activeColumns = AVAILABLE_COLUMNS.filter(col => selectedColumnIds.includes(col.id));
    if (activeColumns.length === 0) {
      alert("Please select at least one column to export.");
      return;
    }

    // Format output filename
    const cleanFilename = filename.trim().replace(/[/\\?%*:|"<>\s]/g, "_") || "export";
    const finalFilename = `${cleanFilename}.${format}`;

    let blobContent = "";
    let mimeType = "";

    if (format === "json") {
      // Build JSON Array of custom-projected records
      const records = data.map(node => {
        const rowObj: Record<string, any> = {};
        activeColumns.forEach(col => {
          rowObj[col.id] = col.accessor(node);
        });
        return rowObj;
      });
      blobContent = JSON.stringify(records, null, 2);
      mimeType = "application/json;charset=utf-8;";
    } else {
      // Build CSV
      const headers = activeColumns.map(col => col.label);
      const csvRows = [headers.join(",")];

      data.forEach(node => {
        const rowValues = activeColumns.map(col => {
          let value = col.accessor(node);
          if (value === null || value === undefined) {
            value = "";
          }
          // Convert to string and sanitise for CSV escape
          let strVal = String(value).replace(/\r?\n|\r/g, " ");
          if (strVal.includes(",") || strVal.includes('"') || strVal.includes("\n")) {
            strVal = `"${strVal.replace(/"/g, '""')}"`;
          }
          return strVal;
        });
        csvRows.push(rowValues.join(","));
      });
      blobContent = csvRows.join("\n");
      mimeType = "text/csv;charset=utf-8;";
    }

    // Dynamic browser trigger download
    const blob = new Blob([blobContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", finalFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-neutral-50/50 border border-neutral-200 p-4 transition-all hover:bg-neutral-50 shadow-xs mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-4 h-4 text-neutral-600" />
            <h4 className="font-bold text-xs text-neutral-800 uppercase font-mono tracking-tight">
              Export Scraped Results
            </h4>
            <span className="text-[10px] bg-neutral-200/85 px-1.5 py-0.5 rounded-none font-mono text-neutral-700 font-bold">
              {data.length} records
            </span>
          </div>
          <p className="text-[10px] text-neutral-500 mt-1 font-sans">
            Export site mapping node structures. Customize columns, select format (JSON/CSV) and customize layout name.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.length > 0 && (
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="px-3 py-1.5 text-xs font-mono uppercase bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 transition-colors flex items-center gap-1.5 font-bold"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {isOpen ? "Hide Exporter Controls" : "Configure Export Options"}
            </button>
          )}
        </div>
      </div>

      {isOpen && data.length > 0 && (
        <div className="mt-4 pt-4 border-t border-neutral-200/80 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            
            {/* Options configuration Left */}
            <div className="md:col-span-4 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase font-bold text-neutral-500 block">
                  Output File Name
                </label>
                <div className="flex rounded-none mt-1 shadow-xs">
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder="Enter output filename..."
                    className="flex-1 min-w-0 bg-white border border-neutral-300 px-3 py-1.5 text-xs font-mono h-8 rounded-none focus:outline-none focus:ring-1 focus:ring-indigo-500 text-neutral-800"
                  />
                  <span className="inline-flex items-center px-2.5 bg-neutral-100 border border-l-0 border-neutral-300 text-[10px] font-mono text-neutral-500">
                    .{format}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase font-bold text-neutral-500 block">
                  Select Format
                </label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setFormat("json")}
                    className={`h-9 px-3 text-xs font-mono border transition-all flex items-center justify-center gap-2 ${
                      format === "json"
                        ? "bg-indigo-600 border-indigo-600 text-white font-bold"
                        : "bg-white border-neutral-350 text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    <FileJson className="w-4 h-4" />
                    JSON Format
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormat("csv")}
                    className={`h-9 px-3 text-xs font-mono border transition-all flex items-center justify-center gap-2 ${
                      format === "csv"
                        ? "bg-emerald-600 border-emerald-600 text-white font-bold"
                        : "bg-white border-neutral-350 text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    CSV Format
                  </button>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200/80 p-3 flex gap-2 rounded-none text-amber-900">
                <Info className="w-4 h-4 mt-0.5 text-amber-700 shrink-0" />
                <div className="text-[9px] font-sans leading-relaxed">
                  <div className="font-bold text-amber-800 uppercase font-mono">Live Processing Summary</div>
                  Exporting <b className="font-bold">{data.length} records</b> with <b className="font-bold">{selectedColumnIds.length}</b> custom projected domains. Approximate download size: <b className="font-bold">~{Math.round((data.length * selectedColumnIds.length * 15) / 102) / 10} KB</b>.
                </div>
              </div>
            </div>

            {/* Columns selector Right */}
            <div className="md:col-span-8 flex flex-col bg-white border border-neutral-200 p-3">
              <div className="flex items-center justify-between border-b border-neutral-100 pb-2 mb-2">
                <label className="text-[10px] font-mono uppercase font-bold text-neutral-600">
                  Select Columns to Include ({selectedColumnIds.length}/{AVAILABLE_COLUMNS.length})
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="px-2 py-0.5 text-[9px] font-mono bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-700 font-bold transition-all"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectNone}
                    className="px-2 py-0.5 text-[9px] font-mono bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-700 font-bold transition-all"
                  >
                    None
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-2 py-0.5 text-[9px] font-mono bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-700 font-bold transition-all"
                  >
                    Default
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-2 overflow-y-auto max-h-48 text-[11px]">
                {AVAILABLE_COLUMNS.map((col) => {
                  const isChecked = selectedColumnIds.includes(col.id);
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleColumn(col.id)}
                      className={`px-2 py-1.5 border flex items-center text-left gap-1.5 font-sans transition-all group ${
                        isChecked 
                          ? "bg-indigo-50/50 border-indigo-300/60 text-indigo-950 font-medium" 
                          : "border-neutral-200/80 bg-neutral-50/20 text-neutral-500 hover:bg-neutral-50"
                      }`}
                    >
                      <span className="shrink-0 transition-transform group-hover:scale-105">
                        {isChecked ? (
                          <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-neutral-400" />
                        )}
                      </span>
                      <span className="truncate max-w-full font-mono text-[10px] break-all">
                        {col.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-neutral-100 pt-3 mt-auto flex justify-end">
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={selectedColumnIds.length === 0}
                  className="h-9 px-5 bg-neutral-900 border border-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40 hover:scale-[1.01] transition-all flex items-center gap-1.5 text-xs font-mono font-bold uppercase rounded-none shadow-sm"
                >
                  <Download className="w-4 h-4 text-emerald-400 animate-pulse" />
                  Generate & Download export file
                </button>
              </div>

            </div>

          </div>
        </div>
      )}
    </div>
  );
}
