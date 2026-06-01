import * as fs from 'fs';

const content = fs.readFileSync('src/WorkstationDashboard.tsx', 'utf-8');

const returnIndex = content.indexOf('  return (\n    <div className="w-full space-y-4">');
if (returnIndex === -1) {
  console.error("Could not find start of return");
  process.exit(1);
}

const head = content.substring(0, returnIndex);

const newRender = `  // ===== NEW LAYOUT SUB-RENDERS =====

  const renderSidebar = () => {
    switch (activeJobView) {
      case "intake":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Intake Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Discover and crawl PDFs from educational web sources. Fetches links into the staging area.</p>
            </div>
            
            <div className="space-y-4">
              {/* Method Switch */}
              <div className="grid grid-cols-2 gap-1 bg-neutral-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("crawl")}
                  className={\`text-[10px] uppercase py-1.5 text-center font-bold \${activeTab === "crawl" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}\`}
                >
                  Crawler
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("discover")}
                  className={\`text-[10px] uppercase py-1.5 text-center font-bold \${activeTab === "discover" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}\`}
                >
                  Paste URLs
                </button>
              </div>

              {activeTab === "crawl" ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Start URL</label>
                    <Input 
                      value={crawlUrl}
                      onChange={e => setCrawlUrl(e.target.value)}
                      placeholder="https://..."
                      className="rounded-none border-[#141414] text-[11px] h-8 bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Depth</label>
                      <select 
                        value={maxDepth}
                        onChange={e => setMaxDepth(Number(e.target.value))}
                        className="w-full border border-[#141414] h-8 text-xs font-mono px-2 rounded-none bg-white"
                      >
                        <option value={1}>1 (Current)</option>
                        <option value={2}>2 (Standard)</option>
                        <option value={3}>3 (Deep)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Max Pages</label>
                      <Input 
                        type="number" value={maxPages} onChange={e => setMaxPages(Number(e.target.value))}
                        className="rounded-none border-[#141414] h-8 text-[11px]" min="1"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-1 flex flex-col h-32">
                  <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Paste Links (One per line)</label>
                  <textarea
                    value={discoverPastedUrls}
                    onChange={e => setDiscoverPastedUrls(e.target.value)}
                    className="w-full flex-1 border border-[#141414] p-2 text-[10px] font-mono bg-white resize-none"
                    placeholder="https://..."
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Topic Filters (csv)</label>
                <Input 
                  value={topicFilter}
                  onChange={e => setTopicFilter(e.target.value)}
                  placeholder="e.g. math, 1ac"
                  className="rounded-none border-[#141414] text-[11px] h-8 bg-white"
                />
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-neutral-200">
              <Button 
                onClick={activeTab === "crawl" ? handleCrawlPdfs : handleDiscoverPdfs}
                disabled={isCrawling || isDiscovering}
                className="w-full bg-[#141414] hover:bg-[#141414]/90 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
              >
                {(isCrawling || isDiscovering) ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Scanning...</> : <><Search className="w-4 h-4 mr-2" /> Scan Source</>}
              </Button>
            </div>
          </div>
        );
      case "processing":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Processing Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Run batched AI pipelines on staged files. Extracts texts, assigns classifications, and isolates problematic documents.</p>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Grade Scope</label>
                <select value={scopeGradeId} onChange={e => setScopeGradeId(e.target.value)} className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0">
                  <option value="all">ANY GRADE [ALL]</option>
                  {dictionary.grades.map(g => <option key={g.id} value={g.id}>{g.nameFr} ({g.nameAr})</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Subject Scope</label>
                <select value={scopeSubjectId} onChange={e => setScopeSubjectId(e.target.value)} className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0">
                  <option value="all">ANY SUBJECT [ALL]</option>
                  {dictionary.subjects.map(s => <option key={s.id} value={s.id}>{s.nameFr}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">File Status Scope</label>
                <select value={scopeStatus} onChange={e => setScopeStatus(e.target.value)} className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0">
                  <option value="all">ALL STAGED</option>
                  <option value="pending">PENDING ONLY</option>
                  <option value="needs_review">NEEDS REVIEW (RETRY)</option>
                  <option value="ocr_needed">NEEDS OCR ONLY</option>
                  <option value="failed">FAILED ONLY</option>
                </select>
              </div>
              
              <div className="border border-neutral-200 bg-neutral-50 p-3 mt-4">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block mb-2 flex items-center gap-1.5"><Settings className="w-3 h-3"/> OCR Policy</label>
                <select value={ocrBatchMode} onChange={e => handleApplyOcrModePreset(e.target.value.toLowerCase() as any).catch(console.error)} className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414]">
                  <option value="Disabled">Disabled (Fastest)</option>
                  <option value="Safe">Safe Mode (Slow, API safe)</option>
                  <option value="Balanced">Balanced</option>
                  <option value="Fast">Fast (Parallel, High Quota)</option>
                </select>
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-neutral-200 space-y-3">
              {!isBatchJobRunning ? (
                 <Button onClick={activeBatchJob ? startBatchJob : createBatchJob} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(37,99,235,0.5)]">
                   <Play className="w-4 h-4 mr-2" /> {activeBatchJob ? "Resume Job" : "Run Batch Job"}
                 </Button>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={pauseBatchJob} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <Pause className="w-4 h-4 mr-1" /> Pause
                  </Button>
                  <Button onClick={stopBatchJob} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <Square className="w-4 h-4 mr-1" /> Stop
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      case "review":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Review Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Resolve uncertainties and blockages from the AI pipeline. Approve or correct metadata mappings manually.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Block Reason</label>
                <select className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white">
                  <option value="all">ALL BLOCKS</option>
                  <option value="no_grade_match">Missing Grade</option>
                  <option value="no_subject_match">Missing Subject</option>
                  <option value="low_confidence">Low Confidence</option>
                </select>
              </div>
            </div>
            <div className="mt-auto pt-6 border-t border-neutral-200">
              <Button className="w-full bg-amber-600 hover:bg-amber-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <CheckSquare className="w-4 h-4 mr-2" /> Apply Review Actions
              </Button>
            </div>
          </div>
        );
      case "output":
         return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Outputs Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Generate clean printed PDFs and dataset mappings from completed files.</p>
            </div>
            <div className="space-y-4">
              <div className="border border-emerald-200 bg-emerald-50/30 p-3">
                 <h3 className="text-[10px] font-bold text-emerald-800 uppercase mb-1">Clean Build Scope</h3>
                 <p className="text-[9px] text-emerald-600 mb-3">Applies stamps, normalizes names, and compiles standard PDFs to server build cache.</p>
                 <Button onClick={handleBuildCleanCopiesForSelected} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-none text-[10px] font-mono uppercase h-8">
                   Build Selected ({selectedPdfUrls.length || stagedPdfs.filter(p=>p.status==="classified").length})
                 </Button>
              </div>
              <div className="border border-purple-200 bg-purple-50/30 p-3">
                 <h3 className="text-[10px] font-bold text-purple-800 uppercase mb-1">Export ZIP</h3>
                 <p className="text-[9px] text-purple-600 mb-3">Zips the built output PDFs along with corresponding dataset JSONL.</p>
                 <Button onClick={handleZipDownloadSelected} className="w-full bg-purple-600 hover:bg-purple-700 text-white rounded-none text-[10px] font-mono uppercase h-8">
                   Download Archive
                 </Button>
              </div>
            </div>
          </div>
        );
      case "reports":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Reports Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">View internal logs and audit errors.</p>
            </div>
            <div className="mt-auto pt-6 border-t border-neutral-200">
               <Button onClick={fetchPipelineStats} variant="outline" className="w-full rounded-none border-[#141414] text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                 <RefreshCw className="w-4 h-4 mr-2" /> Refresh Statistics
               </Button>
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Workstation Settings</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Configure master dictionary mappings and local OCR quotas.</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderMain = () => {
    switch (activeJobView) {
      case "intake":
        return (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-neutral-200 bg-white flex justify-between items-center shrink-0">
               <div>
                  <h3 className="font-bold text-neutral-800 flex items-center gap-2"><Globe className="w-4 h-4 text-emerald-600"/> URL Source Extraction</h3>
                  <p className="text-[11px] text-neutral-500">Discoveries map to the local staging engine.</p>
               </div>
               {activeTab === "crawl" && crawledPdfs.length > 0 && (
                 <Button onClick={handleStageSelectedCrawled} className="bg-[#141414] hover:bg-neutral-800 text-white rounded-none font-mono text-[10px] uppercase h-8">
                   Stage {selectedCrawled.length} to Workspace
                 </Button>
               )}
               {activeTab === "discover" && discoveredResults.length > 0 && (
                 <Button onClick={handleIncorporateDiscovered} className="bg-[#141414] hover:bg-neutral-800 text-white rounded-none font-mono text-[10px] uppercase h-8">
                   Stage {selectedDiscovered.length} Approved Links
                 </Button>
               )}
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-neutral-50/50">
               {activeTab === "crawl" ? (
                 crawledPdfs.length === 0 ? (
                   <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400">
                     <Search className="w-12 h-12 mb-3 opacity-20" />
                     <p className="text-xs uppercase font-mono tracking-wider font-bold">No URLs Extracted</p>
                     <p className="text-[10px] mt-1 max-w-xs">Enter a curriculum page URL in the sidebar and scan to find PDFs.</p>
                   </div>
                 ) : (
                   <div className="border border-neutral-200 bg-white">
                      <div className="flex items-center px-4 py-2 border-b border-neutral-200 bg-neutral-50">
                        <input type="checkbox" checked={selectedCrawled.length === crawledPdfs.length} onChange={() => setSelectedCrawled(selectedCrawled.length === crawledPdfs.length ? [] : [...crawledPdfs])} className="rounded-none border-neutral-300 mr-3" />
                        <span className="text-[10px] font-mono font-bold uppercase text-neutral-500">Select All Visible ({crawledPdfs.length})</span>
                      </div>
                      <div className="divide-y divide-neutral-100">
                         {crawledPdfs.map(url => (
                            <div key={url} className={\`p-3 flex items-center gap-3 \${selectedCrawled.includes(url) ? 'bg-emerald-50' : 'hover:bg-neutral-50'}\`}>
                              <input type="checkbox" checked={selectedCrawled.includes(url)} onChange={() => setSelectedCrawled(prev => prev.includes(url) ? prev.filter(u=>u!==url) : [...prev, url])} className="rounded-none border-neutral-300" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-neutral-800 truncate" title={decodeURIComponent(url.split('/').pop() || url)}>{decodeURIComponent(url.split('/').pop() || url)}</div>
                                <div className="text-[10px] text-neutral-400 truncate mt-0.5">{url}</div>
                              </div>
                              <a href={url} target="_blank" className="shrink-0 text-neutral-400 hover:text-neutral-900"><ExternalLink className="w-4 h-4"/></a>
                            </div>
                         ))}
                      </div>
                   </div>
                 )
               ) : (
                 discoveredResults.length === 0 ? (
                   <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400">
                     <Sparkles className="w-12 h-12 mb-3 opacity-20" />
                     <p className="text-xs uppercase font-mono tracking-wider font-bold">No Discovery Matches</p>
                     <p className="text-[10px] mt-1 max-w-xs">Run a search query to surface educational PDFs from the web.</p>
                   </div>
                 ) : (
                    <div className="border border-neutral-200 bg-white">
                      <div className="flex items-center px-4 py-2 border-b border-neutral-200 bg-neutral-50">
                        <input type="checkbox" checked={selectedDiscovered.length === discoveredResults.length} onChange={() => setSelectedDiscovered(selectedDiscovered.length === discoveredResults.length ? [] : discoveredResults.map(r=>r.url))} className="rounded-none border-neutral-300 mr-3" />
                        <span className="text-[10px] font-mono font-bold uppercase text-neutral-500">Select All Verified ({discoveredResults.length})</span>
                      </div>
                      <div className="divide-y divide-neutral-100">
                         {discoveredResults.map(res => (
                            <div key={res.url} className={\`p-3 flex items-start gap-3 \${selectedDiscovered.includes(res.url) ? 'bg-emerald-50' : 'hover:bg-neutral-50'}\`}>
                              <input type="checkbox" checked={selectedDiscovered.includes(res.url)} onChange={() => setSelectedDiscovered(prev => prev.includes(res.url) ? prev.filter(u=>u!==res.url) : [...prev, res.url])} className="rounded-none border-neutral-300 mt-1" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {res.accepted ? <Badge className="bg-emerald-100 text-emerald-800 rounded-none border-emerald-300 px-1 py-0 shadow-none text-[8px] font-mono">Verified Match</Badge> : <Badge className="bg-amber-100 text-amber-800 rounded-none border-amber-300 px-1 py-0 shadow-none text-[8px] font-mono">Rejected (Excluded)</Badge>}
                                  {res.isDirectPdf && <Badge className="bg-blue-100 text-blue-800 rounded-none border-blue-300 px-1 py-0 shadow-none text-[8px] font-mono">Direct PDF</Badge>}
                                </div>
                                <div className="text-xs font-medium text-neutral-800 truncate">{res.url}</div>
                                <div className="text-[10px] text-neutral-500 mt-1">Reason: {res.reason}</div>
                              </div>
                            </div>
                         ))}
                      </div>
                    </div>
                 )
               )}
            </div>
          </div>
        );
      case "processing":
        return (
          <div className="flex flex-col h-full">
            {/* Top Summaries */}
            <div className="p-6 bg-white border-b border-neutral-200 shrink-0 grid grid-cols-5 gap-4">
              <div className="border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-[9px] uppercase font-bold text-neutral-500 mb-1">Queued</div>
                <div className="font-mono text-2xl font-bold text-neutral-800">{activeBatchJob ? activeBatchJob.pending : stagedPdfs.length}</div>
              </div>
              <div className="border border-blue-200 bg-blue-50 p-3">
                <div className="text-[9px] uppercase font-bold text-blue-600 mb-1">Running</div>
                <div className="font-mono text-xl font-bold text-blue-800">{activeBatchJob ? activeBatchJob.running : 0}</div>
              </div>
              <div className="border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[9px] uppercase font-bold text-emerald-600 mb-1">Completed</div>
                <div className="font-mono text-xl font-bold text-emerald-800">{activeBatchJob ? activeBatchJob.completed : stagedPdfs.filter(p=>p.status==="classified").length}</div>
              </div>
              <div className="border border-amber-200 bg-amber-50 p-3">
                <div className="text-[9px] uppercase font-bold text-amber-600 mb-1">Blocked (Review)</div>
                <div className="font-mono text-xl font-bold text-amber-800">{activeBatchJob ? activeBatchJob.blocked : stagedPdfs.filter(p=>p.status==="needs_review").length}</div>
              </div>
              <div className="border border-red-200 bg-red-50 p-3">
                <div className="text-[9px] uppercase font-bold text-red-600 mb-1">Failed</div>
                <div className="font-mono text-xl font-bold text-red-800">{activeBatchJob ? activeBatchJob.failed : stagedPdfs.filter(p=>p.status==="failed").length}</div>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-6 bg-neutral-50">
              {!activeBatchJob ? (
                <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400">
                   <Play className="w-12 h-12 mb-3 opacity-20" />
                   <p className="text-xs uppercase font-mono tracking-wider font-bold">No Active Batch Job</p>
                   <p className="text-[10px] mt-1 max-w-xs text-neutral-500">Configure parameters in the sidebar and click Run Batch Job to start processing staged PDFs.</p>
                </div>
              ) : (
                <div className="border border-neutral-200 bg-white">
                  <div className="divide-y divide-neutral-100">
                     {batchJobItems.slice(0, 50).map((item, idx) => (
                        <div key={item.id} className="p-3 flex items-center gap-4 text-sm font-mono">
                          <div className="text-[10px] text-neutral-400 w-6">#{idx+1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-neutral-800 truncate">{item.filename}</div>
                            <div className="text-[9px] text-neutral-500 mt-1 flex gap-2">
                              <span>Step: <span className="font-bold text-neutral-700 uppercase">{item.currentStep}</span></span>
                              <span>Status: <span className={\`font-bold uppercase \${item.status==='clean_copy_done' ? 'text-emerald-600' : item.status==='blocked' ? 'text-amber-600' : item.status==='failed' ? 'text-red-600' : item.status==='running' ? 'text-blue-600' : 'text-neutral-500'}\`}>{item.status}</span></span>
                            </div>
                          </div>
                          {item.confidenceScore !== undefined && (
                             <div className="shrink-0 text-[10px] font-bold">
                               <span className={item.confidenceScore > 80 ? 'text-emerald-600' : item.confidenceScore > 50 ? 'text-amber-600' : 'text-red-600'}>
                                  {item.confidenceScore}% CONF
                               </span>
                             </div>
                          )}
                        </div>
                     ))}
                  </div>
                  {batchJobItems.length > 50 && (
                     <div className="p-3 text-center text-[10px] font-mono text-neutral-500 border-t border-neutral-100">
                        + {batchJobItems.length - 50} more items in queue
                     </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      case "review":
        return (
          <div className="flex flex-col h-full bg-neutral-50">
            <div className="p-6">
              {stagedPdfs.filter(p => p.status === "needs_review").length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400 bg-white border border-neutral-200">
                   <CheckCircle className="w-12 h-12 mb-3 opacity-20" />
                   <p className="text-xs uppercase font-mono tracking-wider font-bold">No Blocks to Review</p>
                   <p className="text-[10px] mt-1 max-w-xs text-neutral-500">All processed documents were classified perfectly, or the queue is empty.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {stagedPdfs.filter(p => p.status === "needs_review").map(pdf => (
                    <div key={pdf.url} className="bg-white border text-left p-4 shadow-sm border-amber-300">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <Badge className="bg-amber-100 text-amber-800 rounded-none border-amber-300 px-2 py-0 shadow-none text-[9px] font-mono mb-2 uppercase">{pdf.reason || "Needs Review"}</Badge>
                          <h4 className="font-bold text-xs font-mono text-neutral-800 break-all">{pdf.originalName}</h4>
                        </div>
                        {pdf.confidenceScore !== undefined && (
                          <div className="text-[10px] font-mono font-bold px-2 py-1 bg-neutral-100 border border-neutral-200">
                            Confidence: {Math.round(pdf.confidenceScore*100)}%
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-3 bg-neutral-50 p-2 border border-neutral-100 text-[10px] font-mono">
                        <div><span className="text-neutral-400 uppercase block mb-1">Grade</span><span className="font-bold">{pdf.gradeId || "—"}</span></div>
                        <div><span className="text-neutral-400 uppercase block mb-1">Subject</span><span className="font-bold">{pdf.subjectId || "—"}</span></div>
                        <div><span className="text-neutral-400 uppercase block mb-1">Topic</span><span className="font-bold">{pdf.topicId || "—"}</span></div>
                        <div><span className="text-neutral-400 uppercase block mb-1">Type</span><span className="font-bold">{pdf.documentTypeId || "—"}</span></div>
                      </div>
                      <div className="flex gap-2 justify-end mt-2">
                        <Button className="bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 h-8 text-[10px] font-mono shadow-none rounded-none w-24">Reject</Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-[10px] font-mono shadow-none rounded-none w-24">Fix & Approve</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      case "output":
         return (
          <div className="flex flex-col h-full items-center justify-center bg-white">
             {/* Simple summary table */}
             <div className="mb-8 text-center max-w-lg">
                <Merge className="w-12 h-12 text-purple-200 mx-auto mb-4" />
                <h3 className="text-lg font-mono font-bold uppercase text-neutral-800 mb-2">Outputs & Data Assets</h3>
                <p className="text-xs text-neutral-500 leading-relaxed font-sans">
                  The outputs job allows you to compile clean, watermarked copies of your correctly classified PDFs alongside the structured JSONL metadata for AI dataset tuning. Select actions from the sidebar.
                </p>
             </div>
             
             <div className="grid grid-cols-2 gap-4 w-full max-w-2xl px-6">
                <div className="border border-neutral-200 p-6 flex items-center justify-between">
                   <div>
                      <div className="text-[10px] uppercase font-mono font-bold text-neutral-500">Processed Ready PDFs</div>
                   </div>
                   <div className="text-2xl font-black font-mono text-emerald-700">{stagedPdfs.filter(p=>p.status==="classified").length}</div>
                </div>
                <div className="border border-neutral-200 p-6 flex items-center justify-between">
                   <div>
                      <div className="text-[10px] uppercase font-mono font-bold text-neutral-500">Clean Cached Copies</div>
                   </div>
                   <div className="text-2xl font-black font-mono text-blue-700">{pipelineStats.cleanCopies}</div>
                </div>
             </div>
             
             {isCombining && (
                <div className="fixed inset-0 bg-neutral-900/80 z-50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
                  <Loader2 className="w-12 h-12 animate-spin mb-4 text-emerald-400" />
                  <h3 className="font-mono text-xl font-bold mb-2">Building Clean Copies</h3>
                  <p className="text-sm opacity-70">Watermarking PDFs and saving metadata dataset...</p>
                </div>
             )}
             
             {isDownloadingZip && (
                <div className="fixed inset-0 bg-neutral-900/80 z-50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
                  <Loader2 className="w-12 h-12 animate-spin mb-4 text-purple-400" />
                  <h3 className="font-mono text-xl font-bold mb-2">Compressing Archive</h3>
                  <p className="text-sm opacity-70">Gathering artifacts into a zip file for download...</p>
                </div>
             )}
          </div>
         );
      case "reports":
        return (
          <div className="flex flex-col h-full bg-neutral-50 p-6">
            <h3 className="font-bold text-neutral-800 flex items-center gap-2 mb-6"><Activity className="w-5 h-5 text-blue-600"/> Diagnostics Summary</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                 <div className="border border-neutral-300 bg-white p-6 flex flex-col text-center shadow-sm">
                   <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-2">Total Downloads</span>
                   <span className="font-black text-3xl text-neutral-800">{pipelineStats.originalDownloads}</span>
                 </div>
                 <div className="border border-emerald-300 bg-emerald-50 p-6 flex flex-col text-center shadow-sm">
                   <span className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider mb-2">Clean Stamped Copies</span>
                   <span className="font-black text-3xl text-emerald-800">{pipelineStats.cleanCopies}</span>
                 </div>
                 <div className="border border-violet-300 bg-violet-50 p-6 flex flex-col text-center shadow-sm">
                   <span className="text-[10px] text-violet-600 uppercase font-bold tracking-wider mb-2">Dataset Rows (JSONL)</span>
                   <span className="font-black text-3xl text-violet-800">{pipelineStats.datasetRows}</span>
                 </div>
                 <div className="border border-red-300 bg-red-50 p-6 flex flex-col text-center shadow-sm">
                   <span className="text-[10px] text-red-600 uppercase font-bold tracking-wider mb-2">Failed Tasks</span>
                   <span className="font-black text-3xl text-red-800">{stagedPdfs.filter(p=>p.status==="failed").length}</span>
                 </div>
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="flex flex-col h-full p-6 bg-white overflow-y-auto">
             <h3 className="font-bold text-neutral-800 flex items-center gap-2 mb-4"><Settings className="w-5 h-5 text-neutral-600"/> Master Dictionary Editor</h3>
             <p className="text-xs text-neutral-500 mb-6 max-w-2xl">Modify the canonical dictionaries used for automated AI mapping. Topics and categories mapped here are passed strictly to the model prompt via standard JSON context.</p>
             {/* Re-use dictionary tabs logic briefly */}
             <div className="border border-neutral-200">
               <div className="flex overflow-x-auto border-b border-neutral-200 bg-neutral-50 text-[10px] font-mono font-bold uppercase text-neutral-500">
                 <button onClick={() => setActiveDictSubTab("grades")} className={\`px-4 py-3 \${activeDictSubTab==='grades' ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#047857]' : 'hover:bg-neutral-100'}\`}>Grades</button>
                 <button onClick={() => setActiveDictSubTab("subjects")} className={\`px-4 py-3 \${activeDictSubTab==='subjects' ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#047857]' : 'hover:bg-neutral-100'}\`}>Subjects</button>
                 <button onClick={() => setActiveDictSubTab("topics")} className={\`px-4 py-3 \${activeDictSubTab==='topics' ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#047857]' : 'hover:bg-neutral-100'}\`}>Topics</button>
                 <button onClick={() => setActiveDictSubTab("docs")} className={\`px-4 py-3 \${activeDictSubTab==='docs' ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#047857]' : 'hover:bg-neutral-100'}\`}>Document Types</button>
               </div>
               <div className="p-4 flex flex-col items-center justify-center text-neutral-400 py-12">
                   <FolderArchive className="w-12 h-12 mb-3 opacity-20" />
                   <div className="flex items-center gap-2 mb-2"><Loader2 className="w-3 h-3 animate-spin"/></div>
                   <p className="text-xs font-mono tracking-wide">Dictionary records are populated by the active SCARPE database.</p>
               </div>
             </div>
          </div>
        );
      default:
        return <div>Select a job view.</div>;
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-neutral-100 font-sans text-neutral-900">
      {/* 1. Top Monitoring Bar */}
      <div className="h-16 bg-white border-b border-[#141414] px-4 flex items-center justify-between shrink-0 sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-600" />
            <h1 className="font-mono font-bold text-sm tracking-tight uppercase">SCARPE-AI</h1>
          </div>
          <div className="h-6 w-px bg-neutral-300" />
          <div className="flex bg-neutral-100 p-1 border border-neutral-200">
            {(["intake", "processing", "review", "output", "reports", "settings"] as JobView[]).map((view) => (
              <button
                key={view}
                onClick={() => setActiveJobView(view)}
                className={\`px-3 py-1.5 text-[10px] font-mono font-bold uppercase transition-all \${
                  activeJobView === view
                    ? "bg-white text-emerald-800 shadow-sm border border-neutral-300"
                    : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50"
                }\`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap flex-1 justify-end items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase font-bold text-neutral-600">
          <div className="flex items-center gap-1.5" title="Discovered/Crawled URLs">
            <span className="text-neutral-400">Found:</span>
            <span className="text-blue-700 bg-blue-50 px-1.5 py-0.5 border border-blue-200">{crawledPdfs.length}</span>
          </div>
          <div className="flex items-center gap-1.5" title="URLs staged in current pipeline">
            <span className="text-neutral-400">Staged:</span>
            <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200">{stagedPdfs.length}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Currently selected staged items">
            <span className="text-neutral-400">Selected:</span>
            <span className="text-purple-700 bg-purple-50 px-1.5 py-0.5 border border-purple-200">{selectedPdfUrls.length}</span>
          </div>
          <div className="h-4 w-px bg-neutral-300" />
          <div className="flex items-center gap-1.5" title="Processed successfully">
            <span className="text-neutral-400">Done:</span>
            <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200">
              {stagedPdfs.filter(p => p.status === "classified").length}
            </span>
          </div>
          <div className="flex items-center gap-1.5" title="Blocked needing human review">
            <span className="text-neutral-400">Blocked:</span>
            <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 border border-amber-200">{stagedPdfs.filter(p => p.status === "needs_review").length}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Failed extraction">
            <span className="text-neutral-400">Failed:</span>
            <span className="text-red-700 bg-red-50 px-1.5 py-0.5 border border-red-200">{stagedPdfs.filter(p => p.status === "failed").length}</span>
          </div>
          <div className="h-4 w-px bg-neutral-300" />
          <div className="flex items-center gap-1.5">
            <span className="text-neutral-400">Clean:</span>
            <span className="text-neutral-900 bg-white px-1.5 py-0.5 border border-neutral-900">{pipelineStats.cleanCopies}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-neutral-400">Outputs:</span>
            <span className="text-neutral-500 bg-neutral-100 px-1.5 py-0.5 border border-neutral-200 truncate max-w-[120px]">
               {pipelineStats.localRoot || "/workspace"}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Job Workspace */}
      <div className="flex flex-1 overflow-hidden job-workspace relative">
        {/* LEFT SIDEBAR CONTROL ZONE */}
        <div className="w-[300px] min-w-[280px] max-w-[340px] bg-white border-r border-[#141414] flex flex-col shrink-0 relative z-10 shadow-[4px_0_0_rgba(0,0,0,1)] z-20">
          {renderSidebar()}
        </div>

        {/* MAIN OUTPUT ZONE */}
        <div className="flex-1 bg-neutral-100/50 flex flex-col overflow-hidden relative z-10">
          {renderMain()}
        </div>
      </div>
    </div>
  );
};
`;

fs.writeFileSync('src/WorkstationDashboard.tsx', head + newRender);
console.log("Refactored successfully.");
