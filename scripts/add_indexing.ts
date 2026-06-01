import * as fs from 'fs';

const content = fs.readFileSync('src/WorkstationDashboard.tsx', 'utf-8');

let newSidebar = content.replace(
  /      case "review":\n        return \(\n          <div className="p-4 flex flex-col h-full space-y-6">/,
  `      case "indexing":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Levelspace Indexing</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Map generic classified PDFs to the precise curriculum path in Levelspace.</p>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Index Confidence Threshold</label>
                <select className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white">
                  <option value="high">High (>= 85%)</option>
                  <option value="medium">Medium (>= 60%)</option>
                  <option value="all">Map All (Review Later)</option>
                </select>
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-neutral-200">
               <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(37,99,235,0.5)]">
                 <Play className="w-4 h-4 mr-2" /> Run Indexing Job
               </Button>
            </div>
          </div>
        );
      case "review":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">`
);

let newMain = newSidebar.replace(
  /      case "review":\n        return \(\n          <div className="flex flex-col h-full bg-neutral-50">/,
  `      case "indexing":
        return (
          <div className="flex flex-col h-full">
            {/* Top Summaries */}
            <div className="p-6 bg-white border-b border-neutral-200 shrink-0 grid grid-cols-4 gap-4">
              <div className="border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-[9px] uppercase font-bold text-neutral-500 mb-1">To Index</div>
                <div className="font-mono text-xl font-bold text-neutral-800">{stagedPdfs.filter(p => !p.levelspace?.index_status && p.status === "classified").length}</div>
              </div>
              <div className="border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[9px] uppercase font-bold text-emerald-600 mb-1">Indexed</div>
                <div className="font-mono text-xl font-bold text-emerald-800">{stagedPdfs.filter(p => p.levelspace?.index_status === "indexed").length}</div>
              </div>
              <div className="border border-amber-200 bg-amber-50 p-3">
                <div className="text-[9px] uppercase font-bold text-amber-600 mb-1">Needs Review</div>
                <div className="font-mono text-xl font-bold text-amber-800">{stagedPdfs.filter(p => p.levelspace?.index_status === "needs_review").length}</div>
              </div>
              <div className="border border-red-200 bg-red-50 p-3">
                <div className="text-[9px] uppercase font-bold text-red-600 mb-1">Blocked</div>
                <div className="font-mono text-xl font-bold text-red-800">{stagedPdfs.filter(p => p.levelspace?.index_status === "blocked").length}</div>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-6 bg-neutral-50">
                <div className="border border-neutral-200 bg-white">
                  <div className="divide-y divide-neutral-100 table w-full">
                     <div className="table-row bg-neutral-50 text-[9px] font-mono font-bold uppercase text-neutral-500 border-b border-neutral-200">
                        <div className="table-cell p-3 w-10"></div>
                        <div className="table-cell p-3 w-48">Filename</div>
                        <div className="table-cell p-3 max-w-xs">Curriculum Path</div>
                        <div className="table-cell p-3">Role</div>
                        <div className="table-cell p-3">Role Status</div>
                        <div className="table-cell p-3">Status</div>
                     </div>
                     {stagedPdfs.filter(p => p.levelspace).map((item, idx) => (
                        <div key={item.url} className="table-row text-xs font-mono border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
                          <div className="table-cell p-3 text-neutral-400 align-middle">
                            <input type="checkbox" className="rounded-none border-neutral-300" />
                          </div>
                          <div className="table-cell p-3 font-bold text-neutral-800 truncate max-w-xs align-middle" title={item.originalName}>{item.originalName}</div>
                          <div className="table-cell p-3 text-neutral-500 align-middle">
                            <div className="truncate max-w-xs text-[10px]" title={item.levelspace?.curriculum_path || ""}>
                              {item.levelspace?.curriculum_path ? (
                                <span className="text-neutral-700">{item.levelspace.curriculum_path}</span>
                              ) : (
                                <span className="text-neutral-400 italic">Not mapped</span>
                              )}
                            </div>
                          </div>
                          <div className="table-cell p-3 align-middle text-[10px]">{item.levelspace?.document_role || "—"}</div>
                          <div className="table-cell p-3 align-middle">
                             <div className="flex gap-1" title="visible: S(tudent) T(eacher) A(dmin) AI">
                               {item.levelspace?.student_visible ? <Badge className="px-1 py-0 text-[8px] rounded-none bg-blue-100 text-blue-800 shadow-none hover:bg-blue-100">S</Badge> : null}
                               {item.levelspace?.teacher_visible ? <Badge className="px-1 py-0 text-[8px] rounded-none bg-emerald-100 text-emerald-800 shadow-none hover:bg-emerald-100">T</Badge> : null}
                               {item.levelspace?.admin_visible ? <Badge className="px-1 py-0 text-[8px] rounded-none bg-amber-100 text-amber-800 shadow-none hover:bg-amber-100">A</Badge> : null}
                               {item.levelspace?.ai_visible ? <Badge className="px-1 py-0 text-[8px] rounded-none bg-purple-100 text-purple-800 shadow-none hover:bg-purple-100">AI</Badge> : null}
                             </div>
                          </div>
                          <div className="table-cell p-3 align-middle font-bold">
                             <span className={\`uppercase \${item.levelspace?.index_status === 'indexed' ? 'text-emerald-600' : item.levelspace?.index_status === 'needs_review' ? 'text-amber-600' : item.levelspace?.index_status === 'blocked' ? 'text-red-600' : 'text-neutral-500'}\`}>
                               {item.levelspace?.index_status || "PENDING"}
                             </span>
                          </div>
                        </div>
                     ))}
                     {stagedPdfs.filter(p => p.levelspace).length === 0 && (
                        <div className="table-row">
                          <div className="table-cell p-8 text-center text-neutral-400 col-span-6">
                            No files have been indexed yet. Run the Indexing Job.
                          </div>
                        </div>
                     )}
                  </div>
                </div>
            </div>
          </div>
        );
      case "review":
        return (
          <div className="flex flex-col h-full bg-neutral-50">`
);

fs.writeFileSync('src/WorkstationDashboard.tsx', newMain);
