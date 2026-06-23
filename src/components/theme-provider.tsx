"use client";

// Lightweight, dependency-free theme system that replaces next-themes.
// next-themes renders its anti-flicker <script> from inside a Client Component,
// which React 19 / Next 16 now warns about ("Encountered a script tag while
// rendering React component"). This client provider only manages state + the
// <html> class, exposing a next-themes-compatible useTheme() API. The server
// layout defaults to dark until the client reconciles the stored preference.

import * as React from "react";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: Resolved;
  systemTheme: Resolved;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

const MEDIA = "(prefers-color-scheme: dark)";

function getSystemTheme(): Resolved {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia(MEDIA).matches ? "dark" : "light";
}

/** Temporarily kills CSS transitions so theme swaps don't animate. */
function disableTransitions() {
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode("*,*::before,*::after{transition:none!important}")
  );
  document.head.appendChild(style);
  return () => {
    // Force a reflow to flush the override, then remove on next tick.
    window.getComputedStyle(document.body);
    setTimeout(() => document.head.removeChild(style), 1);
  };
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "theme",
  enableSystem = true,
  disableTransitionOnChange = false,
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  /** Accepted for API parity with next-themes; "class" is the only mode used. */
  attribute?: string;
}) {
  const [theme, setThemeState] = React.useState<Theme>(defaultTheme);
  const [systemTheme, setSystemTheme] = React.useState<Resolved>("dark");

  // Hydrate from storage on mount, then the effect below applies the resolved
  // class to <html>.
  React.useEffect(() => {
    setSystemTheme(getSystemTheme());
    try {
      const stored = localStorage.getItem(storageKey) as Theme | null;
      setThemeState(stored ?? defaultTheme);
    } catch {
      setThemeState(defaultTheme);
    }
  }, [storageKey, defaultTheme]);

  // Keep system preference in sync.
  React.useEffect(() => {
    const mq = window.matchMedia(MEDIA);
    const onChange = () => setSystemTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: Resolved =
    theme === "system" ? (enableSystem ? systemTheme : "dark") : (theme as Resolved);

  // Apply the resolved theme to <html>.
  React.useEffect(() => {
    const root = document.documentElement;
    const restore = disableTransitionOnChange ? disableTransitions() : undefined;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
    restore?.();
  }, [resolvedTheme, disableTransitionOnChange]);

  const setTheme = React.useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* ignore quota / privacy-mode errors */
      }
    },
    [storageKey]
  );

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, systemTheme, setTheme }),
    [theme, resolvedTheme, systemTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    // Safe defaults if used outside the provider.
    return { theme: "system", resolvedTheme: "dark", systemTheme: "dark", setTheme: () => {} };
  }
  return ctx;
}
