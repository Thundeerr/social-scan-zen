import type { Database } from "@/integrations/supabase/types";
import { isAllowedFollowerStarStoryUrl } from "./story-link";

type ContentPost = Database["public"]["Tables"]["content_posts"]["Row"];

export type PublisherPreflightPost = Pick<
  ContentPost,
  | "alt_text"
  | "caption"
  | "cover_storage_path"
  | "first_comment"
  | "media_manifest"
  | "post_key"
  | "quality_report"
  | "reel_storage_path"
  | "scheduled_for"
  | "share_to_feed"
  | "status"
  | "story_link_label"
  | "story_link_url"
  | "story_publish_mode"
  | "story_storage_path"
>;

export type PreflightCheck = {
  code: string;
  label: string;
  detail: string;
  state: "pass" | "warning" | "blocker" | "manual";
};

export type PublishPlanStep = {
  channel: "reel" | "first_comment" | "story_handoff";
  label: string;
  detail: string;
  dependsOn: "reel" | null;
  state: "ready" | "blocked" | "skipped" | "manual";
};

export type PublisherDryRun = {
  ready: boolean;
  statusLabel: string;
  statusTone: "success" | "warning" | "danger" | "neutral";
  blockers: PreflightCheck[];
  warnings: PreflightCheck[];
  checks: PreflightCheck[];
  steps: PublishPlanStep[];
};

