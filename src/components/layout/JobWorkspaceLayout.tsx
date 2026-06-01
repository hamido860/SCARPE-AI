import React, { useState, useEffect } from "react";

interface JobWorkspaceLayoutProps {
  sidebarContent?: React.ReactNode;
  mainContent?: React.ReactNode;
  sidebar?: React.ReactNode;
  main?: React.ReactNode;
}

export function JobWorkspaceLayout({ 
  sidebarContent, 
  mainContent, 
  sidebar, 
  main 
}: JobWorkspaceLayoutProps) {
  const sb = sidebarContent ?? sidebar;
  const mc = mainContent ?? main;

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  useEffect(() => {
    const handleToggle = () => setIsMobileDrawerOpen(prev => !prev);
    const handleClose = () => setIsMobileDrawerOpen(false);

    window.addEventListener("toggle-mobile-controls", handleToggle);
    window.addEventListener("close-mobile-controls", handleClose);

    return () => {
      window.removeEventListener("toggle-mobile-controls", handleToggle);
      window.removeEventListener("close-mobile-controls", handleClose);
    };
  }, []);

  return (
    <div id="job-workspace-layout" className="flex flex-1 min-h-0 w-full overflow-hidden relative">
      {/* DESKTOP SIDEBAR CONTROL ZONE (Fixed 300px, hidden on tablet/mobile) */}
      <aside className="hidden lg:flex lg:flex-col w-[300px] min-w-[300px] max-w-[300px] border-r border-neutral-250 bg-white overflow-y-auto shrink-0 select-none">
        {sb}
      </aside>

      {/* TABLET/MOBILE SIDEBAR DRAWER (Overlay Modal) */}
      {isMobileDrawerOpen && (
        <>
          {/* Backdrop clickable overlay */}
          <div 
            id="mobile-drawer-backdrop"
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs z-40 lg:hidden" 
            onClick={() => setIsMobileDrawerOpen(false)} 
          />
          {/* Slide-out Panel */}
          <aside 
            id="mobile-drawer-aside"
            className="fixed top-0 left-0 bottom-0 w-[300px] max-w-[85vw] bg-white z-50 shadow-2xl flex flex-col h-full lg:hidden border-r border-neutral-250 overflow-hidden"
          >
            {/* Header with a click to close button */}
            <div className="p-3.5 border-b border-neutral-200 flex justify-between items-center bg-neutral-50 font-mono text-[11px] font-bold text-neutral-500 uppercase select-none">
              <span>Control Panel</span>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                className="px-2 py-1 text-[10.5px] border border-neutral-300 hover:bg-neutral-100 font-mono text-neutral-800 transition-colors uppercase font-bold text-[10px]"
              >
                Close
              </button>
            </div>
            {/* Scrollable Container Content */}
            <div className="flex-1 overflow-y-auto select-none">
              {sb}
            </div>
          </aside>
        </>
      )}

      {/* MAIN OUTPUT ZONE */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-neutral-50 h-full relative z-10">
        {mc}
      </main>
    </div>
  );
}

export default JobWorkspaceLayout;
