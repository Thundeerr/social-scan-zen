import { Upload } from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const CHUNK_SIZE = 6 * 1024 * 1024;

export async function uploadContentFile(input: {
  file: File;
  objectPath: string;
  onProgress?: (fraction: number) => void;
}) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!projectId || !publishableKey) throw new Error("Supabase upload configuration is missing.");

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Your operator session has expired.");

  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(input.file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: publishableKey,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK_SIZE,
      metadata: {
        bucketName: "ig-publish",
        objectName: input.objectPath,
        contentType: input.file.type || "application/octet-stream",
        cacheControl: "31536000",
      },
      onError: (uploadError) => reject(uploadError),
      onProgress: (uploaded, total) => input.onProgress?.(total > 0 ? uploaded / total : 0),
      onSuccess: () => resolve(),
    });

    void upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
}
