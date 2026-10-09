// Minimal client-side ZIP (STORE method, no dependencies) — packs the game's static assets
// into a single .zip the visitor can download. Works for binary (PNG/MP3/JPG) and text (JSON).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
function concatBytes(arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const a of arrs) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function buildZip(files) {
  const encoder = new TextEncoder(),
    locals = [],
    centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name),
      crc = crc32(file.data),
      size = file.data.length;
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]);
    locals.push(local);
    centrals.push(
      concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(size),
        u32(size),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const central = concatBytes(centrals),
    centralStart = offset;
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(centralStart),
    u16(0),
  ]);
  return new Blob([concatBytes(locals), central, end], { type: "application/zip" });
}

// Fetch each path under `base`, pack into a zip named `zipName`, trigger a download.
// onProgress(done, total, path) is called as it goes. Returns {ok, failed:[...]}.
export async function zipAndDownload(base, paths, zipName, onProgress) {
  const files = [],
    failed = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    try {
      const response = await fetch(base + path);
      if (!response.ok) throw new Error(response.status);
      files.push({
        name: zipName.replace(/\.zip$/, "") + "/" + path,
        data: new Uint8Array(await response.arrayBuffer()),
      });
    } catch (e) {
      failed.push(path);
    }
    onProgress && onProgress(i + 1, paths.length, path);
  }
  const blob = buildZip(files);
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { ok: files.length, failed };
}
