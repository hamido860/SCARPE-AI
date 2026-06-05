import React from "react";
import { JobView } from "../../types/jobs";

interface JobNavigationProps {
  activeJobView: JobView;
  onJobViewChange: (view: JobView) => void;
  className?: string;
}

export function JobNavigation({ activeJobView, onJobViewChange, className = "" }: JobNavigationProps) {
  const views: { id: JobView; label: string }[] = [
    { id: "intake", label: "Collect PDFs" },
    { id: "collector", label: "Drive Collector" },
    { id: "processing", label: "Clean & OCR" },
    { id: "indexing", label: "Build RAG" },
    { id: "review", label: "Validate" },
    { id: "output", label: "Export" },
    { id: "reports", label: "Audit" },
    { id: "settings", label: "Settings" }
  ];

  return (
    <nav className={`flex flex-col space-y-1 ${className}`}>
      {views.map((v) => (
        <button
          key={v.id}
          onClick={() => onJobViewChange(v.id)}
          className={`px-4 py-2.5 text-left text-xs font-mono font-bold uppercase transition-all border ${
            activeJobView === v.id
              ? "bg-[#141414] text-white border-[#141414]"
              : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
          }`}
        >
          {v.label}
        </button>
      ))}
    </nav>
  );
}
export default JobNavigation;
