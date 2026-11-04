import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  archivePath, compareArtifacts, compareTranscriptArtifacts, folderName, legacyFolder, manifestForRecording, validFolderName, validFolderPath, parseArtifact, parseManifest,
} from '../src/lib/icloud/archive';
import { syncICloud } from '../src/lib/icloud/engine';
import type { ICloudFile, ICloudSyncOptions, NoteArtifact, SummaryArtifact, TranscriptArtifact } from '../src/lib/icloud/types';
import type { LocalRecording } from '../src/lib/pocket/types';
import { recordingKey } from '../src/lib/transcription/state';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const audio = 'synthetic audio bytes';
const recording: LocalRecording = {
  id: '2026-10-23/20261023120000', date: '2026-10-23', timestamp: '20261023120000', durationSeconds: 120,
  uri: 'file:///local/recording.mp3', bytes: audio.length, transport: 'bluetooth', downloadedAt: '2026-10-23T12:00:00.000Z',
};
const manifest = manifestForRecording(recording, hash(audio));
const folder = folderName(manifest);
const transcript: TranscriptArtifact = {
  schema: 1, kind: 'transcript', text: 'Hello from the recording.', updatedAt: '2026-10-23T12:00:00.000Z', provider: 'openai', model: 'gpt-transcribe',
};
const note: NoteArtifact = {
  schema: 1, kind: 'note', text: 'My note', updatedAt: '2026-10-23T12:00:00.000Z', revision: '00000000-0000-4000-8000-000000000001',
};

const summary: SummaryArtifact = {
  schema: 1, kind: 'summary', title: 'Planning call', text: 'The team planned.\n- Ship it', updatedAt: '2026-10-23T12:05:00.000Z',
  provider: 'anthropic', model: 'claude-haiku-5-5',
};

