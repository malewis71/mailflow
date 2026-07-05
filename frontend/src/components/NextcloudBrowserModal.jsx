import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api.js';

const inputStyle = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
  fontSize: 14, outline: 'none',
};

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
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 14, width: '100%', maxWidth: 480,
        boxShadow: 'var(--shadow-modal)', overflow: 'hidden',
        maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
        }}>
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
        <div style={{ padding: '8px 0', overflowY: 'auto', minHeight: 200, flex: 1 }}>
          {loading ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              {t('common.loading')}
            </div>
          ) : error ? (
            <div style={{ margin: '0 18px', fontSize: 13, color: 'var(--red, #f87171)', padding: '8px 10px', borderRadius: 6, background: 'rgba(248,113,113,0.08)' }}>
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              {t('nextcloud.browser.empty')}
            </div>
          ) : (
            entries.map(entry => {
              const clickable = entry.isDirectory || mode === 'file';
              return (
                <button
                  key={entry.path}
                  disabled={!clickable || busy}
                  onClick={() => entry.isDirectory ? setCurrentPath(entry.path) : handleFileClick(entry)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '9px 18px', background: 'none', border: 'none', textAlign: 'left',
                    cursor: clickable ? 'pointer' : 'default',
                    opacity: clickable ? 1 : 0.5,
                    fontSize: 13.5, color: 'var(--text-primary)',
                  }}
                >
                  {entry.isDirectory ? <FolderIcon /> : <FileIcon />}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.name}
                  </span>
                  {!entry.isDirectory && entry.size > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                      {(entry.size / 1024).toFixed(0)} KB
                    </span>
                  )}
                </button>
              );
            })
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
      </div>
    </div>
  );
}
