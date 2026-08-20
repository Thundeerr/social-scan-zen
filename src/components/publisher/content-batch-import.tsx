import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  FileJson2,
  LoaderCircle,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { planContentBatchImport } from "@/lib/content-batch-plan";
import {
  packageHasErrors,
  prepareContentBatch,
  storageExtension,
  type PackageFileRole,
  type PreparedContentPackage,
} from "@/lib/content-package";
import { uploadContentFile } from "@/lib/resumable-content-upload";

type Props = { onImported: () => void };
type ExistingPost = {
  id: string;
  post_key: string;
  media_sha256: string | null;
  media_manifest: unknown;
  batch_key: string | null;
};

function chunks<T>(items: T[], size = 40) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function storedPackageHash(row: ExistingPost) {
  if (!row.media_manifest || typeof row.media_manifest !== "object") return null;
  const value = (row.media_manifest as Record<string, unknown>).package_sha256;
  return typeof value === "string" ? value : null;
}

async function findExistingPosts(keys: string[], hashes: string[]) {
  const rows = new Map<string, ExistingPost>();
  for (const keyChunk of chunks(keys)) {
    const { data, error } = await supabase
      .from("content_posts")
      .select("id, post_key, media_sha256, media_manifest, batch_key")
      .in("post_key", keyChunk);
    if (error) throw error;
    for (const row of data ?? []) rows.set(row.id, row as ExistingPost);
  }
  for (const hashChunk of chunks(hashes)) {
    const { data, error } = await supabase
      .from("content_posts")
      .select("id, post_key, media_sha256, media_manifest, batch_key")
      .in("media_sha256", hashChunk);
    if (error) throw error;
    for (const row of data ?? []) rows.set(row.id, row as ExistingPost);
  }
  return [...rows.values()];
}

