"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { ShieldCheck } from "lucide-react";

export function SidebarLogo({
  lightVersion,
  darkVersion,
}: {
  lightVersion: number;
  darkVersion: number;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [errored, setErrored] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  const version = isDark ? darkVersion : lightVersion;
  const hasLogo = version > 0 && !errored;

  if (hasLogo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/branding/${isDark ? "dark" : "light"}?v=${version}`}
        alt="Logo"
        className="max-h-8 w-auto object-contain"
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <>
      <ShieldCheck className="h-5 w-5 text-primary" />
      CRM
    </>
  );
}
