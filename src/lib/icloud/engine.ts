import { compareSummaries, type SummaryEntry } from '../ai/state';
import type { LocalRecording } from '../pocket/types';
import { recordingKey } from '../transcription/state';
import {
  archivePath, artifactsForMaterial, compareArtifacts, folderName,
  manifestForRecording, ownsFolder, parseArtifact, parseManifest, summaryEntry, titleOfFolder,
} from './archive';
import type { ICloudFile, ICloudSyncOptions, ICloudSyncResult, RecordingManifest, SummaryArtifact, TextArtifact } from './types';

/**
 * Reconcile immutable documents. Missing cloud entries never imply local deletion.
 * A recording's identity is the audio checksum in its folder's `recording.json`; folders are readable
 * labels, `YYYY-MM-DD/HH.MM – AI title`, that OpenPocket moves and renames as titles arrive.
 */
export async function syncICloud(options: ICloudSyncOptions): Promise<ICloudSyncResult> {
  const { session, transport, checkActive } = options;
  const result: ICloudSyncResult = { pending: 0, errors: 0, conflicts: 0, published: 0, imported: 0, uploaded: 0 };
  const pending = new Set<string>();
  const files = new Map<string, ICloudFile>();
  const textCache = new Map<string, string>();
  const localBySha = new Map<string, Map<string, LocalRecording>>();
  const blockedFolders = new Set<string>();
  const unpublished = new Set<string>();

  async function active<T>(work: () => Promise<T>): Promise<T> {
    checkActive();
    const value = await work();
    checkActive();
    return value;
  }

  function failed(context: string, cause: unknown): void {
    // An account/consent change must escape rather than be swallowed as a per-file error.
    checkActive();
    result.errors += 1;
    options.onError?.(context, cause);
  }

  async function read(path: string): Promise<string | null> {
    const cached = textCache.get(path);
    if (cached !== undefined) return cached;
    const text = await active(() => transport.readText(session, path));
    if (text === null) pending.add(path);
    else {
      textCache.set(path, text);
      if (files.get(path)?.uploaded) pending.delete(path);
    }
    return text;
  }

  function published(path: string): void {
    files.set(path, { path, downloaded: true, uploaded: false, conflict: false });
    pending.add(path);
    result.published += 1;
  }

  async function putText(path: string, text: string): Promise<void> {
    if (files.has(path)) return;
    await active(() => transport.putText(session, path, text));
    textCache.set(path, text);
    published(path);
  }

  options.onStage?.('Checking iCloud files');
  const scan = await active(() => transport.scan(session));
  result.errors = scan.errors;
  if (scan.errors) options.onError?.('Checking iCloud files', new Error(`${scan.errors} iCloud folder entries could not be read.`));
  // Query gathering is not an empty folder. Wait before deciding anything is absent.
  if (scan.gathering) return { ...result, pending: 1 };
  for (const file of scan.files) {
    if (!archivePath(file.path)) continue;
    const prior = files.get(file.path);
    files.set(file.path, prior ? { ...file, conflict: true } : file);
  }
  for (const file of files.values()) {
    if (file.conflict) result.conflicts += 1;
    if (!file.uploaded || !file.downloaded) pending.add(file.path);
    if (file.uploaded) result.uploaded += 1;
  }

  // Learn which recording each folder holds. A folder whose metadata is not readable yet keeps its name reserved.
  const manifests = new Map<string, RecordingManifest>();
  const foldersBySha = new Map<string, string[]>();
  const folderNames = new Set<string>();
  for (const file of files.values()) {
    const part = archivePath(file.path);
    if (!part) continue;
    folderNames.add(part.folder);
    if (part.leaf !== 'recording.json') continue;
    if (file.conflict) { blockedFolders.add(part.folder); continue; }
    try {
      const raw = await read(file.path);
      if (raw === null) continue;
      const manifest = parseManifest(raw);
      manifests.set(part.folder, manifest);
      foldersBySha.set(manifest.sha256, [...foldersBySha.get(manifest.sha256) ?? [], part.folder].sort());
    } catch (cause) {
      blockedFolders.add(part.folder);
      failed(`Reading ${part.folder}`, cause);
    }
  }
  const usableFolders = (sha: string) => (foldersBySha.get(sha) ?? []).filter(folder => !blockedFolders.has(folder));
  /** The readable name for a recording, with a short checksum when another recording already uses it. */
  const targetName = (manifest: RecordingManifest, title?: string) => {
    const plain = folderName(manifest, title);
    const holder = manifests.get(plain);
    return holder && holder.sha256 !== manifest.sha256 ? folderName(manifest, title, true) : plain;
  };

  options.onStage?.('Saving recordings and text to the iCloud folder');
  // Complete this phase before adopting cloud text. Both devices' concurrent local revisions survive.
  const plans: { sha: string; manifest: RecordingManifest; summary?: SummaryEntry }[] = [];
  for (const material of options.materials) {
    const { recording } = material;
    let localFolder: string | undefined;
    try {
      checkActive();
      const key = recordingKey(recording);
      // Validate inexpensive metadata before hashing a potentially large local file.
      manifestForRecording(recording, '0'.repeat(64));
      const sha = options.audioHashes.get(key)
        ?? await active(() => transport.identify(recording.uri, recording.bytes));
      const manifest = manifestForRecording(recording, sha);
      options.audioHashes.set(key, sha);
      const known = foldersBySha.get(sha) ?? [];
      const usable = usableFolders(sha);
      if (known.length && !usable.length) continue;
      // Publish into the folder that already holds this recording, whatever it is called; else a new readable one.
      const preferred = targetName(manifest, material.summary?.title);
      const folder = usable.includes(preferred) ? preferred : usable[0] ?? preferred;
      localFolder = folder;
      const manifestPath = `${folder}/recording.json`;
      const audioPath = `${folder}/audio.mp3`;
      if (files.get(manifestPath)?.conflict || files.get(audioPath)?.conflict) {
        blockedFolders.add(folder);
        continue;
      }
      const remote = manifests.get(folder);
      // Its metadata exists but is not readable yet; wait rather than publish into an unknown recording's folder.
      if (!remote && files.has(manifestPath)) continue;
      if (remote && JSON.stringify(remote) !== JSON.stringify(manifest)) {
        blockedFolders.add(folder);
        throw new Error('Conflicting iCloud recording metadata.');
      }
      // Publish audio first; a partial run without a manifest is safe to complete later.
      if (!files.has(audioPath)) {
        await active(() => transport.putAudio(session, folder, recording.uri, recording.bytes, sha));
        published(audioPath);
      }
      await putText(manifestPath, JSON.stringify(manifest));
      if (!remote) {
        manifests.set(folder, manifest);
        folderNames.add(folder);
        foldersBySha.set(sha, [...known, folder].sort());
      }
      const copies = localBySha.get(sha) ?? new Map<string, LocalRecording>();
      copies.set(key, recording);
      localBySha.set(sha, copies);
      plans.push({ sha, manifest, summary: material.summary });
      for (const artifact of artifactsForMaterial(material)) {
        try {
          const text = JSON.stringify(artifact);
          const digest = await active(() => options.sha256(text));
          const leaf = `${artifact.kind}-${digest}.json`;
          parseArtifact(text, leaf, digest);
          const path = `${folder}/${leaf}`;
          if (files.get(path)?.conflict) {
            unpublished.add(`${sha}/${artifact.kind}`);
            continue;
          }
          if (files.has(path)) {
            const existing = await read(path);
            if (existing === null) {
              unpublished.add(`${sha}/${artifact.kind}`);
              continue;
            }
            // A filename alone is not evidence our revision is safely archived.
            parseArtifact(existing, leaf, await active(() => options.sha256(existing)));
          }
          await putText(path, text);
          // Readable copies for Files/Finder; the JSON document is what OpenPocket imports.
          await putText(`${folder}/${artifact.kind}-${digest}.${artifact.kind === 'transcript' ? 'txt' : 'md'}`,
            artifact.kind === 'summary' ? `# ${artifact.title}\n\n${artifact.text}\n` : artifact.text);
        } catch (cause) {
          // Do not replace a local revision whose archive could not be published.
          unpublished.add(`${sha}/${artifact.kind}`);
          failed(`Saving ${artifact.kind} for ${recording.id}`, cause);
        }
      }
    } catch (cause) {
      if (localFolder) blockedFolders.add(localFolder);
      failed(`Saving recording ${recording.id}`, cause);
    }
  }

  options.onStage?.('Reading recordings and text from iCloud');
  const latestSummary = new Map<string, SummaryArtifact>();
  for (const sha of foldersBySha.keys()) {
    const folders = usableFolders(sha);
    if (!folders.length) continue;
    const manifest = manifests.get(folders[0])!;
    try {
      let copies = localBySha.get(sha);
      if (!copies) {
        const audioFolder = folders.find(folder => files.has(`${folder}/audio.mp3`) && !files.get(`${folder}/audio.mp3`)!.conflict);
        if (!audioFolder) {
          for (const folder of folders) if (!files.has(`${folder}/audio.mp3`)) pending.add(`${folder}/audio.mp3`);
          continue;
        }
        const audioPath = `${audioFolder}/audio.mp3`;
        const uri = await active(() => transport.downloadAudio(session, audioPath, manifest.bytes, manifest.sha256));
        if (uri === null) {
          pending.add(audioPath);
          continue;
        }
        const recording = await active(() => options.importRecording(manifest, uri));
        options.audioHashes.set(recordingKey(recording), manifest.sha256);
        copies = new Map([[recordingKey(recording), recording]]);
        localBySha.set(sha, copies);
        result.imported += 1;
      }

      // Text documents from every folder holding this recording, so duplicates still contribute.
      const latest = new Map<TextArtifact['kind'], TextArtifact>();
      for (const candidate of files.values()) {
        const part = archivePath(candidate.path);
        if (!part || !folders.includes(part.folder) || candidate.conflict
          || !/^(transcript|note|summary)-[a-f0-9]{64}\.json$/.test(part.leaf)) continue;
        try {
          const raw = await read(candidate.path);
          if (raw === null) continue;
          const digest = await active(() => options.sha256(raw));
          const artifact = parseArtifact(raw, part.leaf, digest);
          const current = latest.get(artifact.kind);
          if (!current || compareArtifacts(artifact, current) > 0) latest.set(artifact.kind, artifact);
        } catch (cause) { failed(`Reading ${part.leaf}`, cause); }
      }
      for (const artifact of latest.values()) {
        if (artifact.kind === 'summary') latestSummary.set(sha, artifact);
        if (unpublished.has(`${sha}/${artifact.kind}`)) continue;
        for (const recording of copies.values()) {
          try {
            if (artifact.kind === 'transcript') await active(() => options.mergeTranscript(recording, artifact));
            else if (artifact.kind === 'summary') await active(() => options.mergeSummary(recording, artifact));
            else await active(() => options.mergeNote(recording, artifact));
          } catch (cause) { failed(`Merging ${artifact.kind} for ${recording.id}`, cause); }
        }
      }
    } catch (cause) { failed(`Importing ${folders[0]}`, cause); }
  }

  // Last, so this run's paths stayed valid: merge duplicate folders and give each its readable name.
  options.onStage?.('Naming recording folders');
  for (const plan of plans) {
    const folders = usableFolders(plan.sha);
    // A folder someone renamed in Files or Finder keeps its name, and its duplicates are left alone too.
    if (!folders.length || folders.some(folder => !ownsFolder(folder, plan.manifest))) continue;
    // The newest summary on either side, so devices agree on the title instead of renaming back and forth;
    // without one, keep the title a folder already has, so a title is never taken away.
    const cloud = latestSummary.get(plan.sha);
    const newest = cloud && (!plan.summary || compareSummaries(summaryEntry('', cloud), plan.summary) > 0)
      ? cloud.title : plan.summary?.title;
    const title = newest ?? folders.map(folder => titleOfFolder(folder, plan.manifest)).find(Boolean);
    const target = targetName(plan.manifest, title);
    try {
      const keep = folders.includes(target) ? target : folders[0];
      for (const other of folders) {
        if (other !== keep) await active(() => transport.moveFolder(session, other, keep, plan.sha));
      }
      if (keep !== target && !folderNames.has(target)) {
        await active(() => transport.moveFolder(session, keep, target, plan.sha));
      }
    } catch (cause) { failed(`Naming ${folders[0]}`, cause); }
  }
  checkActive();
  return { ...result, pending: pending.size };
}