function harness() {
  const cloud = new Map<string, string>();
  const metadata = new Map<string, Partial<ICloudFile>>();
  const waiting = new Set<string>();
  const failWrites = new Set<string>();
  const calls: string[] = [];
  let active = true;
  let gathering = false;
  const mergedTranscripts: TranscriptArtifact[] = [];
  const mergedNotes: NoteArtifact[] = [];
  const mergedNoteKeys: string[] = [];
  const mergedSummaries: SummaryArtifact[] = [];
  const options: ICloudSyncOptions = {
    session: 'synthetic-session', materials: [], audioHashes: new Map(), sha256: async (text) => hash(text),
    checkActive: () => { if (!active) throw new Error('Sync stopped'); },
    transport: {
      identify: async (uri, bytes) => { calls.push('identify'); assert.equal(bytes, audio.length); return hash(audio); },
      scan: async () => ({ gathering, errors: 0, files: [...cloud.keys()].map((path) => ({
        path, downloaded: !waiting.has(path), uploaded: true, conflict: false, ...metadata.get(path),
      })) }),
      putAudio: async (session, path, uri, bytes, sha) => {
        calls.push(`put:${path}/audio.mp3`);
        assert.equal(session, options.session); assert.equal(bytes, audio.length); assert.equal(sha, hash(audio));
        if (failWrites.has(`${path}/audio.mp3`)) throw new Error('Synthetic disk failure');
        assert.equal(cloud.has(`${path}/audio.mp3`), false);
        cloud.set(`${path}/audio.mp3`, audio);
      },
      putText: async (session, path, text) => {
        calls.push(`put:${path}`); assert.equal(session, options.session);
        if (failWrites.has(path)) throw new Error('Synthetic disk failure');
        assert.equal(cloud.has(path), false); cloud.set(path, text);
      },
      readText: async (session, path) => {
        calls.push(`read:${path}`);
        if (waiting.has(path)) return null;
        const text = cloud.get(path); assert.notEqual(text, undefined); return text!;
      },
      moveFolder: async (session, from, to) => {
        calls.push(`move:${from}->${to}`);
        const inside = (name: string) => [...cloud.keys()].filter(path => path.startsWith(`${name}/`));
        const target = inside(to).length > 0;
        for (const path of inside(from)) {
          const leaf = path.slice(from.length + 1);
          const destination = `${to}/${leaf}`;
          if (!cloud.has(destination)) cloud.set(destination, cloud.get(path)!);
          else if (cloud.get(destination) !== cloud.get(path)) continue;
          cloud.delete(path);
          if (!target) metadata.delete(path);
        }
      },
      downloadAudio: async (session, path, bytes, sha) => {
        calls.push(`download:${path}`);
        if (waiting.has(path)) return null;
        const data = cloud.get(path)!;
        if (data.length !== bytes || hash(data) !== sha) throw new Error('Synthetic checksum failure');
        return 'file:///local/imported.mp3';
      },
    },
    importRecording: async (entry, uri) => {
      calls.push('import'); return { ...recording, ...entry, uri };
    },
    mergeTranscript: async (local, artifact) => { calls.push('merge-transcript'); mergedTranscripts.push(artifact); },
    mergeSummary: async (local, artifact) => { calls.push('merge-summary'); mergedSummaries.push(artifact); },
    mergeNote: async (local, artifact) => {
      calls.push('merge-note'); mergedNotes.push(artifact); mergedNoteKeys.push(recordingKey(local));
    },
  };
  function remoteRecording() {
    cloud.set(`${folder}/recording.json`, JSON.stringify(manifest));
    cloud.set(`${folder}/audio.mp3`, audio);
  }
  function remoteArtifact(artifact: TranscriptArtifact | NoteArtifact | SummaryArtifact) {
    const raw = JSON.stringify(artifact);
    const path = `${folder}/${artifact.kind}-${hash(raw)}.json`;
    cloud.set(path, raw); return path;
  }
  function localMaterial() {
    options.materials = [{ recording,
      transcript: { ...transcript, recordingKey: recordingKey(recording), status: 'complete', jobId: 'secret-job-receipt', error: 'private diagnostic' },
      note: { ...note, recordingKey: recordingKey(recording) },
    }];
  }
  return { cloud, calls, options, metadata, waiting, failWrites, mergedTranscripts, mergedNotes, mergedNoteKeys, mergedSummaries,
    remoteRecording, remoteArtifact, localMaterial, stop: () => { active = false; }, gather: () => { gathering = true; } };
}

