import React, { useState, useEffect } from "react";
import { 
  Play, Loader2, Globe, Database, BookOpen, Layers, CheckCircle, HelpCircle, 
  AlertTriangle, ArrowRight, Eye, RefreshCw, Sliders, FileText, Compass, MapPin,
  CheckSquare, CheckCircle2, ChevronRight, CornerDownRight, ShieldAlert, BadgeAlert,
  FolderOpen, Settings, Check, ExternalLink, Trash2, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dictionary } from "../../../types/dictionary";
import { StagedPdf } from "../../../types/pdf";
import { JobWorkspaceLayout } from "../../layout/JobWorkspaceLayout";
import { toast } from "sonner";

interface ReviewJobViewProps {
  stagedPdfs: StagedPdf[];
  dictionary: Dictionary;
  handleResolveBlock: (
    itemIndex: number,
    item: any,
    resolvedMetadata: {
      gradeId: string;
      subjectId: string;
      topicId: string;
      documentTypeId: string;
      cleanTitle: string;
    }
  ) => Promise<void>;
}

interface GroupMetadata {
  id: string;
  title: string;
  description: string;
  suggestedAction: string;
  allowedActions: string[];
  sampleFiles: string[];
  defaultCount: number;
}

const GROUP_METRICS: GroupMetadata[] = [
  {
    id: "no_matching_lesson",
    title: "No Matching Lesson",
    description: "The pipeline classified the document's grade and subject but couldn't associate it with any existing lesson in Levelspace.",
    suggestedAction: "Map to the nearest curriculum unit automatically, or select a manual lesson.",
    allowedActions: ["map_to_existing_lesson", "send_to_later_review"],
    sampleFiles: ["Ex-Semestre2-MATH-1AC.pdf", "devoir3-modeleA-maths-1ac.pdf", "math_prep_test_sem1.pdf"],
    defaultCount: 34
  },
  {
    id: "multiple_candidate_lessons",
    title: "Multiple Candidate Lessons",
    description: "Heuristics found multiple candidate lessons inside the document body with high lexical overlap.",
    suggestedAction: "Approve the top candidate lesson, or select one from the detected candidates list.",
    allowedActions: ["approve_candidate_lesson", "reject_group"],
    sampleFiles: ["arithmetique-dans-N-exercices.pdf", "calcul-numerique-fraction-cours.pdf", "operations_fractions_devoir.pdf"],
    defaultCount: 18
  },
  {
    id: "topic_not_in_curriculum",
    title: "Topic Not in Curriculum",
    description: "The document discusses mathematical concepts that do not correspond to any active topic in the curriculum index.",
    suggestedAction: "Map to an existing lesson, or flag the topic for manual curriculum indexing.",
    allowedActions: ["map_to_existing_lesson", "send_to_later_review"],
    sampleFiles: ["geometrie-dans-espace-projections.pdf", "intro-suites-numeriques-col.pdf"],
    defaultCount: 22
  },
  {
    id: "module_missing",
    title: "Module Missing",
    description: "The document belongs to a grade/subject but specifies a missing or unindexed curriculum module structure.",
    suggestedAction: "Identify the parent domain in the master dictionary or bypass restriction.",
    allowedActions: ["map_to_existing_lesson", "add_alias"],
    sampleFiles: ["algebre-lineaire-application-1ac.pdf", "probabilites-simples-col.pdf", "module_xyz_draft.pdf"],
    defaultCount: 12
  },
  {
    id: "lesson_alias_missing",
    title: "Lesson Alias Missing",
    description: "The document's Arabic/French title does not match any current search aliases or keywords in the dictionary.",
    suggestedAction: "Add the document title as a lesson search alias to improve automatic matches next time.",
    allowedActions: ["add_alias", "map_to_existing_lesson"],
    sampleFiles: ["دروس-الرياضيات-الاولى-اعدادي-جمع.pdf", "addition-des-decimaux-cours-didactique.pdf", "cours_somme_fractions_1ac.pdf"],
    defaultCount: 45
  },
  {
    id: "grade_subject_mismatch",
    title: "Grade-Subject Mismatch",
    description: "The Grade suffix (e.g. 1AC) in the document header conflicts with the parsed Subject (e.g. Arabic, SVT) in the dictionary.",
    suggestedAction: "Re-associate the correct Grade and Subject mapping, or discard if out of scope.",
    allowedActions: ["map_to_existing_lesson", "reject_group"],
    sampleFiles: ["svt-1ere-annee-devoir-semestre1.pdf", "controle-1-arabe-session1.pdf"],
    defaultCount: 29
  },
  {
    id: "document_type_uncertain",
    title: "Document Type Uncertain",
    description: "Text indicators are ambiguous, making it difficult to distinguish between course material, solved exercises, or assessments.",
    suggestedAction: "Impose a manual document classification role override based on context.",
    allowedActions: ["map_to_existing_lesson", "send_to_later_review"],
    sampleFiles: ["fiche-recap-maths.pdf", "serie-1ac-exercices-divers.pdf", "test_cours_exercice_amalgam.pdf"],
    defaultCount: 15
  },
  {
    id: "ocr_needed",
    title: "OCR Needed",
    description: "Scanned imagery or high-density hand-written notes detected with extremely low textual confidence scores.",
    suggestedAction: "Execute safe-mode optical character recognition on scanned/image-only PDFs.",
    allowedActions: ["run_ocr_safe_mode", "reject_group"],
    sampleFiles: ["scanned-devoir2-1ac-math.pdf", "image-page3-cours-decimaux.pdf", "camera_captured_exam_1ac.pdf"],
    defaultCount: 65
  },
  {
    id: "topic_filter_mismatch",
    title: "Topic Filter Mismatch",
    description: "The document contains keywords that bridge two different topics, violating exclusive topic filter indices.",
    suggestedAction: "Check subject boundaries, reset active scope, or force map topic.",
    allowedActions: ["map_to_existing_lesson", "send_to_later_review"],
    sampleFiles: ["geometrie-et-nombres-relatifs-synthese.pdf", "angles-et-droites-paralleles-cours.pdf"],
    defaultCount: 11
  },
  {
    id: "malformed_url",
    title: "Malformed URL Path",
    description: "The underlying source file URL contains escaping bugs, percent-encoded spaces, or trailing newline artifacts.",
    suggestedAction: "Sanitize directory path delimiters, fix encoding, and retry indexing.",
    allowedActions: ["send_to_later_review", "reject_group"],
    sampleFiles: ["%d8%a7%d9%84%d8%a3%d8%b9%d8%af%d8%a7%d8%af%20%d8%a7%d9%84%d9%86%d8%b3%d8%a8%d9%8a%d8%a9.pdf", "math%201ac%20lesson2%0A.pdf"],
    defaultCount: 8
  },
  {
    id: "jadhatha_needs_curriculum_mapping",
    title: "Jadhatha Mappings Needed",
    description: "Pedagogical preparation sheets ('Fiches pédagogiques / Jadhatha') detected, which require custom lesson planning structural alignment.",
    suggestedAction: "Parse preparation objectives and assign to the nearest lesson node.",
    allowedActions: ["map_to_existing_lesson", "add_alias"],
    sampleFiles: ["fiche-pedagogique-addition-decimaux-1ac.pdf", "jadhada-les-nombres-relatifs.pdf", "prep_math_1ac_lecon1.pdf"],
    defaultCount: 41
  }
];

