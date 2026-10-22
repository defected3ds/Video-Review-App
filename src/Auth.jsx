import React, { useState } from 'react';
import { ChevronRight, CheckCircle2, LoaderCircle, MapPin, Pencil, ShieldCheck, UserRound } from 'lucide-react';
import Brand from './Brand.jsx';
import { api, json, initials } from './review-utils.js';

export const rememberedNicknameKey='pipelife-profile-nickname';
function rememberedName(){try{return localStorage.getItem(rememberedNicknameKey)||'';}catch{return '';}}
export function rememberNickname(value){try{localStorage.setItem(rememberedNicknameKey,value);}catch{}}
export default function Auth({setup,done,profilesEnabled=true}){
  const [name,setName]=useState(()=>setup?'':rememberedName()),[chooseName,setChooseName]=useState(()=>(profilesEnabled&&(!rememberedName()))||setup);
  const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event){
    event.preventDefault();setBusy(true);setError('');
    try{const session=await api(setup?'/api/setup':'/api/login',json('POST',{name,...(profilesEnabled?{nickname:name}:{}),password}));rememberNickname(session.name);done(session);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="auth-page"><header><Brand/></header><main className="auth-layout"><section className="auth-intro"><span className="eyebrow">A clearer way to collaborate</span><h1>Good work.<br/>Better feedback.</h1><p>Bring every frame, every comment, and every decision into one shared review space.</p><div className="auth-benefits"><span><MapPin/>Feedback in the right place</span><span><Pencil/>Mark what matters</span><span><CheckCircle2/>Keep approvals moving</span></div><div className="auth-line-art" aria-hidden="true"><div/><div/><div/></div></section><form className="auth-card" onSubmit={submit}><div className="small-icon"><ShieldCheck/></div><h2>{setup?'Set up your workspace':chooseName?'Join your workspace':'Welcome back'}</h2><p>{setup?'Choose a password for the team. Your clients can join individual reviews using an invitation link.':chooseName?'Choose a nickname and enter the workspace password shared with you. Your profile will be saved.':profilesEnabled?'Enter the workspace password to continue with your remembered profile.':'Enter the workspace password shared with your team.'}</p>
    {setup||chooseName?<><label>{setup?'Your name':'Nickname'}<input autoFocus required maxLength={80} autoComplete={setup?'name':'username'} aria-describedby="profile-name-help" value={name} onChange={e=>setName(e.target.value)}/></label><small id="profile-name-help">Shown on your profile and new comments.</small></>:profilesEnabled?<div className="remembered-profile"><span className="avatar">{initials(name)}</span><strong>{name}</strong><button type="button" onClick={()=>{setChooseName(true);setName('');setPassword('');setError('');}}>Switch profile</button></div>:null}
    <label>Workspace password<input autoFocus={!setup&&!chooseName} type="password" minLength={setup?6:1} maxLength={200} required autoComplete={setup?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>{setup&&<small>Use at least 6 characters. Keep this password for your team.</small>}{error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy||((profilesEnabled||setup)&&!name.trim())}>{busy?<LoaderCircle className="spin" size={18}/>:!setup?<UserRound size={17}/>:null}{setup?'Create workspace':'Sign in'}<ChevronRight size={17}/></button><div className="auth-footnote">PIPELIFE · Video review workspace</div></form></main></div>;
}
