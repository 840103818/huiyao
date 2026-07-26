import { Modal } from "@arco-design/web-react";
import { useEffect } from "react";
import type { AppView } from "../shell/Toolbar";
import type { ReverseResult } from "../../shared/contracts";
import { clipboardTimestamp, isTextEntryTarget } from "./workspace";

interface ShortcutOptions {
  view: AppView;
  loading: boolean;
  onGenerate: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}

export function useWorkspaceShortcuts({ view, loading, onGenerate, onStop }: ShortcutOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (view !== "workspace") return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void (loading ? onStop() : onGenerate());
      } else if (event.key === "Escape" && loading && !document.querySelector('[data-image-viewer="open"]')) {
        event.preventDefault();
        void onStop();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onGenerate, onStop, view]);
}

interface PasteOptions {
  view: AppView;
  loading: boolean;
  result: ReverseResult | null;
  activeHistoryId?: string;
  onImageFile: (file: File) => void | Promise<void>;
  onRejected: (message: string) => void;
}

export function useClipboardImage({ view, loading, result, activeHistoryId, onImageFile, onRejected }: PasteOptions): void {
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (view !== "workspace" || isTextEntryTarget(event.target)) return;
      const clipboardFile = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (!clipboardFile) return;
      event.preventDefault();
      if (loading) {
        onRejected("生成或图片处理中不能替换图片");
        return;
      }
      const extension = clipboardFile.type === "image/jpeg" ? "jpg" : clipboardFile.type === "image/webp" ? "webp" : "png";
      const file = new File([clipboardFile], `剪贴板-${clipboardTimestamp()}.${extension}`, { type: clipboardFile.type });
      const apply = () => void onImageFile(file);
      if (result && !activeHistoryId) {
        Modal.confirm({
          title: "替换当前图片？",
          content: "当前结果尚未保存，替换图片后将无法恢复。",
          okText: "替换图片",
          cancelText: "取消",
          onOk: apply,
        });
      } else {
        apply();
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeHistoryId, loading, onImageFile, onRejected, result, view]);
}
