import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listDirectory } from './nextcloudClient.js';

function multistatusResponse(entries) {
  const responses = entries.map(({ href, isDirectory, size, mtime }) => `
    <d:response>
      <d:href>${href}</d:href>
      <d:propstat>
        <d:prop>
          <d:displayname>${href.split('/').filter(Boolean).pop() || ''}</d:displayname>
          ${size != null ? `<d:getcontentlength>${size}</d:getcontentlength>` : ''}
          ${mtime ? `<d:getlastmodified>${mtime}</d:getlastmodified>` : ''}
          <d:resourcetype>${isDirectory ? '<d:collection/>' : ''}</d:resourcetype>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>`).join('');
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`;
}

function mockFetchOnce(xml) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(xml),
  });
}

describe('listDirectory', () => {
  beforeEach(() => {
    process.env.NEXTCLOUD_URL = 'https://cloud.example.com';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete global.fetch;
  });

  it('excludes the self entry when listing the root', async () => {
    mockFetchOnce(multistatusResponse([
      { href: '/remote.php/dav/files/alice/', isDirectory: true },
      { href: '/remote.php/dav/files/alice/Documents/', isDirectory: true, mtime: 'Mon, 05 Jan 2026 10:00:00 GMT' },
    ]));

    const entries = await listDirectory('alice', 'app-password', '');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'Documents', path: 'Documents', isDirectory: true });
  });

  it('excludes the self entry when listing a subdirectory (regression: was showing Documents inside Documents)', async () => {
    mockFetchOnce(multistatusResponse([
      { href: '/remote.php/dav/files/alice/Documents/', isDirectory: true },
      { href: '/remote.php/dav/files/alice/Documents/report.pdf', isDirectory: false, size: 102400, mtime: 'Tue, 06 Jan 2026 12:00:00 GMT' },
      { href: '/remote.php/dav/files/alice/Documents/Archive/', isDirectory: true, mtime: 'Wed, 07 Jan 2026 09:00:00 GMT' },
    ]));

    const entries = await listDirectory('alice', 'app-password', 'Documents');

    expect(entries.map(e => e.name).sort()).toEqual(['Archive', 'report.pdf']);
    expect(entries.find(e => e.name === 'Documents')).toBeUndefined();

    const file = entries.find(e => e.name === 'report.pdf');
    expect(file).toMatchObject({ path: 'Documents/report.pdf', isDirectory: false, size: 102400 });

    const folder = entries.find(e => e.name === 'Archive');
    expect(folder).toMatchObject({ path: 'Documents/Archive', isDirectory: true });
  });
});
