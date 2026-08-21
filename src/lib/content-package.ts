import { z } from "zod";
import { isAllowedFollowerStarStoryUrl, withInstagramStoryTracking } from "./story-link";

export const contentManifestSchema = z
  .object({
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
    highlight_enabled: z.boolean().default(true),
    highlight_name: z
      .string()
      .trim()
      .max(30)
      .regex(/^[^\r\n]*$/)
      .default(""),
    share_to_feed: z.boolean().default(true),
    story_publish_mode: z
      .enum(["manual_link_sticker", "automatic_no_link"])
      .default("manual_link_sticker"),
    story_link_url: z.string().trim().max(2048).default(""),
    story_link_label: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(/^[^\r\n]+$/, "Story link label must fit on one line")
      .default("Try it now"),
    files: z.object({
      cover: z.string().trim().min(1),
      reel: z.string().trim().min(1),
      story: z.string().trim().min(1),
    }),
  })
  .superRefine((manifest, context) => {
    if (
      manifest.story_publish_mode === "manual_link_sticker" &&
      !isAllowedFollowerStarStoryUrl(manifest.story_link_url)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["story_link_url"],
        message: "Manual Story mode requires HTTPS on followerstar.com or a FollowerStar subdomain",
      });
    }
    if (manifest.story_publish_mode === "automatic_no_link" && manifest.story_link_url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["story_link_url"],
        message: "Automatic Story mode cannot add a link sticker; leave story_link_url empty",
      });
    }
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
  mediaSha256: string;
  packageSha256: string;
};

export const MAX_BATCH_POSTS = 100;
const MAX_BATCH_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_COVER_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 20_000;

export function suggestedHighlightName(contentPillar: string) {
  const value = contentPillar.toLowerCase();
  if (/result|case|proof|testimonial/.test(value)) return "Results";
  if (/guide|blog|education|learn/.test(value)) return "Guides";
  if (/tip|growth|strategy/.test(value)) return "Growth Tips";
  if (/update|news|launch/.test(value)) return "Updates";
  if (/faq|question|support/.test(value)) return "FAQ";
  return "Free Tools";
}

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

function inferredContentType(file: File) {
  if (file.type) return file.type.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp4: "video/mp4",
    mov: "video/quicktime",
  };
  return byExtension[extension(file.name)] ?? "application/octet-stream";
}

