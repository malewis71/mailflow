import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { format, isToday, isThisYear } from 'date-fns';
import { api } from '../utils/api.js';

function formatModified(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return format(d, 'h:mm a');
  if (isThisYear(d)) return format(d, 'MMM d');
  return format(d, 'MMM d, yyyy');
}

// Nextcloud-style dynamic unit sizing: "< 1 KB", "100 KB", "1.5 MB", etc.
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return '< 1 KB';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const rounded = Math.round(value * 10) / 10;
  const display = Number.isInteger(rounded) ? rounded : rounded.toFixed(1);
  return `${display} ${units[unitIndex]}`;
}

const inputStyle = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
  fontSize: 14, outline: 'none',
};

const thStyle = {
  position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-secondary)',
  boxSizing: 'border-box', textAlign: 'left', padding: '6px 18px', fontSize: 11, fontWeight: 500,
  color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-subtle)',
};

const tdStyle = {
  boxSizing: 'border-box', padding: '7px 18px', borderBottom: '1px solid var(--border-subtle)',
};

// Narrower padding for the numeric/date columns — the wide 18px page-edge
// padding used for Name isn't needed for these short, fixed-width columns.
const numericColStyle = { padding: '6px 12px' };

function FolderIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.8">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M15 2v5h5" />
    </svg>
  );
}

