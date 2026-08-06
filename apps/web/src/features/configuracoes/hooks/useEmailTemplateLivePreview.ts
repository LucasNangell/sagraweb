import { useEffect, useState } from "react";

import { previewEmailTemplate } from "@/api/adminSystem";

type PreviewOpts = {
  templateId: string | null;
  subject: string;
  html: string;
  contentMode: "preset" | "custom";
  presetId: string;
  enabled: boolean;
  /** Pausa atualizações automáticas enquanto o usuário edita a prévia. */
  paused?: boolean;
};

export function useEmailTemplateLivePreview(opts: PreviewOpts) {
  const [liveSubject, setLiveSubject] = useState("");
  const [liveHtml, setLiveHtml] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opts.enabled || !opts.templateId) {
      setLiveSubject("");
      setLiveHtml("");
      setLoading(false);
      return;
    }

    if (opts.paused) {
      setLoading(false);
      return;
    }

    if (opts.contentMode === "custom" && opts.html.trim()) {
      setLiveSubject(opts.subject);
      setLiveHtml(opts.html);
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const data = await previewEmailTemplate(opts.templateId!, {
            subject: opts.subject,
            html: opts.contentMode === "custom" ? opts.html : "",
            use_custom: true,
            content_mode: opts.contentMode,
            preset_id: opts.contentMode === "preset" ? opts.presetId : "",
          });
          setLiveSubject(data.subject);
          setLiveHtml(data.html);
        } catch {
          if (opts.contentMode === "custom") {
            setLiveSubject(opts.subject);
            setLiveHtml(opts.html);
          }
        } finally {
          setLoading(false);
        }
      })();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    opts.enabled,
    opts.templateId,
    opts.subject,
    opts.html,
    opts.contentMode,
    opts.presetId,
    opts.paused,
  ]);

  return { liveSubject, liveHtml, loading };
}
