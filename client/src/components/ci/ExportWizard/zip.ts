/* zip.ts — minimal, dependency-free client-side ZIP writer (AC-12: "Copy files as a
   zip" assembled client-side from `CiExport.files`).

   `client/package.json` has no zip library (no JSZip/pako/fflate) and this task's
   owned paths do not include `package.json`/the lockfile, so a small hand-rolled
   writer using the STORE (uncompressed) method is used instead of adding a
   dependency. STORE is a fully valid ZIP compression method — every common
   unzip tool (macOS Archive Utility, Windows Explorer, `unzip`) opens it fine;
   it just skips DEFLATE compression, which is an acceptable trade-off for a
   handful of small text files. */

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] ?? 0;
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(0, date.getFullYear() - 1980)) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

export interface ZipEntryInput {
  path: string;
  contents: string;
}

/** Builds a valid (STORE-method) ZIP archive `Blob` from a set of text files. */
export function buildZipBlob(files: ZipEntryInput[]): Blob {
  const encoder = new TextEncoder();
  const { time, date } = toDosDateTime(new Date());
  const parts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const data = encoder.encode(file.contents);
    const crc = crc32(data);

    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true); // version needed to extract
    localHeader.setUint16(6, 0, true); // general purpose flag
    localHeader.setUint16(8, 0, true); // method = 0 (store)
    localHeader.setUint16(10, time, true);
    localHeader.setUint16(12, date, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, data.length, true); // compressed size
    localHeader.setUint32(22, data.length, true); // uncompressed size
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true); // extra field length

    const localHeaderBytes = new Uint8Array(localHeader.buffer);
    parts.push(localHeaderBytes, nameBytes, data);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed to extract
    centralHeader.setUint16(8, 0, true);
    centralHeader.setUint16(10, 0, true); // method = store
    centralHeader.setUint16(12, time, true);
    centralHeader.setUint16(14, date, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, data.length, true);
    centralHeader.setUint32(24, data.length, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true); // extra field length
    centralHeader.setUint16(32, 0, true); // comment length
    centralHeader.setUint16(34, 0, true); // disk number start
    centralHeader.setUint16(36, 0, true); // internal attrs
    centralHeader.setUint32(38, 0, true); // external attrs
    centralHeader.setUint32(42, offset, true); // local header offset

    const centralHeaderBytes = new Uint8Array(centralHeader.buffer);
    centralParts.push(centralHeaderBytes, nameBytes);

    offset += localHeaderBytes.length + nameBytes.length + data.length;
  }

  const centralDirStart = offset;
  const centralDirSize = centralParts.reduce((n, p) => n + (p as Uint8Array).length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true); // disk number
  end.setUint16(6, 0, true); // disk with central dir
  end.setUint16(8, files.length, true); // entries on this disk
  end.setUint16(10, files.length, true); // total entries
  end.setUint32(12, centralDirSize, true);
  end.setUint32(16, centralDirStart, true);
  end.setUint16(20, 0, true); // comment length

  return new Blob([...parts, ...centralParts, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/** Triggers a browser download of `blob` as `filename` via a temporary object URL. */
export function downloadZipBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
