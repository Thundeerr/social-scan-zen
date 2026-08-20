import { z } from "zod";

export const contentManifestSchema = z.object({
  version: z.literal(1),
  post_key: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]+$/,
      "Use only letters, numbers, dots, dashes and underscores",
    ),
  title: z.string().trim().min(2).max(120),
  hook: z.string().trim().min(2).max(180),
  caption: z.string().trim().min(10).max(2200),
  first_comment: z.string().trim().max(2200).default(""),
  alt_text: z.string().trim().max(1000).default(""),
  content_pillar: z.string().trim().max(80).default("Product showcase"),
  files: z.object({
    cover: z.string().trim().min(1),
    reel: z.string().trim().min(1),
    story: z.string().trim().min(1),
  }),
});

export type ContentManifest = z.infer<typeof contentManifestSchema>;
export type PackageFileRole = "cover" | "reel" | "story";

export type MediaMetadata = {
  role: PackageFileRole;
  filename: string;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
  durationSeconds: number | null;
  sha256: string;
};

export type PackageIssue = {
  severity: "error" | "warning" | "pass";
  code: string;
  label: string;
  detail: string;
};

export type PreparedContentPackage = {
  manifest: ContentManifest;
  files: Record<PackageFileRole, File>;
  media: Record<PackageFileRole, MediaMetadata>;
  issues: PackageIssue[];
  packageSha256: string;
};

function baseName(value: string) {
  return value.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
}

function selectedPath(file: File) {
  return file.webkitRelativePath || file.name;
}

function directoryName(value: string) {
  const normalized = value.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

function extension(value: string) {
  const name = baseName(value);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1) : "bin";
}

export function storageExtension(file: File) {
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
  };
  return byType[file.type] ?? extension(file.name);
}

async function sha256(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function inspectImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`${file.name} could not be read as an image`));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function inspectVideo(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number; durationSeconds: number }>(
      (resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () =>
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
          });
        video.onerror = () => reject(new Error(`${file.name} could not be read as a video`));
        video.src = url;
      },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function inspectMedia(role: PackageFileRole, file: File): Promise<MediaMetadata> {
  const buffer = await file.arrayBuffer();
  if (role === "cover") {
    const dimensions = await inspectImage(file);
    return {
      role,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      bytes: file.size,
      ...dimensions,
      durationSeconds: null,
      sha256: await sha256(buffer),
    };
  }

  const metadata = await inspectVideo(file);
  return {
    role,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    bytes: file.size,
    ...metadata,
    sha256: await sha256(buffer),
  };
}

function ratioClose(width: number, height: number, target: number, tolerance = 0.025) {
  return height > 0 && Math.abs(width / height - target) <= tolerance;
}

function validatePreparedPackage(
  manifest: ContentManifest,
  media: Record<PackageFileRole, MediaMetadata>,
): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const vertical = 9 / 16;
  const coverRatio = 420 / 654;

  if (!media.cover.contentType.startsWith("image/")) {
    issues.push({
      severity: "error",
      code: "cover_type",
      label: "Cover format",
      detail: "Cover must be an image.",
    });
  } else if (media.cover.width < 420 || media.cover.height < 654) {
    issues.push({
      severity: "error",
      code: "cover_size",
      label: "Cover resolution",
      detail: `${media.cover.width}×${media.cover.height} is below Instagram's recommended 420×654 minimum.`,
    });
  } else {
    issues.push({
      severity: "pass",
      code: "cover_size",
      label: "Cover resolution",
      detail: `${media.cover.width}×${media.cover.height}`,
    });
  }

  if (!ratioClose(media.cover.width, media.cover.height, coverRatio, 0.04)) {
    issues.push({
      severity: "warning",
      code: "cover_ratio",
      label: "Profile crop",
      detail: "Cover differs from Instagram's recommended 1:1.55 ratio. Check the crop preview.",
    });
  }

  for (const role of ["reel", "story"] as const) {
    const item = media[role];
    const label = role === "reel" ? "Reel" : "Story";
    if (!item.contentType.startsWith("video/")) {
      issues.push({
        severity: "error",
        code: `${role}_type`,
        label: `${label} format`,
        detail: `${label} must be a video.`,
      });
    }
    if (!ratioClose(item.width, item.height, vertical)) {
      issues.push({
        severity: "error",
        code: `${role}_ratio`,
        label: `${label} ratio`,
        detail: `${item.width}×${item.height} is not 9:16.`,
      });
    } else {
      issues.push({
        severity: "pass",
        code: `${role}_ratio`,
        label: `${label} ratio`,
        detail: `${item.width}×${item.height} · 9:16`,
      });
    }
    if (item.width !== 1080 || item.height !== 1920) {
      issues.push({
        severity: "error",
        code: `${role}_size`,
        label: `${label} resolution`,
        detail: `Export ${label} as 1080×1920 instead of ${item.width}×${item.height}.`,
      });
    } else {
      issues.push({
        severity: "pass",
        code: `${role}_size`,
        label: `${label} resolution`,
        detail: "1080×1920 · Instagram-ready",
      });
    }
  }

  if ((media.reel.durationSeconds ?? 0) > 180) {
    issues.push({
      severity: "error",
      code: "reel_duration",
      label: "Reel duration",
      detail: "Reels above 3 minutes are not recommended to new audiences.",
    });
  } else if ((media.reel.durationSeconds ?? 0) > 30) {
    issues.push({
      severity: "warning",
      code: "reel_duration",
      label: "Reel duration",
      detail: `${media.reel.durationSeconds?.toFixed(1)}s — longer than the 15–20s FollowerStar template target.`,
    });
  } else {
    issues.push({
      severity: "pass",
      code: "reel_duration",
      label: "Reel duration",
      detail: `${media.reel.durationSeconds?.toFixed(1)}s`,
    });
  }

  if (!manifest.alt_text) {
    issues.push({
      severity: "warning",
      code: "alt_text",
      label: "Alt text",
      detail: "Add alt text for accessibility and a complete publishing package.",
    });
  } else {
    issues.push({ severity: "pass", code: "alt_text", label: "Alt text", detail: "Included" });
  }

  if (!manifest.first_comment) {
    issues.push({
      severity: "warning",
      code: "first_comment",
      label: "First comment",
      detail: "No first comment is included.",
    });
  } else {
    issues.push({
      severity: "pass",
      code: "first_comment",
      label: "First comment",
      detail: "Included",
    });
  }

  return issues;
}

