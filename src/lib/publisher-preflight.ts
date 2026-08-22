import type { Database } from "@/integrations/supabase/types";
import { isAllowedFollowerStarStoryUrl } from "./story-link";

type ContentPost = Database["public"]["Tables"]["content_posts"]["Row"];

export type PublisherPreflightPost = Pick<
  ContentPost,
  | "alt_text"
  | "caption"
  | "content_type"
  | "cover_storage_path"
  | "first_comment"
  | "highlight_enabled"
  | "highlight_name"
  | "media_manifest"
  | "post_key"
  | "primary_media_alt_texts"
  | "primary_media_storage_paths"
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
  channel: "reel" | "first_comment" | "story" | "story_handoff" | "highlight_handoff";
  label: string;
  detail: string;
  dependsOn: "reel" | "story" | "story_handoff" | null;
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

function mediaRecord(manifest: unknown, role: string) {
  if (!isRecord(manifest) || !isRecord(manifest[role])) return null;
  return manifest[role] as MediaRecord;
}

function technicalImageCheck(
  role: string,
  label: string,
  media: MediaRecord | null,
  expected: { width: number; height: number },
): PreflightCheck {
  if (!media) {
    return {
      code: `${role}_metadata`,
      label,
      detail: "Technical metadata is missing. Re-import this package before approval.",
      state: "blocker",
    };
  }
  if (media.width !== expected.width || media.height !== expected.height) {
    return {
      code: `${role}_metadata`,
      label,
      detail: `Expected ${expected.width}×${expected.height}, found ${media.width ?? "?"}×${media.height ?? "?"}.`,
      state: "blocker",
    };
  }
  if (typeof media.bytes !== "number" || media.bytes <= 0 || media.bytes > 20 * 1024 * 1024) {
    return {
      code: `${role}_metadata`,
      label,
      detail: "The JPEG is empty, above 20 MB or its size could not be verified.",
      state: "blocker",
    };
  }
  return {
    code: `${role}_metadata`,
    label,
    detail: `${expected.width}×${expected.height} · ${(media.bytes / 1024 / 1024).toFixed(1)} MB`,
    state: "pass",
  };
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
  const isReel = post.content_type === "reel";
  const primaryChecks: PreflightCheck[] = isReel
    ? [
        {
          code: "reel_asset",
          label: "Reel asset",
          detail: post.reel_storage_path ? "Uploaded to private storage." : "Reel is missing.",
          state: post.reel_storage_path ? "pass" : "blocker",
        },
        technicalVideoCheck("reel", mediaRecord(post.media_manifest, "reel")),
      ]
    : post.primary_media_storage_paths.map((_, index) => {
        const role = post.content_type === "image" ? "image" : `slide_${index + 1}`;
        return technicalImageCheck(
          role,
          post.content_type === "image" ? "Feed image" : `Carousel slide ${index + 1}`,
          mediaRecord(post.media_manifest, role),
          { width: 1080, height: 1350 },
        );
      });
  if (!isReel && post.primary_media_storage_paths.length === 0) {
    primaryChecks.push({
      code: "primary_asset",
      label: post.content_type === "carousel" ? "Carousel slides" : "Feed image",
      detail: "Primary media is missing.",
      state: "blocker",
    });
  }
  if (post.content_type === "carousel" && (post.primary_media_storage_paths.length < 2 || post.primary_media_storage_paths.length > 10)) {
    primaryChecks.push({
      code: "carousel_count",
      label: "Carousel order",
      detail: "A carousel requires 2–10 ordered slides.",
      state: "blocker",
    });
  }
  const checks: PreflightCheck[] = [
    {
      code: "cover",
      label: "Profile cover",
      detail: post.cover_storage_path
        ? "Uploaded and profile crop available."
        : "Cover is missing.",
      state: post.cover_storage_path ? "pass" : "blocker",
    },
    ...primaryChecks,
    {
      code: "story_asset",
      label: "Story asset",
      detail: post.story_storage_path ? "Uploaded to private storage." : "Story is missing.",
      state: post.story_storage_path ? "pass" : "blocker",
    },
    isReel
      ? technicalVideoCheck("story", mediaRecord(post.media_manifest, "story"))
      : technicalImageCheck("story", "Story image", mediaRecord(post.media_manifest, "story"), {
          width: 1080,
          height: 1920,
        }),
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
      label: post.story_publish_mode === "automatic_no_link" ? "Automatic Story" : "Story link",
      detail:
        post.story_publish_mode === "automatic_no_link"
          ? "Publishes through the cloud worker without a link sticker."
          : isAllowedFollowerStarStoryUrl(post.story_link_url) && post.story_link_label.trim()
            ? `${post.story_link_label} · tracked FollowerStar HTTPS link.`
            : "A valid FollowerStar HTTPS link and sticker label are required.",
      state:
        post.story_publish_mode === "automatic_no_link" ||
        (isAllowedFollowerStarStoryUrl(post.story_link_url) && post.story_link_label.trim())
          ? "pass"
          : "blocker",
    },
    {
      code: "story_mode",
      label: "Story publishing mode",
      detail:
        post.story_publish_mode === "manual_link_sticker"
          ? "Manual link-sticker confirmation is enforced."
          : "Automatic cloud publishing is enabled without a link sticker.",
      state: "pass",
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
      code: "highlight_target",
      label: "Highlight target",
      detail: post.highlight_enabled
        ? post.highlight_name.trim()
          ? `After Story publishing: ${post.highlight_name.trim()}.`
          : "Choose the destination Highlight."
        : "Highlight handoff disabled for this post.",
      state: post.highlight_enabled
        ? post.highlight_name.trim()
          ? "manual"
          : "blocker"
        : "warning",
    },
    {
      code: "frame_rate",
      label: isReel ? "Frame rate" : "Feed crop",
      detail: isReel
        ? "Confirm 30 FPS in the final exported file. Browsers cannot verify FPS reliably."
        : "1080×1350 media uses the 4:5 feed-safe format.",
      state: isReel ? "manual" : "pass",
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
  const reelReady =
    ready &&
    (isReel ? Boolean(post.reel_storage_path) : post.primary_media_storage_paths.length > 0);
  const storyReady = ready;
  const steps: PublishPlanStep[] = [
    {
      channel: "reel",
      label: isReel
        ? post.share_to_feed
          ? "Reel + Feed"
          : "Reel only"
        : post.content_type === "carousel"
          ? "Carousel post"
          : "Image post",
      detail: isReel
        ? post.share_to_feed
          ? "One Reel publication with Feed sharing enabled."
          : "One Reel publication without Feed sharing."
        : post.content_type === "carousel"
          ? `One ordered ${post.primary_media_storage_paths.length}-slide Feed post.`
          : "One 4:5 image Feed post.",
      dependsOn: null,
      state: reelReady ? "ready" : "blocked",
    },
    {
      channel: "first_comment",
      label: "First comment",
      detail: post.first_comment.trim()
        ? "Runs only after the primary post is confirmed as published."
        : "No first comment included.",
      dependsOn: "reel",
      state: !post.first_comment.trim() ? "skipped" : reelReady ? "ready" : "blocked",
    },
    {
      channel: post.story_publish_mode === "automatic_no_link" ? "story" : "story_handoff",
      label:
        post.story_publish_mode === "automatic_no_link" ? "Automatic Story" : "Story link handoff",
      detail:
        post.story_publish_mode === "automatic_no_link"
          ? "Publishes after the primary post and first comment without a link sticker."
          : "Download Story, copy link, add the link sticker and confirm on mobile.",
      dependsOn: null,
      state: storyReady
        ? post.story_publish_mode === "automatic_no_link"
          ? "ready"
          : "manual"
        : "blocked",
    },
    {
      channel: "highlight_handoff",
      label: post.highlight_enabled ? `Add to ${post.highlight_name}` : "Highlight",
      detail: post.highlight_enabled
        ? "Instagram does not expose Highlights in its official API; one confirmation remains in the app."
        : "No Highlight requested.",
      dependsOn: post.story_publish_mode === "automatic_no_link" ? "story" : "story_handoff",
      state: !post.highlight_enabled ? "skipped" : storyReady ? "manual" : "blocked",
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
