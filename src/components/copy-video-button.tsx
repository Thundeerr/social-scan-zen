import { useState } from "react";
import { Button } from "./ui/button";

export function CopyVideoButton({ reference }: { reference: string }) {
  const [message, setMessage] = useState("");
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(reference);
            setMessage("Kopiert – bei Video erstellen einfügen.");
          } catch {
            setMessage("Kopieren nicht erlaubt. Bitte Browser-Berechtigung prüfen.");
          }
        }}
      >
        Video kopieren
      </Button>
      {message && (
        <span role="status" className="text-xs text-muted-foreground">
          {message}
        </span>
      )}
    </span>
  );
}