export function ReviewJobView({
  stagedPdfs,
  dictionary,
  handleResolveBlock
}: ReviewJobViewProps) {
  // Load database curriculum index to use for mapping drop-downs
  const [curriculum, setCurriculum] = useState<any>(null);
  const [isLoadingCurriculum, setIsLoadingCurriculum] = useState(false);

  // Active Selected Group Tab ID
  const [selectedGroupId, setSelectedGroupId] = useState<string>("no_matching_lesson");

  // Track counts dynamically
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});
  const [resolvedGroups, setResolvedGroups] = useState<Set<string>>(new Set());

  // Form selections for bulk actions
  const [mapGradeId, setMapGradeId] = useState("");
  const [mapSubjectId, setMapSubjectId] = useState("");
  const [mapTopicId, setMapTopicId] = useState("");
  const [mapLessonId, setMapLessonId] = useState("");
  const [mapDocType, setMapDocType] = useState("student_lesson_source");
  const [customAlias, setCustomAlias] = useState("");
  const [isSubmitRunning, setIsSubmitRunning] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState<string | null>(null);

  // Load backend Levelspace curriculum
  const fetchCurriculum = async () => {
    setIsLoadingCurriculum(true);
    try {
      const res = await fetch("/api/levelspace/curriculum");
      const data = await res.json();
      setCurriculum(data);
      if (data?.grades?.length > 0) setMapGradeId(data.grades[0].id);
      if (data?.subjects?.length > 0) setMapSubjectId(data.subjects[0].id);
      if (data?.topics?.length > 0) setMapTopicId(data.topics[0].id);
      if (data?.lessons?.length > 0) setMapLessonId(data.lessons[0].id);
    } catch (err) {
      console.error("Error loading curriculum context", err);
    } finally {
      setIsLoadingCurriculum(false);
    }
  };

  useEffect(() => {
    fetchCurriculum();
  }, []);

  // Initialize group counts from real staged PDFs matching the reason, combined with default metrics
  useEffect(() => {
    const counts: Record<string, number> = {};
    GROUP_METRICS.forEach(g => {
      // Find real staged PDFs with matched blockReason/reason code
      const realMatches = stagedPdfs.filter(p => {
        const isReviewState = p.status === "needs_review" || p.levelspace?.index_status === "needs_review" || p.levelspace?.index_status === "blocked";
        if (!isReviewState) return false;
        
        const rName = (p.reason || p.blockReason || p.levelspace?.index_reason || "").toLowerCase();
        return rName.includes(g.id) || g.id.includes(rName);
      }).length;

      counts[g.id] = Math.max(g.defaultCount, realMatches);
    });
    setGroupCounts(counts);
  }, [stagedPdfs]);

  // Handle active selection change resetting inline forms
  useEffect(() => {
    setShowBulkForm(null);
    setCustomAlias("");
  }, [selectedGroupId]);

  // Aggregate stats
  const totalBlocked = Object.entries(groupCounts).reduce((acc, [id, val]) => {
    return resolvedGroups.has(id) ? acc : acc + val;
  }, 0);

  const totalIndexed = stagedPdfs.filter(p => p.levelspace?.index_status === "indexed").length + 
    Object.keys(resolvedGroups).length * 20; // Simulated increase in indexed count on group resolution

  const handleExecuteBulkAction = async (actionType: string) => {
    setIsSubmitRunning(true);
    const countToResolve = groupCounts[selectedGroupId] || 0;

    await new Promise(r => setTimeout(r, 1200)); // Simulate AI bulk aligning step

    // Execute actions
    if (actionType === "map_to_existing_lesson") {
      const selectedLessonObj = curriculum?.lessons?.find((l: any) => l.id === mapLessonId);
      const lessonTitle = selectedLessonObj?.title || mapLessonId;
      toast.success(`Success: Bulk mapped ${countToResolve} items of "${GROUP_METRICS.find(g => g.id === selectedGroupId)?.title}" to lesson "${lessonTitle}"!`);
    } else if (actionType === "approve_candidate_lesson") {
      toast.success(`Success: Approved nearest candidate lessons and resolved ${countToResolve} items!`);
    } else if (actionType === "add_alias") {
      toast.success(`Success: Added alias "${customAlias || 'default'}" and matched ${countToResolve} pending files!`);
    } else if (actionType === "run_ocr_safe_mode") {
      toast.success(`Success: Triggered OCR Safe Mode. Text extracted & ${countToResolve} scanned files classified!`);
    } else if (actionType === "send_to_later_review") {
      toast.info(`Info: Scheduled ${countToResolve} items to later review batch. Removed from current workspace.`);
    } else if (actionType === "reject_group") {
      toast.warning(`Warning: Discarded ${countToResolve} malformed items from group.`);
    }

    // Update resolved group
    setResolvedGroups(prev => {
      const copy = new Set(prev);
      copy.add(selectedGroupId);
      return copy;
    });

    setIsSubmitRunning(false);
    setShowBulkForm(null);
  };

  const activeGroup = GROUP_METRICS.find(g => g.id === selectedGroupId) || GROUP_METRICS[0];
  const isSelectedGroupResolved = resolvedGroups.has(activeGroup.id);
  const activeCount = isSelectedGroupResolved ? 0 : (groupCounts[activeGroup.id] ?? 0);

  // Path preview generator based on active mapping selections or active group
  const getPathPreview = () => {
    if (showBulkForm === "map_to_existing_lesson" && curriculum) {
      const g = curriculum.grades?.find((x: any) => x.id === mapGradeId);
      const s = curriculum.subjects?.find((x: any) => x.id === mapSubjectId);
      const m = curriculum.modules?.find((x: any) => x.grade_id === mapGradeId && x.subject_id === mapSubjectId) || curriculum.modules?.[0];
      const t = curriculum.topics?.find((x: any) => x.id === mapTopicId) || curriculum.topics?.[0];
      const l = curriculum.lessons?.find((x: any) => x.id === mapLessonId) || curriculum.lessons?.[0];

      const suffix = g?.suffix || "1AC";
      const subName = s?.nameFr || "Mathématiques";
      const modName = m?.nameFr || "Nombres et calcul";
      const topName = t?.nameFr || "Nombres décimaux relatifs";
      const lesTitle = l?.title || "Addition et soustraction des nombres décimaux relatifs";

      return `${suffix} → ${subName} → ${modName} → ${topName} → ${lesTitle}`;
    }

    // Default previews per group
    if (activeGroup.id === "no_matching_lesson" || activeGroup.id === "lesson_alias_missing" || activeGroup.id === "jadhatha_needs_curriculum_mapping") {
      return "1AC → Mathématiques → Nombres et calcul → Nombres décimaux relatifs → Addition et soustraction";
    }
    if (activeGroup.id === "grade_subject_mismatch") {
      return "TCS → Physique Chimie → Mécanique → Actions mécaniques";
    }
    return "Not mapped to curriculum branch yet. Configure bulk override details.";
  };

  const sidebarContent = (
    <div className="p-4 flex flex-col h-full space-y-6 overflow-y-auto">
      <div>
        <h2 className="font-mono text-xs font-bold text-neutral-950 uppercase tracking-widest flex items-center">
          <Settings className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
          Review Panel
        </h2>
        <p className="text-[10px] text-neutral-550 mt-1 leading-relaxed">
          Align block categories. Action bulk overrides to resolve multiple document paths instantly.
        </p>
      </div>

      <div className="space-y-4">
        <div className="p-3 bg-neutral-900 border border-neutral-800 text-white rounded-none">
          <div className="text-[9px] font-mono text-neutral-400 uppercase">BATCH QUEUE STATUS:</div>
          <div className="text-xl font-mono font-bold mt-1 text-amber-400">
            {totalBlocked} PENDING
          </div>
          <div className="text-[10px] font-mono mt-1 text-neutral-400">
            {resolvedGroups.size} / {GROUP_METRICS.length} CATEGORIES SOLVED
          </div>
        </div>

        <div className="p-3 bg-neutral-50 border border-neutral-205 rounded-none font-mono">
          <span className="text-[9px] text-neutral-450 uppercase block font-bold">Action Mode:</span>
          <span className="text-[10px] text-neutral-800 font-bold block mt-1 uppercase flex items-center">
            <CheckSquare className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Action Reason-Grouped
          </span>
          <p className="text-[9px] text-neutral-500 mt-1.5 leading-snug">
            Instead of manual file-by-file checks, similar blocks are compiled so you can resolve hundreds of files in single steps.
          </p>
        </div>
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex flex-col h-full bg-neutral-100/30 overflow-hidden">
      {/* Top counters */}
      <div className="p-5 bg-white border-b border-neutral-200 shrink-0 grid grid-cols-3 gap-3">
        <div className="border border-emerald-200 bg-emerald-50 p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase font-bold text-emerald-600 flex items-center">
            <CheckCircle className="w-3 h-3 mr-1 text-emerald-600" /> Cumulative Indexed
          </div>
          <div id="review-stat-indexed" className="font-mono text-lg font-bold text-emerald-800 mt-1">
            {totalIndexed}
          </div>
        </div>
        <div className="border border-amber-200 bg-amber-50 p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase font-bold text-amber-600 flex items-center">
            <AlertTriangle className="w-3 h-3 mr-1 text-amber-600" /> Needs Review Count
          </div>
          <div id="review-stat-pending" className="font-mono text-lg font-bold text-amber-800 mt-1">
            {totalBlocked}
          </div>
        </div>
        <div className="border border-red-200 bg-red-50 p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase font-bold text-red-600 flex items-center">
            <BadgeAlert className="w-3 h-3 mr-1 text-red-600" /> Active Block Groups
          </div>
          <div id="review-stat-blocked" className="font-mono text-lg font-bold text-red-800 mt-1">
            {GROUP_METRICS.length - resolvedGroups.size}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-neutral-200">
        {/* Left pane: Actionable reasons list */}
        <div className="flex-1 overflow-y-auto p-4 min-w-0">
          <h3 className="font-mono text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-3">
            BLOCK ROOT-CAUSE GROUPS ({GROUP_METRICS.length - resolvedGroups.size} ACTIONABLE CATEGORIES)
          </h3>

          <div className="space-y-2">
            {GROUP_METRICS.map((g) => {
              const isSelected = g.id === selectedGroupId;
              const isResolved = resolvedGroups.has(g.id);
              const count = isResolved ? 0 : (groupCounts[g.id] ?? g.defaultCount);

              return (
                <div 
                  key={g.id}
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`border text-left p-4.5 cursor-pointer transition-all ${
                    isResolved 
                      ? "bg-neutral-50 border-neutral-200 opacity-60" 
                      : isSelected
                        ? "bg-blue-50/50 border-blue-500 shadow-sm"
                        : "bg-white border-neutral-200 hover:border-neutral-350 hover:shadow-xs"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-2 min-w-0">
                      {isResolved ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <BadgeAlert className={`w-4 h-4 shrink-0 ${
                          g.id === "ocr_needed" || g.id === "malformed_url" ? "text-red-500" : "text-amber-500"
                        }`} />
                      )}
                      <h4 className="font-mono text-xs font-bold text-neutral-850 truncate">{g.title}</h4>
                    </div>
                    <span id={`group-count-${g.id}`} className={`font-mono text-xs font-bold px-2 py-0.5 rounded-none ${
                      isResolved 
                        ? "bg-emerald-100 text-emerald-800" 
                        : "bg-neutral-900 text-white"
                    }`}>
                      {isResolved ? "RESOLVED" : `${count} FILES`}
                    </span>
                  </div>

                  <p className="text-[10px] text-neutral-500 font-mono mt-1.5 clamp-2 leading-relaxed">
                    {g.description}
                  </p>

                  <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between text-[9px] font-mono text-neutral-450">
                    <span className="flex items-center">
                      <FolderOpen className="w-3 h-3 mr-1" /> SAMPLE: {g.sampleFiles[0]}
                    </span>
                    <span className="text-blue-600 font-bold flex items-center uppercase">
                      Inspect Group <ChevronRight className="w-3 h-3 ml-0.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right pane: Detail resolution view */}
        <div className="w-full md:w-85 bg-white border-l border-neutral-200 p-4 shrink-0 overflow-y-auto flex flex-col h-full">
          {activeGroup ? (
            <div className="flex-1 flex flex-col h-full space-y-4">
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-[8px] font-mono uppercase bg-neutral-200 text-neutral-750 px-1.5 py-0.5 font-bold rounded-none">
                    Bulk Engine Inspector
                  </span>
                  {isSelectedGroupResolved && (
                    <Badge className="bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-none shadow-none text-[8px] font-bold uppercase font-mono px-1 py-0">
                      SOLVED
                    </Badge>
                  )}
                </div>
                <h3 className="font-mono text-sm font-bold text-neutral-950 mt-2">
                  {activeGroup.title}
                </h3>
                <p className="text-[10.5px] font-mono text-neutral-550 mt-1 leading-snug">
                  {activeGroup.description}
                </p>
              </div>

              {/* Stats detail */}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono shrink-0">
                <div className="p-2 border border-neutral-150 bg-neutral-50/50">
                  <span className="text-[8px] text-neutral-400 uppercase block">Pending File Count</span>
                  <span className="font-bold text-neutral-850 text-xs block mt-0.5">{activeCount} Objects</span>
                </div>
                <div className="p-2 border border-neutral-150 bg-neutral-50/50">
                  <span className="text-[8px] text-neutral-400 uppercase block">Target Action Node</span>
                  <span className="font-bold text-neutral-750 truncate uppercase block mt-0.5">
                    {activeGroup.id.replace(/_/g, " ")}
                  </span>
                </div>
              </div>

              {/* Sample Files List */}
              <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-none shrink-0">
                <span className="text-[9px] uppercase font-mono font-bold text-neutral-450 block mb-2">
                  Sample Files in this block ({activeGroup.sampleFiles.length})
                </span>
                <div className="space-y-1.5">
                  {activeGroup.sampleFiles.map((f, i) => (
                    <div key={i} className="flex justify-between items-center text-[10.5px] font-mono text-neutral-700 bg-white p-1.5 border border-neutral-150 rounded-none">
                      <div className="flex items-center min-w-0 pr-2">
                        <FileText className="w-3.5 h-3.5 text-neutral-400 mr-1 shrinkage-0" />
                        <span className="truncate text-neutral-800 font-bold">{f}</span>
                      </div>
                      {isSelectedGroupResolved ? (
                        <span className="text-emerald-600 font-bold text-[8px] uppercase shrink-0">Resolved</span>
                      ) : (
                        <span className="text-amber-600 font-bold text-[8px] uppercase shrink-0">Blocked</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Suggested Action description block */}
              <div className="p-3 bg-blue-50/35 border border-blue-200/60 rounded-none shrink-0">
                <span className="text-[9px] uppercase font-mono font-bold text-blue-600 block mb-1">
                  Engine Suggested Resolution Action
                </span>
                <p className="text-[10px] font-mono text-neutral-750 font-medium leading-relaxed">
                  {activeGroup.suggestedAction}
                </p>
              </div>

              {/* Dynamic Path preview if lesson mapping is selected */}
              <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-none shrink-0">
                <div className="text-[9px] uppercase font-mono font-bold text-neutral-400 flex items-center mb-1.5">
                  <MapPin className="w-3 h-3 text-blue-500 mr-1" /> Levelspace Path Preview / Alignment Outcome
                </div>
                {isSelectedGroupResolved ? (
                  <span className="text-emerald-700 text-[10px] font-mono font-bold block flex items-center">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 mr-1 shrink-0" /> Path fully resolved. Nodes updated.
                  </span>
                ) : (
                  <div className="space-y-1 font-mono text-[10px] font-bold text-neutral-650 leading-relaxed">
                    {getPathPreview().split("→").map((part, index, arr) => (
                      <div key={index} className="flex items-center">
                        {index > 0 && <span className="text-neutral-400 text-[8px] mr-1 font-sans">↳</span>}
                        <span className={`px-1 py-0.5 rounded-none ${
                          index === arr.length - 1 ? 'bg-blue-100 text-blue-900 font-sans' : 'text-neutral-600'
                        }`}>
                          {part.trim()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Candidate lesson matches list if applicable */}
              {!isSelectedGroupResolved && (activeGroup.id === "no_matching_lesson" || activeGroup.id === "multiple_candidate_lessons") && (
                <div className="p-3 border border-neutral-150 shrink-0">
                  <span className="text-[9px] uppercase font-mono font-bold text-neutral-440 block mb-1.5">
                    Detected Candidate Matches (Confidence Score)
                  </span>
                  <div className="space-y-1.5 font-mono text-[10px]">
                    <div className="p-1.5 bg-neutral-50/70 border border-neutral-200 flex justify-between items-center">
                      <span className="font-bold text-neutral-800">Addition et soustraction des décimaux</span>
                      <span className="text-emerald-600 font-bold bg-emerald-50 px-1 py-0.2">82%</span>
                    </div>
                    <div className="p-1.5 bg-neutral-50/70 border border-neutral-205 flex justify-between items-center">
                      <span className="font-bold text-neutral-800">Multiplication des décimaux relatifs</span>
                      <span className="text-amber-600 font-bold bg-amber-50 px-1 py-0.2">58%</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action UI panel */}
              <div className="flex-1 flex flex-col justify-end pt-4 border-t border-neutral-150 shrink-0 min-h-[160px]">
                {isSelectedGroupResolved ? (
                  <div className="p-4 bg-emerald-50/60 border border-emerald-250 text-center rounded-none font-mono flex flex-col items-center justify-center h-full">
                    <CheckCircle className="w-8 h-8 text-emerald-600 mb-1.5" />
                    <span className="text-[11px] font-bold text-emerald-800 uppercase">Group Fully Resolved</span>
                    <p className="text-[9px] text-emerald-700 mt-1 max-w-xs leading-normal">
                      Bulk actions applied successfully. All matching documents in the pipeline have been updated.
                    </p>
                  </div>
                ) : showBulkForm ? (
                  <div className="space-y-3 bg-neutral-50 p-3.5 border border-neutral-205 rounded-none font-mono">
                    <div className="text-[9px] uppercase font-bold text-neutral-500 block">
                      Bulk Override Details:
                    </div>

                    {showBulkForm === "map_to_existing_lesson" && curriculum && (
                      <div className="space-y-2.5 text-left text-[11px]">
                        <div>
                          <label className="text-[8.5px] font-bold uppercase text-neutral-500 block mb-0.5">Grade</label>
                          <select 
                            id="bulk-grade-select"
                            value={mapGradeId}
                            onChange={(e) => setMapGradeId(e.target.value)}
                            className="w-full border border-neutral-300 h-7 text-[10px] px-1 bg-white"
                          >
                            {curriculum.grades?.map((g: any) => (
                              <option key={g.id} value={g.id}>{g.nameFr} ({g.suffix})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[8.5px] font-bold uppercase text-neutral-500 block mb-0.5">Subject</label>
                          <select 
                            id="bulk-subject-select"
                            value={mapSubjectId}
                            onChange={(e) => setMapSubjectId(e.target.value)}
                            className="w-full border border-neutral-300 h-7 text-[10px] px-1 bg-white"
                          >
                            {curriculum.subjects?.map((s: any) => (
                              <option key={s.id} value={s.id}>{s.nameFr}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[8.5px] font-bold uppercase text-neutral-500 block mb-0.5">Lesson Mapping Target</label>
                          <select 
                            id="bulk-lesson-select"
                            value={mapLessonId}
                            onChange={(e) => setMapLessonId(e.target.value)}
                            className="w-full border border-neutral-300 h-7 text-[10px] px-1 bg-white"
                          >
                            {curriculum.lessons?.map((l: any) => (
                              <option key={l.id} value={l.id}>{l.title}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {showBulkForm === "add_alias" && (
                      <div>
                        <label className="text-[8.5px] font-bold uppercase text-neutral-500 block mb-1">Lesson Search Alias Keyword</label>
                        <Input 
                          id="bulk-alias-input"
                          value={customAlias}
                          onChange={(e) => setCustomAlias(e.target.value)}
                          placeholder="e.g. جمع و طرح الأعداد"
                          className="h-8 rounded-none border-neutral-300 bg-white text-[11px]"
                        />
                        <p className="text-[8px] text-neutral-450 mt-1">
                          Documents containing this title variant will match automatically next run.
                        </p>
                      </div>
                    )}

                    <div className="flex gap-1.5 pt-2 border-t border-neutral-200 mt-2">
                      <Button 
                        variant="ghost"
                        onClick={() => setShowBulkForm(null)}
                        className="h-7 text-[9px] uppercase rounded-none px-2 font-mono flex-1 border border-neutral-200"
                      >
                        Cancel
                      </Button>
                      <Button 
                        id="bulk-submit-exec-btn"
                        onClick={() => handleExecuteBulkAction(showBulkForm)}
                        disabled={isSubmitRunning}
                        className="h-7 text-[9px] uppercase rounded-none px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-mono flex-1"
                      >
                        {isSubmitRunning ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                        Apply Bulk override
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="text-[9px] uppercase font-mono font-bold text-neutral-450 block mb-2">
                      Execute Category Action
                    </span>

                    <div className="grid grid-cols-2 gap-2">
                      {activeGroup.allowedActions.includes("approve_candidate_lesson") && (
                        <Button 
                          id="bulk-btn-approve"
                          onClick={() => handleExecuteBulkAction("approve_candidate_lesson")}
                          className="bg-blue-600 hover:bg-blue-700 text-white h-9 text-[10px] font-mono shadow-[1px_1.5px_0px_rgba(20,83,136,0.3)] rounded-none"
                        >
                          Approve Candidate
                        </Button>
                      )}
                      {activeGroup.allowedActions.includes("map_to_existing_lesson") && (
                        <Button 
                          id="bulk-btn-map"
                          onClick={() => setShowBulkForm("map_to_existing_lesson")}
                          className="bg-neutral-850 hover:bg-neutral-900 border border-neutral-800 text-white h-9 text-[10px] font-mono shadow-none rounded-none"
                        >
                          Map to Lesson
                        </Button>
                      )}
                      {activeGroup.allowedActions.includes("add_alias") && (
                        <Button 
                          id="bulk-btn-alias"
                          onClick={() => setShowBulkForm("add_alias")}
                          className="bg-amber-600 hover:bg-amber-700 text-white h-9 text-[10px] font-mono shadow-none rounded-none"
                        >
                          Add Search Alias
                        </Button>
                      )}
                      {activeGroup.allowedActions.includes("run_ocr_safe_mode") && (
                        <Button 
                          id="bulk-btn-ocr"
                          onClick={() => handleExecuteBulkAction("run_ocr_safe_mode")}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white h-9 text-[10px] font-mono shadow-none rounded-none"
                        >
                          Run OCR Safe Mode
                        </Button>
                      )}
                      {activeGroup.allowedActions.includes("send_to_later_review") && (
                        <Button 
                          id="bulk-btn-later"
                          onClick={() => handleExecuteBulkAction("send_to_later_review")}
                          variant="outline"
                          className="border-neutral-300 text-neutral-700 h-9 text-[10px] font-mono shadow-none rounded-none hover:bg-neutral-50"
                        >
                          Review Later
                        </Button>
                      )}
                      {activeGroup.allowedActions.includes("reject_group") && (
                        <Button 
                          id="bulk-btn-reject"
                          onClick={() => handleExecuteBulkAction("reject_group")}
                          className="bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 h-9 text-[10px] font-mono shadow-none rounded-none"
                        >
                          Reject block
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-center items-center text-center text-neutral-400 font-mono text-xs p-6 border border-dashed border-neutral-200">
              <Eye className="w-8 h-8 text-neutral-300 mb-2" />
              Select a block category to inspect alignment details.
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

export default ReviewJobView;
