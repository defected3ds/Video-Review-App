import React,{useState} from 'react';
import {ChevronRight,CheckCircle2,LoaderCircle,MapPin,Pencil,ShieldCheck} from 'lucide-react';
import Brand from './Brand.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import {api,json} from './review-utils.js';
import {commenterNameKey,rememberCommenter} from './commenter.js';
export const rememberedNicknameKey=commenterNameKey;
export const rememberNickname=rememberCommenter;
export default function Auth({setup,done,expired=false,loginPath='/api/login'}){
  const [name,setName]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event){
    event.preventDefault();setBusy(true);setError('');
    try{const session=await api(setup?'/api/setup':loginPath,json('POST',setup?{name,password}:{password}));if(setup)rememberCommenter(name);done(session);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="auth-page"><header><Brand/><ThemeToggle/></header><main className="auth-layout"><section className="auth-intro"><span className="eyebrow">A clearer way to collaborate</span><h1>Good work.<br/>Better feedback.</h1><p>Bring every frame, every comment, and every decision into one shared review space.</p><div className="auth-benefits"><span><MapPin/>Feedback in the right place</span><span><Pencil/>Mark what matters</span><span><CheckCircle2/>Keep approvals moving</span></div><div className="auth-line-art" aria-hidden="true"><div/><div/><div/></div></section><form className="auth-card" onSubmit={submit}><div className="small-icon"><ShieldCheck/></div><h2>{setup?'Set up your workspace':expired?'Session expired':'Welcome back'}</h2><p>{setup?'Choose a password for the team.':expired?'Your one-hour session has ended. Enter the shared password to continue. Your commenter name is remembered.':'Enter the shared workspace password. No account or registration needed.'}</p>
    {setup&&<label>Your name<input autoFocus required maxLength={80} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>}
    <label>Workspace password<input autoFocus={!setup} type="password" minLength={setup?6:1} maxLength={200} required autoComplete={setup?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>{setup&&<small>Use at least 6 characters. Keep this password for your team.</small>}{error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy||(setup&&!name.trim())}>{busy?<LoaderCircle className="spin" size={18}/>:null}{setup?'Create workspace':'Sign in'}<ChevronRight size={17}/></button><div className="auth-footnote">One-hour sessions · PIPELIFE video review</div></form></main></div>;
}