test('publishes one folder with immutable audio, metadata and readable text; never publishes secrets', async () => {
  const h = harness(); h.localMaterial();
  const result = await syncICloud(h.options);
  assert.deepEqual(result, { pending: 6, errors: 0, conflicts: 0, published: 6, imported: 0, uploaded: 0 });
  assert.equal(h.cloud.get(`${folder}/audio.mp3`), audio);
  assert.deepEqual(JSON.parse(h.cloud.get(`${folder}/recording.json`)!), manifest);
  assert.equal(h.cloud.get(`${folder}/transcript-${hash(JSON.stringify(transcript))}.txt`), transcript.text);
  assert.equal(h.cloud.get(`${folder}/note-${hash(JSON.stringify(note))}.md`), note.text);
  for (const [path, raw] of h.cloud) {
    if (path.endsWith('.json')) assert.doesNotMatch(raw, /jobId|private diagnostic|recordingKey|file:\/\/\//);
  }
  assert.deepEqual(h.mergedTranscripts, [transcript]);
});

test('repeat reconciliation deduplicates files and cached audio hashes, retaining local audio', async () => {
  const h = harness(); h.localMaterial();
  await syncICloud(h.options);
  h.calls.length = 0;
  const result = await syncICloud(h.options);
  assert.equal(result.published, 0); assert.equal(result.uploaded, 6); assert.equal(result.pending, 0);
  assert.equal(h.calls.some((call) => call === 'identify' || call.startsWith('put:') || call.startsWith('download:')), false);
});

test('same audio downloaded through two transports shares its cloud folder but merges text into both local copies', async () => {
  const h = harness(); h.localMaterial();
  const newerCopy = { ...recording, uri: 'file:///local/recording_wifi.mp3', transport: 'wifi' as const, downloadedAt: '2026-10-23T13:00:00.000Z' };
  const newerNote = { ...note, revision: '00000000-0000-4000-8000-000000000002', text: 'Newer copy edit' };
  h.options.materials.unshift({ recording: newerCopy, note: { ...newerNote, recordingKey: recordingKey(newerCopy) } });
  const result = await syncICloud(h.options);
  assert.equal(result.imported, 0);
  assert.equal(h.calls.filter(call => call === `put:${folder}/audio.mp3`).length, 1);
  assert.deepEqual(new Set(h.mergedNoteKeys), new Set([recordingKey(recording), recordingKey(newerCopy)]));
  assert.deepEqual(h.mergedNotes, [newerNote, newerNote]);
  assert.ok(h.cloud.has(`${folder}/note-${hash(JSON.stringify(note))}.json`));
  assert.ok(h.cloud.has(`${folder}/note-${hash(JSON.stringify(newerNote))}.json`));
});

test('publishes local concurrent revisions before adopting later cloud text, preserving both', async () => {
  const h = harness(); h.localMaterial(); h.remoteRecording();
  const newer = { ...note, text: 'Another device edit', updatedAt: '2026-10-23T12:00:01.000Z', revision: '00000000-0000-4000-8000-000000000002' };
  const remotePath = h.remoteArtifact(newer);
  await syncICloud(h.options);
  const localPath = `${folder}/note-${hash(JSON.stringify(note))}.json`;
  assert.ok(h.cloud.has(localPath)); assert.ok(h.cloud.has(remotePath));
  assert.ok(h.calls.indexOf(`put:${localPath}`) < h.calls.indexOf('merge-note'));
  assert.deepEqual(h.mergedNotes, [newer]);
});

test('does not adopt cloud text over a local revision whose publication failed', async () => {
  const h = harness(); h.localMaterial(); h.remoteRecording();
  h.remoteArtifact({ ...note, text: 'Newer remote', updatedAt: '2026-10-23T12:00:01.000Z' });
  h.failWrites.add(`${folder}/note-${hash(JSON.stringify(note))}.json`);
  const result = await syncICloud(h.options);
  assert.equal(result.errors, 1); assert.deepEqual(h.mergedNotes, []);
  assert.deepEqual(h.mergedTranscripts, [transcript]);
});

test('a pending, conflicted or corrupt file at the local revision path does not count as a safe archive', async () => {
  for (const condition of ['pending', 'conflicted', 'corrupt']) {
    const h = harness(); h.localMaterial(); h.remoteRecording();
    const localPath = h.remoteArtifact(note);
    h.remoteArtifact({ ...note, text: 'Newer remote', updatedAt: '2026-10-23T12:00:01.000Z' });
    if (condition === 'pending') h.waiting.add(localPath);
    if (condition === 'conflicted') h.metadata.set(localPath, { conflict: true });
    if (condition === 'corrupt') h.cloud.set(localPath, '{}');
    await syncICloud(h.options);
    assert.deepEqual(h.mergedNotes, []);
  }
});

test('imports only audio verified by native checksum before attaching transcripts and notes', async () => {
  const h = harness(); h.remoteRecording(); h.remoteArtifact(transcript); h.remoteArtifact(note);
  const result = await syncICloud(h.options);
  assert.equal(result.imported, 1); assert.equal(result.errors, 0);
  assert.ok(h.calls.indexOf(`download:${folder}/audio.mp3`) < h.calls.indexOf('import'));
  assert.ok(h.calls.indexOf('import') < h.calls.indexOf('merge-note'));
  assert.deepEqual(h.mergedTranscripts, [transcript]); assert.deepEqual(h.mergedNotes, [note]);
});

test('gathering and metadata-only documents stay pending without being mistaken for empty or corrupt files', async () => {
  const h = harness(); h.localMaterial(); h.gather();
  assert.equal((await syncICloud(h.options)).pending, 1); assert.deepEqual(h.calls, []);
  const pending = harness(); pending.remoteRecording(); pending.waiting.add(`${folder}/recording.json`);
  pending.localMaterial();
  const result = await syncICloud(pending.options);
  assert.equal(result.pending, 1); assert.equal(result.errors, 0); assert.equal(result.published, 0); assert.equal(result.imported, 0);
  assert.ok(pending.calls.includes(`read:${folder}/recording.json`));
});

test('requests downloads for cloud-only audio and text, then imports only when ready', async () => {
  const h = harness(); h.remoteRecording(); const path = h.remoteArtifact(transcript);
  h.waiting.add(`${folder}/audio.mp3`); h.waiting.add(path);
  let result = await syncICloud(h.options);
  assert.equal(result.imported, 0); assert.equal(result.pending, 2); assert.equal(result.errors, 0);
  h.waiting.delete(`${folder}/audio.mp3`);
  result = await syncICloud(h.options);
  assert.equal(result.imported, 1); assert.deepEqual(h.mergedTranscripts, []);
  assert.ok(h.calls.includes(`read:${path}`));
});

test('checksum corruption and conflicted revisions are isolated while valid independent text is imported', async () => {
  const h = harness(); h.remoteRecording(); h.remoteArtifact(note);
  const corrupt = h.remoteArtifact(transcript); h.cloud.set(corrupt, JSON.stringify({ ...transcript, text: 'tampered' }));
  const conflict = h.remoteArtifact({ ...note, text: 'unresolved conflict', updatedAt: '2026-10-23T13:00:00.000Z' });
  h.metadata.set(conflict, { conflict: true });
  const result = await syncICloud(h.options);
  assert.equal(result.errors, 1); assert.equal(result.conflicts, 1);
  assert.deepEqual(h.mergedTranscripts, []); assert.deepEqual(h.mergedNotes, [note]);
});

test('invalid audio never enters the library and manifest/audio conflicts never overwrite local files', async () => {
  const h = harness(); h.remoteRecording(); h.cloud.set(`${folder}/audio.mp3`, 'wrong audio');
  assert.equal((await syncICloud(h.options)).errors, 1); assert.equal(h.calls.includes('import'), false);
  const conflict = harness(); conflict.remoteRecording(); conflict.localMaterial(); conflict.metadata.set(`${folder}/audio.mp3`, { conflict: true });
  const result = await syncICloud(conflict.options);
  assert.equal(result.conflicts, 1); assert.equal(result.published, 0); assert.equal(result.imported, 0);
});

test('unrelated, temporary and incomplete files do not cause imports, mutations or deletions', async () => {
  const h = harness(); h.cloud.set('unrelated.txt', 'keep'); h.cloud.set(`${folder}/.audio.mp3.part`, 'keep');
  h.cloud.set(`${folder}/audio.mp3`, audio);
  assert.deepEqual(await syncICloud(h.options), { pending: 0, errors: 0, conflicts: 0, published: 0, imported: 0, uploaded: 1 });
  assert.equal(h.cloud.size, 3);
  h.cloud.delete(`${folder}/audio.mp3`); h.cloud.set(`${folder}/recording.json`, JSON.stringify(manifest));
  const result = await syncICloud(h.options);
  assert.equal(result.pending, 1); assert.equal(result.errors, 0); assert.equal(result.imported, 0);
});

test('opt-out or account change during a native operation stops all subsequent writes and callbacks', async () => {
  const h = harness(); h.localMaterial();
  const put = h.options.transport.putAudio;
  h.options.transport.putAudio = async (...args) => { await put(...args); h.stop(); };
  await assert.rejects(syncICloud(h.options), /Sync stopped/);
  assert.equal(h.cloud.has(`${folder}/recording.json`), false);
  assert.deepEqual(h.mergedNotes, []); assert.deepEqual(h.mergedTranscripts, []);
});

test('unsaved and incomplete transcription results never enter the cloud archive', async () => {
  for (const changed of [{ unsaved: true }, { status: 'pending' as const }, { status: 'error' as const }]) {
    const h = harness(); h.localMaterial(); Object.assign(h.options.materials[0].transcript!, changed);
    await syncICloud(h.options);
    assert.equal([...h.cloud.keys()].some((path) => path.includes('/transcript-')), false);
  }
});

test('strict archive validation rejects paths, invalid dates, wrong hashes, extra fields and oversized metadata', () => {
  assert.equal(archivePath(`../${folder}/recording.json`), null);
  assert.equal(archivePath(`${folder}/note-${'a'.repeat(64)}.txt`), null);
  assert.throws(() => parseManifest(JSON.stringify({ ...manifest, bytes: 2_000_000_001 })));
  assert.throws(() => parseManifest(JSON.stringify({ ...manifest, token: 'never allowed' })));
  const invalidDate = { ...manifest, date: '2026-02-30', timestamp: '20260230120000', id: '2026-02-30/20260230120000' };
  assert.throws(() => parseManifest(JSON.stringify(invalidDate)));
  for (const invalid of [
    { ...transcript, provider: 'unknown' }, { ...transcript, updatedAt: '2026-10-23' },
    { ...note, text: 'x'.repeat(100_001) }, { ...note, revision: '../bad' },
    { ...transcript, jobId: 'do-not-export' },
  ]) {
    const raw = JSON.stringify(invalid);
    assert.throws(() => parseArtifact(raw, `${invalid.kind}-${hash(raw)}.json`, hash(raw)));
  }
  const raw = JSON.stringify(transcript);
  assert.throws(() => parseArtifact(raw, `transcript-${'0'.repeat(64)}.json`, hash(raw)));
});

test('equal-time transcript ties converge regardless of cloud listing order', async () => {
  const second = { ...transcript, text: 'Zebra wins the canonical tie' };
  assert.ok(compareTranscriptArtifacts(transcript, second) < 0);
  for (const artifacts of [[transcript, second], [second, transcript]]) {
    const h = harness(); h.remoteRecording(); artifacts.forEach(h.remoteArtifact);
    await syncICloud(h.options); assert.deepEqual(h.mergedTranscripts, [second]);
  }
});

test('different key order in valid manifest JSON does not create a false recording conflict', async () => {
  const h = harness(); h.remoteRecording(); h.localMaterial();
  h.cloud.set(`${folder}/recording.json`, JSON.stringify(Object.fromEntries(Object.entries(manifest).reverse())));
  assert.equal((await syncICloud(h.options)).errors, 0);
});

test('recordings named PH + YYMMDDHHMMSS by the recorder are archived and validated by their wall-clock time', async () => {
  const call: LocalRecording = { ...recording, id: '2026-10-06/PH261006191146', date: '2026-10-06', timestamp: 'PH261006191146' };
  const callManifest = manifestForRecording(call, hash(audio));
  const callFolder = folderName(callManifest);
  assert.equal(callFolder, '2026-10-06/19.11');
  assert.deepEqual(archivePath(`${callFolder}/recording.json`), { folder: callFolder, leaf: 'recording.json' });
  const h = harness();
  h.options.materials = [{ recording: call }];
  const result = await syncICloud(h.options);
  assert.equal(result.errors, 0);
  assert.deepEqual(JSON.parse(h.cloud.get(`${callFolder}/recording.json`)!), callManifest);
  for (const timestamp of ['PH261007191146', 'PH261006251146', 'PH2610061911', 'XH261006191146']) {
    const invalid = { ...callManifest, timestamp, id: `2026-10-06/${timestamp}` };
    assert.throws(() => parseManifest(JSON.stringify(invalid)));
  }
});

test('each counted failure reports what was being done and why', async () => {
  const h = harness();
  const reported: string[] = [];
  h.options.onError = (context, cause) => reported.push(`${context}: ${(cause as Error).message}`);
  h.options.materials = [{ recording: { ...recording, id: '2026-10-23/unknown', timestamp: 'unknown' } }];
  const result = await syncICloud(h.options);
  assert.equal(result.errors, 1);
  assert.deepEqual(reported, ['Saving recording 2026-10-23/unknown: Invalid iCloud recording metadata.']);
});

test('AI summaries publish as JSON plus a readable Markdown copy and import the newest version', async () => {
  const h = harness();
  h.options.materials = [{ recording, summary: { recordingKey: recordingKey(recording), provider: summary.provider, model: summary.model,
    title: summary.title, summary: summary.text, updatedAt: summary.updatedAt } }];
  await syncICloud(h.options);
  const raw = JSON.stringify(summary);
  const titled = folderName(manifest, summary.title);
  assert.equal(titled, '2026-10-23/12.00 – Planning call');
  assert.deepEqual(JSON.parse(h.cloud.get(`${titled}/summary-${hash(raw)}.json`)!), summary);
  assert.equal(h.cloud.get(`${titled}/summary-${hash(raw)}.md`), `# ${summary.title}\n\n${summary.text}\n`);

  const other = harness();
  other.remoteRecording();
  const newer: SummaryArtifact = { ...summary, title: 'Newer title', updatedAt: '2026-10-24T09:00:00.000Z' };
  other.remoteArtifact(summary);
  other.remoteArtifact(newer);
  await syncICloud(other.options);
  assert.deepEqual(other.mergedSummaries, [newer]);
  assert.equal(compareArtifacts(newer, summary) > 0, true);
  for (const invalid of [{ ...summary, title: '' }, { ...summary, provider: 'gemini' }, { ...summary, model: 'bad model' }, { ...summary, extra: 1 }]) {
    const text = JSON.stringify(invalid);
    assert.throws(() => parseArtifact(text, `summary-${hash(text)}.json`, hash(text)));
  }
  assert.notEqual(archivePath(`${folder}/summary-${'a'.repeat(64)}.md`), null);
});

const localSummary = (title: string, updatedAt = '2026-10-23T12:05:00.000Z') => ({ recordingKey: recordingKey(recording),
  provider: 'openai' as const, model: 'gpt-6-luna', title, summary: 'Gist.', updatedAt });
const folderFiles = (h: ReturnType<typeof harness>, name: string) => [...h.cloud.keys()].filter(path => path.startsWith(`${name}/`)).length;

test('folders are found by recording.json, renamed from legacy checksum names, and retitled when a title arrives', async () => {
  const legacy = legacyFolder(manifest);
  const h = harness();
  h.cloud.set(`${legacy}/recording.json`, JSON.stringify(manifest)); h.cloud.set(`${legacy}/audio.mp3`, audio);
  h.options.materials = [{ recording }];
  await syncICloud(h.options);
  assert.equal(h.calls.filter(call => call.startsWith('put:') && call.includes('audio.mp3')).length, 0);
  assert.ok(h.calls.includes(`move:${legacy}->${folder}`));
  assert.equal(folderFiles(h, legacy), 0);
  assert.equal(h.cloud.get(`${folder}/audio.mp3`), audio);

  h.options.materials = [{ recording, summary: localSummary('Budget / Q4: review') }];
  await syncICloud(h.options);
  const titled = '2026-10-23/12.00 – Budget Q4 review';
  assert.equal(folderName(manifest, 'Budget / Q4: review'), titled);
  assert.ok(h.calls.includes(`move:${folder}->${titled}`));
  assert.equal(folderFiles(h, folder), 0);
  assert.ok(folderFiles(h, titled) >= 4);
});

test('a renamed-by-hand folder keeps its name, and a title is never taken away', async () => {
  const h = harness();
  h.cloud.set('Salary talk/recording.json', JSON.stringify(manifest)); h.cloud.set('Salary talk/audio.mp3', audio);
  h.options.materials = [{ recording, summary: localSummary('Budget review') }];
  await syncICloud(h.options);
  assert.equal(h.calls.some(call => call.startsWith('move:')), false);
  assert.ok(h.cloud.has(`Salary talk/summary-${hash(JSON.stringify({ schema: 1, kind: 'summary', title: 'Budget review', text: 'Gist.',
    updatedAt: '2026-10-23T12:05:00.000Z', provider: 'openai', model: 'gpt-6-luna' }))}.json`));

  const titled = harness();
  const name = folderName(manifest, 'Kept title');
  titled.cloud.set(`${name}/recording.json`, JSON.stringify(manifest)); titled.cloud.set(`${name}/audio.mp3`, audio);
  titled.options.materials = [{ recording }];
  await syncICloud(titled.options);
  assert.equal(titled.calls.some(call => call.startsWith('move:')), false);
});

test('duplicate folders of one recording merge, and another recording in the same minute gets a short checksum', async () => {
  const legacy = legacyFolder(manifest);
  const h = harness();
  for (const name of [legacy, folder]) { h.cloud.set(`${name}/recording.json`, JSON.stringify(manifest)); h.cloud.set(`${name}/audio.mp3`, audio); }
  h.remoteArtifact(transcript);
  h.options.materials = [{ recording }];
  await syncICloud(h.options);
  assert.ok(h.calls.includes(`move:${legacy}->${folder}`));
  assert.equal(folderFiles(h, legacy), 0);

  const other = harness();
  const otherAudio = 'other synthetic audio';
  const otherManifest = { ...manifest, sha256: hash(otherAudio), bytes: otherAudio.length };
  other.cloud.set(`${folder}/recording.json`, JSON.stringify(otherManifest)); other.cloud.set(`${folder}/audio.mp3`, otherAudio);
  other.options.materials = [{ recording }];
  await syncICloud(other.options);
  const distinct = folderName(manifest, undefined, true);
  assert.equal(distinct, `2026-10-23/12.00 (${hash(audio).slice(0, 6)})`);
  assert.equal(other.cloud.get(`${distinct}/audio.mp3`), audio);
  assert.equal(other.cloud.get(`${folder}/audio.mp3`), otherAudio);
});

test('folder names refuse path characters and stay within the length limit', () => {
  for (const name of ['', '.hidden', 'a/b', 'a:b', 'tab\tname', ' padded', 'x'.repeat(201)]) assert.equal(validFolderName(name), false);
  assert.equal(validFolderName('12.00 – Ünïcödé 会议'), true);
  const long = folderName(manifest, '会'.repeat(200));
  assert.ok(new TextEncoder().encode(long.split('/')[1]).length <= 200 && validFolderPath(long));
  for (const path of ['2026-10-23/12.00', 'Salary talk', legacyFolder(manifest)]) assert.equal(validFolderPath(path), true);
  for (const path of ['notes/12.00', '2026-10-23/a/b', '2026-10-23/', '/12.00']) assert.equal(validFolderPath(path), false);
  assert.equal(archivePath('2026-10-23/12.00/a/recording.json'), null);
});

test('flat folders move into their date folder and keep the title they have', async () => {
  const h = harness();
  const flat = '2026-10-23 12.00 – Earlier title';
  h.cloud.set(`${flat}/recording.json`, JSON.stringify(manifest)); h.cloud.set(`${flat}/audio.mp3`, audio);
  h.options.materials = [{ recording }];
  await syncICloud(h.options);
  assert.ok(h.calls.includes(`move:${flat}->2026-10-23/12.00 – Earlier title`));
  assert.equal(h.cloud.get('2026-10-23/12.00 – Earlier title/audio.mp3'), audio);
  assert.equal(folderFiles(h, flat), 0);
});