export function storageExtension(file: File) {
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
  };
  return byType[inferredContentType(file)] ?? extension(file.name);
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
      const timer = window.setTimeout(
        () => reject(new Error(`${file.name} took too long to read as an image`)),
        METADATA_TIMEOUT_MS,
      );
      image.onload = () => {
        window.clearTimeout(timer);
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error(`${file.name} could not be read as an image`));
      };
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
        const timer = window.setTimeout(() => {
          video.removeAttribute("src");
          video.load();
          reject(new Error(`${file.name} took too long to read as a video`));
        }, METADATA_TIMEOUT_MS);
        video.onloadedmetadata = () => {
          window.clearTimeout(timer);
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
          });
        };
        video.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error(`${file.name} could not be read as a video`));
        };
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
      contentType: inferredContentType(file),
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
    contentType: inferredContentType(file),
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

  if (!["image/jpeg", "image/png", "image/webp"].includes(media.cover.contentType)) {
    issues.push({
      severity: "error",
      code: "cover_type",
      label: "Cover format",
      detail: "Cover must be JPG, PNG or WebP.",
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
    if (item.contentType !== "video/mp4") {
      issues.push({
        severity: "error",
        code: `${role}_type`,
        label: `${label} format`,
        detail: `${label} must be an MP4 for reliable Instagram publishing.`,
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

  for (const role of ["reel", "story"] as const) {
    const duration = media[role].durationSeconds ?? 0;
    if (duration <= 0) {
      issues.push({
        severity: "error",
        code: `${role}_duration_valid`,
        label: `${role === "reel" ? "Reel" : "Story"} duration`,
        detail: "Video duration could not be verified.",
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
  } else if ((media.reel.durationSeconds ?? 0) > 0) {
    issues.push({
      severity: "pass",
      code: "reel_duration",
      label: "Reel duration",
      detail: `${media.reel.durationSeconds?.toFixed(1)}s`,
    });
  }

  if ((media.story.durationSeconds ?? 0) > 60) {
    issues.push({
      severity: "error",
      code: "story_duration",
      label: "Story duration",
      detail: "Story video must be 60 seconds or shorter.",
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

  if (manifest.highlight_enabled) {
    issues.push({
      severity: "pass",
      code: "highlight_handoff",
      label: "Highlight target",
      detail: manifest.highlight_name || suggestedHighlightName(manifest.content_pillar),
    });
  }

  issues.push({
    severity: "pass",
    code: "story_delivery",
    label:
      manifest.story_publish_mode === "automatic_no_link"
        ? "Automatic Story"
        : "Story link handoff",
    detail:
      manifest.story_publish_mode === "automatic_no_link"
        ? "Publishes automatically without a link sticker."
        : `${manifest.story_link_label} · FollowerStar HTTPS link`,
  });

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
  if (manifestCandidates[0].size > MAX_MANIFEST_BYTES) {
    throw new Error("manifest.json exceeds the 256 KB safety limit.");
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse((await manifestCandidates[0].text()).replace(/^\uFEFF/, ""));
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

  for (const [role, file] of Object.entries(files) as [PackageFileRole, File][]) {
    if (file.size <= 0) throw new Error(`${file.name} is empty.`);
    const limit = role === "cover" ? MAX_COVER_BYTES : MAX_VIDEO_BYTES;
    if (file.size > limit) {
      const limitMb = Math.round(limit / 1024 / 1024);
      throw new Error(`${file.name} exceeds the ${limitMb} MB ${role} safety limit.`);
    }
  }

  const inspected: MediaMetadata[] = [];
  for (const [role, file] of Object.entries(files) as [PackageFileRole, File][]) {
    inspected.push(await inspectMedia(role, file));
  }
  const media = Object.fromEntries(inspected.map((item) => [item.role, item])) as Record<
    PackageFileRole,
    MediaMetadata
  >;
  const mediaSha256 = await sha256(
    new TextEncoder().encode(
      JSON.stringify(inspected.map((item) => [item.role, item.sha256]).sort()),
    ).buffer,
  );
  const packageSha256 = await sha256(
    new TextEncoder().encode(
      JSON.stringify({
        manifest: parsed.data,
        mediaSha256,
      }),
    ).buffer,
  );

  return {
    manifest: {
      ...parsed.data,
      highlight_name:
        parsed.data.highlight_name || suggestedHighlightName(parsed.data.content_pillar),
      story_link_url:
        parsed.data.story_publish_mode === "manual_link_sticker"
          ? withInstagramStoryTracking(parsed.data.story_link_url, parsed.data.post_key)
          : "",
    },
    files,
    media,
    issues: validatePreparedPackage(parsed.data, media),
    mediaSha256,
    packageSha256,
  };
}

export async function prepareContentBatch(
  selectedFiles: File[],
  onProgress?: (completed: number, total: number) => void,
): Promise<PreparedContentPackage[]> {
  const manifests = selectedFiles.filter((file) => baseName(file.name) === "manifest.json");
  if (manifests.length === 0) {
    throw new Error("No manifest.json found. Select a post folder or a batch folder.");
  }

  if (manifests.length > MAX_BATCH_POSTS) {
    throw new Error(`A batch can contain at most ${MAX_BATCH_POSTS} posts.`);
  }
  if (manifests.length > 1 && manifests.some((file) => !directoryName(selectedPath(file)))) {
    throw new Error(
      "This browser did not preserve the batch folders. Import from desktop Chrome or Edge.",
    );
  }
  const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_BATCH_BYTES) {
    throw new Error("This batch exceeds 5 GB. Split it into smaller batch folders.");
  }

  const packages: PreparedContentPackage[] = [];
  for (const manifest of manifests) {
    const directory = directoryName(selectedPath(manifest));
    const files = selectedFiles.filter((file) => directoryName(selectedPath(file)) === directory);
    packages.push(await prepareContentPackage(files));
    onProgress?.(packages.length, manifests.length);
  }

  const duplicateKey = packages.find(
    (item, index) =>
      packages.findIndex(
        (candidate) =>
          candidate.manifest.post_key.toLowerCase() === item.manifest.post_key.toLowerCase(),
      ) !== index,
  );
  if (duplicateKey)
    throw new Error(`Duplicate post_key in batch: ${duplicateKey.manifest.post_key}`);

  const duplicateMedia = packages.find(
    (item, index) =>
      packages.findIndex((candidate) => candidate.mediaSha256 === item.mediaSha256) !== index,
  );
  if (duplicateMedia) {
    throw new Error(`Duplicate media package in batch: ${duplicateMedia.manifest.post_key}`);
  }

  return packages.sort((a, b) => a.manifest.post_key.localeCompare(b.manifest.post_key));
}

export function packageHasErrors(prepared: PreparedContentPackage) {
  return prepared.issues.some((issue) => issue.severity === "error");
}