export async function prepareContentPackage(
  selectedFiles: File[],
): Promise<PreparedContentPackage> {
  const manifestCandidates = selectedFiles.filter(
    (file) => baseName(file.name) === "manifest.json",
  );
  if (manifestCandidates.length !== 1) {
    throw new Error("Select one post folder containing exactly one manifest.json file.");
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await manifestCandidates[0].text());
  } catch {
    throw new Error("manifest.json is not valid JSON.");
  }

  const parsed = contentManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Manifest error at ${first.path.join(".") || "root"}: ${first.message}`);
  }

  const byName = new Map<string, File[]>();
  for (const file of selectedFiles) {
    const name = baseName(file.name);
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }

  const resolveFile = (name: string, role: PackageFileRole) => {
    const matches = byName.get(baseName(name)) ?? [];
    if (matches.length === 0) throw new Error(`Missing ${role} file: ${name}`);
    if (matches.length > 1) throw new Error(`More than one file is named ${baseName(name)}.`);
    return matches[0];
  };

  const files = {
    cover: resolveFile(parsed.data.files.cover, "cover"),
    reel: resolveFile(parsed.data.files.reel, "reel"),
    story: resolveFile(parsed.data.files.story, "story"),
  };

  const inspected = await Promise.all(
    (Object.entries(files) as [PackageFileRole, File][]).map(([role, file]) =>
      inspectMedia(role, file),
    ),
  );
  const media = Object.fromEntries(inspected.map((item) => [item.role, item])) as Record<
    PackageFileRole,
    MediaMetadata
  >;
  const packageSha256 = await sha256(
    new TextEncoder().encode(
      JSON.stringify({
        manifest: parsed.data,
        hashes: inspected.map((item) => item.sha256).sort(),
      }),
    ).buffer,
  );

  return {
    manifest: parsed.data,
    files,
    media,
    issues: validatePreparedPackage(parsed.data, media),
    packageSha256,
  };
}

export async function prepareContentBatch(
  selectedFiles: File[],
): Promise<PreparedContentPackage[]> {
  const manifests = selectedFiles.filter((file) => baseName(file.name) === "manifest.json");
  if (manifests.length === 0) {
    throw new Error("No manifest.json found. Select a post folder or a batch folder.");
  }

  const packages = await Promise.all(
    manifests.map((manifest) => {
      const directory = directoryName(selectedPath(manifest));
      const files = selectedFiles.filter((file) => directoryName(selectedPath(file)) === directory);
      return prepareContentPackage(files);
    }),
  );

  const duplicateKey = packages.find(
    (item, index) =>
      packages.findIndex((candidate) => candidate.manifest.post_key === item.manifest.post_key) !==
      index,
  );
  if (duplicateKey)
    throw new Error(`Duplicate post_key in batch: ${duplicateKey.manifest.post_key}`);

  const duplicateMedia = packages.find(
    (item, index) =>
      packages.findIndex((candidate) => candidate.packageSha256 === item.packageSha256) !== index,
  );
  if (duplicateMedia) {
    throw new Error(`Duplicate media package in batch: ${duplicateMedia.manifest.post_key}`);
  }

  return packages.sort((a, b) => a.manifest.post_key.localeCompare(b.manifest.post_key));
}

export function packageHasErrors(prepared: PreparedContentPackage) {
  return prepared.issues.some((issue) => issue.severity === "error");
}
