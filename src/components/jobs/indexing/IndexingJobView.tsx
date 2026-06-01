import React from "react";
import { 
  Play, Loader2, Globe, Database, BookOpen, Layers, CheckCircle, HelpCircle, 
  AlertTriangle, ArrowRight, Eye, RefreshCw, Sliders, FileText, Compass, MapPin
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StagedPdf } from "../../../types/pdf";
import { JobWorkspaceLayout } from "../../layout/JobWorkspaceLayout";

interface IndexingJobViewProps {
  stagedPdfs: StagedPdf[];
  isIndexingRunning: boolean;
  handleRunIndexingJob: () => Promise<void>;
}

export function IndexingJobView({
  stagedPdfs,
  isIndexingRunning,
  handleRunIndexingJob
}: IndexingJobViewProps) {

  // Load backend Levelsplace curriculum index
  const [curriculum, setCurriculum] = React.useState<any>(null);
  const [isLoadingCurriculum, setIsLoadingCurriculum] = React.useState(false);
  const [selectedPdfUrl, setSelectedPdfUrl] = React.useState<string | null>(null);

  // Sidebar selects
  const [selectedGrade, setSelectedGrade] = React.useState("all");
  const [selectedSubject, setSelectedSubject] = React.useState("all");
  const [selectedModule, setSelectedModule] = React.useState("all");
  const [selectedTopic, setSelectedTopic] = React.useState("all");
  const [selectedLesson, setSelectedLesson] = React.useState("all");
  const [selectedDocType, setSelectedDocType] = React.useState("all");
  const [confidenceThreshold, setConfidenceThreshold] = React.useState("all");

  const fetchCurriculum = React.useCallback(async () => {
    setIsLoadingCurriculum(true);
    try {
      const res = await fetch("/api/levelspace/curriculum");
      const data = await res.json();
      setCurriculum(data);
    } catch (err) {
      console.error("Error loading curriculum", err);
    } finally {
      setIsLoadingCurriculum(false);
    }
  }, []);

  React.useEffect(() => {
    fetchCurriculum();
  }, [fetchCurriculum]);

  // Filters candidates based on select lists
  const filteredPdfs = stagedPdfs.filter(p => {
    // Grade Filter
    if (selectedGrade !== "all") {
      const gid = p.levelspace?.grade_id || p.gradeId;
      if (gid !== selectedGrade) return false;
    }
    // Subject Filter
    if (selectedSubject !== "all") {
      const sid = p.levelspace?.subject_id || p.subjectId;
      if (sid !== selectedSubject) return false;
    }
    // Module Filter
    if (selectedModule !== "all") {
      const mid = p.levelspace?.module_id;
      if (mid !== selectedModule) return false;
    }
    // Topic Filter
    if (selectedTopic !== "all") {
      const tid = p.levelspace?.topic_id || p.topicId;
      if (tid !== selectedTopic) return false;
    }
    // Lesson Filter
    if (selectedLesson !== "all") {
      const lid = p.levelspace?.lesson_id;
      if (lid !== selectedLesson) return false;
    }
    // Document Type Filter
    if (selectedDocType !== "all") {
      const docType = p.levelspace?.document_role || p.documentTypeId || "";
      if (!docType.toLowerCase().includes(selectedDocType.toLowerCase())) return false;
    }
    // Confidence Threshold Filter
    if (confidenceThreshold !== "all") {
      const conf = p.levelspace?.curriculum_confidence ?? p.confidenceScore ?? 0;
      if (confidenceThreshold === "high" && conf < 85) return false;
      if (confidenceThreshold === "medium" && (conf < 60 || conf >= 85)) return false;
      if (confidenceThreshold === "low" && conf >= 60) return false;
    }
    return true;
  });

  // Calculate stats based on ALL staged pdfs (or filtered ones for precision)
  const countToIndex = stagedPdfs.filter(p => !p.levelspace?.index_status && p.status === "classified").length;
  const countIndexed = stagedPdfs.filter(p => p.levelspace?.index_status === "indexed").length;
  const countNeedsReview = stagedPdfs.filter(p => p.levelspace?.index_status === "needs_review").length;
  const countBlocked = stagedPdfs.filter(p => p.levelspace?.index_status === "blocked").length;

  // Active highlighted file
  const activePdf = stagedPdfs.find(p => p.url === selectedPdfUrl) || filteredPdfs[0] || null;

  // Handle active selection
  React.useEffect(() => {
    if (activePdf && activePdf.url !== selectedPdfUrl) {
      setSelectedPdfUrl(activePdf.url);
    }
  }, [activePdf, selectedPdfUrl]);

  // Clear filters
  const handleResetFilters = () => {
    setSelectedGrade("all");
    setSelectedSubject("all");
    setSelectedModule("all");
    setSelectedTopic("all");
    setSelectedLesson("all");
    setSelectedDocType("all");
    setConfidenceThreshold("all");
  };

  const sidebarContent = (
    <div className="p-4 flex flex-col h-full space-y-5 overflow-y-auto">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center">
            <Sliders className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
            Curriculum Filters
          </h2>
          <Button 
            variant="ghost" 
            onClick={handleResetFilters}
            className="h-auto p-0 text-[9px] font-mono hover:bg-transparent text-neutral-500 hover:text-neutral-800 uppercase"
          >
            Clear
          </Button>
        </div>
        <p className="text-[10px] text-neutral-550 mt-1 leading-snug">
          Filter documents by curriculum nodes and confidence parameters.
        </p>
      </div>

      <div className="space-y-3.5">
        {/* Grade */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-500 block">Grade Selection</label>
          <select 
            id="indexing-grade-select"
            value={selectedGrade} 
            onChange={(e) => {
              setSelectedGrade(e.target.value);
              setSelectedModule("all");
              setSelectedTopic("all");
              setSelectedLesson("all");
            }}
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-neutral-900 focus:outline-none"
          >
            <option value="all">All Grades</option>
            {curriculum?.grades?.map((g: any) => (
              <option key={g.id} value={g.id}>{g.nameFr || g.nameFr || g.id} ({g.suffix})</option>
            ))}
          </select>
        </div>

        {/* Subject */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-500 block">Subject Area</label>
          <select 
            id="indexing-subject-select"
            value={selectedSubject} 
            onChange={(e) => {
              setSelectedSubject(e.target.value);
              setSelectedModule("all");
              setSelectedTopic("all");
              setSelectedLesson("all");
            }}
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-neutral-900 focus:outline-none"
          >
            <option value="all">All Subjects</option>
            {curriculum?.subjects?.map((s: any) => (
              <option key={s.id} value={s.id}>{s.nameFr || s.id}</option>
            ))}
          </select>
        </div>

        {/* Module */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-500 block">Module / Domain</label>
          <select 
            id="indexing-module-select"
            value={selectedModule} 
            onChange={(e) => {
              setSelectedModule(e.target.value);
              setSelectedTopic("all");
              setSelectedLesson("all");
            }}
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-neutral-900 focus:outline-none"
          >
            <option value="all">All Modules</option>
            {curriculum?.modules?.filter((m: any) => {
              if (selectedGrade !== "all" && m.grade_id !== selectedGrade) return false;
              if (selectedSubject !== "all" && m.subject_id !== selectedSubject) return false;
              return true;
            }).map((m: any) => (
              <option key={m.id} value={m.id}>{m.nameFr || m.id}</option>
            ))}
          </select>
        </div>

        {/* Topic */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-500 block">Topic / Unit</label>
          <select 
            id="indexing-topic-select"
            value={selectedTopic} 
            onChange={(e) => {
              setSelectedTopic(e.target.value);
              setSelectedLesson("all");
            }}
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-neutral-900 focus:outline-none"
          >
            <option value="all">All Topics</option>
            {curriculum?.topics?.filter((t: any) => {
              if (selectedSubject !== "all" && t.subject_id !== selectedSubject) return false;
              if (selectedModule !== "all" && t.module_id !== selectedModule) return false;
              return true;
            }).map((t: any) => (
              <option key={t.id} value={t.id}>{t.nameFr || t.id}</option>
            ))}
          </select>
        </div>

        {/* Lesson */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-500 block">Lesson Unit</label>
          <select 
            id="indexing-lesson-select"
            value={selectedLesson} 
            onChange={(e) => setSelectedLesson(e.target.value)}
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-neutral-900 focus:outline-none"
          >
            <option value="all">All Lessons</option>
            {curriculum?.lessons?.filter((l: any) => {
              if (selectedTopic !== "all" && l.topic_id !== selectedTopic) return false;
              return true;
            }).map((l: any) => (
              <option key={l.id} value={l.id}>{l.title || l.id}</option>
            ))}
          </select>
        </div>

        {/* Document Type */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-500 block">Document Type Match</label>
          <select 
            id="indexing-doctype-select"
            value={selectedDocType} 
            onChange={(e) => setSelectedDocType(e.target.value)}
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-neutral-900 focus:outline-none"
          >
            <option value="all">All Roles</option>
            <option value="lesson">Lesson Source (cours)</option>
            <option value="practice">Practice Source (exercice)</option>
            <option value="solution">Solution (correction)</option>
            <option value="assessment">Assessment (controle/exam)</option>
            <option value="planning">Pedagogical planning</option>
          </select>
        </div>

        {/* Confidence threshold */}
        <div className="space-y-1">
          <span className="text-[9px] font-mono uppercase font-bold text-neutral-500 block">Confidence Filter</span>
          <select 
            id="indexing-threshold"
            value={confidenceThreshold}
            onChange={(e) => setConfidenceThreshold(e.target.value)}
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-neutral-900 focus:outline-none"
          >
            <option value="all">All Confidence Ratings</option>
            <option value="high">High (Classified &gt;= 85%)</option>
            <option value="medium">Medium (60% - 84%)</option>
            <option value="low">Low (Blocked &lt; 60%)</option>
          </select>
        </div>
      </div>

      <div className="mt-auto pt-4 border-t border-neutral-200">
         <Button 
           id="indexing-run-job-btn"
           onClick={handleRunIndexingJob}
           disabled={isIndexingRunning}
           className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(20,83,136,0.5)] transition-all"
         >
           {isIndexingRunning ? (
             <>
               <Loader2 className="w-4 h-4 animate-spin mr-2" />
               Aligning...
             </>
           ) : (
             <>
               <Play className="w-4 h-4 mr-2" />
               Run Indexing Job
             </>
           )}
         </Button>
         <div className="flex justify-between items-center mt-2.5">
           <span className="text-[9px] font-mono text-neutral-400">REFERENCE SYNC:</span>
           {isLoadingCurriculum ? (
             <span className="text-[9px] font-mono text-blue-500 animate-pulse">Syncing...</span>
           ) : (
             <button onClick={fetchCurriculum} className="text-[9px] font-mono hover:text-blue-600 text-neutral-500 flex items-center">
               <RefreshCw className="w-2.5 h-2.5 mr-0.5" /> REFRESH
             </button>
           )}
         </div>
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex flex-col h-full bg-neutral-100/30 overflow-hidden">
      {/* Top Summaries */}
      <div className="p-5 bg-white border-b border-neutral-200 shrink-0 grid grid-cols-4 gap-3">
        <div className="border border-neutral-200 bg-neutral-50 p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase font-bold text-neutral-500 flex items-center">
            <Layers className="w-3 h-3 mr-1 text-neutral-500" /> To Index
          </div>
          <div id="indexing-stat-payload" className="font-mono text-lg font-bold text-neutral-800 mt-1">
            {countToIndex}
          </div>
        </div>
        <div className="border border-emerald-200 bg-emerald-50 p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase font-bold text-emerald-600 flex items-center">
            <CheckCircle className="w-3 h-3 mr-1 text-emerald-600" /> Indexed
          </div>
          <div id="indexing-stat-indexed" className="font-mono text-lg font-bold text-emerald-800 mt-1">
            {countIndexed}
          </div>
        </div>
        <div className="border border-amber-200 bg-amber-50 p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase font-bold text-amber-600 flex items-center">
            <AlertTriangle className="w-3 h-3 mr-1 text-amber-600" /> Needs Review
          </div>
          <div id="indexing-stat-review" className="font-mono text-lg font-bold text-amber-800 mt-1">
            {countNeedsReview}
          </div>
        </div>
        <div className="border border-red-200 bg-red-50 p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase font-bold text-red-600 flex items-center">
            <HelpCircle className="w-3 h-3 mr-1 text-red-600" /> Blocked
          </div>
          <div id="indexing-stat-blocked" className="font-mono text-lg font-bold text-red-800 mt-1">
            {countBlocked}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-neutral-200">
        
        {/* Left Side: Indexing list */}
        <div className="flex-1 overflow-y-auto p-4 min-w-0">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className="text-[10px] font-mono font-semibold text-neutral-600">
              SHOWING {filteredPdfs.length} OF {stagedPdfs.length} DOCUMENT ENTRIES
            </span>
            {filteredPdfs.length < stagedPdfs.length && (
              <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 font-mono uppercase">
                Filtered list
              </span>
            )}
          </div>
          
          <div className="border border-neutral-200 bg-white">
            <div className="divide-y divide-neutral-200 w-full text-left">
              <div className="bg-neutral-50 text-[9px] font-mono font-bold uppercase text-neutral-500 border-b border-neutral-200 flex py-2 px-3">
                <div className="w-[30%]">Filename</div>
                <div className="w-[12%]">Grade</div>
                <div className="w-[12%]">Subject</div>
                <div className="w-[15%]">Topic</div>
                <div className="w-[15%]">Lesson Mapping</div>
                <div className="w-[8%] text-center">Confidence</div>
                <div className="w-[8%] text-right">Status</div>
              </div>
              
              {filteredPdfs.map((item, idx) => {
                const isActive = item.url === selectedPdfUrl;
                const score = item.levelspace?.curriculum_confidence ?? item.confidenceScore ?? 0;
                return (
                  <div 
                    key={item.hash || item.url || `index-row-${idx}`} 
                    onClick={() => setSelectedPdfUrl(item.url)}
                    className={`flex items-center text-[10px] py-2.5 px-3 border-b border-neutral-100 font-mono last:border-b-0 cursor-pointer transition-colors ${
                      isActive ? "bg-blue-50/70 hover:bg-blue-50" : "hover:bg-neutral-50"
                    }`}
                  >
                    <div className="w-[30%] font-bold text-neutral-800 truncate pr-2 flex items-center" title={item.originalName}>
                      <FileText className="w-3.5 h-3.5 text-neutral-400 mr-1 shrink-0" />
                      <span className="truncate">{item.originalName}</span>
                    </div>
                    <div className="w-[12%] text-neutral-600 truncate pr-2 uppercase">
                      {item.levelspace?.grade_id || item.gradeId || "—"}
                    </div>
                    <div className="w-[12%] text-neutral-600 truncate pr-2 uppercase">
                      {item.levelspace?.subject_id || item.subjectId || "—"}
                    </div>
                    <div className="w-[15%] text-neutral-600 truncate pr-2">
                      {item.levelspace?.topic_name || item.levelspace?.topic_id || item.topicId || "—"}
                    </div>
                    <div className="w-[15%] text-neutral-800 font-medium truncate pr-2">
                      {item.levelspace?.lesson_title || item.levelspace?.lesson_id || "—"}
                    </div>
                    <div className="w-[8%] text-center">
                      <span className={`font-bold ${
                        score >= 85 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-500'
                      }`}>
                        {score > 0 ? `${score}%` : "—"}
                      </span>
                    </div>
                    <div className="w-[8%] text-right font-bold">
                       <span className={`uppercase text-[8px] px-1.5 py-0.5 inline-block rounded-none ${
                         item.levelspace?.index_status === 'indexed' ? 'bg-emerald-100 text-emerald-800' : 
                         item.levelspace?.index_status === 'needs_review' ? 'bg-amber-100 text-amber-800' : 
                         item.levelspace?.index_status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-neutral-100 text-neutral-600'
                       }`}>
                         {item.levelspace?.index_status || "PENDING"}
                       </span>
                    </div>
                  </div>
                );
              })}

              {filteredPdfs.length === 0 && (
                <div className="p-8 text-center text-neutral-400 font-mono text-xs">
                  No matching registered files matches selected filters.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Alignment Inspector */}
        <div className="w-full md:w-80 bg-white border-l border-neutral-200 p-4 shrink-0 overflow-y-auto flex flex-col h-full">
          {activePdf ? (
            <div className="flex-1 flex flex-col h-full space-y-4">
              <div>
                <span className="text-[8px] font-mono uppercase bg-neutral-200 text-neutral-700 px-1.5 py-0.5 font-bold rounded-none">
                  Inspection Panel
                </span>
                <h3 className="font-mono text-xs font-bold text-neutral-900 mt-2 line-clamp-2 pr-1" title={activePdf.originalName}>
                  {activePdf.originalName}
                </h3>
                <span className="text-[8px] font-mono text-neutral-400 block mt-1 break-all">
                  URL: {activePdf.url}
                </span>
              </div>

              {/* Path Preview */}
              <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-none relative">
                <div className="text-[9px] uppercase font-mono font-bold text-neutral-400 flex items-center mb-1.5">
                  <MapPin className="w-3 h-3 text-blue-500 mr-1" /> Levelspace Path Preview
                </div>
                {activePdf.levelspace?.curriculum_path ? (
                  <div className="space-y-1.5 font-mono text-[10px]">
                    {activePdf.levelspace.curriculum_path.split("→").map((part, index, arr) => (
                      <div key={index} className="flex items-center">
                        {index > 0 && <span className="text-neutral-400 text-[8px] mr-1.5 font-sans">↳</span>}
                        <span className={`px-1 py-0.5 rounded-none font-bold ${
                          index === arr.length - 1 ? 'bg-blue-100 text-blue-900 font-sans' : 'text-neutral-600'
                        }`}>
                          {part.trim()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-neutral-400 italic text-[10px]">No aligned curriculum path yet. Run mapping job.</span>
                )}
              </div>

              {/* Status details */}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="p-2 border border-neutral-100 bg-neutral-50/50">
                  <span className="text-[8px] text-neutral-400 uppercase block">Indexing Status</span>
                  <span className={`font-bold uppercase ${
                    activePdf.levelspace?.index_status === 'indexed' ? 'text-emerald-600' : 
                    activePdf.levelspace?.index_status === 'needs_review' ? 'text-amber-600' : 
                    activePdf.levelspace?.index_status === 'blocked' ? 'text-red-600' : 'text-neutral-500'
                  }`}>
                    {activePdf.levelspace?.index_status || 'PENDING'}
                  </span>
                </div>
                <div className="p-2 border border-neutral-100 bg-neutral-50/50">
                  <span className="text-[8px] text-neutral-400 uppercase block">Role Assigned</span>
                  <span className="font-bold text-neutral-700 uppercase truncate block">
                    {activePdf.levelspace?.document_role?.replace(/_/g, " ") || '—'}
                  </span>
                </div>
              </div>

              {/* Suggested Action */}
              <div className="p-3 bg-neutral-50 border border-neutral-200">
                <span className="text-[9px] uppercase font-mono font-bold text-neutral-400 block mb-1">
                  Suggested Action
                </span>
                <p className="text-[10px] font-mono text-neutral-700 leading-snug">
                  {activePdf.levelspace?.suggested_action || "Ready & verified. No action required."}
                </p>
                {activePdf.levelspace?.index_reason && (
                  <div className="mt-2 text-[9px] text-amber-700 font-mono italic">
                    Reason: {activePdf.levelspace.index_reason}
                  </div>
                )}
              </div>

              {/* Visibility and Roles */}
              <div className="p-3 border border-neutral-150">
                <span className="text-[9px] uppercase font-mono font-bold text-neutral-400 block mb-1.5">
                  Permissions Scope
                </span>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className={`px-1.5 py-0 rounded-none text-[8px] ${activePdf.levelspace?.student_visible ? 'bg-blue-50 text-blue-700 border-blue-200' : 'opacity-40'}`}>STUDENT</Badge>
                  <Badge variant="outline" className={`px-1.5 py-0 rounded-none text-[8px] ${activePdf.levelspace?.teacher_visible ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'opacity-40'}`}>TEACHER</Badge>
                  <Badge variant="outline" className={`px-1.5 py-0 rounded-none text-[8px] ${activePdf.levelspace?.admin_visible ? 'bg-amber-50 text-amber-700 border-amber-200' : 'opacity-40'}`}>ADMIN</Badge>
                  <Badge variant="outline" className={`px-1.5 py-0 rounded-none text-[8px] ${activePdf.levelspace?.ai_visible ? 'bg-purple-50 text-purple-700 border-purple-200' : 'opacity-40'}`}>AI ENGINE</Badge>
                </div>
              </div>

              {/* Candidate Lesson Matches */}
              <div className="flex-1 flex flex-col min-h-0">
                <span className="text-[9px] uppercase font-mono font-bold text-neutral-400 block mb-1 shrink-0">
                  Candidate Lesson Matches
                </span>
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[100px]">
                  {activePdf.levelspace?.candidate_lessons && activePdf.levelspace.candidate_lessons.length > 0 ? (
                    (activePdf.levelspace.candidate_lessons as any[]).map((cand: any, idx: number) => (
                      <div key={cand.id || idx} className="p-2 border border-neutral-200 bg-neutral-50/50 flex flex-col space-y-1">
                        <div className="flex justify-between items-start">
                          <span className="text-[9.5px] font-bold text-neutral-800 line-clamp-2 leading-tight">
                            {cand.title || cand.nameFr || cand.id}
                          </span>
                        </div>
                        {cand.title_ar && (
                          <div className="text-[10px] text-right font-sans text-neutral-500 font-medium tracking-tight">
                            {cand.title_ar}
                          </div>
                        )}
                        <div className="flex justify-between items-center pt-0.5">
                          <Badge variant="secondary" className="bg-neutral-100 text-neutral-600 px-1 py-0 text-[8px] rounded-none shadow-none uppercase font-mono">
                            ID: {cand.id}
                          </Badge>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center p-4 border border-dashed border-neutral-200 text-neutral-400 text-[10px] italic">
                      No matching candidate lessons available.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-center items-center text-center text-neutral-400 font-mono text-xs p-6 border border-dashed border-neutral-200">
              <Eye className="w-8 h-8 text-neutral-300 mb-2" />
              Select a document to inspect alignment details.
            </div>
          )}
        </div>

      </div>
    </div>
  );

  return (
    <JobWorkspaceLayout 
      sidebar={sidebarContent} 
      main={mainContent} 
    />
  );
}

export default IndexingJobView;
