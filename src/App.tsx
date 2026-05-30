import React from "react";
import { GraduationCap } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import WorkstationDashboard from "./WorkstationDashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] pb-12">
      <Toaster position="top-center" />
      <header className="border-b border-[#141414] px-6 py-4 flex justify-between items-center bg-white sticky top-0 z-40 h-16 shadow-sm mb-6 select-none">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1.5 rounded-sm">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-bold tracking-tighter uppercase font-mono flex items-center gap-1.5 text-neutral-900">
            SCARPE-AI <span className="text-xs bg-emerald-600 font-sans text-white font-semibold py-0.5 px-2 rounded-full uppercase tracking-normal">Local Scraping & Merging Workstation</span>
          </h1>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-zinc-500">Status: <span className="text-emerald-600 font-bold">Offline-First Engine Running</span></span>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6">
        <WorkstationDashboard />
      </div>
    </div>
  );
}