type MediaRecord = {
  bytes?: number;
  durationSeconds?: number | null;
  height?: number;
  width?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mediaRecord(manifest: unknown, role: "reel" | "story") {
  if (!isRecord(manifest) || !isRecord(manifest[role])) return null;
  return manifest[role] as MediaRecord;
}

function importedQualityErrors(report: unknown) {
  if (!Array.isArray(report)) return [];
  return report.filter(
    (item): item is Record<string, unknown> => isRecord(item) && item.severity === "error",
  );
}

function technicalVideoCheck(role: "reel" | "story", media: MediaRecord | null): PreflightCheck {
  const label = role === "reel" ? "Reel export" : "Story export";
  if (!media) {
    return {
      code: `${role}_metadata`,
      label,
      detail: "Technical metadata is missing. Re-import this package before approval.",
      state: "blocker",
    };
  }
  if (media.width !== 1080 || media.height !== 1920) {
    return {
      code: `${role}_metadata`,
      label,
      detail: `Expected 1080×1920, found ${media.width ?? "?"}×${media.height ?? "?"}.`,
      state: "blocker",
    };
  }
  const duration = media.durationSeconds;
  const durationLimit = role === "reel" ? 180 : 60;
  if (typeof duration !== "number" || duration <= 0 || duration > durationLimit) {
    return {
      code: `${role}_metadata`,
      label,
      detail: `Duration must be between 0 and ${durationLimit} seconds.`,
      state: "blocker",
    };
  }
  if (typeof media.bytes !== "number" || media.bytes <= 0 || media.bytes > 500 * 1024 * 1024) {
    return {
      code: `${role}_metadata`,
      label,
      detail: "The file is empty, above 500 MB or its size could not be verified.",
      state: "blocker",
    };
  }
  return {
    code: `${role}_metadata`,
    label,
    detail: `1080×1920 · ${duration.toFixed(1)}s · ${(media.bytes / 1024 / 1024).toFixed(1)} MB`,
    state: "pass",
  };
}

function displayStatus(post: PublisherPreflightPost, ready: boolean) {
  if (!ready) return { statusLabel: "Action required", statusTone: "danger" as const };
  if (post.status === "failed")
    return { statusLabel: "Failed · retry available", statusTone: "danger" as const };
  if (post.status === "published")
    return { statusLabel: "Published", statusTone: "success" as const };
  if (post.status === "publishing")
    return { statusLabel: "Publishing", statusTone: "warning" as const };
  if (post.status === "scheduled")
    return { statusLabel: "Scheduled", statusTone: "success" as const };
  if (post.status === "approved")
    return { statusLabel: "Approved · waiting for schedule", statusTone: "success" as const };
  if (post.status === "changes_requested")
    return { statusLabel: "Changes requested", statusTone: "warning" as const };
  return { statusLabel: "Ready for review", statusTone: "neutral" as const };
}

export function buildPublisherDryRun(post: PublisherPreflightPost): PublisherDryRun {
  const qualityErrors = importedQualityErrors(post.quality_report);
  const checks: PreflightCheck[] = [
    {
      code: "cover",
      label: "Profile cover",
      detail: post.cover_storage_path
        ? "Uploaded and profile crop available."
        : "Cover is missing.",
      state: post.cover_storage_path ? "pass" : "blocker",
    },
    {
      code: "reel_asset",
      label: "Reel asset",
      detail: post.reel_storage_path ? "Uploaded to private storage." : "Reel is missing.",
      state: post.reel_storage_path ? "pass" : "blocker",
    },
    technicalVideoCheck("reel", mediaRecord(post.media_manifest, "reel")),
    {
      code: "story_asset",
      label: "Story asset",
      detail: post.story_storage_path ? "Uploaded to private storage." : "Story is missing.",
      state: post.story_storage_path ? "pass" : "blocker",
    },
    technicalVideoCheck("story", mediaRecord(post.media_manifest, "story")),
    {
      code: "caption",
      label: "Caption",
      detail:
        post.caption.trim().length >= 10 && post.caption.length <= 2200
          ? `${post.caption.length}/2200 characters.`
          : "Caption must contain 10–2200 characters.",
      state: post.caption.trim().length >= 10 && post.caption.length <= 2200 ? "pass" : "blocker",
    },
    {
      code: "first_comment",
      label: "First comment",
      detail: post.first_comment.trim()
        ? `${post.first_comment.length}/2200 characters · waits for the Reel.`
        : "Optional · this step will be skipped.",
      state:
        post.first_comment.length > 2200
          ? "blocker"
          : post.first_comment.trim()
            ? "pass"
            : "warning",
    },
    {
      code: "alt_text",
      label: "Alt text",
      detail: post.alt_text.trim()
        ? `${post.alt_text.length}/1000 characters.`
        : "Recommended for accessibility.",
      state: post.alt_text.length > 1000 ? "blocker" : post.alt_text.trim() ? "pass" : "warning",
    },
    {
      code: "story_link",
      label: "Story link",
      detail:
        isAllowedFollowerStarStoryUrl(post.story_link_url) && post.story_link_label.trim()
          ? `${post.story_link_label} · tracked FollowerStar HTTPS link.`
          : "A valid FollowerStar HTTPS link and sticker label are required.",
      state:
        isAllowedFollowerStarStoryUrl(post.story_link_url) && post.story_link_label.trim()
          ? "pass"
          : "blocker",
    },
    {
      code: "story_mode",
      label: "Story publishing mode",
      detail:
        post.story_publish_mode === "manual_link_sticker"
          ? "Manual link-sticker confirmation is enforced."
          : "Story link posts must use the manual link-sticker handoff.",
      state: post.story_publish_mode === "manual_link_sticker" ? "pass" : "blocker",
    },
    {
      code: "quality_report",
      label: "Import quality report",
      detail: qualityErrors.length
        ? `${qualityErrors.length} blocking import issue${qualityErrors.length === 1 ? "" : "s"} remain.`
        : "No blocking import issues.",
      state: qualityErrors.length ? "blocker" : "pass",
    },
    {
      code: "frame_rate",
      label: "Frame rate",
      detail: "Confirm 30 FPS in the final exported file. Browsers cannot verify FPS reliably.",
      state: "manual",
    },
  ];

  if (post.scheduled_for) {
    const scheduledAt = new Date(post.scheduled_for).getTime();
    checks.push({
      code: "schedule",
      label: "Schedule",
      detail:
        Number.isFinite(scheduledAt) && scheduledAt > Date.now()
          ? `Future slot: ${new Date(scheduledAt).toLocaleString()}.`
          : "Scheduled time is invalid or already in the past.",
      state: Number.isFinite(scheduledAt) && scheduledAt > Date.now() ? "pass" : "blocker",
    });
  }

  const blockers = checks.filter((check) => check.state === "blocker");
  const warnings = checks.filter((check) => check.state === "warning" || check.state === "manual");
  const ready = blockers.length === 0;
  const reelReady = ready && Boolean(post.reel_storage_path);
  const storyReady = ready && post.story_publish_mode === "manual_link_sticker";
  const steps: PublishPlanStep[] = [
    {
      channel: "reel",
      label: post.share_to_feed ? "Reel + Feed" : "Reel only",
      detail: post.share_to_feed
        ? "One Reel publication with Feed sharing enabled."
        : "One Reel publication without Feed sharing.",
      dependsOn: null,
      state: reelReady ? "ready" : "blocked",
    },
    {
      channel: "first_comment",
      label: "First comment",
      detail: post.first_comment.trim()
        ? "Runs only after the Reel is confirmed as published."
        : "No first comment included.",
      dependsOn: "reel",
      state: !post.first_comment.trim() ? "skipped" : reelReady ? "ready" : "blocked",
    },
    {
      channel: "story_handoff",
      label: "Story link handoff",
      detail: "Download Story, copy link, add the link sticker and confirm on mobile.",
      dependsOn: null,
      state: storyReady ? "manual" : "blocked",
    },
  ];
  return {
    ready,
    ...displayStatus(post, ready),
    blockers,
    warnings,
    checks,
    steps,
  };
}
