import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.0";
import { buildReelContainerFields } from "../_shared/instagram-reel.ts";

const GRAPH_TIMEOUT_MS = 20_000;
const SIGNED_URL_SECONDS = 12 * 60 * 60;
const MAX_PUBLICATION_ATTEMPTS = 3;

type JsonRecord = Record<string, unknown>;
type Publication = {
  id: string;
  channel: "reel" | "story" | "story_handoff" | "highlight_handoff" | "first_comment" | "feed";
  status: "pending" | "publishing" | "published" | "skipped" | "failed";
  attempts: number;
  platform_container_id: string | null;
  platform_media_id: string | null;
};

function response(body: JsonRecord, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function safeError(error: unknown, token?: string) {
  let message = error instanceof Error ? error.message : String(error);
  if (token) message = message.replaceAll(token, "[REDACTED]");
  return message.replace(/[\r\n]+/g, " ").slice(0, 800);
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function graphRequest(
  apiBaseUrl: string,
  path: string,
  token: string,
  method: "GET" | "POST",
  values: Record<string, string | boolean | number> = {},
) {
  const base = `${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const headers = { Authorization: `Bearer ${token}` };
  let result: Response;
  if (method === "GET") {
    const url = new URL(base);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
    result = await fetchWithTimeout(url.toString(), { headers });
  } else {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) body.set(key, String(value));
    result = await fetchWithTimeout(base, {
      method: "POST",
      headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  }
  const text = await result.text();
  let parsed: JsonRecord = {};
  try {
    parsed = text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  if (!result.ok) {
    const graphError = parsed.error as JsonRecord | undefined;
    const message =
      typeof graphError?.message === "string" ? graphError.message : `HTTP ${result.status}`;
    throw new Error(`Instagram API: ${message}`);
  }
  return parsed;
}

async function authorize(
  request: Request,
  admin: ReturnType<typeof createClient>,
): Promise<{ kind: "cron"; userId: null } | { kind: "operator"; userId: string }> {
  const cronSecret = request.headers.get("x-cron-secret")?.trim();
  if (cronSecret) {
    const { data, error } = await admin.rpc("verify_publisher_cron_secret", {
      _candidate: cronSecret,
    });
    if (!error && data === true) return { kind: "cron", userId: null };
  }

  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!bearer) throw new Error("Unauthorized");
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth.user) throw new Error("Unauthorized");
  const { data: isOperator, error: operatorError } = await admin.rpc("is_operator", {
    _user_id: auth.user.id,
  });
  if (operatorError || isOperator !== true) throw new Error("Unauthorized");
  return { kind: "operator", userId: auth.user.id };
}

async function signedMediaUrl(
  admin: ReturnType<typeof createClient>,
  storagePath: string,
  mediaKind: "video" | "cover",
) {
  const { data, error } = await admin.storage
    .from("ig-publish")
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("Could not create the temporary media URL");

  const check = await fetchWithTimeout(data.signedUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  const contentType = check.headers.get("content-type")?.toLowerCase() ?? "";
  const validContentType =
    mediaKind === "video"
      ? contentType.startsWith("video/mp4")
      : contentType.startsWith("image/jpeg");
  if (!check.ok || !validContentType) {
    throw new Error(
      mediaKind === "video"
        ? "Temporary media URL did not return video/mp4"
        : "Temporary cover URL did not return image/jpeg",
    );
  }
  return data.signedUrl;
}

async function updatePublication(
  admin: ReturnType<typeof createClient>,
  id: string,
  values: JsonRecord,
) {
  const { error } = await admin
    .from("content_publications")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function addEvent(
  admin: ReturnType<typeof createClient>,
  contentPostId: string,
  eventType: string,
  detail: JsonRecord = {},
) {
  const { error } = await admin.from("content_events").insert({
    content_post_id: contentPostId,
    event_type: eventType,
    detail,
  });
  if (error) throw error;
}

async function processVideoPublication(input: {
  admin: ReturnType<typeof createClient>;
  postId: string;
  publication: Publication;
  channel: "reel" | "story";
  storagePath: string;
  coverStoragePath?: string;
  caption: string;
  shareToFeed: boolean;
  igUserId: string;
  apiBaseUrl: string;
  token: string;
}) {
  const { admin, publication, channel, apiBaseUrl, token } = input;
  if (publication.status === "published" || publication.status === "skipped") return "done";
  if (publication.status === "failed") return "failed";

  if (publication.status === "pending") {
    if (publication.attempts >= MAX_PUBLICATION_ATTEMPTS) {
      throw new Error(`${channel} reached the retry limit`);
    }
    const videoUrl = await signedMediaUrl(admin, input.storagePath, "video");
    const body: Record<string, string | boolean | number> = {
      media_type: channel === "reel" ? "REELS" : "STORIES",
      video_url: videoUrl,
    };
    if (channel === "reel") {
      if (!input.coverStoragePath) throw new Error("Reel cover is missing");
      const coverUrl = await signedMediaUrl(admin, input.coverStoragePath, "cover");
      Object.assign(
        body,
        buildReelContainerFields({
          caption: input.caption,
          shareToFeed: input.shareToFeed,
          coverUrl,
        }),
      );
    }
    const created = await graphRequest(apiBaseUrl, `${input.igUserId}/media`, token, "POST", body);
    if (typeof created.id !== "string")
      throw new Error(`Instagram did not return a ${channel} container`);
    await updatePublication(admin, publication.id, {
      status: "publishing",
      attempts: publication.attempts + 1,
      platform_container_id: created.id,
      last_error: null,
    });
    await addEvent(admin, input.postId, `${channel}_container_created`, {
      container_id: created.id,
    });
    return "waiting";
  }

  if (!publication.platform_container_id) throw new Error(`${channel} container id is missing`);
  const status = await graphRequest(apiBaseUrl, publication.platform_container_id, token, "GET", {
    fields: "status_code,status",
  });
  const statusCode = String(status.status_code ?? "").toUpperCase();
  if (["ERROR", "EXPIRED"].includes(statusCode)) {
    throw new Error(`${channel} processing failed: ${String(status.status ?? statusCode)}`);
  }
  if (statusCode !== "FINISHED") return "waiting";

  const published = await graphRequest(
    apiBaseUrl,
    `${input.igUserId}/media_publish`,
    token,
    "POST",
    { creation_id: publication.platform_container_id },
  );
  if (typeof published.id !== "string")
    throw new Error(`Instagram did not return a ${channel} media id`);

  let permalink: string | null = null;
  try {
    const media = await graphRequest(apiBaseUrl, published.id, token, "GET", {
      fields: "id,permalink,media_type,media_product_type,timestamp",
    });
    permalink = typeof media.permalink === "string" ? media.permalink : null;
  } catch {
    // Publishing succeeded. A permalink lookup must never trigger a duplicate retry.
  }
  await updatePublication(admin, publication.id, {
    status: "published",
    platform_media_id: published.id,
    permalink,
    published_at: new Date().toISOString(),
    last_error: null,
  });
  await addEvent(admin, input.postId, `${channel}_published`, {
    media_id: published.id,
    permalink,
  });
  return "done";
}

async function processFirstComment(input: {
  admin: ReturnType<typeof createClient>;
  postId: string;
  publication: Publication | undefined;
  reel: Publication;
  message: string;
  apiBaseUrl: string;
  token: string;
}) {
  const publication = input.publication;
  if (!publication || publication.status === "published" || publication.status === "skipped") {
    return "done";
  }
  if (publication.status === "failed") return "failed";
  if (!input.message.trim()) {
    await updatePublication(input.admin, publication.id, { status: "skipped" });
    return "done";
  }
  if (input.reel.status !== "published" || !input.reel.platform_media_id) return "waiting";
  const posted = await graphRequest(
    input.apiBaseUrl,
    `${input.reel.platform_media_id}/comments`,
    input.token,
    "POST",
    { message: input.message },
  );
  if (typeof posted.id !== "string") throw new Error("Instagram did not return a comment id");
  await updatePublication(input.admin, publication.id, {
    status: "published",
    platform_media_id: posted.id,
    attempts: publication.attempts + 1,
    published_at: new Date().toISOString(),
    last_error: null,
  });
  await addEvent(input.admin, input.postId, "first_comment_published", {
    comment_id: posted.id,
  });
  return "done";
}

async function cleanupExpiredMedia(admin: ReturnType<typeof createClient>) {
  const { data: due, error } = await admin
    .from("content_posts")
    .select("id,reel_storage_path,story_storage_path,cover_storage_path")
    .is("media_cleaned_at", null)
    .lte("media_cleanup_after", new Date().toISOString())
    .limit(5);
  if (error) throw error;

  let cleaned = 0;
  for (const post of due ?? []) {
    const paths = [
      ...new Set(
        [post.reel_storage_path, post.story_storage_path, post.cover_storage_path].filter(Boolean),
      ),
    ] as string[];
    if (paths.length) {
      const { error: removeError } = await admin.storage.from("ig-publish").remove(paths);
      if (removeError) continue;
    }
    const { error: updateError } = await admin
      .from("content_posts")
      .update({ media_cleaned_at: new Date().toISOString() })
      .eq("id", post.id)
      .is("media_cleaned_at", null);
    if (!updateError) {
      cleaned += 1;
      await addEvent(admin, post.id, "temporary_media_cleaned", { paths: paths.length });
    }
  }
  return cleaned;
}

async function processPost(admin: ReturnType<typeof createClient>, postId: string) {
  const { data: post, error: postError } = await admin
    .from("content_posts")
    .select("*")
    .eq("id", postId)
    .single();
  if (postError || !post) throw postError ?? new Error("Content post not found");

  const { data: connection, error: connectionError } = await admin
    .from("ig_connections")
    .select("ig_user_id,ig_username,page_access_token,token_expires_at,status,api_base_url")
    .eq("user_id", post.user_id)
    .eq("status", "active")
    .single();
  if (connectionError || !connection) throw new Error("Healthy Instagram connection not found");
  if (new Date(connection.token_expires_at).getTime() <= Date.now() + 60 * 60 * 1000) {
    throw new Error("Instagram access token expires too soon");
  }

  const { data: rows, error: publicationError } = await admin
    .from("content_publications")
    .select("id,channel,status,attempts,platform_container_id,platform_media_id")
    .eq("content_post_id", postId);
  if (publicationError) throw publicationError;
  const publications = new Map((rows as Publication[]).map((item) => [item.channel, item]));
  const reel = publications.get("reel");
  if (!reel || !post.reel_storage_path) throw new Error("Reel publication is incomplete");

  const apiBaseUrl = connection.api_base_url ?? "https://graph.facebook.com/v25.0";
  const common = {
    admin,
    postId,
    igUserId: connection.ig_user_id,
    apiBaseUrl,
    token: connection.page_access_token,
  };

  const reelState = await processVideoPublication({
    ...common,
    publication: reel,
    channel: "reel",
    storagePath: post.reel_storage_path,
    coverStoragePath: post.cover_storage_path,
    caption: post.caption,
    shareToFeed: post.share_to_feed,
  });
  if (reelState !== "done") return { state: reelState, channel: "reel" };

  const refreshedReel =
    reel.status === "published"
      ? reel
      : ((
          await admin
            .from("content_publications")
            .select("id,channel,status,attempts,platform_container_id,platform_media_id")
            .eq("id", reel.id)
            .single()
        ).data as Publication);

  const commentState = await processFirstComment({
    admin,
    postId,
    publication: publications.get("first_comment"),
    reel: refreshedReel,
    message: post.first_comment,
    apiBaseUrl,
    token: connection.page_access_token,
  });
  if (commentState !== "done") return { state: commentState, channel: "first_comment" };

  if (post.story_publish_mode === "automatic_no_link") {
    const story = publications.get("story");
    if (!story || !post.story_storage_path) throw new Error("Story publication is incomplete");
    const storyState = await processVideoPublication({
      ...common,
      publication: story,
      channel: "story",
      storagePath: post.story_storage_path,
      caption: "",
      shareToFeed: false,
    });
    if (storyState !== "done") return { state: storyState, channel: "story" };
  }

  const completedAt = new Date();
  const cleanupAt = new Date(completedAt.getTime() + 48 * 60 * 60 * 1000);
  const { error: finishError } = await admin
    .from("content_posts")
    .update({
      status: "published",
      published_at: completedAt.toISOString(),
      media_cleanup_after:
        post.story_publish_mode === "automatic_no_link" ? cleanupAt.toISOString() : null,
      publish_lease_until: null,
      last_publish_error: null,
    })
    .eq("id", postId);
  if (finishError) throw finishError;
  await addEvent(admin, postId, "publishing_completed", {
    instagram_username: connection.ig_username,
    story_mode: post.story_publish_mode,
    cleanup_after: post.story_publish_mode === "automatic_no_link" ? cleanupAt.toISOString() : null,
  });
  return { state: "published", channel: null };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return response({ error: "Publisher is not configured" }, 503);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let actor: Awaited<ReturnType<typeof authorize>>;
  try {
    actor = await authorize(request, admin);
  } catch {
    return response({ error: "Unauthorized" }, 401);
  }

  let body: JsonRecord = {};
  try {
    body = (await request.json()) as JsonRecord;
  } catch {
    // Empty cron bodies are valid.
  }
  const requestedPostId = typeof body.content_post_id === "string" ? body.content_post_id : null;
  if (actor.kind === "cron" && requestedPostId) {
    return response({ error: "Cron cannot select an arbitrary post" }, 400);
  }

  let cleaned = 0;
  try {
    cleaned = await cleanupExpiredMedia(admin);
  } catch (error) {
    console.error("[content-publisher] cleanup", safeError(error));
  }

  const { data: claimedId, error: claimError } = await admin.rpc("claim_due_content_post", {
    _content_post_id: requestedPostId,
    _user_id: actor.userId,
  });
  if (claimError) return response({ ok: false, error: safeError(claimError), cleaned }, 500);
  if (!claimedId) return response({ ok: true, state: "idle", cleaned });

  let token: string | undefined;
  try {
    const { data: claimedPost } = await admin
      .from("content_posts")
      .select("user_id")
      .eq("id", claimedId)
      .single();
    if (claimedPost?.user_id) {
      const { data: claimedConnection } = await admin
        .from("ig_connections")
        .select("page_access_token")
        .eq("user_id", claimedPost.user_id)
        .eq("status", "active")
        .maybeSingle();
      token = claimedConnection?.page_access_token;
    }
    const outcome = await processPost(admin, claimedId);
    await admin.rpc("release_content_publish_lease", { _content_post_id: claimedId });
    return response({ ok: true, post_id: claimedId, ...outcome, cleaned });
  } catch (error) {
    const message = safeError(error, token);
    console.error("[content-publisher] post failed", claimedId, message);
    await admin
      .from("content_posts")
      .update({
        status: "failed",
        last_publish_error: message,
        publish_lease_until: null,
      })
      .eq("id", claimedId);
    try {
      await addEvent(admin, claimedId, "publishing_failed", { error: message });
    } catch {
      // Preserve the original failure.
    }
    return response({ ok: false, post_id: claimedId, error: message, cleaned }, 500);
  }
});
