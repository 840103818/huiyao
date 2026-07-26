import { useEffect } from "react";
import { applyNativeTheme } from "../../infrastructure/tauri";
import type { ThemeMode } from "../../shared/contracts";

export function useTheme(theme: ThemeMode): void {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyCssTheme = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      if (resolved === "dark") document.body.setAttribute("arco-theme", "dark");
      else document.body.removeAttribute("arco-theme");
    };
    applyCssTheme();
    void applyNativeTheme(theme).catch(() => undefined);
    media.addEventListener("change", applyCssTheme);
    return () => media.removeEventListener("change", applyCssTheme);
  }, [theme]);
}
