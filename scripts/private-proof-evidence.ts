import fs from 'node:fs';
import path from 'node:path';

/** Resolve one evidence file without following a final symlink or leaving the proof root. */
export function proofEvidenceFile(root: string, value: unknown, label: string) {
  const file = path.resolve(requiredString(value, label));
  const relative = path.relative(path.resolve(root), file);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must be a file inside the proof root`);
  }
  const status = fs.lstatSync(file);
  if (!status.isFile()) throw new Error(`${label} is not a plain file`);
  assertInsideRealRoot(root, file, label);
  return file;
}

/** Require a private regular file and private directory ancestry through the proof root. */
export function assertPrivateProofFile(root: string, file: string, label: string) {
  const status = fs.lstatSync(file);
  if (!status.isFile()) throw new Error(`${label} is not a regular no-follow file`);
  if ((status.mode & 0o777) !== 0o600) throw new Error(`${label} must have mode 0600`);
  assertInsideRealRoot(root, file, label);
  let directory = path.dirname(file);
  const resolvedRoot = path.resolve(root);
  while (true) {
    assertPrivateProofDirectory(directory, `${label} parent`);
    if (path.resolve(directory) === resolvedRoot) break;
    const parent = path.dirname(directory);
    const relative = path.relative(resolvedRoot, parent);
    if (
      parent === directory ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`${label} parent escaped the proof root`);
    }
    directory = parent;
  }
}

export function assertPrivateProofDirectory(directory: string, label: string) {
  const status = fs.lstatSync(directory);
  if (!status.isDirectory()) throw new Error(`${label} is not a regular directory`);
  if ((status.mode & 0o777) !== 0o700) throw new Error(`${label} must have mode 0700`);
}

/** Recursively reject permissive, linked, or special entries in a private evidence store. */
export function assertPrivateProofTree(root: string, directory: string, label: string) {
  assertPrivateProofDirectory(directory, label);
  assertInsideRealRoot(root, directory, label);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${child}`);
    if (entry.isDirectory()) assertPrivateProofTree(root, child, label);
    else if (entry.isFile()) assertPrivateProofFile(root, child, label);
    else throw new Error(`${label} contains a non-file entry: ${child}`);
  }
}

/** Enforce filesystem privacy for every file reference in a private action-record bundle. */
export function assertPrivateActionRecordReferences(root: string, bundle: any) {
  if (!bundle || !Array.isArray(bundle.records)) {
    throw new Error('action record bundle is unavailable for private-reference verification');
  }
  const references: Array<{ ref: string; label: string }> = [];
  for (const record of bundle.records) {
    if (record?.access?.visibility !== 'private') continue;
    if (typeof record?.payload?.dataRef === 'string') {
      references.push({ ref: record.payload.dataRef, label: `${record.stage} data reference` });
    }
    if (record?.stage === 'check' && Array.isArray(record?.payload?.evidence)) {
      for (const evidence of record.payload.evidence) {
        if (evidence?.access?.visibility === 'private' && typeof evidence?.ref === 'string') {
          references.push({ ref: evidence.ref, label: `${evidence.kind} evidence reference` });
        }
      }
    }
  }
  if (references.length === 0) {
    throw new Error('private action record has no verifiable private references');
  }
  for (const reference of references) {
    if (reference.ref.startsWith('lync://')) continue;
    const withoutFragment = reference.ref.split('#', 1)[0];
    if (!path.isAbsolute(withoutFragment)) {
      throw new Error(`${reference.label} must be an absolute proof path or Lync reference`);
    }
    const file = proofEvidenceFile(root, withoutFragment, reference.label);
    assertPrivateProofFile(root, file, reference.label);
  }
}

function assertInsideRealRoot(root: string, candidate: string, label: string) {
  const canonicalRoot = fs.realpathSync(root);
  const canonicalCandidate = fs.realpathSync(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} resolves outside the proof root`);
  }
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}
