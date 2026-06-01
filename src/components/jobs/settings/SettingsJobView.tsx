import React, { useState } from "react";
import { 
  Settings, FolderArchive, Loader2, Shield, ShieldCheck, Sparkles, Sliders, Check, Plus, Database, Cpu, HelpCircle, Save
} from "lucide-react";
import { Dictionary } from "../../../types/dictionary";
import { JobWorkspaceLayout } from "../../layout/JobWorkspaceLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface SettingsJobViewProps {
  dictionary: Dictionary;
  activeDictSubTab: "grades" | "subjects" | "topics" | "docs";
  setActiveDictSubTab: (tab: "grades" | "subjects" | "topics" | "docs") => void;

  ocrBatchMode: "Disabled" | "Safe" | "Balanced" | "Fast";
  handleApplyOcrModePreset: (preset: "safe" | "balanced" | "fast") => Promise<void>;

  newGrade: any;
  setNewGrade: React.Dispatch<React.SetStateAction<any>>;
  newSubject: any;
  setNewSubject: React.Dispatch<React.SetStateAction<any>>;
  newTopic: any;
  setNewTopic: React.Dispatch<React.SetStateAction<any>>;

  handleAddGrade: () => void;
  handleAddSubject: () => void;
  handleAddTopic: () => void;
  handleCommitDictionaryToDb: () => Promise<void>;
  savingDictionary: boolean;
}

