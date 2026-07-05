// Minimal WebDAV client for Nextcloud, authenticated with a per-user
// username + app password (HTTP Basic). Directory listings are parsed with a
// small parser scoped to exactly the props we request below — not a general
// XML parser — since we control the request shape and Nextcloud's response
// format for these props is stable.

export function isEnabled() {
  return !!process.env.NEXTCLOUD_URL;
}

function baseUrl() {
  const url = process.env.NEXTCLOUD_URL;
  if (!url) throw Object.assign(new Error('Nextcloud integration is not configured on this server'), { status: 503 });
  return url.replace(/\/+$/, '');
}

function authHeader(username, password) {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

// Encodes each path segment individually (preserving '/') and rejects
// '.'/'..' segments to prevent escaping the user's DAV namespace.
function encodePathSegments(path) {
  const segments = String(path || '').split('/').filter(Boolean);
  if (segments.some(s => s === '.' || s === '..')) {
    throw Object.assign(new Error('Invalid path'), { status: 400 });
  }
  return segments.map(encodeURIComponent).join('/');
}

function davUrl(username, path) {
  const encodedUser = encodeURIComponent(username);
  const encodedPath = encodePathSegments(path);
  return `${baseUrl()}/remote.php/dav/files/${encodedUser}/${encodedPath}`;
}

const PROPFIND_ROOT_BODY = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';

const PROPFIND_LIST_BODY = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:getlastmodified/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

// Validates credentials by issuing a Depth:0 PROPFIND against the user's DAV root.
export async function testConnection(username, password) {
  const res = await fetch(davUrl(username, ''), {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(username, password), Depth: '0', 'Content-Type': 'application/xml' },
    body: PROPFIND_ROOT_BODY,
    signal: AbortSignal.timeout(10000),
  });
  await res.body?.cancel().catch(() => {});
  if (!res.ok) {
    const message = res.status === 401
      ? 'Invalid Nextcloud username or app password'
      : `Could not reach Nextcloud (${res.status})`;
    throw Object.assign(new Error(message), { status: 400 });
  }
}

export async function listDirectory(username, password, path) {
  const res = await fetch(davUrl(username, path), {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(username, password), Depth: '1', 'Content-Type': 'application/xml' },
    body: PROPFIND_LIST_BODY,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Nextcloud folder listing failed (${res.status})`), { status: res.status === 404 ? 404 : 502 });
  }
  const xml = await res.text();
  return parseMultistatus(xml);
}

export async function downloadFile(username, password, path, { maxBytes } = {}) {
  const res = await fetch(davUrl(username, path), {
    method: 'GET',
    headers: { Authorization: authHeader(username, password) },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Nextcloud download failed (${res.status})`), { status: res.status === 404 ? 404 : 502 });
  }
  if (maxBytes) {
    const declared = parseInt(res.headers.get('content-length') || '', 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw Object.assign(new Error('File exceeds the download size limit'), { status: 413 });
    }
  }
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (maxBytes && buffer.length > maxBytes) {
    throw Object.assign(new Error('File exceeds the download size limit'), { status: 413 });
  }
  return { buffer, contentType };
}

export async function uploadFile(username, password, path, buffer, contentType) {
  const res = await fetch(davUrl(username, path), {
    method: 'PUT',
    headers: {
      Authorization: authHeader(username, password),
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: buffer,
    signal: AbortSignal.timeout(30000),
  });
  await res.body?.cancel().catch(() => {});
  if (!res.ok) {
    throw Object.assign(new Error(`Nextcloud upload failed (${res.status})`), { status: 502 });
  }
}

// --- multistatus (PROPFIND response) parsing -------------------------------

function splitResponses(xml) {
  const re = /<([a-zA-Z][\w-]*:)?response\b[^>]*>([\s\S]*?)<\/\1?response>/gi;
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[2]);
  return out;
}

function extractTag(block, tag) {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function hasChildTag(block, tag) {
  return new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}\\b`, 'i').test(block);
}

function parseMultistatus(xml) {
  const entries = [];
  for (const block of splitResponses(xml)) {
    const hrefRaw = extractTag(block, 'href');
    if (!hrefRaw) continue;
    // href looks like /remote.php/dav/files/<user>/<path...> — keep everything after that prefix.
    const marker = decodeURIComponent(hrefRaw).match(/\/remote\.php\/dav\/files\/[^/]+\/?(.*)$/);
    const relPath = marker ? marker[1].replace(/\/$/, '') : '';
    if (!relPath) continue; // the directory entry for itself — not a child
    entries.push({
      name: decodeURIComponent(relPath.split('/').pop()),
      path: relPath,
      isDirectory: hasChildTag(block, 'collection'),
      size: (() => { const n = parseInt(extractTag(block, 'getcontentlength') || '0', 10); return Number.isFinite(n) ? n : 0; })(),
      mtime: extractTag(block, 'getlastmodified'),
    });
  }
  entries.sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)));
  return entries;
}
