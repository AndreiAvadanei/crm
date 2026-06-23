"use client";

import { useEffect, useState } from "react";
import { Editor } from "@tinymce/tinymce-react";
import { useTheme } from "next-themes";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

// TinyMCE Cloud API key (set NEXT_PUBLIC_TINYMCE_API_KEY in your env; it is
// inlined at build time because this is a client component).
const TINYMCE_API_KEY = process.env.NEXT_PUBLIC_TINYMCE_API_KEY;

/**
 * TinyMCE Cloud editor. The script + all skin/content CSS assets are loaded
 * from the Tiny CDN using the API key. The editor re-initialises on theme
 * change so it picks up the matching oxide-dark / dark content skins.
 */
export default function RichTextEditor({ value, onChange, placeholder, disabled }: Props) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid initialising with the wrong skin before the theme is resolved.
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  if (!mounted) {
    return <div className="h-[220px] rounded-lg border bg-muted/30" aria-hidden />;
  }

  return (
    <Editor
      // TinyMCE Cloud: loads the script from the CDN using your API key.
      apiKey={TINYMCE_API_KEY}
      // Remount when the theme flips so skin/content_css are re-applied.
      key={isDark ? "dark" : "light"}
      value={value}
      onEditorChange={(html) => onChange(html)}
      disabled={disabled}
      init={{
        height: 220,
        menubar: false,
        statusbar: false,
        branding: false,
        promotion: false,
        placeholder,
        plugins: "lists link autolink code",
        toolbar:
          "bold italic underline | bullist numlist | link blockquote | code | removeformat",
        skin: isDark ? "oxide-dark" : "oxide",
        content_css: isDark ? "dark" : "default",
        // Keep the editing surface visually aligned with the app's typography.
        content_style:
          "body{font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.6;margin:8px}",
        // Links open in a new, opener-isolated tab (sanitizer also enforces this).
        link_default_target: "_blank",
        link_default_protocol: "https",
        link_assume_external_targets: true,
      }}
    />
  );
}