export function SettingsJobView({
  dictionary,
  activeDictSubTab,
  setActiveDictSubTab,
  ocrBatchMode,
  handleApplyOcrModePreset,
  newGrade,
  setNewGrade,
  newSubject,
  setNewSubject,
  newTopic,
  setNewTopic,
  handleAddGrade,
  handleAddSubject,
  handleAddTopic,
  handleCommitDictionaryToDb,
  savingDictionary
}: SettingsJobViewProps) {
  
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [ocrConfigLoading, setOcrConfigLoading] = useState(false);

  const handleOcrPresetChange = async (mode: "safe" | "balanced" | "fast") => {
    setOcrConfigLoading(true);
    try {
      await handleApplyOcrModePreset(mode);
      toast.success(`OCR policy updated to: ${mode.toUpperCase()}`);
    } catch (err) {
      toast.error("Failed to update OCR preset");
    } finally {
      setOcrConfigLoading(false);
    }
  };

  const sidebarContent = (
    <div className="p-4 flex flex-col h-full space-y-6">
      <div>
        <h2 className="font-mono text-xs font-bold text-neutral-900 uppercase tracking-widest flex items-center">
          <Settings className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
          Settings Panel
        </h2>
        <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
          Configure centralized systems parameters: optical recognition quota allocations and master dictionary classifications.
        </p>
      </div>

      <div className="space-y-4">
        {/* Admin Authorization Token toggle to enforce Settings/Admin only constraint */}
        <div className={`p-3.5 border font-mono text-[10.5px] transition-all duration-300 ${
          isAdminMode ? 'bg-emerald-50/50 border-emerald-300' : 'bg-amber-50/35 border-amber-200'
        }`}>
          <div className="flex items-center gap-1.5 mb-2 font-bold uppercase">
            {isAdminMode ? (
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            ) : (
              <Shield className="w-4 h-4 text-amber-600" />
            )}
            <span>Admin Control Status</span>
          </div>
          <p className="text-[9.5px] text-neutral-500 mb-3 leading-snug">
            {isAdminMode 
              ? "Dictionary write access is unlocked. Modifications compile to the active DB layout." 
              : "Reference lists are running in viewer mode. Activate Admin Mode to build custom rules."}
          </p>
          <Button
            id="settings-admin-mode-toggle"
            variant="outline"
            onClick={() => {
              setIsAdminMode(!isAdminMode);
              toast.info(isAdminMode ? "Admin write restrictions restored." : "Admin control authorization activated.");
            }}
            className={`w-full h-8 text-[10px] rounded-none uppercase font-mono ${
              isAdminMode 
                ? 'border-emerald-600 hover:bg-emerald-50 text-emerald-700' 
                : 'border-neutral-400 hover:bg-neutral-50 text-neutral-800'
            }`}
          >
            {isAdminMode ? "Lock Write Access" : "Activate Admin Mode"}
          </Button>
        </div>

        {/* OCR Policy summary status */}
        <div className="p-3.5 border border-neutral-200 bg-neutral-50 font-mono text-[10px]">
          <span className="uppercase font-bold text-neutral-450 block">Active OCR State:</span>
          <span className="block text-neutral-900 font-extrabold mt-1 text-xs uppercase flex items-center">
            <Cpu className="w-3.5 h-3.5 mr-1 text-blue-600" /> {ocrBatchMode}
          </span>
          <p className="text-[9px] text-neutral-450 leading-relaxed mt-1.5">
            Automatic scanned document processing is governed by this global setting inside the active Workspace pipeline.
          </p>
        </div>
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex flex-col h-full bg-neutral-50 p-6 overflow-y-auto space-y-8">
      {/* SECTION 1: Advanced OCR Policy */}
      <div className="bg-white border border-neutral-200 p-6 shadow-sm">
        <h3 className="font-mono text-sm font-bold text-neutral-900 uppercase flex items-center gap-2 mb-2">
          <Cpu className="w-4.5 h-4.5 text-blue-600" />
          Advanced OCR Configuration / Policy Selectors
        </h3>
        <p className="text-xs text-neutral-500 mb-6 max-w-2xl leading-relaxed">
          Manage how the pipeline responds to illegible, scanned, or image-only documents. System safeguards will override OCR logic based on raw textual score performance thresholds.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { id: "disabled", title: "Disabled", mode: "Disabled", desc: "Turns off OCR logic. Scapes with low extraction confidence are flagged instantly under Needs Review." },
            { id: "safe", title: "Safe Mode", mode: "Safe", desc: "Serial API batches with token flow limits. Optimal safety parameters to prevent Google rate limits." },
            { id: "balanced", title: "Balanced", mode: "Balanced", desc: "Default optimal config. Moderate resource parallelism for balanced system completion speed." },
            { id: "fast", title: "Fast / Parallel", mode: "Fast", desc: "Fully concurrent threads, optimized for extremely massive workloads with high corporate API quotas." }
          ].map(preset => {
            const isActive = ocrBatchMode.toLowerCase() === preset.id;
            return (
              <div 
                key={preset.id}
                onClick={() => handleOcrPresetChange(preset.id as any)}
                className={`border p-4 cursor-pointer transition-all flex flex-col justify-between ${
                  isActive 
                    ? "bg-blue-50/40 border-blue-500 shadow-sm" 
                    : "bg-white border-neutral-200 hover:border-neutral-300"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs font-bold text-neutral-800">{preset.title}</span>
                    {isActive && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </div>
                  <p className="text-[10.5px] text-neutral-500 font-mono leading-relaxed">{preset.desc}</p>
                </div>
                <div className="mt-4 pt-2.5 border-t border-neutral-100 text-[9px] font-mono text-neutral-400">
                  {preset.id === "disabled" ? "0ms Overhead" : (preset.id === "safe" ? "Single Thread" : "Parallel Threads")}
                </div>
              </div>
            );
          })}
        </div>

        {/* OCR thresholds debug dashboard */}
        <div className="mt-5 p-4 bg-neutral-50 border border-neutral-200 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div>
            <span className="text-[9px] text-neutral-505 uppercase block">Trigger Margin</span>
            <span className="font-bold text-neutral-800 mt-0.5 block">&lt; 15% Text Coverage</span>
          </div>
          <div>
            <span className="text-[9px] text-neutral-505 uppercase block">Safety Restarts</span>
            <span className="font-bold text-neutral-800 mt-0.5 block">Retry with OCR Safe mode</span>
          </div>
          <div>
            <span className="text-[9px] text-neutral-505 uppercase block">Model Grounding</span>
            <span className="font-bold text-neutral-800 mt-0.5 block">Gemini 2.5 Multi-modal Vision</span>
          </div>
        </div>
      </div>

      {/* SECTION 2: Master Dictionary Editor (Locked for Admin Mode only) */}
      <div className="bg-white border border-neutral-200 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-neutral-200 pb-4 mb-5 gap-3">
          <div>
            <h3 className="font-mono text-sm font-bold text-neutral-900 uppercase flex items-center gap-2">
              <Database className="w-4.5 h-4.5 text-neutral-800" />
              Master Classification Dictionary
            </h3>
            <p className="text-[11.5px] text-neutral-500 leading-snug mt-1">
              Configure system search parameters, keyword matches, and unique prefixes for curriculum taxonomy alignment.
            </p>
          </div>
          {isAdminMode && (
            <Button
              id="settings-commit-db-btn"
              disabled={savingDictionary}
              onClick={handleCommitDictionaryToDb}
              className="bg-neutral-900 hover:bg-neutral-800 text-white rounded-none font-mono text-xs uppercase h-9 flex items-center shrink-0"
            >
              {savingDictionary ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Commit to SCARPE DB
                </>
              )}
            </Button>
          )}
        </div>

        {/* Navigation subtabs for dictionary entities */}
        <div className="flex border border-neutral-200 bg-neutral-50 text-[10px] font-mono font-bold uppercase text-neutral-500">
          {(["grades", "subjects", "topics", "docs"] as const).map(tab => (
            <button 
              key={tab}
              id={`settings-dict-tab-${tab}`}
              onClick={() => setActiveDictSubTab(tab)} 
              className={`px-4 py-3 border-r border-neutral-200 last:border-r-0 ${
                activeDictSubTab === tab 
                  ? 'bg-white text-neutral-900 font-extrabold shadow-[inset_0_-2px_0_0_#171717]' 
                  : 'hover:bg-neutral-100'
              }`}
            >
              {tab === "docs" ? "Document Types" : tab}
            </button>
          ))}
        </div>

        {/* Locked Overlay or Active Editing Section */}
        {!isAdminMode ? (
          <div className="p-8 border-x border-b border-neutral-200 bg-neutral-50/50 flex flex-col items-center justify-center text-center">
            <Shield className="w-12 h-12 mb-3 text-amber-500 opacity-80" />
            <h4 className="font-mono text-xs font-bold uppercase text-neutral-800">Admin Clearance Mandatory</h4>
            <p className="text-xs text-neutral-500 mt-1 max-w-md leading-relaxed">
              Modifying the active database dictionary layout is locked. Click "Activate Admin Mode" in the sidebar to add new grades, subjects, topics, or modify terminology filters.
            </p>
          </div>
        ) : (
          <div className="p-5 border-x border-b border-neutral-200 bg-white space-y-6">
            {/* 1. Grade Tab Form */}
            {activeDictSubTab === "grades" && (
              <div className="space-y-4">
                <h4 className="font-mono text-xs font-bold uppercase border-b pb-1">Add New System Grade Target</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Input 
                    id="add-grade-id"
                    placeholder="ID (e.g., 2ac)" 
                    value={newGrade.id}
                    onChange={e => setNewGrade({ ...newGrade, id: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                  <Input 
                    id="add-grade-suffix"
                    placeholder="Suffix / Prefix (e.g., 2AC)" 
                    value={newGrade.suffix}
                    onChange={e => setNewGrade({ ...newGrade, suffix: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                  <Input 
                    id="add-grade-name-fr"
                    placeholder="French Label (e.g., 2ème Année)" 
                    value={newGrade.nameFr || ""}
                    onChange={e => setNewGrade({ ...newGrade, nameFr: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                  <Input 
                    id="add-grade-name-ar"
                    placeholder="Arabic Label (e.g., السنة الثانية)" 
                    value={newGrade.nameAr}
                    onChange={e => setNewGrade({ ...newGrade, nameAr: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                  <div className="md:col-span-3">
                    <Input 
                      id="add-grade-keywords"
                      placeholder="Search Keywords (comma-separated, e.g. 2eme annee college, 2AC, اعدادي ثانية)" 
                      value={newGrade.keywords}
                      onChange={e => setNewGrade({ ...newGrade, keywords: e.target.value })}
                      className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                    />
                  </div>
                  <Button 
                    id="btn-add-grade"
                    onClick={handleAddGrade}
                    className="h-8 rounded-none bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-[11px] uppercase w-full"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Append Grade
                  </Button>
                </div>
              </div>
            )}

            {/* 2. Subject Tab Form */}
            {activeDictSubTab === "subjects" && (
              <div className="space-y-4">
                <h4 className="font-mono text-xs font-bold uppercase border-b pb-1">Add New System Subject Target</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Input 
                    id="add-subject-id"
                    placeholder="ID (e.g., phys_chimie)" 
                    value={newSubject.id}
                    onChange={e => setNewSubject({ ...newSubject, id: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                  <Input 
                    id="add-subject-suffix"
                    placeholder="Short Prefix (e.g., PC)" 
                    value={newSubject.suffix}
                    onChange={e => setNewSubject({ ...newSubject, suffix: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                  <Input 
                    id="add-subject-name-fr"
                    placeholder="French Label (e.g., Physique)" 
                    value={newSubject.nameFr || ""}
                    onChange={e => setNewSubject({ ...newSubject, nameFr: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                  <Input 
                    id="add-subject-name-ar"
                    placeholder="Arabic Label (e.g., فيزياء)" 
                    value={newSubject.nameAr}
                    onChange={e => setNewSubject({ ...newSubject, nameAr: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                  <div className="md:col-span-3">
                    <Input 
                      id="add-subject-keywords"
                      placeholder="Detection Keywords (comma-separated, e.g. physique, chimie, physics, pc, sciences)" 
                      value={newSubject.keywords}
                      onChange={e => setNewSubject({ ...newSubject, keywords: e.target.value })}
                      className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                    />
                  </div>
                  <Button 
                    id="btn-add-subject"
                    onClick={handleAddSubject}
                    className="h-8 rounded-none bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-[11px] uppercase w-full"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Append Subject
                  </Button>
                </div>
              </div>
            )}

            {/* 3. Topic Tab Form */}
            {activeDictSubTab === "topics" && (
              <div className="space-y-4">
                <h4 className="font-mono text-xs font-bold uppercase border-b pb-1">Add New System Topic Unit</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Input 
                    id="add-topic-id"
                    placeholder="ID (e.g., decimaux_relatifs)" 
                    value={newTopic.id}
                    onChange={e => setNewTopic({ ...newTopic, id: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                  <select
                    id="add-topic-subject"
                    value={newTopic.subjectId}
                    onChange={e => setNewTopic({ ...newTopic, subjectId: e.target.value })}
                    className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white font-sans focus:border-neutral-900 focus:outline-none"
                  >
                    <option value="">-- Choose Subject Ownership --</option>
                    {dictionary.subjects?.map(s => (
                      <option key={s.id} value={s.id}>{s.nameFr} ({s.id})</option>
                    ))}
                  </select>
                  <Input 
                    id="add-topic-name-fr"
                    placeholder="French Label (e.g., Fractions)" 
                    value={newTopic.nameFr || ""}
                    onChange={e => setNewTopic({ ...newTopic, nameFr: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                  <Input 
                    id="add-topic-name-ar"
                    placeholder="Arabic Label (e.g., الأعداد الكسرية)" 
                    value={newTopic.nameAr}
                    onChange={e => setNewTopic({ ...newTopic, nameAr: e.target.value })}
                    className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                  <div className="md:col-span-3">
                    <Input 
                      id="add-topic-keywords"
                      placeholder="Heuristic keywords (comma-separated, e.g. fractions, devoirs frac, addition decimaux)" 
                      value={newTopic.keywords}
                      onChange={e => setNewTopic({ ...newTopic, keywords: e.target.value })}
                      className="h-8 rounded-none text-[11px] font-mono border-neutral-300"
                    />
                  </div>
                  <Button 
                    id="btn-add-topic"
                    onClick={handleAddTopic}
                    className="h-8 rounded-none bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-[11px] uppercase w-full"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Append Topic
                  </Button>
                </div>
              </div>
            )}

            {/* 4. Document Types List */}
            {activeDictSubTab === "docs" && (
              <div className="text-left py-4 text-xs font-mono text-neutral-500">
                <h4 className="font-mono text-xs font-bold uppercase border-b pb-1 text-neutral-700 mb-2">Immutable Global Roles</h4>
                <p className="mb-4">System classification maps only to these recognized document roles. Modifications require master backend updates.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div className="p-2 border border-neutral-200 bg-neutral-50 select-all font-bold">cours [student_lesson_source]</div>
                  <div className="p-2 border border-neutral-200 bg-neutral-50 select-all font-bold">exercice [practice_source]</div>
                  <div className="p-2 border border-neutral-200 bg-neutral-50 select-all font-bold">correction [solution_source]</div>
                  <div className="p-2 border border-neutral-200 bg-neutral-50 select-all font-bold">examen [assessment_source]</div>
                  <div className="p-2 border border-neutral-200 bg-neutral-50 select-all font-bold">jadhatha [pedagogical_planning_source]</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Existing records directory list (tactile viewer) */}
        <div className="mt-6 border border-neutral-200">
          <div className="bg-neutral-50 p-2.5 border-b border-neutral-200 text-[10px] font-mono font-bold text-neutral-550 uppercase">
            Active System Classifications Repository Directory ({
              activeDictSubTab === "grades" ? (dictionary?.grades?.length || 0) :
              activeDictSubTab === "subjects" ? (dictionary?.subjects?.length || 0) :
              activeDictSubTab === "topics" ? (dictionary?.topics?.length || 0) : 5
            } active rules)
          </div>
          <div className="divide-y divide-neutral-150 max-h-75 overflow-y-auto bg-white">
            {activeDictSubTab === "grades" && dictionary?.grades?.map(g => (
              <div key={g.id} className="p-3 text-xs font-mono flex items-center justify-between hover:bg-neutral-50">
                <div>
                  <span className="font-bold text-neutral-800">{g.id.toUpperCase()}</span>
                  <span className="text-neutral-500 ml-1.5">({g.nameFr || "No translation"} — {g.nameAr})</span>
                </div>
                <Badge variant="outline" className="rounded-none text-[9.5px] border-neutral-200 uppercase bg-neutral-50">
                  Suffix: {g.suffix}
                </Badge>
              </div>
            ))}
            {activeDictSubTab === "subjects" && dictionary?.subjects?.map(s => (
              <div key={s.id} className="p-3 text-xs font-mono flex items-center justify-between hover:bg-neutral-50">
                <div>
                  <span className="font-bold text-neutral-800">{s.id.toUpperCase()}</span>
                  <span className="text-neutral-500 ml-1.5">({s.nameFr || s.nameFr} — {s.nameAr})</span>
                </div>
                <Badge variant="outline" className="rounded-none text-[9.5px] border-neutral-200 uppercase bg-neutral-50">
                  Prefix: {s.suffix}
                </Badge>
              </div>
            ))}
            {activeDictSubTab === "topics" && dictionary?.topics?.map(t => (
              <div key={t.id} className="p-3 text-xs font-mono flex items-center justify-between hover:bg-neutral-50">
                <div>
                  <span className="font-bold text-neutral-800">{t.id.toUpperCase()}</span>
                  <span className="text-neutral-500 ml-1.5">({t.nameFr || "None"} — {t.nameAr})</span>
                </div>
                <Badge variant="secondary" className="rounded-none text-[9.5px] shadow-none uppercase font-bold text-neutral-600">
                  Subject ID: {t.subjectId || "None"}
                </Badge>
              </div>
            ))}
            {activeDictSubTab === "docs" && (
              <div className="p-4 text-center text-neutral-400 font-mono text-xs">
                 Document roles list is generated directly from production schemas.
              </div>
            )}
          </div>
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

export default SettingsJobView;
