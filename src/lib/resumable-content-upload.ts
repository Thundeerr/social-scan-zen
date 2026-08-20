import { Upload } from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const CHUNK_SIZE = 6 * 1024 * 1024;

export async function uploadContentFile(input: {
  file: File;
  objectPath: string;
  contentType: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!projectId || !publishableKey) throw new Error("Supabase upload configuration is missing.");

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Your operator session has expired.");
  if (input.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", abortUpload);
      callback();
    };
    const upload = new Upload(input.file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: publishableKey,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: async (file) =>
        ["instascanner-v1", input.objectPath, file.size, file.lastModified].join("::"),
      chunkSize: CHUNK_SIZE,
      metadata: {
        bucketName: "ig-publish",
        objectName: input.objectPath,
        contentType: input.contentType,
        cacheControl: "31536000",
      },
      onError: (uploadError) => finish(() => reject(uploadError)),
      onProgress: (uploaded, total) => input.onProgress?.(total > 0 ? uploaded / total : 0),
      onSuccess: () => finish(resolve),
    });

    const abortUpload = () => {
      void upload
        .abort()
        .finally(() => finish(() => reject(new DOMException("Upload cancelled", "AbortError"))));
    };
    input.signal?.addEventListener("abort", abortUpload, { once: true });

    void upload.findPreviousUploads().then(
      (previous) => {
        if (input.signal?.aborted) return abortUpload();
        const newestValid = previous
          .filter(
            (item) => Date.now() - new Date(item.creationTime).getTime() < 23 * 60 * 60 * 1000,
          )
          .sort(
            (left, right) =>
              new Date(right.creationTime).getTime() - new Date(left.creationTime).getTime(),
          )[0];
        if (newestValid) upload.resumeFromPreviousUpload(newestValid);
        upload.start();
      },
      (previousError) => finish(() => reject(previousError)),
    );
  });
}
