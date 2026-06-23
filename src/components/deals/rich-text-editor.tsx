"use client";

import { useEffect, useRef, useState } from "react";
import { Editor } from "@tinymce/tinymce-react";
import { useTheme } from "@/components/theme-provider";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * When set, image upload/paste is enabled and files are POSTed to the deal's
   * protected image endpoint. Omit to render a text-only editor.
   */
  uploadDealId?: string;
  /**
   * Called whenever the number of in-flight image uploads transitions to/from
   * zero, so the parent can block submission until pasted images are saved.
   */
  onUploadingChange?: (uploading: boolean) => void;
};

// TinyMCE Cloud API key (set NEXT_PUBLIC_TINYMCE_API_KEY in your env; it is
// inlined at build time because this is a client component).
const TINYMCE_API_KEY = process.env.NEXT_PUBLIC_TINYMCE_API_KEY;

/**
 * Uploads a TinyMCE image blob (from paste, drag-drop or the image dialog) to
 * the deal's access-checked endpoint and resolves to the embeddable URL.
 */
function makeImageUploadHandler(dealId: string, onPending: (delta: number) => void) {
  return (blobInfo: { blob: () => Blob; filename: () => string }): Promise<string> => {
    onPending(1);
    return new Promise<string>((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", blobInfo.blob(), blobInfo.filename());
      fetch(`/api/deals/${dealId}/images`, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            reject({ message: body?.error || `Upload failed (${res.status})`, remove: true });
            return;
          }
          const json = await res.json().catch(() => null);
          if (!json?.location) {
            reject({ message: "Malformed upload response.", remove: true });
            return;
          }
          resolve(json.location as string);
        })
        .catch(() => reject({ message: "Network error during image upload.", remove: true }));
    }).finally(() => onPending(-1));
  };
}

/**
 * TinyMCE Cloud editor. The script + all skin/content CSS assets are loaded
 * from the Tiny CDN using the API key. The editor re-initialises on theme
 * change so it picks up the matching oxide-dark / dark content skins.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled,
  uploadDealId,
  onUploadingChange,
}: Props) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Track in-flight uploads; report to the parent only on 0<->n transitions.
  const pendingRef = useRef(0);

  // Avoid initialising with the wrong skin before the theme is resolved.
  useEffect(() => setMounted(true), []);

  function onPending(delta: number) {
    const prev = pendingRef.current;
    const next = Math.max(0, prev + delta);
    pendingRef.current = next;
    if ((prev === 0) !== (next === 0)) onUploadingChange?.(next > 0);
  }

  const isDark = resolvedTheme === "dark";
  const canUpload = Boolean(uploadDealId);

  if (!mounted) {
    return <div className="h-[260px] rounded-lg border bg-muted/30" aria-hidden />;
  }

  const plugins = [
    "advlist",
    "autolink",
    "lists",
    "link",
    "charmap",
    "anchor",
    "searchreplace",
    "visualblocks",
    "code",
    "fullscreen",
    "insertdatetime",
    "table",
    "wordcount",
    "codesample",
    "emoticons",
    "autoresize",
    ...(canUpload ? ["image"] : []),
  ].join(" ");

  // Two logical groups; sliding mode wraps overflow into a "more" menu.
  const toolbar = [
    "undo redo",
    "blocks",
    "bold italic underline strikethrough",
    "forecolor backcolor",
    "alignleft aligncenter alignright alignjustify",
    "bullist numlist outdent indent",
    canUpload ? "link image table" : "link table",
    "blockquote code codesample",
    "emoticons charmap insertdatetime",
    "removeformat fullscreen",
  ].join(" | ");

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
        // autoresize grows the editor with content between these bounds.
        min_height: 260,
        max_height: 600,
        autoresize_bottom_margin: 16,
        menubar: "edit insert view format table tools",
        statusbar: true,
        elementpath: false,
        branding: false,
        promotion: false,
        placeholder,
        plugins,
        toolbar,
        toolbar_mode: "sliding",
        skin: isDark ? "oxide-dark" : "oxide",
        content_css: isDark ? "dark" : "default",
        // Keep the editing surface visually aligned with the app's typography.
        content_style:
          "body{font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.6;margin:8px}img{max-width:100%;height:auto}",
        // Links open in a new, opener-isolated tab (sanitizer also enforces this).
        link_default_target: "_blank",
        link_default_protocol: "https",
        link_assume_external_targets: true,
        // Keep our absolute upload URLs (`/api/attachments/{id}`) verbatim —
        // otherwise TinyMCE rewrites them page-relative and the sanitizer's
        // allowlist strips the <img> on save.
        convert_urls: false,
        relative_urls: false,
        remove_script_host: true,
        // --- Image upload / paste (only when a deal target is provided) ---
        // Upload pasted & dragged images immediately to the backend so the
        // stored HTML references our protected URL, never a transient blob:.
        automatic_uploads: canUpload,
        paste_data_images: canUpload,
        images_file_types: "jpeg,jpg,png,gif,webp,svg,avif",
        ...(canUpload
          ? { images_upload_handler: makeImageUploadHandler(uploadDealId as string, onPending) }
          : {}),
      }}
    />
  );
}
