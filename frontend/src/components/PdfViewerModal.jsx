import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { useMobile } from '../hooks/useMobile.js';

function TitleBtn({ children, onClick, danger, title }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? (danger ? 'var(--red)' : 'var(--bg-hover)') : 'var(--bg-elevated)',
        border: 'none', borderRadius: 4, padding: '4px',
        color: hov && danger ? 'white' : 'var(--text-tertiary)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.1s',
      }}
    >
      {children}
    </button>
  );
}

export default function PdfViewerModal() {
  const { t } = useTranslation();
  const isMobile = useMobile();
  const { pdfViewer, closePdfViewer } = useStore();
  const { messageId, part, filename } = pdfViewer || {};

  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!messageId || !part) return;
    let cancelled = false;
    let url = null;
    setLoading(true);
    setError('');
    setBlobUrl(null);
    fetch(`/api/mail/messages/${messageId}/attachments/${encodeURIComponent(part)}`, {
      credentials: 'include',
    })
      .then(res => {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then(blob => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(() => { if (!cancelled) setError(t('pdfViewer.loadError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [messageId, part, t]);

  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [pos, setPos] = useState(null);
  const [customSize, setCustomSize] = useState(() => {
    try {
      const saved = localStorage.getItem('mailflow_pdf_viewer_size');
      if (!saved) return null;
      const { width, height } = JSON.parse(saved);
      return {
        width:  Math.min(Math.max(360, width),  window.innerWidth  - 16),
        height: Math.min(Math.max(240, height), window.innerHeight - 40),
      };
    } catch { return null; }
  });
  const windowRef = useRef(null);
  const dragCleanupRef = useRef(null);

  useEffect(() => { return () => { dragCleanupRef.current?.({ commit: false }); }; }, []);

  const handleTitleDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, a')) return;
    if (maximized) return;
    e.preventDefault();
    const el = windowRef.current;
    if (!el) return;
    dragCleanupRef.current?.({ commit: false });
    const captureEl = e.currentTarget;
    const pointerId = e.pointerId;
    captureEl.setPointerCapture(pointerId);
    el.getAnimations().forEach(a => a.finish());
    const rect = el.getBoundingClientRect();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startX = rect.left;
    const startY = rect.top;
    const w = rect.width;
    const h = rect.height;
    el.style.bottom = '';
    el.style.right = '';
    el.style.top = startY + 'px';
    el.style.left = startX + 'px';
    setPos({ x: startX, y: startY });
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    let curX = startX;
    let curY = startY;
    const onMove = (ev) => {
      curX = Math.max(0, Math.min(window.innerWidth - w, startX + ev.clientX - startMouseX));
      curY = Math.max(0, Math.min(Math.max(0, window.innerHeight - h), startY + ev.clientY - startMouseY));
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
  }, [maximized]);

  const handleResizeDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = windowRef.current;
    if (!el) return;
    dragCleanupRef.current?.({ commit: false });
    const captureEl = e.currentTarget;
    const pointerId = e.pointerId;
    captureEl.setPointerCapture(pointerId);
    el.getAnimations().forEach(a => a.finish());
    const rect = el.getBoundingClientRect();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    el.style.bottom = '';
    el.style.right = '';
    if (!el.style.top) el.style.top = rect.top + 'px';
    if (!el.style.left) el.style.left = rect.left + 'px';
    setPos(prev => prev ?? { x: rect.left, y: rect.top });
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    let curW = startWidth;
    let curH = startHeight;
    const onMove = (ev) => {
      curW = Math.min(window.innerWidth - 16, Math.max(360, startWidth + ev.clientX - startMouseX));
      curH = Math.min(window.innerHeight - 40, Math.max(240, startHeight + ev.clientY - startMouseY));
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
        try { localStorage.setItem('mailflow_pdf_viewer_size', JSON.stringify({ width: curW, height: curH })); } catch { /* localStorage unavailable */ }
      }
    };
    const cleanupNoCommit = () => cleanup({ commit: false });
    dragCleanupRef.current = cleanup;
    captureEl.addEventListener('pointermove', onMove);
    captureEl.addEventListener('pointerup', cleanup);
    captureEl.addEventListener('pointercancel', cleanupNoCommit);
    window.addEventListener('blur', cleanupNoCommit);
  }, []);

  useEffect(() => {
    const clamp = () => {
      if (!pos) return;
      const w = customSize?.width || 640;
      setPos(prev => prev ? {
        x: Math.max(0, Math.min(window.innerWidth - w, prev.x)),
        y: Math.max(0, Math.min(window.innerHeight - 40, prev.y)),
      } : prev);
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [pos, customSize]);

  if (!pdfViewer) return null;

  const body = loading ? (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
      {t('common.loading')}
    </div>
  ) : error ? (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ fontSize: 13, color: 'var(--red, #f87171)', padding: '8px 10px', borderRadius: 6, background: 'rgba(248,113,113,0.08)' }}>
        {error}
      </div>
    </div>
  ) : (
    <iframe src={blobUrl} title={filename} style={{ flex: 1, width: '100%', border: 'none' }} />
  );

  if (isMobile) {
    return (
      <>
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1999,
          background: 'rgba(0,0,0,0.25)',
        }} />
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'var(--bg-secondary)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', flexShrink: 0,
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 10 }}>
              {filename}
            </span>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {blobUrl && (
                <TitleBtn title={t('pdfViewer.download')}>
                  <a href={blobUrl} download={filename} style={{ display: 'flex', color: 'inherit' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </a>
                </TitleBtn>
              )}
              <TitleBtn onClick={closePdfViewer} danger title={t('pdfViewer.close')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </TitleBtn>
            </div>
          </div>
          {body}
        </div>
      </>
    );
  }

  if (minimized) {
    return (
      <div
        onClick={() => setMinimized(false)}
        style={{
          position: 'fixed', bottom: 0, right: 24,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderBottom: 'none', borderRadius: '8px 8px 0 0',
          padding: '10px 16px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          color: 'var(--text-primary)', fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-soft)', zIndex: 1000,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
          <path d="M6 2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 01 2-2z"/>
          <path d="M15 2v5h5"/>
        </svg>
        {filename}
      </div>
    );
  }

  return (
    <>
      {maximized && (
        <div
          onClick={() => setMaximized(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(0,0,0,0.35)',
            backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          }}
        />
      )}
      <div
        ref={windowRef}
        style={maximized ? {
          position: 'fixed', top: 28, left: 28, right: 28, bottom: 28,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: 'var(--shadow-modal)',
          zIndex: 1000, display: 'flex', flexDirection: 'column',
        } : pos ? {
          position: 'fixed', top: pos.y, left: pos.x,
          width: customSize?.width || 640,
          height: customSize?.height || 640,
          maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-modal)',
          zIndex: 1000, display: 'flex', flexDirection: 'column',
        } : {
          position: 'fixed', bottom: 0, right: 24,
          width: customSize?.width || 640,
          height: customSize?.height || 640,
          maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 40px)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-modal)',
          zIndex: 1000, display: 'flex', flexDirection: 'column',
          animation: 'compose-enter var(--motion-normal) var(--ease-emphasized) backwards',
        }}
      >
        {/* Title bar */}
        <div
          onPointerDown={handleTitleDragStart}
          style={{
            padding: '10px 14px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0, cursor: maximized ? 'default' : 'grab',
          }}
        >
          <span style={{
            fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 10,
          }}>
            {filename}
          </span>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {blobUrl && (
              <TitleBtn title={t('pdfViewer.download')}>
                <a href={blobUrl} download={filename} style={{ display: 'flex', color: 'inherit' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </a>
              </TitleBtn>
            )}
            <TitleBtn onClick={() => setMinimized(true)} title={t('pdfViewer.minimize')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </TitleBtn>
            <TitleBtn onClick={() => setMaximized(m => !m)} title={maximized ? t('pdfViewer.restore') : t('pdfViewer.maximize')}>
              {maximized ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
                  <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                  <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
              )}
            </TitleBtn>
            <TitleBtn onClick={closePdfViewer} danger title={t('pdfViewer.close')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </TitleBtn>
          </div>
        </div>

        {body}

        {!maximized && (
          <div
            onPointerDown={handleResizeDragStart}
            style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, cursor: 'nwse-resize' }}
          >
            <svg
              width="8" height="8" viewBox="0 0 8 8" fill="none"
              stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round"
              style={{ position: 'absolute', bottom: 3, right: 3, display: 'block', opacity: 0.5 }}
            >
              <path d="M7 2L2 7M7 5L5 7"/>
            </svg>
          </div>
        )}
      </div>
    </>
  );
}
