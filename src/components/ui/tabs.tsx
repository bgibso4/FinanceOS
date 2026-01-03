import React from "react";
import { cn } from "@/lib/cn";

type TabsProps = {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={cn("flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-sm font-semibold", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={cn(
            "flex-1 rounded-lg px-4 py-2 transition",
            active === tab.id 
              ? "bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-slate-100" 
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          )}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