export function ContentBatchImport({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [batch, setBatch] = useState<PreparedContentPackage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [readProgress, setReadProgress] = useState({ completed: 0, total: 0 });
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const uploadGuardRef = useRef(false);
  const selected = batch[selectedIndex] ?? null;

  useEffect(() => {
    if (!selected) {
      setCoverUrl(null);
      return;
    }
    const next = URL.createObjectURL(selected.files.cover);
    setCoverUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [selected]);

  useEffect(() => {
    if (!isUploading) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isUploading]);

  const selectBatch = async (files: File[]) => {
    if (!files.length) return;
    setIsReading(true);
    setBatch([]);
    setSelectedIndex(0);
    setReadProgress({ completed: 0, total: 0 });
    setProgress(0);
    try {
      const next = await prepareContentBatch(files, (completed, total) =>
        setReadProgress({ completed, total }),
      );
      setBatch(next);
      const invalid = next.filter(packageHasErrors).length;
      if (invalid > 0)
        toast.error(`${invalid} package${invalid === 1 ? " needs" : "s need"} fixes`);
      else toast.success(`${next.length} package${next.length === 1 ? "" : "s"} checked and ready`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Batch could not be read");
    } finally {
      setIsReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const uploadBatchLocked = async () => {
    if (!batch.length || batch.some(packageHasErrors) || uploadGuardRef.current) return;
    uploadGuardRef.current = true;
    setIsUploading(true);
    setProgress(1);
    const controller = new AbortController();
    abortRef.current = controller;
    let imported = 0;
    let skipped = 0;
    try {
      if (!navigator.onLine) throw new Error("You are offline. Reconnect before uploading.");
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Your operator session has expired.");

      const keys = batch.map((item) => item.manifest.post_key);
      const hashes = batch.flatMap((item) => [item.mediaSha256, item.packageSha256]);
      const existing = await findExistingPosts(keys, hashes);
      const plan = planContentBatchImport(
        batch.map((item) => ({
          postKey: item.manifest.post_key,
          mediaSha256: item.mediaSha256,
          packageSha256: item.packageSha256,
        })),
        existing.map((row) => ({
          id: row.id,
          postKey: row.post_key,
          mediaSha256: row.media_sha256,
          packageSha256: storedPackageHash(row),
          batchKey: row.batch_key,
        })),
      );
      const pendingKeys = new Set(plan.pendingPostKeys);
      const pending = batch.filter((item) => pendingKeys.has(item.manifest.post_key));
      skipped = plan.skippedPostKeys.length;

      if (pending.length === 0) {
        toast.success(`${skipped} post${skipped === 1 ? " is" : "s are"} already imported`);
        setBatch([]);
        onImported();
        return;
      }

      const sharedBatchId = plan.reusableBatchKey ?? crypto.randomUUID();
      const roles: PackageFileRole[] = ["cover", "reel", "story"];
      const totalFiles = pending.length * roles.length;
      let completedFiles = 0;

      for (const item of pending) {
        if (controller.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
        const root = `${auth.user.id}/content/${item.manifest.post_key}/${item.packageSha256}`;
        const paths = Object.fromEntries(
          roles.map((role) => {
            const file = item.files[role];
            const hash = item.media[role].sha256.slice(0, 16);
            return [role, `${root}/${role}-${hash}.${storageExtension(file)}`];
          }),
        ) as Record<PackageFileRole, string>;
        const uploadedPaths: string[] = [];
        try {
          const { error: orphanError } = await supabase.storage
            .from("ig-publish")
            .remove(Object.values(paths));
          if (orphanError) throw new Error(`Could not clean an earlier partial upload.`);

          for (const role of roles) {
            const file = item.files[role];
            await uploadContentFile({
              file,
              objectPath: paths[role],
              contentType: item.media[role].contentType,
              signal: controller.signal,
              onProgress: (fraction) =>
                setProgress(Math.round(((completedFiles + fraction) / totalFiles) * 90)),
            });
            uploadedPaths.push(paths[role]);
            completedFiles += 1;
          }

          const mediaManifest = {
            package_sha256: item.packageSha256,
            ...Object.fromEntries(
              roles.map((role) => [role, { ...item.media[role], storage_path: paths[role] }]),
            ),
          };
          const { error: insertError } = await supabase.from("content_posts").insert({
            user_id: auth.user.id,
            post_key: item.manifest.post_key,
            title: item.manifest.title,
            hook: item.manifest.hook,
            caption: item.manifest.caption,
            first_comment: item.manifest.first_comment,
            alt_text: item.manifest.alt_text,
            content_pillar: item.manifest.content_pillar,
            manifest_version: item.manifest.version,
            batch_key: sharedBatchId,
            cover_storage_path: paths.cover,
            reel_storage_path: paths.reel,
            story_storage_path: paths.story,
            media_sha256: item.mediaSha256,
            media_manifest: mediaManifest,
            quality_report: item.issues,
            imported_at: new Date().toISOString(),
            status: "review",
          });
          if (insertError) throw insertError;
          imported += 1;
        } catch (error) {
          if (uploadedPaths.length > 0) {
            const { error: cleanupError } = await supabase.storage
              .from("ig-publish")
              .remove(uploadedPaths);
            if (cleanupError) {
              toast.warning("Some partial files need automatic cleanup on the next retry.");
            }
          }
          throw error;
        }
      }

      setProgress(100);
      toast.success(
        `${imported} post${imported === 1 ? " is" : "s are"} ready${skipped ? ` · ${skipped} already existed` : ""}`,
      );
      setBatch([]);
      setSelectedIndex(0);
      onImported();
    } catch (error) {
      if (imported > 0) onImported();
      const message = error instanceof Error ? error.message : "Upload failed";
      const safeCount = imported + skipped;
      toast.error(safeCount > 0 ? `${message} · ${safeCount} already safe` : message);
    } finally {
      abortRef.current = null;
      uploadGuardRef.current = false;
      setIsUploading(false);
    }
  };

  const uploadBatch = async () => {
    if (!navigator.locks) {
      toast.error("Safe uploads require desktop Chrome or Edge.");
      return;
    }

    await navigator.locks.request(
      "instascanner-content-import",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          toast.warning("Another InstaScanner tab is already importing content.");
          return;
        }
        await uploadBatchLocked();
      },
    );
  };

  const errors = selected?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = selected?.issues.filter((issue) => issue.severity === "warning") ?? [];
  const passes = selected?.issues.filter((issue) => issue.severity === "pass") ?? [];
  const invalidPackages = batch.filter(packageHasErrors).length;

  return (
    <Card className="overflow-hidden border-dashed border-primary/30 bg-primary/[0.035]">
      <CardContent className="p-0">
        <input
          ref={(node) => {
            inputRef.current = node;
            node?.setAttribute("webkitdirectory", "");
            node?.setAttribute("directory", "");
          }}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => selectBatch(Array.from(event.target.files ?? []))}
        />
        {!selected ? (
          <div className="flex w-full flex-col items-center justify-center px-6 py-8 text-center">
            {isReading ? (
              <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10">
                <UploadCloud className="h-5 w-5 text-primary" />
              </div>
            )}
            <div className="mt-4 text-sm font-semibold">
              {isReading
                ? `Checking batch${readProgress.total ? ` ${readProgress.completed}/${readProgress.total}` : ""}…`
                : "Import content batch"}
            </div>
            <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
              Select one post folder or a parent folder containing many post folders. Every
              manifest, 1080×1920 Reel, Story and cover is checked before private upload.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <FileJson2 className="h-3 w-3" /> One manifest per post
              </span>
              <span className="inline-flex items-center gap-1">
                <FileArchive className="h-3 w-3" /> Resumable upload
              </span>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={() => inputRef.current?.click()} disabled={isReading} size="sm">
                <UploadCloud className="mr-2 h-3.5 w-3.5" /> Select folder
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href="/templates/content-package/manifest.example.json" download>
                  <Download className="mr-2 h-3.5 w-3.5" /> Manifest template
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-[180px_1fr]">
            <div className="aspect-[3/4] bg-black/20">
              {coverUrl && (
                <img
                  src={coverUrl}
                  alt="Local cover preview"
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="p-5 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] text-primary">
                    {selected.manifest.post_key}
                    <span className="text-muted-foreground">
                      {selectedIndex + 1}/{batch.length}
                    </span>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold">{selected.manifest.title}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-primary/30 text-primary">
                    {batch.length} posts
                  </Badge>
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">
                    {passes.length} passed
                  </Badge>
                  {warnings.length > 0 && (
                    <Badge variant="outline" className="border-amber-500/30 text-amber-300">
                      {warnings.length} warnings
                    </Badge>
                  )}
                  {errors.length > 0 && (
                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                      {errors.length} errors
                    </Badge>
                  )}
                </div>
              </div>
              {batch.length > 1 && (
                <div className="mt-4 flex items-center justify-between rounded-md border border-border/60 bg-background/30 px-2 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIndex((value) => Math.max(0, value - 1))}
                    disabled={selectedIndex === 0 || isUploading}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    Review every package before upload
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSelectedIndex((value) => Math.min(batch.length - 1, value + 1))
                    }
                    disabled={selectedIndex === batch.length - 1 || isUploading}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              )}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {selected.issues.map((issue) => {
                  const Icon =
                    issue.severity === "error"
                      ? XCircle
                      : issue.severity === "warning"
                        ? AlertTriangle
                        : CheckCircle2;
                  const tone =
                    issue.severity === "error"
                      ? "text-destructive"
                      : issue.severity === "warning"
                        ? "text-amber-300"
                        : "text-emerald-400";
                  return (
                    <div
                      key={issue.code}
                      className="flex gap-2 rounded-md border border-border/60 bg-background/40 p-2.5"
                    >
                      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium">{issue.label}</div>
                        <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                          {issue.detail}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {isUploading && <Progress value={progress} className="mt-5 h-1.5" />}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setBatch([])} disabled={isUploading}>
                  Choose another folder
                </Button>
                <Button onClick={uploadBatch} disabled={invalidPackages > 0 || isUploading}>
                  {isUploading ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="mr-2 h-4 w-4" />
                  )}
                  Upload {batch.length} post{batch.length === 1 ? "" : "s"} privately
                </Button>
                {isUploading && (
                  <Button variant="destructive" onClick={() => abortRef.current?.abort()}>
                    Cancel safely
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
