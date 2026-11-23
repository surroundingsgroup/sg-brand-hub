"use client";

// Light / dark switch for the team's workspace. The choice is kept in this
// browser and applied before the page paints (the small script in the root
// layout), so there is no flash. Client-facing pages (intake, share links,
// sign-in) are always light.

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "sg-theme";

function apply(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f0f0e" : "#ffffff");
}

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const on = document.documentElement.classList.contains("dark");
    setDark(on);
    apply(on);
  }, []);
  const flip = () => {
    const next = !dark;
    apply(next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // Private window: the switch still works for this visit.
    }
    setDark(next);
  };
  return [dark, flip];
}

/** The small sun / moon button in the top bar. */
export function ThemeToggle() {
  const [dark, flip] = useTheme();
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

/** The same switch as a full-width row, for the phone's Account sheet. */
export function ThemeRow() {
  const [dark, flip] = useTheme();
  return (
    <button type="button" onClick={flip} className="flex min-h-[60px] w-full items-center gap-3 px-5 py-2.5 active:bg-secondary">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-foreground">
        {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-medium text-foreground">{dark ? "Light theme" : "Dark theme"}</span>
        <span className="block text-[12px] text-muted-foreground">{dark ? "Switch back to the light look" : "Easier on the eyes at night"}</span>
      </span>
    </button>
  );
}
