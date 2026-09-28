import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createGunzip } from 'node:zlib';

const BLOCK = 512;

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}

/** `key=value` records from a pax extended header; only `path` matters here. */
function paxPath(data: Buffer): string | null {
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(data.subarray(offset, space).toString());
    if (!length) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    if (record.startsWith('path=')) return record.slice(5);
    offset += length;
  }
  return null;
}

/**
 * Reads a repo at one commit from codeload.github.com in a single request and
 * returns the files `wanted` asks for. codeload has its own limits,
 * unlike raw.githubusercontent.com, which throttles an IP after a few thousand
 * files. The archive is parsed as a stream and only wanted files are kept.
 */
export async function readRepoFiles(repo: string, sha: string, wanted: (path: string) => boolean): Promise<Map<string, Buffer>> {
  const response = await fetch(`https://codeload.github.com/${repo}/tar.gz/${sha}`, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`${repo}@${sha.slice(0, 7)} tarball: HTTP ${response.status}`);
  const source = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  const stream = createGunzip();
  // pipe() does not forward errors; without this a timeout mid-download crashes the process.
  source.on('error', (error) => stream.destroy(error));
  source.pipe(stream);

  const files = new Map<string, Buffer>();
  let buffer: Buffer = Buffer.alloc(0);
  let entry: { path: string; kind: 'file' | 'pax' | 'longname'; keep: boolean; dataLeft: number; remaining: number; parts: Buffer[] } | null = null;
  let nextPath: string | null = null;

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    for (;;) {
      if (entry) {
        const take = Math.min(buffer.length, entry.remaining);
        const useful = buffer.subarray(0, Math.min(take, entry.dataLeft));
        if (entry.keep) entry.parts.push(Buffer.from(useful));
        entry.dataLeft -= useful.length;
        entry.remaining -= take;
        buffer = buffer.subarray(take);
        if (entry.remaining > 0) break;
        const data = Buffer.concat(entry.parts);
        if (entry.kind === 'pax') nextPath = paxPath(data) ?? nextPath;
        else if (entry.kind === 'longname') nextPath = data.toString('utf8').replace(/\0+$/, '');
        else if (entry.keep) files.set(entry.path, data);
        entry = null;
        continue;
      }
      if (buffer.length < BLOCK) break;
      const header = buffer.subarray(0, BLOCK);
      buffer = buffer.subarray(BLOCK);
      if (header.every((byte) => byte === 0)) continue;
      const size = parseInt(field(header, 124, 12).trim() || '0', 8) || 0;
      const type = String.fromCharCode(header[156] ?? 0);
      const base = { dataLeft: size, remaining: Math.ceil(size / BLOCK) * BLOCK, parts: [] as Buffer[] };
      if (type === 'x') entry = { ...base, path: '', kind: 'pax', keep: true };
      else if (type === 'L') entry = { ...base, path: '', kind: 'longname', keep: true };
      else {
        const name = field(header, 0, 100);
        const prefix = field(header, 345, 155);
        const full = nextPath ?? (prefix ? `${prefix}/${name}` : name);
        nextPath = null;
        // Strip the `owner-repo-sha/` directory codeload wraps everything in.
        const path = full.slice(full.indexOf('/') + 1);
        const keep = (type === '0' || type === '\0') && wanted(path);
        entry = { ...base, path, kind: 'file', keep };
      }
      if (entry.remaining === 0) {
        if (entry.kind === 'file' && entry.keep) files.set(entry.path, Buffer.alloc(0));
        entry = null;
      }
    }
  }
  return files;
}