// mode: 'file' — used to attach a Nextcloud file into an outgoing message.
// mode: 'folder' — used to pick a destination folder to save an attachment into.
export default function NextcloudBrowserModal({ mode, onSelect, onClose }) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [customSize, setCustomSize] = useState(() => {
    try {
      const saved = localStorage.getItem('mailflow_nextcloud_browser_size');
      if (!saved) return null;
      const { width, height } = JSON.parse(saved);
      return {
        width: Math.min(Math.max(360, width), window.innerWidth - 32),
        height: Math.min(Math.max(320, height), window.innerHeight - 32),
      };
    } catch { return null; }
  });
  // Once set, the dialog switches from flex-centered to a fixed position/size
  // anchored at its top-left corner, so resizing grows it toward the bottom-right
  // instead of the flex parent re-centering it (which would move all 4 edges).
  const [pos, setPos] = useState(null);
  const windowRef = useRef(null);
  const dragCleanupRef = useRef(null);

  useEffect(() => { return () => { dragCleanupRef.current?.({ commit: false }); }; }, []);

  useEffect(() => {
    const clamp = () => {
      setCustomSize(prev => prev ? {
        width: Math.min(prev.width, window.innerWidth - 32),
        height: Math.min(prev.height, window.innerHeight - 32),
      } : prev);
      setPos(prev => prev ? {
        x: Math.max(0, Math.min(window.innerWidth - 360, prev.x)),
        y: Math.max(0, Math.min(window.innerHeight - 320, prev.y)),
      } : prev);
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  const handleTitleDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, a')) return;
    e.preventDefault();
    const el = windowRef.current;
    if (!el) return;
    dragCleanupRef.current?.({ commit: false });
    const captureEl = e.currentTarget;
    const pointerId = e.pointerId;
    captureEl.setPointerCapture(pointerId);
    const rect = el.getBoundingClientRect();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startX = rect.left;
    const startY = rect.top;
    const w = rect.width;
    const h = rect.height;
    // Switch out of flex-centering (if not already) so dragging moves the dialog
    // from wherever it currently sits, the same trick the resize handle uses.
    el.style.position = 'fixed';
    el.style.margin = '0';
    el.style.top = startY + 'px';
    el.style.left = startX + 'px';
    setPos({ x: startX, y: startY });
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    let curX = startX;
    let curY = startY;
    const onMove = (ev) => {
      curX = Math.max(0, Math.min(window.innerWidth - w, startX + ev.clientX - startMouseX));
      curY = Math.max(0, Math.min(window.innerHeight - h, startY + ev.clientY - startMouseY));
      el.style.left = curX + 'px';
      el.style.top = curY + 'px';
    };
    const cleanup = ({ commit = true } = {}) => {
      captureEl.removeEventListener('pointermove', onMove);
      captureEl.removeEventListener('pointerup', cleanup);
      captureEl.removeEventListener('pointercancel', cleanupNoCommit);
      window.removeEventListener('blur', cleanupNoCommit);
      if (captureEl.hasPointerCapture?.(pointerId)) captureEl.releasePointerCapture(pointerId);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragCleanupRef.current = null;
      if (commit) setPos({ x: curX, y: curY });
    };
    const cleanupNoCommit = () => cleanup({ commit: false });
    dragCleanupRef.current = cleanup;
    captureEl.addEventListener('pointermove', onMove);
    captureEl.addEventListener('pointerup', cleanup);
    captureEl.addEventListener('pointercancel', cleanupNoCommit);
    window.addEventListener('blur', cleanupNoCommit);
  }, []);

  const handleResizeDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = windowRef.current;
    if (!el) return;
    dragCleanupRef.current?.({ commit: false });
    const captureEl = e.currentTarget;
    const pointerId = e.pointerId;
    captureEl.setPointerCapture(pointerId);
    const rect = el.getBoundingClientRect();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    // Pin the top-left corner in place (switching out of flex-centering, if not
    // already) so only the width/height change — the right/bottom edges move.
    el.style.position = 'fixed';
    el.style.top = rect.top + 'px';
    el.style.left = rect.left + 'px';
    el.style.margin = '0';
    setPos({ x: rect.left, y: rect.top });
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    let curW = startWidth;
    let curH = startHeight;
    const onMove = (ev) => {
      curW = Math.min(window.innerWidth - rect.left - 16, Math.max(360, startWidth + ev.clientX - startMouseX));
      curH = Math.min(window.innerHeight - rect.top - 16, Math.max(320, startHeight + ev.clientY - startMouseY));
      el.style.width = curW + 'px';
      el.style.height = curH + 'px';
    };
    const cleanup = ({ commit = true } = {}) => {
      captureEl.removeEventListener('pointermove', onMove);
      captureEl.removeEventListener('pointerup', cleanup);
      captureEl.removeEventListener('pointercancel', cleanupNoCommit);
      window.removeEventListener('blur', cleanupNoCommit);
      if (captureEl.hasPointerCapture?.(pointerId)) captureEl.releasePointerCapture(pointerId);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragCleanupRef.current = null;
      if (commit) {
        setCustomSize({ width: curW, height: curH });
        try { localStorage.setItem('mailflow_nextcloud_browser_size', JSON.stringify({ width: curW, height: curH })); } catch { /* localStorage unavailable */ }
      }
    };
    const cleanupNoCommit = () => cleanup({ commit: false });
    dragCleanupRef.current = cleanup;
    captureEl.addEventListener('pointermove', onMove);
    captureEl.addEventListener('pointerup', cleanup);
    captureEl.addEventListener('pointercancel', cleanupNoCommit);
    window.addEventListener('blur', cleanupNoCommit);
  }, []);

  const load = useCallback((path) => {
    setLoading(true);
    setError('');
    api.nextcloud.list(path)
      .then(res => setEntries(res.entries))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(currentPath); }, [currentPath, load]);

  async function handleFileClick(entry) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const file = await api.nextcloud.download(entry.path);
      onSelect(file);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function handleSaveHere() {
    onSelect(currentPath);
    onClose();
  }

  const crumbs = [{ label: t('nextcloud.browser.home'), path: '' },
    ...currentPath.split('/').filter(Boolean).map((seg, i, arr) => ({
      label: seg,
      path: arr.slice(0, i + 1).join('/'),
    }))];

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 3000, padding: 24,
      }}
    >
      <div ref={windowRef} style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 14,
        ...(pos
          ? { position: 'fixed', top: pos.y, left: pos.x, margin: 0 }
          : { position: 'relative' }),
        width: customSize?.width ?? '100%', maxWidth: customSize ? undefined : 480,
        boxShadow: 'var(--shadow-modal)', overflow: 'hidden',
        // Using height (via min()) rather than just maxHeight — a flex column
        // sized only by max-height doesn't reliably force its children to
        // shrink/scroll in all browsers, which was letting the footer buttons
        // get laid out past the bottom and clipped instead of the body scrolling.
        height: customSize?.height ?? 'min(480px, calc(100vh - 48px))',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header — also the drag handle for moving the dialog */}
        <div
          onPointerDown={handleTitleDragStart}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 18px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
            cursor: 'grab',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            {mode === 'folder' ? t('nextcloud.browser.titleSave') : t('nextcloud.browser.titleAttach')}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4, display: 'flex' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Breadcrumb */}
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
          padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
          fontSize: 13, color: 'var(--text-secondary)',
        }}>
          {crumbs.map((c, i) => (
            <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}>/</span>}
              <button
                onClick={() => setCurrentPath(c.path)}
                disabled={c.path === currentPath}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: c.path === currentPath ? 'var(--text-primary)' : 'var(--accent)',
                  fontWeight: c.path === currentPath ? 600 : 400,
                  cursor: c.path === currentPath ? 'default' : 'pointer', fontSize: 13,
                }}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {loading ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              {t('common.loading')}
            </div>
          ) : error ? (
            <div style={{ margin: '8px 18px', fontSize: 13, color: 'var(--red, #f87171)', padding: '8px 10px', borderRadius: 6, background: 'rgba(248,113,113,0.08)' }}>
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              {t('nextcloud.browser.empty')}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', fontSize: 13 }}>
              {/* Column widths are declared here (not just on the header cells) —
                  table-layout:fixed can otherwise disagree across browsers about
                  which row's cell widths are authoritative, letting longer values
                  in body rows push past the intended column width. */}
              <colgroup>
                <col />
                <col style={{ width: 88 }} />
                <col style={{ width: 104 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={thStyle}>{t('nextcloud.browser.columnName')}</th>
                  <th style={{ ...thStyle, ...numericColStyle, textAlign: 'right' }}>{t('nextcloud.browser.columnSize')}</th>
                  <th style={{ ...thStyle, ...numericColStyle, textAlign: 'left' }}>{t('nextcloud.browser.columnModified')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => {
                  const clickable = entry.isDirectory || mode === 'file';
                  const disabled = !clickable || busy;
                  return (
                    <tr
                      key={entry.path}
                      onClick={() => { if (disabled) return; entry.isDirectory ? setCurrentPath(entry.path) : handleFileClick(entry); }}
                      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      style={{ cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          {entry.isDirectory ? <FolderIcon /> : <FileIcon />}
                          <span title={entry.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.name}
                          </span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, ...numericColStyle, textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {!entry.isDirectory && entry.size > 0 ? formatSize(entry.size) : '—'}
                      </td>
                      <td style={{ ...tdStyle, ...numericColStyle, textAlign: 'left', color: 'var(--text-tertiary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {entry.mtime ? formatModified(entry.mtime) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {mode === 'folder' && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '12px 18px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0,
          }}>
            <button
              onClick={onClose}
              style={{ ...inputStyle, background: 'transparent', cursor: 'pointer' }}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSaveHere}
              style={{
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: 'var(--accent)', color: 'white', cursor: 'pointer',
                fontSize: 13, fontWeight: 500,
              }}
            >
              {t('nextcloud.browser.saveHere')}
            </button>
          </div>
        )}

        {/* Resize handle */}
        <div
          onPointerDown={handleResizeDragStart}
          style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, cursor: 'nwse-resize' }}
        >
          <svg
            width="8" height="8" viewBox="0 0 8 8" fill="none"
            stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round"
            style={{ position: 'absolute', bottom: 3, right: 3, display: 'block', opacity: 0.5 }}
          >
            <path d="M7 2L2 7M7 5L5 7" />
          </svg>
        </div>
      </div>
    </div>
  );
}
