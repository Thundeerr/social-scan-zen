import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Users,
  Images,
  Radar,
  Settings,
  Download,
  Check,
  X,
  ExternalLink,
  Star,
  Search,
  ArrowDown,
  ArrowUp,
  Undo2,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  setCommandPaletteOpen,
  useCommandPaletteOpen,
} from "@/lib/palette-store";
import { moveSelection, useSelection } from "@/lib/selection-store";
import { assetActions } from "@/lib/assets-store";
import { toggleFavorite, isFavorite } from "@/lib/favorites-store";
import { openOriginalSource } from "@/lib/keyboard-shortcuts";

export function CommandPalette() {
  const open = useCommandPaletteOpen();
  const navigate = useNavigate();
  const { selectedId } = useSelection();

  const close = () => setCommandPaletteOpen(false);
  const run = (fn: () => void) => {
    close();
    // let the dialog unmount before we fire (avoids stealing focus)
    setTimeout(fn, 0);
  };

  const go = (path: "/" | "/assets" | "/accounts" | "/scanner" | "/downloads" | "/settings") =>
    run(() => {
      if (path === "/assets") navigate({ to: path, search: { day: "all", status: "all" } });
      else navigate({ to: path });
    });

  const requireSelected = (fn: (id: string) => void, empty: string) =>
    run(() => {
      if (!selectedId) {
        toast(empty);
        return;
      }
      fn(selectedId);
    });

  return (
    <CommandDialog open={open} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/")}>
            <LayoutDashboard /> Dashboard
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/assets")}>
            <Images /> New Assets
            <CommandShortcut>G A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/accounts")}>
            <Users /> Tracked Accounts
            <CommandShortcut>G T</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/scanner")}>
            <Radar /> Scanner
            <CommandShortcut>G S</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/downloads")}>
            <Download /> Archive
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings /> Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Selection">
          <CommandItem onSelect={() => run(() => moveSelection(1))}>
            <ArrowDown /> Next asset
            <CommandShortcut>J</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => moveSelection(-1))}>
            <ArrowUp /> Previous asset
            <CommandShortcut>K</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                setTimeout(
                  () =>
                    (window as unknown as { __focusSearch?: () => void }).__focusSearch?.(),
                  10,
                );
              })
            }
          >
            <Search /> Focus search
            <CommandShortcut>/</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Selected asset">
          <CommandItem
            onSelect={() =>
              requireSelected((id) => {
                assetActions.approve(id);
                toast.success("Asset approved");
              }, "Select an asset first")
            }
          >
            <Check /> Approve asset
            <CommandShortcut>A</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              requireSelected((id) => {
                assetActions.download(id);
                toast.success("Asset synchronized");
              }, "Select an asset first")
            }
          >
            <Download /> Synchronize asset
            <CommandShortcut>D</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              requireSelected((id) => {
                assetActions.ignore(id);
                toast("Asset archived");
              }, "Select an asset first")
            }
          >
            <X /> Archive asset
            <CommandShortcut>I</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              requireSelected((id) => openOriginalSource(id), "Select an asset first")
            }
          >
            <ExternalLink /> Open original source
            <CommandShortcut>R</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              requireSelected((id) => {
                const wasFav = isFavorite(id);
                toggleFavorite(id);
                toast(wasFav ? "Removed from favorites" : "Added to favorites");
              }, "Select an asset first")
            }
          >
            <Star /> Toggle favorite
            <CommandShortcut>F</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
