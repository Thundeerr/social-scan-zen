import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  moveSelection,
  selectAsset,
  useSelection,
} from "@/lib/selection-store";
import { assetActions } from "@/lib/assets-store";
import { toggleFavorite, isFavorite } from "@/lib/favorites-store";
import {
  setCommandPaletteOpen,
  toggleCommandPalette,
  useCommandPaletteOpen,
} from "@/lib/palette-store";

/** Returns true when the event target is a text input surface. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function focusGlobalSearch() {
  const el = document.getElementById("global-search") as HTMLInputElement | null;
  if (!el) return;
  el.focus();
  el.select();
}

/**
 * Global keyboard shortcut layer. Mounted once from the app shell.
 * Rules:
 *   - Cmd/Ctrl+K and Esc always work, even while typing.
 *   - All other hotkeys are suppressed while focus is inside an input.
 *   - `g` opens a 900ms two-key sequence (g→d/a/t/s) for route navigation.
 */
export function KeyboardShortcuts() {
  const navigate = useNavigate();
  const paletteOpen = useCommandPaletteOpen();

  useEffect(() => {
    let gSequenceExpires = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);

      // Always-on: command palette toggle
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Always-on: escape closes the palette (dialogs handle their own Esc)
      if (e.key === "Escape" && paletteOpen) {
        e.preventDefault();
        setCommandPaletteOpen(false);
        return;
      }

      // No other shortcuts while typing or while palette owns the keyboard
      if (typing || paletteOpen) return;
      if (mod || e.altKey) return;

      // G-sequence: navigation
      if (e.key === "g" || e.key === "G") {
        gSequenceExpires = Date.now() + 900;
        return;
      }
      if (Date.now() < gSequenceExpires) {
        gSequenceExpires = 0;
        const key = e.key.toLowerCase();
        if (key === "d") {
          e.preventDefault();
          navigate({ to: "/" });
          return;
        }
        if (key === "a") {
          e.preventDefault();
          navigate({ to: "/assets", search: { day: "all", status: "all" } });
          return;
        }
        if (key === "t") {
          e.preventDefault();
          navigate({ to: "/accounts" });
          return;
        }
        if (key === "s") {
          e.preventDefault();
          navigate({ to: "/scanner" });
          return;
        }
        if (key === "x") {
          e.preventDefault();
          navigate({ to: "/discovery" });
          return;
        }
      }

      // Focus global search
      if (e.key === "/") {
        e.preventDefault();
        focusGlobalSearch();
        return;
      }

      // Asset-scoped actions — read selection lazily so we always act on the
      // latest state, not a stale closure.
      const key = e.key.toLowerCase();
      const selection = (
        window as unknown as { __getSelection?: () => { selectedId: string | null } }
      ).__getSelection?.();
      const selectedId = selection?.selectedId ?? null;

      if (key === "j") {
        e.preventDefault();
        moveSelection(1);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        moveSelection(-1);
        return;
      }

      if (!selectedId) return;

      if (key === "a") {
        e.preventDefault();
        assetActions.approve(selectedId);
        toast.success("Asset approved");
        return;
      }
      if (key === "d") {
        e.preventDefault();
        assetActions.download(selectedId);
        toast.success("Asset synchronized");
        return;
      }
      if (key === "i") {
        e.preventDefault();
        assetActions.ignore(selectedId);
        toast("Asset archived");
        return;
      }
      if (key === "r") {
        e.preventDefault();
        openOriginalSource(selectedId);
        return;
      }
      if (key === "f") {
        e.preventDefault();
        const wasFav = isFavorite(selectedId);
        toggleFavorite(selectedId);
        toast(wasFav ? "Removed from favorites" : "Added to favorites");
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, paletteOpen]);

  // Publish current selection to a plain window slot so the keydown handler
  // (which we intentionally don't re-bind on every selection change) can read
  // it lazily. Prevents rebinding the listener on every J/K press.
  const selection = useSelection();
  useEffect(() => {
    (window as unknown as { __getSelection?: () => typeof selection }).__getSelection = () =>
      selection;
  }, [selection]);

  useEffect(() => {
    // Expose a helper so command-palette items can trigger it too.
    (window as unknown as { __focusSearch?: () => void }).__focusSearch = focusGlobalSearch;
  }, []);

  return null;
}

export function openOriginalSource(assetId: string) {
  // Resolve via the DOM so we don't couple hotkeys to the asset store schema.
  // Every AssetCard tags itself with data-asset-id + data-asset-url.
  const el = document.querySelector<HTMLElement>(`[data-asset-id="${assetId}"]`);
  const url = el?.getAttribute("data-asset-url");
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Format a shortcut key for display in tooltips and menus. */
export function formatKey(key: string): string {
  return key
    .replace("mod", isMac() ? "⌘" : "Ctrl")
    .replace("shift", "⇧")
    .replace("alt", isMac() ? "⌥" : "Alt");
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
