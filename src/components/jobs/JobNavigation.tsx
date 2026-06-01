import React from "react";
import { JobView } from "../../types/jobs";

interface JobNavigationProps {
  activeJobView: JobView;
  onJobViewChange: (view: JobView) => void;
  className?: string;
}

export function JobNavigation({ activeJobView, onJobViewChange, className = "" }: JobNavigationProps) {
  const views: { id: JobView; label: string }[] = [
    { id: "intake", label: "Intake" },
    { id: "processing", label: "Processing" },
    { id: "indexing", label: "Levelspace Indexing" },
    { id: "review", label: "Review" },
    { id: "output", label: "Outputs" },
    { id: "reports", label: "Reports" },
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
