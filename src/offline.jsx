import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, Download, Folder, Film, X, Info, RotateCcw } from 'lucide-react';
import Review from './Review.jsx';
import { clock, statusClass } from './review-utils.js';
import './style.css';
import './offline.css';

const PREFIX = 'pipelife-offline-v1:';
const sample = { id: 'sample', name: 'Welcome — sample video.mp4', duration: 8, fps: 25, status: 'In review', demo: true, src: __DEMO_VIDEO__, poster: __DEMO_POSTER__ };
const welcome = [{ id: 'welcome', author: 'Pipelife team', body: 'Click this comment to revisit frame 50. Try adding a hotspot or a pencil drawing of your own.', time: 2, frame: 50, hotspot: { x: .62, y: .5 }, annotations: [], resolved: false }];
const memory = new Map();
let storageAvailable = true;
function read(id) {
  if (memory.has(id)) return memory.get(id);
  let saved;
  try { saved = JSON.parse(localStorage.getItem(PREFIX + id) || 'null'); } catch { storageAvailable = false; }
  const value = saved && Array.isArray(saved.comments) ? saved : { status: 'In review', fps: 25, comments: id === 'sample' ? welcome : [] };
  memory.set(id, value); return value;
}
function write(id, value) {
  memory.set(id, value);
  try { localStorage.setItem(PREFIX + id, JSON.stringify(value)); } catch { storageAvailable = false; }
}
function uid() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function Demo() {
  const [assets, setAssets] = useState([{ ...sample, ...read(sample.id) }]), [selected, setSelected] = useState('sample'), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [hasDraft, setHasDraft] = useState(false);
  const input = useRef(), dirty = useRef(false);
  const asset = assets.find(a => a.id === selected);
  const base = `/offline/${asset.id}`;
  function navigate(id) { if (id !== selected && (!dirty.current || confirm('Discard unfinished feedback?'))) { dirty.current = false; setSelected(id); setNotice(''); } }
  async function request(route, options = {}) {
    const state = read(asset.id), body = options.body ? JSON.parse(options.body) : null;
    if (route === `${base}/comments` && (!options.method || options.method === 'GET')) return structuredClone(state.comments);
    if (route === `${base}/comments` && options.method === 'POST') {
      if (!body.body?.trim() || !body.author?.trim()) throw new Error('Enter your name and comment.');
      const comment = { ...body, id: uid(), frame: Math.round(body.time * asset.fps), resolved: false, created_at: new Date().toISOString() };
      write(asset.id, { ...state, comments: [...state.comments, comment].sort((a, b) => a.time - b.time) });
      return structuredClone(comment);
    }
    if (route.startsWith(`${base}/comments/`) && options.method === 'PATCH') {
      const id = route.split('/').at(-1), comment = state.comments.find(c => c.id === id);
      if (!comment) throw new Error('Comment not found.');
      const result = typeof body.resolved==='boolean'?{...comment,resolved:body.resolved}:{...comment,body:body.body,annotations:body.annotations??comment.annotations,hotspot:body.hotspot===undefined?comment.hotspot:body.hotspot};
      write(asset.id, { ...state, comments: state.comments.map(c => c.id === id ? result : c) }); return structuredClone(result);
    }
    throw new Error('This action requires the deployed app.');
  }
  async function importVideo(file) {
    if (!file) return;
    if (dirty.current && !confirm('Discard unfinished feedback?')) return;
    if (!/\.(mp4|webm)$/i.test(file.name) || file.size > 250 * 1024 * 1024) { setError('Choose an MP4 or WebM video up to 250 MB.'); return; }
    setBusy(true); setError('');
    const src = URL.createObjectURL(file);
    try {
      const duration = await new Promise((resolve, reject) => {
        const el = document.createElement('video'); el.preload = 'metadata';
        const timer = setTimeout(() => { el.removeAttribute('src'); el.load(); reject(new Error('Video took too long to load. Try an H.264 MP4.')); }, 15000);
        el.onloadedmetadata = () => { clearTimeout(timer); const duration = el.duration; el.removeAttribute('src'); el.load(); Number.isFinite(duration) && duration > 0 ? resolve(duration) : reject(new Error('Unable to read this video’s duration.')); };
        el.onerror = () => { clearTimeout(timer); reject(new Error('This browser cannot play that video. Try an H.264 MP4 or WebM.')); }; el.src = src;
      });
      const id = encodeURIComponent(`${file.name}:${file.size}:${file.lastModified}`), saved = read(id);
      const value = { id, name: file.name, size: file.size, duration, fps: saved.fps, status: saved.status, src, poster: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' };
      setAssets(previous => { const old = previous.find(a => a.id === id); if (old && !old.demo) URL.revokeObjectURL(old.src); return [...previous.filter(a => a.id !== id), value]; });
      dirty.current = false; setSelected(id); setRevision(v => v + 1); setNotice('Video opened locally. Choose its source frame rate below.');
    } catch (e) { URL.revokeObjectURL(src); setError(e.message); } finally { setBusy(false); }
  }
  function change(values) { setAssets(previous => previous.map(a => a.id === asset.id ? { ...a, ...values } : a)); write(asset.id, { ...read(asset.id), ...values }); }
  function exportFeedback() {
    const blob = new Blob([JSON.stringify({ video: asset.name, duration: asset.duration, ...read(asset.id) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${asset.name.replace(/\.[^.]+$/, '')}-feedback.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="app offline-demo"><header className="topbar"><div className="brand"><span>PIPELIFE</span><i/><span className="brand-subtitle">Video review</span></div><span className="offline-badge">INTERACTIVE DEMO</span><div className="topbar-actions"><button className="secondary export-button" onClick={exportFeedback}><Download size={16}/>Export feedback</button><button className="primary upload-button" disabled={busy} onClick={() => input.current.click()}><Upload size={17}/>{busy ? 'Opening…' : 'Open video'}</button></div></header>
  <div className="offline-banner"><Info size={16}/><span>Everything stays on your device. {storageAvailable ? 'Feedback is saved in this browser; reopen your video after a refresh.' : 'Browser storage is unavailable. Export feedback before closing.'} Client invitations require the deployed app.</span></div>
  <input className="hidden" ref={input} type="file" accept=".mp4,.webm,video/mp4,video/webm" aria-label="Open local video" onChange={e => { importVideo(e.target.files[0]); e.target.value = ''; }}/>
  <div className="app-body"><aside className="sidebar"><div className="sidebar-heading">YOUR REVIEW SPACE</div><button className="project-button selected"><Folder size={17}/>Local videos<small>{assets.length}</small></button><div className="sidebar-assets">{assets.map(a => <button key={a.id} className={selected === a.id ? 'selected' : ''} onClick={() => navigate(a.id)}><Film size={14}/><span>{a.name}</span></button>)}</div><div className="sidebar-bottom"><span className="eyebrow">Try it for yourself</span><p>Play. Pause. Pin a detail.<br/>Draw directly on a frame.<br/>Leave feedback that’s clear.</p></div></aside>
  <main className="workspace">{error && <div className="error-banner" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={18}/></button></div>}{notice && <div className="offline-notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={15}/></button></div>}
  <div className="workspace-heading"><div><div className="breadcrumb">Projects / Local review</div><h1>Your video, in focus.</h1><p>{asset.name}</p></div><label className={`status-select ${statusClass(asset.status)}`}><span className="status-dot"/><select aria-label="Review status" value={asset.status} onChange={e => change({ status: e.target.value })}>{['In review', 'Changes requested', 'Approved'].map(s => <option key={s}>{s}</option>)}</select></label></div>
  <div className="offline-settings"><label>Source frame rate <select aria-label="Source frame rate" value={asset.fps} disabled={hasDraft} onChange={e => { change({ fps: Number(e.target.value) }); setRevision(v => v + 1); }}>{[23.976,24,25,29.97,30,50,59.94,60].map(f => <option value={f} key={f}>{f} fps</option>)}</select></label><span>Set this to match your clip for frame numbering. Timestamps are always retained.</span></div>
  <Review key={`${asset.id}:${revision}`} asset={asset} base={base} guest={false} ownerName="Reviewer" onError={setError} onDirty={value => { dirty.current = value; setHasDraft(value); }} onNotice={setNotice} request={request} videoSrc={asset.src} posterSrc={asset.poster}>
    <section className="asset-section"><div className="asset-section-heading"><h2>VIDEO ASSETS <span>{assets.length}</span></h2><button className="reset-demo" onClick={() => { if (confirm('Clear the feedback and status for this video?')) { write(asset.id, { comments: [], fps: asset.fps, status: 'In review' }); change({ status: 'In review' }); dirty.current = false; setRevision(v => v + 1); } }}><RotateCcw size={13}/>Reset this review</button></div><div className="asset-grid">{assets.map(a => <button key={a.id} className={`asset-card ${selected === a.id ? 'selected' : ''}`} onClick={() => navigate(a.id)}><div className="thumbnail">{a.demo ? <img src={a.poster} alt=""/> : <video src={a.src} muted preload="metadata"/>}<span className="duration">{clock(a.duration)}</span></div><div className="asset-details"><strong>{a.name}</strong><div><small>{a.demo ? 'Included sample' : 'On your device'}</small><span className={`status-badge ${statusClass(a.status)}`}>{a.status}</span></div></div></button>)}</div></section>
  </Review></main></div></div>;
}
createRoot(document.getElementById('root')).render(<Demo/>);
