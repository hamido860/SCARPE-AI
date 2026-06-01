import React from "react";
import { GraduationCap } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import WorkstationDashboard from "./WorkstationDashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-[#F0F0F0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      <Toaster position="top-center" />
      <main className="w-full">
        <WorkstationDashboard />
      </main>
    </div>
  );
}
