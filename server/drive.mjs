import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

export const drivePrefix='drive:';
export const inlinePosterPrefix='inline-jpeg:';
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{5,200}$/.test(value);
const error=(message,status=400)=>Object.assign(new Error(message),{status,publicMessage:message});
const maxBytes=250*1024*1024;
export class GoogleDrive {
  constructor(store,{clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET,appUrl=process.env.APP_URL||process.env.RENDER_EXTERNAL_URL,encryptionKey=process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,folderId=process.env.GOOGLE_DRIVE_FOLDER_ID||'1banF1xuWc3kKjLCSIu4c7x26RSYr2Uhv',fetcher=fetch,allowLocal=false}={}) {
    this.store=store;this.clientId=clientId;this.clientSecret=clientSecret;this.folderId=folderId;this.fetch=fetcher;
    this.ready=Boolean(clientId&&clientSecret&&appUrl&&encryptionKey&&encryptionKey.length>=32&&validId(folderId));
    if(appUrl){const base=new URL(appUrl);if(base.protocol!=='https:'&&!(allowLocal&&base.hostname==='127.0.0.1'))throw new Error('APP_URL must use HTTPS.');if(base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('APP_URL must be the public site origin.');this.callback=new URL('/api/drive/callback',base).href;}
    if(encryptionKey)this.key=createHash('sha256').update(encryptionKey).digest();
  }
  check(){if(!this.ready)throw error('Google Drive is not configured. Add its OAuth settings in Render first.',503);}
  seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');}
  open(value){try{const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]));}catch{throw error('The saved Drive connection cannot be read. Restore its encryption key or reconnect Drive.',503);}}
  async status(){if(!this.ready)return {configured:false,connected:false};return {configured:true,connected:Boolean(await this.store.connection('google-drive')),folderId:this.folderId};}
  async connect(){
    this.check();await this.store.clearConnectionStates(Date.now());
    const state=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url');
    await this.store.saveConnection(`oauth:${createHash('sha256').update(state).digest('hex')}`,this.seal({verifier}),Date.now()+10*60000);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for(const [k,v] of Object.entries({client_id:this.clientId,redirect_uri:this.callback,response_type:'code',scope:'https://www.googleapis.com/auth/drive',access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
    return {url:url.href};
  }
  async token(body){
    const response=await this.fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:this.clientId,client_secret:this.clientSecret}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw error('Google authorization failed. Reconnect Drive and check the OAuth client settings.',401);
    const value=await response.json();if(!value.access_token)throw error('Google did not return an access token. Reconnect Drive.',401);return value;
  }
  async complete(state,code){
    this.check();if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state)||typeof code!=='string'||!code||code.length>4096)throw error('Invalid Google authorization response.');
    const saved=await this.store.consumeConnection(`oauth:${createHash('sha256').update(state).digest('hex')}`);
    if(!saved||saved.expires_at<Date.now())throw error('This Google connection attempt expired. Start again.');
    const {verifier}=this.open(saved.payload);
    const tokens=await this.token({grant_type:'authorization_code',code,redirect_uri:this.callback,code_verifier:verifier});
    if(!tokens.refresh_token)throw error('Google did not grant offline access. Reconnect and approve access again.',401);
    if(!tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/drive'))throw error('Approve Drive access to import and upload review videos.',401);
    await this.store.saveConnection('google-drive',this.seal({...tokens,expires_at:Date.now()+Number(tokens.expires_in||3600)*1000}),null);
  }
  async access(force=false){
    this.check();const saved=await this.store.connection('google-drive');if(!saved)throw error('Connect your Google Drive account first.',401);
    const value=this.open(saved.payload);
    if(!force&&value.access_token&&value.expires_at>Date.now()+60000)return value.access_token;
    if(!this.refreshing)this.refreshing=(async()=>{
      const tokens=await this.token({grant_type:'refresh_token',refresh_token:value.refresh_token});
      // A disconnect while refreshing must not recreate the deleted connection.
      if(!(await this.store.connection('google-drive')))throw error('Google Drive was disconnected.',401);
      await this.store.saveConnection('google-drive',this.seal({...value,...tokens,refresh_token:tokens.refresh_token||value.refresh_token,expires_at:Date.now()+Number(tokens.expires_in||3600)*1000}),null);
      return tokens.access_token;
    })().finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }
  async request(target,options={}) {
    const token=await this.access();
    let response=await this.fetch(target,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`},signal:options.signal||AbortSignal.timeout(30000),redirect:'error'});
    if(response.status===401){await response.body?.cancel();const refreshed=await this.access(true);response=await this.fetch(target,{...options,headers:{...options.headers,Authorization:`Bearer ${refreshed}`},signal:options.signal||AbortSignal.timeout(30000),redirect:'error'});}
    return response;
  }
  async list(pageToken){
    this.check();if(pageToken&&(typeof pageToken!=='string'||pageToken.length>2048))throw error('Invalid Drive page.');
    const target=new URL('https://www.googleapis.com/drive/v3/files');
    target.search=new URLSearchParams({q:`'${this.folderId}' in parents and trashed = false and (mimeType = 'video/mp4' or mimeType = 'video/webm')`,fields:'nextPageToken,files(id,name,size,mimeType,capabilities(canDownload))',pageSize:'50',orderBy:'name',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(pageToken?{pageToken}:{})});
    const response=await this.request(target);if(!response.ok)throw error('Unable to list the selected Drive folder. Check folder access and enable the Google Drive API.',response.status===404?404:503);
    const value=await response.json();return {files:(value.files||[]).filter(file=>file.capabilities?.canDownload!==false).map(({id,name,size,mimeType})=>({id,name,size:Number(size||0),mimeType})),nextPageToken:value.nextPageToken||null};
  }
  async metadata(id){
    if(!validId(id))throw error('Choose a valid Drive video.');
    const target=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);target.search=new URLSearchParams({fields:'id,name,size,mimeType,parents,trashed,capabilities(canDownload)',supportsAllDrives:'true'});
    const response=await this.request(target);if(!response.ok)throw error('This Drive video is unavailable or access was removed.',404);
    const value=await response.json();
    if(value.trashed||!value.parents?.includes(this.folderId)||value.capabilities?.canDownload===false)throw error('Choose a downloadable video in the connected folder.',403);
    if(!['video/mp4','video/webm'].includes(value.mimeType))throw error('Choose an MP4 or WebM video.');
    if(!Number.isSafeInteger(Number(value.size))||Number(value.size)<=0||Number(value.size)>maxBytes)throw error('Drive imports support videos up to 250 MB.');
    return value;
  }
  async media(id,{range,signal}={}){
    if(!validId(id))throw error('Invalid Drive video.');
    const target=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);target.search=new URLSearchParams({alt:'media',supportsAllDrives:'true'});
    return this.request(target,{headers:range?{Range:range}:{},signal});
  }
  async download(id,filename){
    const response=await this.media(id,{signal:AbortSignal.timeout(180000)});
    if(!response.ok||!response.body)throw error('Unable to download the Drive video. Check its download permissions or quota.',503);
    let count=0;
    const limit=new Transform({transform(chunk,encoding,done){count+=chunk.length;done(count>maxBytes?error('Drive imports support videos up to 250 MB.'):null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(filename,{flags:'wx'}));
  }
  async upload(filename,name,type,size) {
    const folderTarget=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(this.folderId)}`);
    folderTarget.search=new URLSearchParams({fields:'id,mimeType,trashed,capabilities(canAddChildren)',supportsAllDrives:'true'});
    const folderResponse=await this.request(folderTarget);
    if(!folderResponse.ok)throw error('The upload folder is unavailable. Check its Drive permissions.',403);
    const folder=await folderResponse.json();
    if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||!folder.capabilities?.canAddChildren)throw error('The connected Google account needs permission to upload into this folder.',403);
    const target=new URL('https://www.googleapis.com/upload/drive/v3/files');
    target.search=new URLSearchParams({uploadType:'resumable',fields:'id,name,size,mimeType',supportsAllDrives:'true'});
    const start=await this.request(target,{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':type,'X-Upload-Content-Length':String(size)},body:JSON.stringify({name,parents:[this.folderId]})});
    if(!start.ok)throw error('Google Drive could not start the upload. Check folder permissions and available storage.',503);
    const location=start.headers.get('location');
    if(!location)throw error('Google Drive did not provide an upload session.',503);
    const uploadUrl=new URL(location);
    if(uploadUrl.protocol!=='https:'||uploadUrl.hostname!=='www.googleapis.com'||!uploadUrl.pathname.startsWith('/upload/drive/'))throw error('Google Drive returned an invalid upload session.',503);
    const accessToken=await this.access();
    const uploaded=await this.fetch(uploadUrl,{method:'PUT',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':type,'Content-Length':String(size)},body:createReadStream(filename),duplex:'half',signal:AbortSignal.timeout(180000),redirect:'error'});
    if(!uploaded.ok)throw error('Google Drive upload failed. Check your available storage and try again.',503);
    const value=await uploaded.json();if(!validId(value.id))throw error('Google Drive did not confirm the uploaded video.',503);return value;
  }
  // Used only to clean up a newly-created upload if saving its review record fails.
  async removeNewUpload(id){if(!validId(id))return;const target=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);target.searchParams.set('supportsAllDrives','true');const response=await this.request(target,{method:'DELETE'});if(!response.ok&&response.status!==404)throw error('Unable to clean up the unfinished upload.',503);}
  async disconnect(){this.check();await this.store.consumeConnection('google-drive');}
}
