export type PackageIdentity = {
  postKey: string;
  mediaSha256: string;
  packageSha256: string;
};

export type ExistingContentIdentity = {
  id: string;
  postKey: string;
  mediaSha256: string | null;
  packageSha256: string | null;
  batchKey: string | null;
};

export function planContentBatchImport(
  packages: PackageIdentity[],
  existing: ExistingContentIdentity[],
) {
  const byKey = new Map(existing.map((row) => [row.postKey, row]));
  const byHash = new Map(
    existing.filter((row) => row.mediaSha256).map((row) => [row.mediaSha256 as string, row]),
  );
  const pendingPostKeys: string[] = [];
  const skippedPostKeys: string[] = [];

  for (const item of packages) {
    const keyMatch = byKey.get(item.postKey);
    if (keyMatch) {
      const exactRetry =
        keyMatch.packageSha256 === item.packageSha256 ||
        (!keyMatch.packageSha256 &&
          [item.mediaSha256, item.packageSha256].includes(keyMatch.mediaSha256 ?? ""));
      if (!exactRetry) {
        throw new Error(`Post key ${item.postKey} already exists with different content.`);
      }
      skippedPostKeys.push(item.postKey);
      continue;
    }

    const mediaMatch = byHash.get(item.mediaSha256) ?? byHash.get(item.packageSha256);
    if (mediaMatch) {
      throw new Error(`The same media already belongs to ${mediaMatch.postKey}.`);
    }
    pendingPostKeys.push(item.postKey);
  }

  const priorBatchKeys = [...new Set(existing.map((row) => row.batchKey).filter(Boolean))];
  return {
    pendingPostKeys,
    skippedPostKeys,
    reusableBatchKey: priorBatchKeys.length === 1 ? priorBatchKeys[0]! : null,
  };
}
