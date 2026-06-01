import React from "react";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div id="scarpe-app-shell" className="h-screen w-full overflow-hidden bg-[#F5F5F5] font-sans text-neutral-900 flex flex-col">
      {children}
    </div>
  );
}
export default AppShell;
