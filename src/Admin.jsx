import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, Folder, KeyRound, LoaderCircle, LogOut, Save, Settings, UserRound } from 'lucide-react';
import Brand from './Brand.jsx';
import { api, json } from './review-utils.js';

export default function Admin({ session, onSession }) {
  const [name, setName] = useState(session.name || '');
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [storage, setStorage] = useState(null), [storageBusy, setStorageBusy] = useState(false), [saving, setSaving] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function refreshStorage() {
    setStorageBusy(true); setError('');
    try { setStorage(await api('/api/storage/status')); } catch (e) { setError(e.message); } finally { setStorageBusy(false); }
  }
  useEffect(() => { refreshStorage(); }, []);
  async function saveProfile(event) {
    event.preventDefault(); setSaving('profile'); setError(''); setNotice('');
    try { const profile = await api('/api/settings/profile', json('PATCH', { name })); onSession({ ...session, name: profile.name }); setName(profile.name); setNotice('Display name saved. New comments will use this name.'); }
    catch (e) { setError(e.message); } finally { setSaving(''); }
  }
  async function changePassword(event) {
    event.preventDefault(); setError(''); setNotice('');
    if (newPassword !== confirmation) { setError('The new passwords do not match.'); return; }
    setSaving('password');
    try {
      onSession(await api('/api/settings/password', json('POST', { currentPassword, newPassword })));
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
      setNotice('Workspace password changed. Other team sessions have been signed out.');
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  }
  const spinner = <LoaderCircle className="spin" size={17}/>;
  return <div className="admin-page">
    <header className="topbar admin-topbar"><Brand/><div className="topbar-actions"><a className="secondary" href="/"><ArrowLeft size={16}/>Back to projects</a><button className="icon-button" aria-label="Sign out" onClick={async () => { try { await api('/api/logout', { method: 'POST' }); location.assign('/admin'); } catch (e) { setError(e.message); } }}><LogOut size={19}/></button></div></header>
    <main className="admin-main"><div className="admin-heading"><span className="eyebrow">Workspace administration</span><h1>Settings</h1><p>Manage your team profile, workspace password, and video storage.</p></div>
      {error && <div className="admin-alert error" role="alert">{error}</div>}{notice && <div className="admin-alert admin-success" role="status"><CheckCircle2 size={18}/>{notice}</div>}
      <div className="admin-layout"><nav className="admin-nav" aria-label="Settings sections"><a href="#profile"><UserRound size={17}/>Team profile</a><a href="#password"><KeyRound size={17}/>Password</a><a href="#storage"><Folder size={17}/>Video storage</a><div className="admin-access"><Settings size={18}/><p>Protected by your workspace sign-in. Client invitation links do not grant access.</p></div></nav>
        <div className="admin-sections">
          <section className="admin-card" id="profile" aria-labelledby="profile-heading"><div className="admin-card-heading"><UserRound size={20}/><div><h2 id="profile-heading">Team profile</h2><p>The shared name shown on your workspace and new comments.</p></div></div><form onSubmit={saveProfile}><label htmlFor="admin-name">Display name</label><input id="admin-name" required maxLength={80} autoComplete="name" value={name} onChange={e => setName(e.target.value)}/><button className="primary" disabled={Boolean(saving) || !name.trim()}>{saving === 'profile' ? spinner : <Save size={16}/>}Save profile</button></form></section>
          <section className="admin-card" id="password" aria-labelledby="password-heading"><div className="admin-card-heading"><KeyRound size={20}/><div><h2 id="password-heading">Workspace password</h2><p>Use the same password to enter your team workspace and this settings page.</p></div></div><form onSubmit={changePassword}><label htmlFor="current-password">Current password</label><input id="current-password" type="password" required maxLength={200} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}/><div className="admin-password-row"><div><label htmlFor="new-password">New password</label><input id="new-password" type="password" required minLength={6} maxLength={200} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)}/></div><div><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" required minLength={6} maxLength={200} autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)}/></div></div><p className="admin-help">At least 6 characters. Changing it signs out other team sessions. Client review links remain active.</p><button className="primary" disabled={Boolean(saving)}>{saving === 'password' ? spinner : <KeyRound size={16}/>}Change password</button></form></section>
          <section className="admin-card" id="storage" aria-labelledby="storage-heading"><div className="admin-card-heading"><Folder size={20}/><div><h2 id="storage-heading">Video storage</h2><p>Private Backblaze B2 storage for uploaded videos.</p></div></div>
            {!storage ? <p className="storage-summary">{storageBusy ? spinner : <Folder size={18}/>}Checking storage connection…</p> : storage.connected ? <><div className="storage-summary"><CheckCircle2 size={20}/><strong>Video storage connected</strong></div><div className="admin-storage-usage"><strong>{(storage.usedBytes / 1e9).toFixed(2)} GB</strong><span>of 10 GB used</span></div><progress className="storage-meter" value={storage.usedBytes} max={storage.maxBytes} aria-label="Video storage used"/><p className="admin-help">Clients watch through their review link. Your bucket and access keys stay private.</p></> : <><div className="storage-summary"><Folder size={20}/><strong>{storage.configured ? 'Check storage settings' : 'Connect your free video storage'}</strong></div>{storage.message && <p className="error" role="alert">{storage.message}</p>}<ol className="storage-steps"><li>Create a private Backblaze B2 bucket.</li><li>Create a read-and-write application key restricted to that bucket.</li><li>Save <code>B2_KEY_ID</code>, <code>B2_APPLICATION_KEY</code>, and <code>B2_BUCKET_ID</code> in Render Environment, then redeploy.</li></ol></>}
            <div className="admin-storage-actions"><button className="secondary" disabled={storageBusy} onClick={refreshStorage}>{storageBusy ? spinner : <CheckCircle2 size={16}/>}Check connection</button><a className="secondary" href="https://secure.backblaze.com/b2_buckets.htm" target="_blank" rel="noreferrer">Manage storage<ExternalLink size={14}/></a><a className="admin-text-link" href="https://dashboard.render.com/web/srv-dbcee89kjs5s739m3n9g/env" target="_blank" rel="noreferrer">Server settings<ExternalLink size={13}/></a></div><div className="admin-storage-note"><strong>Free storage limits</strong><p>Keep Backblaze monetary caps at $0 and leave payment details unset. Download and API allowances are separate from the 10 GB storage limit. Cloud files remain after deleting a project; remove unused files and versions in Backblaze to reclaim space.</p></div>
          </section>
        </div></div></main>
  </div>;
}
