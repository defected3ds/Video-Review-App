import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, Folder, Plus, Search, ChevronRight, Play, Pause, Pencil, MapPin, Undo2, Trash2, SkipBack, SkipForward, Maximize, Volume2, VolumeX, MessageSquare, Check, X, Link, Copy, LogOut, Film, Clock, CheckCircle2, LoaderCircle, ArrowLeft, Send, ShieldCheck } from 'lucide-react';
import './style.css';
import Review from './Review.jsx';
import Auth, {rememberNickname} from './Auth.jsx';
import Brand from './Brand.jsx';
import Admin from './Admin.jsx';
import ReviewQueue from './ReviewQueue.jsx';
import { api, json, clock, statusClass, initials } from './review-utils.js';

const statuses = ['In review', 'Changes requested', 'Approved'];
function Spinner() { return <LoaderCircle className="spin" size={18}/>; }
function Modal({ title, close, children }) {
  const ref = useRef();
  useEffect(() => { const element = ref.current; element.showModal(); const cancel = event => { event.preventDefault(); close(); }; element.addEventListener('cancel', cancel); return () => element.removeEventListener('cancel', cancel); }, []);
  return <dialog ref={ref} className="modal"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20}/></button></div>{children}</dialog>;
}

function App() {
  const admin = location.pathname.replace(/\/+$/, '') === '/admin';
  const token = admin ? null : new URLSearchParams(location.search).get('review');
  const guest = Boolean(token);
  const [session, setSession] = useState(null), [projects, setProjects] = useState([]), [projectId, setProjectId] = useState(''), [assets, setAssets] = useState([]), [asset, setAsset] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''), [tab, setTab] = useState('Projects'), [projectModal, setProjectModal] = useState(false), [projectName, setProjectName] = useState(''), [busy, setBusy] = useState(false), [uploadProgress, setUploadProgress] = useState(null), [share, setShare] = useState(null), [deleteProject, setDeleteProject] = useState(false), [videoToDelete,setVideoToDelete] = useState(null), [dragging,setDragging] = useState(false);
  const [storageStatus,setStorageStatus]=useState(null);
  const [driveStatus,setDriveStatus]=useState(null),[driveModal,setDriveModal]=useState(false),[driveFiles,setDriveFiles]=useState([]),[drivePage,setDrivePage]=useState(null),[driveBusy,setDriveBusy]=useState(false);
  const input = useRef(), dirty = useRef(false), projectRequest = useRef(0), requestedAsset = useRef(null), dragDepth = useRef(0), uploading = useRef(false);
  const project = projects.find(p => p.id === projectId);
  const assetBase = guest ? `/api/reviews/${encodeURIComponent(token)}` : asset ? `/api/assets/${asset.id}` : '';
  useEffect(()=>{
    const prevent=event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();};
    const reset=()=>{dragDepth.current=0;setDragging(false);};
    window.addEventListener('dragover',prevent);window.addEventListener('drop',prevent);window.addEventListener('dragend',reset);window.addEventListener('drop',reset);
    return()=>{window.removeEventListener('dragover',prevent);window.removeEventListener('drop',prevent);window.removeEventListener('dragend',reset);window.removeEventListener('drop',reset);};
  },[]);
  useEffect(()=>{if(session?.authenticated&&session.name)rememberNickname(session.name);},[session]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => {
    if (guest) api(`/api/reviews/${encodeURIComponent(token)}`).then(({ asset, project }) => { setProjects([project]); setProjectId(project.id); setAssets([asset]); setAsset(asset); }).catch(e => setError(e.message)).finally(() => setLoading(false));
    else api('/api/session').then(setSession).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (!admin && !guest && session?.authenticated) { setLoading(true); api('/api/projects').then(rows => { setProjects(rows); setProjectId(rows[0]?.id || ''); }).catch(e => setError(e.message)).finally(() => setLoading(false)); } }, [session]);
  useEffect(() => {
    if (!projectId || guest) return;
    const request = ++projectRequest.current; setLoading(true); setAsset(null); setAssets([]);
    api(`/api/projects/${projectId}/assets`).then(rows => { if (request === projectRequest.current) { setAssets(rows); setAsset(rows.find(a=>a.id===requestedAsset.current) || rows[0] || null); requestedAsset.current=null; } }).catch(e => { if (request === projectRequest.current) setError(e.message); }).finally(() => { if (request === projectRequest.current) setLoading(false); });
  }, [projectId]);
  useEffect(()=>{if(!admin&&!guest&&session?.authenticated){api('/api/storage/status').then(setStorageStatus).catch(e=>setError(e.message));api('/api/drive/status').then(setDriveStatus).catch(e=>setError(e.message));const result=new URLSearchParams(location.search).get('drive');if(result==='connected')setNotice('Google Drive connected. Site uploads will be saved in your Drive folder.');if(result==='error')setError('Google Drive connection failed. Try connecting again and check the Google OAuth settings.');}},[session]);
  async function openDrive(){if(!canNavigate())return;setDriveModal(true);if(driveStatus?.connected)await loadDriveFiles();}
  async function loadDriveFiles(pageToken){setDriveBusy(true);try{const result=await api(`/api/drive/files${pageToken?`?pageToken=${encodeURIComponent(pageToken)}`:''}`);setDriveFiles(previous=>pageToken?[...previous,...result.files]:result.files);setDrivePage(result.nextPageToken);}catch(e){setError(e.message);}finally{setDriveBusy(false);}}
  async function connectDrive(){setDriveBusy(true);try{const {url}=await api('/api/drive/connect',{method:'POST'});location.assign(url);}catch(e){setError(e.message);setDriveBusy(false);}}
  async function importDrive(file){if(!projectId)return;setDriveBusy(true);try{const value=await api(`/api/projects/${projectId}/drive-import`,json('POST',{fileId:file.id}));setAssets(previous=>[...previous,value]);setAsset(value);dirty.current=false;setProjects(previous=>previous.map(p=>p.id===projectId?{...p,asset_count:p.asset_count+1}:p));setDriveModal(false);setNotice('Drive video added. Ready for feedback.');}catch(e){setError(e.message);}finally{setDriveBusy(false);}}
  function canNavigate() { return !dirty.current || window.confirm('Discard your unfinished comment and markup?'); }
  function chooseProject(id) { if (uploadProgress !== null || busy) return; if ((id !== projectId||tab==='Reviews') && canNavigate()) { dirty.current = false; requestedAsset.current=null; setTab('Projects');setSearch(''); setProjectId(id); } }
  function chooseAsset(value) { if(uploading.current||busy)return; if ((value.id !== asset?.id||tab==='Reviews') && canNavigate()) { dirty.current = false; setTab('Projects');setAsset(value); } }
  function changeTab(value){if(value!==tab&&uploadProgress===null&&canNavigate()){dirty.current=false;setTab(value);}}
  function openReview(value){if(!canNavigate())return;dirty.current=false;setSearch('');setTab('Projects');if(value.project_id===projectId)setAsset(assets.find(a=>a.id===value.id)||value);else{requestedAsset.current=value.id;setProjectId(value.project_id);}}
  async function createProject(event) { event.preventDefault(); setBusy(true); try { const value = await api('/api/projects', json('POST', { name: projectName })); setProjects([...projects, value]); setProjectModal(false); setProjectName(''); chooseProject(value.id); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function removeProject() {
    if (!projectId) return;
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}`, { method: 'DELETE' });
      const remaining = projects.filter(p => p.id !== projectId);
      dirty.current = false; setDeleteProject(false); setProjects(remaining); setAssets([]); setAsset(null); setProjectId(remaining[0]?.id || '');
      setNotice('Project and its review data deleted.');
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  async function removeVideo() {
    if(!videoToDelete||uploading.current||busy)return;
    const target=videoToDelete;setBusy(true);
    try{
      await api(`/api/assets/${target.id}`,{method:'DELETE'});
      const remaining=assets.filter(a=>a.id!==target.id);setAssets(remaining);
      setProjects(previous=>previous.map(p=>p.id===target.project_id?{...p,asset_count:Math.max(0,p.asset_count-1)}:p));
      if(asset?.id===target.id){dirty.current=false;setAsset(remaining[Math.min(assets.findIndex(a=>a.id===target.id),remaining.length-1)]||null);setShare(null);}
      setVideoToDelete(null);setNotice('Video and its review data deleted. Project kept.');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const acceptsDrop=()=>!guest&&session?.authenticated&&tab==='Projects'&&!loading&&!busy&&!projectModal&&!deleteProject&&!videoToDelete&&!share&&!driveModal&&!uploading.current;
  function dragEnter(event){if(!Array.from(event.dataTransfer.types).includes('Files'))return;event.preventDefault();if(!acceptsDrop())return;dragDepth.current++;setDragging(true);}
  function dragLeave(event){if(!Array.from(event.dataTransfer.types).includes('Files'))return;event.preventDefault();if(--dragDepth.current<=0){dragDepth.current=0;setDragging(false);}}
  function dragOver(event){if(!Array.from(event.dataTransfer.types).includes('Files'))return;event.preventDefault();event.dataTransfer.dropEffect=acceptsDrop()&&projectId?'copy':'none';}
  function dropVideo(event){
    if(!Array.from(event.dataTransfer.types).includes('Files'))return;event.preventDefault();dragDepth.current=0;setDragging(false);
    if(!acceptsDrop())return;
    if(!projectId){setError('Create a project before dropping a video.');return;}
    if(event.dataTransfer.files.length!==1){setError('Drop one video at a time.');return;}
    upload(event.dataTransfer.files[0]);
  }
  function upload(file) {
    if (!file || uploading.current || busy || !projectId) return;
    if (!/\.(mp4|webm)$/i.test(file.name) || file.size > (session?.maxUploadMB || 250) * 1024 * 1024) { setError(`Choose an MP4 or WebM video smaller than ${session?.maxUploadMB || 250} MB.`); return; }
    if (!canNavigate()) return;
    const targetProject = projectId; uploading.current=true;setUploadProgress(0); setError('');
    const data = new FormData(); data.append('video', file);
    const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/projects/${targetProject}/assets`);
    xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onerror = () => { uploading.current=false;setUploadProgress(null); setError('Connection lost during upload. Please try again.'); };
    xhr.onload = () => { uploading.current=false;setUploadProgress(null); try { const value = JSON.parse(xhr.responseText); if (xhr.status !== 201) throw new Error(value.error || 'Upload failed.'); setAssets(previous => [...previous, value]); setAsset(value); setTab('Projects'); dirty.current = false; setProjects(previous => previous.map(p => p.id === targetProject ? { ...p, asset_count: p.asset_count + 1 } : p)); setNotice((value.inB2||value.inR2)?'Video saved to your private video storage. Ready for feedback.':value.inDrive?'Video saved to Google Drive. Ready for feedback.':'Video uploaded. Ready for feedback.');if(value.inB2||value.inR2)api('/api/storage/status').then(setStorageStatus).catch(()=>{}); } catch (e) { setError(e.message); } };
    xhr.send(data);
  }
  async function invite(mode='invite') { setBusy(true); try { const value = await api(`${assetBase}/share`, { method: 'POST' }); setShare({ ...value, mode, url: `${location.origin}/?review=${value.token}` }); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function revoke() { setBusy(true); try { await api(`${assetBase}/share`, { method: 'DELETE' }); setShare(null); setNotice('All invitation links for this video were revoked.'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function updateStatus(status) { try { const result = await api(guest ? `${assetBase}/status` : assetBase, json('PATCH', { status })); setAsset(result); setAssets(previous => previous.map(a => a.id === result.id ? { ...a, ...result } : a)); setNotice(`Review status: ${status}`); } catch (e) { setError(e.message); } }
  if (!guest && !session) return <div className="auth-page auth-check"><header><Brand/></header><main role="status">{error?<><p className="error">{error}</p><button className="secondary" onClick={()=>location.reload()}>Try again</button></>:<><Spinner/><p>Checking your session…</p></>}</main></div>;
  if (!guest && session && !session.authenticated) return <Auth setup={session.setupRequired} done={setSession} profilesEnabled={session.profilesEnabled}/>;
  if (admin) return session ? <Admin session={session} onSession={setSession}/> : <div className="auth-page"><header><Brand/></header><main className="admin-main">{error ? <p className="error" role="alert">{error}</p> : <p className="storage-summary"><Spinner/>Opening settings…</p>}</main></div>;
  const shown = assets.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));
  return <div className={`app ${guest ? 'guest' : ''}`}>
    <header className="topbar"><Brand/>{!guest && <nav aria-label="Main navigation">{['Projects', 'Reviews'].map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => changeTab(value)} disabled={uploadProgress!==null}>{value}</button>)}</nav>}<div className="topbar-actions">{guest ? <span className="guest-label"><Link size={15}/> Guest review</span> : <>{driveStatus?.connected&&!storageStatus?.configured&&<button className="secondary drive-button" disabled={uploadProgress !== null} onClick={openDrive}>Google Drive</button>}<button className="primary upload-button" disabled={!projectId || uploadProgress !== null} onClick={() => input.current.click()}><Upload size={17}/>Upload video</button><button className="avatar logout" aria-label="Sign out" title="Sign out" onClick={async () => { if (canNavigate()) { await api('/api/logout', { method: 'POST' }); location.reload(); } }}>{initials(session?.name || 'Team')}<LogOut size={14}/></button></>}</div></header>
    <input ref={input} className="hidden" type="file" accept="video/mp4,video/webm,.mp4,.webm" aria-label="Upload video file" onChange={e => { upload(e.target.files[0]); e.target.value = ''; }}/>
    <div className="app-body"><aside className="sidebar"><div className="sidebar-heading"><span>{guest ? 'YOUR REVIEW' : 'PROJECTS'}</span>{!guest && <button className="icon-button" aria-label="Create project from sidebar" disabled={uploadProgress !== null} onClick={() => { if (canNavigate()) setProjectModal(true); }}><Plus size={18}/></button>}</div><div className="project-list">{projects.map(p => <div key={p.id}><button disabled={uploadProgress !== null} className={`project-button ${projectId === p.id ? 'selected' : ''}`} onClick={() => chooseProject(p.id)}><Folder size={17}/><span>{p.name}</span>{!guest && <small>{p.asset_count}</small>}</button>{p.id === projectId && <div className="sidebar-assets">{assets.map(a => <button key={a.id} onClick={() => chooseAsset(a)} className={asset?.id === a.id ? 'selected' : ''}><Film size={14}/><span>{a.name.replace(/\.(mp4|webm)$/i, '')}</span></button>)}</div>}</div>)}</div></aside>
    <main className={`workspace ${dragging?'dragging-video':''}`} onDragEnter={dragEnter} onDragLeave={dragLeave} onDragOver={dragOver} onDrop={dropVideo}>{dragging&&<div className="video-drop-overlay" role="status"><Upload size={36}/><strong>{projectId?'Drop video to upload':'Create a project first'}</strong><span>{project?.name} · MP4 or WebM · up to {session?.maxUploadMB||250} MB</span></div>}{error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={18}/></button></div>}{notice && <div className="toast" role="status"><CheckCircle2 size={17}/>{notice}</div>}
    {uploadProgress !== null && <div className="upload-progress" role="status"><Spinner/>{uploadProgress < 100 ? `Uploading video… ${uploadProgress}%` : (storageStatus?.configured?'Saving original video to storage…':driveStatus?.connected?'Processing video and saving to Google Drive…':'Processing video and generating thumbnail…')}<progress value={uploadProgress} max="100"/></div>}
    <div className="workspace-heading"><div><div className="breadcrumb">{guest ? 'Shared review' : 'Workspace'}<ChevronRight size={13}/>{tab==='Reviews'&&!guest?'All projects':project?.name || 'Workspace'}</div><h1>{tab==='Reviews'&&!guest?'Reviews':project?.name || 'Video review'}</h1><p>{tab==='Reviews'&&!guest?'Feedback and approvals across all your projects.':asset ? asset.name : project?.description || 'A place for your next great project.'}</p></div>{asset && (guest||tab!=='Reviews') && <div className="review-actions"><label className={`status-select ${statusClass(asset.status)}`}><span className="status-dot"/><select aria-label="Review status" value={asset.status} onChange={e => updateStatus(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label>{!guest && <button className="secondary" disabled={busy} onClick={()=>invite('invite')}><Link size={16}/>Invite people</button>}{!guest && <button className="secondary" disabled={busy} onClick={()=>invite('share')}><Copy size={15}/>Share link</button>}</div>}</div>
    {!guest && tab!=='Reviews' && <div className="project-controls"><button className="secondary" disabled={uploadProgress !== null} onClick={() => { if (canNavigate()) setProjectModal(true); }}><Plus size={15}/>New project</button>{project && <button className="secondary" disabled={uploadProgress !== null || busy} onClick={() => setDeleteProject(true)}><Trash2 size={15}/>Delete project</button>}</div>}
    {!guest && tab!=='Reviews' && <select className="mobile-project-select" aria-label="Choose project" disabled={uploadProgress !== null} value={projectId} onChange={e => chooseProject(e.target.value)}>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>}
    {!guest&&tab==='Reviews'?<ReviewQueue onOpen={openReview}/>:loading ? <div className="empty loading"><Spinner/><p>Opening your workspace…</p></div> : asset ? <Review key={asset.id} asset={asset} base={assetBase} guest={guest} ownerName={session?.name} onError={setError} onDirty={value => { dirty.current = value; }} onNotice={setNotice}>
      {!guest && <section className="asset-section"><div className="asset-section-heading"><h2>VIDEO ASSETS <span>{shown.length}</span><small>Drop a video here to upload</small></h2><label className="search"><Search size={15}/><input placeholder="Search videos" aria-label="Search videos" value={search} onChange={e => setSearch(e.target.value)}/></label></div><div className="asset-grid">{shown.map(a => <div key={a.id} className="asset-card-shell"><button className={`asset-card ${asset.id === a.id ? 'selected' : ''}`} onClick={() => chooseAsset(a)}><div className="thumbnail"><img src={`/api/assets/${a.id}/poster`} alt=""/><span className="duration">{clock(a.duration)}</span>{a.demo && <span className="demo-label">SAMPLE</span>}</div><div className="asset-details"><strong>{a.name}</strong><div><small>{a.demo ? 'Try the review tools' : `${a.inR2?'Cloudflare R2 · ':a.inB2?'Backblaze B2 · ':a.inDrive?'Google Drive · ':''}${(a.size / 1024 / 1024).toFixed(1)} MB · ${a.fps.toFixed(2).replace('.00', '')} fps`}</small><span className={`status-badge ${statusClass(a.status)}`}>{a.status}</span></div></div></button><button className="asset-delete icon-button" aria-label={`Delete video ${a.name}`} title="Delete video" disabled={busy||uploadProgress!==null} onClick={()=>setVideoToDelete(a)}><Trash2 size={14}/></button></div>)}{!shown.length && <p className="muted">{search ? 'No videos match your search.' : 'No videos in this project yet.'}</p>}</div></section>}
    </Review> : <div className="empty"><div className="empty-icon"><Film size={34}/></div><h2>{guest ? 'Review unavailable' : 'Your next review starts here'}</h2><p>{guest ? 'Ask the team for a new invitation link.' : 'Drop a video here or choose a file to start your review.'}</p>{!guest && <><button className="primary" onClick={() => projectId ? input.current.click() : setProjectModal(true)} disabled={uploadProgress !== null}>{projectId ? <Upload size={17}/> : <Plus size={17}/>}{projectId ? 'Upload your first video' : 'Create your first project'}</button><small>MP4 or WebM · up to {session?.maxUploadMB || 250} MB</small></>}</div>}
    </main></div>
    {projectModal && <Modal title="Create a project" close={() => setProjectModal(false)}><form onSubmit={createProject}><label>Project name<input autoFocus required maxLength={100} placeholder="e.g. Spring campaign" value={projectName} onChange={e => setProjectName(e.target.value)}/></label><button className="primary" disabled={busy || !projectName.trim()}>{busy ? <Spinner/> : <Plus size={17}/>}Create project</button></form></Modal>}
    {driveModal && <Modal title="Google Drive" close={()=>{if(!driveBusy)setDriveModal(false);}}><p>Videos uploaded on this site are saved in your connected Google Drive folder. Imported videos can be reviewed without changing their original file.</p>{driveStatus?.connected?<><div className="drive-folder"><a href={`https://drive.google.com/drive/folders/${driveStatus.folderId}`} target="_blank" rel="noreferrer">Open connected folder ↗</a><button className="secondary" disabled={driveBusy} onClick={()=>loadDriveFiles()}>Refresh</button></div>{!projectId&&<p>Create a project before importing a video.</p>}<div className="drive-file-list">{driveFiles.map(file=><div key={file.id} className="drive-file"><Film size={20}/><div><strong>{file.name}</strong><small>{(file.size/1024/1024).toFixed(1)} MB</small></div><button className="primary" disabled={!projectId||driveBusy||file.size>250*1024*1024} onClick={()=>importDrive(file)}>Import</button></div>)}{!driveFiles.length&&!driveBusy&&<p>No MP4 or WebM videos found in this folder.</p>}</div>{driveBusy&&<p className="drive-loading"><Spinner/>Reading your Drive video…</p>}{drivePage&&<button className="secondary" disabled={driveBusy} onClick={()=>loadDriveFiles(drivePage)}>Load more videos</button>}<button className="danger-link" disabled={driveBusy} onClick={async()=>{setDriveBusy(true);try{await api('/api/drive/connect',{method:'DELETE'});setDriveStatus(await api('/api/drive/status'));setDriveFiles([]);}catch(e){setError(e.message);}finally{setDriveBusy(false);}}}>Disconnect Google Drive</button></>:<><p>{driveStatus?.configured?'Sign in with the Google account that can upload into your review folder. Google will ask you to approve Drive access.':'Your workspace owner needs to configure Google authorization before connecting Drive.'}</p><button className="primary" disabled={driveBusy||!driveStatus?.configured} onClick={connectDrive}>{driveBusy?<Spinner/>:<Folder size={17}/>}Connect Google Drive</button></>}</Modal>}
    {videoToDelete&&<Modal title="Delete video?" close={()=>{if(!busy)setVideoToDelete(null);}}><p>Delete <strong>{videoToDelete.name}</strong>? Its comments, drawings, and review links will also be removed. <strong>The project and its other videos will stay.</strong> Cloud video files stay in their storage account; remove unused files there to reclaim space. This cannot be undone.</p><div className="modal-actions"><button className="secondary" disabled={busy} onClick={()=>setVideoToDelete(null)}>Cancel</button><button className="primary danger-button" disabled={busy} onClick={removeVideo}>{busy?<Spinner/>:<Trash2 size={16}/>}Delete video</button></div></Modal>}
    {deleteProject && <Modal title="Delete project?" close={() => setDeleteProject(false)}><p>Delete <strong>{project?.name}</strong> and its {assets.length} video(s)? Comments, drawings, and review links will also be removed. Cloud video files stay in their storage account. Remove unused files there to reclaim storage. This cannot be undone.</p><div className="modal-actions"><button className="secondary" onClick={() => setDeleteProject(false)}>Cancel</button><button className="primary danger-button" disabled={busy} onClick={removeProject}>{busy ? <Spinner/> : <Trash2 size={16}/>}Delete permanently</button></div></Modal>}
    {share && <Modal title={share.mode==='share'?'Share video':'Invite people'} close={() => setShare(null)}><div className="share-intro"><div className="small-icon"><Link/></div><p>Share <strong>{asset.name}</strong> with its full comment history, drawings, pins, and review status. Anyone with this link can watch and add feedback. No account needed.</p></div><label>Review link<input readOnly aria-label="Review link" value={share.url} onFocus={e => e.target.select()}/></label><p className="muted small">Expires {new Date(share.expiresAt).toLocaleDateString()}. Other projects remain private.{asset.inR2&&' Already issued playback links may remain usable for up to 5 minutes after revocation.'}</p><div className="modal-actions"><button className="primary" onClick={async () => { try { await navigator.clipboard.writeText(share.url); setNotice('Review link copied.'); } catch { setNotice('Select and copy the review link above.'); } }}><Copy size={16}/>Copy link</button><a className="secondary" href={share.url} target="_blank" rel="noreferrer">Open review<ChevronRight size={15}/></a></div><button className="danger-link" disabled={busy} onClick={revoke}>Revoke all invitation links for this video</button></Modal>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
