import express from 'express';
import multer from 'multer';
import { localDatabase, supabaseDatabase } from './database.mjs';
import { mkdirSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { proxyMedia } from './media.mjs';
import { GoogleDrive, drivePrefix, inlinePosterPrefix } from './drive.mjs';
import path from 'node:path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

if(process.env.NODE_ENV==='production'&&!process.env.SUPABASE_URL)throw new Error('Production requires SUPABASE_URL and SUPABASE_SECRET_KEY for persistent review data.');
const root = fileURLToPath(new URL('../', import.meta.url));
const data = path.resolve(process.env.DATA_DIR || path.join(root, '.data'));
const uploads = path.join(data, 'uploads');
mkdirSync(uploads, { recursive: true });
const store = process.env.SUPABASE_URL ? supabaseDatabase({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY,allowLocal:process.env.SUPABASE_ALLOW_LOCAL_TEST==='1'}) : localDatabase(data);
const drive=new GoogleDrive(store,{allowLocal:process.env.DRIVE_ALLOW_LOCAL_TEST==='1'});
const maxUploadMB=250;
const hash = value => createHash('sha256').update(value).digest('hex');
const publicAsset = ({ filename, poster, ...asset }) => ({ ...asset, hasPoster: Boolean(poster), demo: !filename, inDrive: Boolean(filename?.startsWith(drivePrefix)) });
const serializeComment = row => ({ ...row, annotations: JSON.parse(row.annotations), hotspot: row.hotspot ? JSON.parse(row.hotspot) : null, resolved: Boolean(row.resolved) });
const fail = (res, code, error) => res.status(code).json({ error });
const setupProtected=store.remote||process.env.NODE_ENV==='production'||Boolean(process.env.WORKSPACE_SETUP_TOKEN);
const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(async(req,res,next) => {
  res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});
  if (req.path.startsWith('/api')) res.set('Cache-Control','no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin')) {
    try { if (new URL(req.get('origin')).host !== req.get('host')) return fail(res,403,'Cross-origin requests are not allowed.'); }
    catch { return fail(res,403,'Invalid origin.'); }
  }
  next();
});
app.use(express.json({ limit:'128kb' }));
app.use(async(req,res,next) => {
  const cookie = req.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('pipelife_session='))?.slice(17);
  req.owner = Boolean(cookie && await store.session(hash(cookie),Date.now()));
  next();
});
const requireOwner = (req,res,next) => req.owner ? next() : fail(res,401,'Sign in to access the team workspace.');
async function createSession(req,res) {
  const token = randomBytes(32).toString('hex');
  await store.clearSessions(Date.now());
  await store.createSession(hash(token),Date.now()+7*86400000);
  res.cookie('pipelife_session',token,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/',maxAge:7*86400000});
}
app.get('/api/health',async(req,res)=>{if(store.remote)await store.owner();res.json({ok:true});});
app.get('/api/session',async(req,res)=>res.json({maxUploadMB,setupTokenRequired:setupProtected,authenticated:req.owner,setupRequired:!(await store.owner()),name:req.owner?(await store.owner())?.name:null}));
app.post('/api/setup',async(req,res)=>{
  if ((await store.owner())) return fail(res,409,'Workspace is already configured. Sign in instead.');
  const {password,name,setupCode}=req.body || {};
  if(setupProtected){
    if(!process.env.WORKSPACE_SETUP_TOKEN)return fail(res,503,'Workspace setup is disabled until the owner configures its setup code.');
    if(typeof setupCode!=='string'||setupCode.length>256||!timingSafeEqual(createHash('sha256').update(setupCode).digest(),createHash('sha256').update(process.env.WORKSPACE_SETUP_TOKEN).digest()))return fail(res,403,'The owner setup code is incorrect.');
  }
  if(typeof password!=='string'||password.length<10||password.length>200||typeof name!=='string'||!name.trim()||name.length>80) return fail(res,400,'Enter your name and a workspace password of 10–200 characters.');
  const salt=randomBytes(16).toString('hex');
  await store.createOwner({name:name.trim(),salt,password_hash:scryptSync(password,salt,64).toString('hex')});
  await createSession(req,res); res.status(201).json({authenticated:true,name:name.trim(),maxUploadMB});
});
const attempts=new Map();
app.post('/api/login',async(req,res)=>{
  const now=Date.now(), key=req.ip, previous=attempts.get(key);
  const attempt=previous&&previous.reset>now?previous:{count:0,reset:now+15*60000};
  attempts.set(key,attempt);
  if(++attempt.count>10) return fail(res,429,'Too many attempts. Try again in 15 minutes.');
  const owner=await store.owner();
  const password=req.body?.password;
  if(!owner||typeof password!=='string'||password.length>200||!timingSafeEqual(scryptSync(password,owner.salt,64),Buffer.from(owner.password_hash,'hex'))) return fail(res,401,'The workspace password is incorrect.');
  attempts.delete(key); await createSession(req,res); res.json({authenticated:true,name:owner.name,maxUploadMB});
});
app.post('/api/logout',async(req,res)=>{
  const cookie=req.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('pipelife_session='))?.slice(17);
  if(cookie) await store.deleteSession(hash(cookie));
  res.clearCookie('pipelife_session',{path:'/'});res.status(204).end();
});
app.use('/api/projects',requireOwner);
app.get('/api/projects',async(req,res)=>res.json(await store.projects()));
app.post('/api/projects',async(req,res)=>{
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  if(!name||name.length>100) return fail(res,400,'Enter a project name of 1–100 characters.');
  const id=randomUUID();await store.createProject(id,name);
  res.status(201).json({id,name,description:'',asset_count:0});
});
app.delete('/api/projects/:id',async(req,res,next)=>{
  if(!(await store.project(req.params.id)))return fail(res,404,'Project not found.');
  const files=await store.assets(req.params.id);
  await store.deleteProject(req.params.id);
  for(const file of files)for(const filename of [file.filename,file.filename?file.poster:null])if(filename&&existsSync(path.join(uploads,filename)))unlinkSync(path.join(uploads,filename));
  res.status(204).end();
});
app.get('/api/projects/:id/assets',async(req,res)=>{
  if(!(await store.project(req.params.id)))return fail(res,404,'Project not found.');
  res.json((await store.assets(req.params.id)).map(publicAsset));
});
const upload=multer({dest:uploads,limits:{fileSize:maxUploadMB*1024*1024,files:1},fileFilter:(req,file,cb)=>cb(null,/\.(mp4|webm)$/i.test(file.originalname))});
app.post('/api/projects/:id/assets',async(req,res,next)=>{
  if(store.remote&&!(await drive.status()).connected)return fail(res,503,'Connect Google Drive before uploading a video.');
  if(!(await store.project(req.params.id)))return fail(res,404,'Project not found.');next();
},upload.single('video'),async(req,res,next)=>{
  if(!req.file)return fail(res,400,`Choose an MP4 or WebM video up to ${maxUploadMB} MB.`);
  let metadata;
  try {
    const {stdout}=await promisify(execFile)('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=avg_frame_rate,codec_name:format=duration','-of','json',req.file.path],{timeout:20000,maxBuffer:65536});
    metadata=JSON.parse(stdout);
    if(!metadata.streams?.length||!['h264','vp8','vp9','av1'].includes(metadata.streams[0].codec_name)||!Number.isFinite(Number(metadata.format?.duration))||Number(metadata.format.duration)<=0)throw new Error('Unsupported video');
  }catch{unlinkSync(req.file.path);return fail(res,400,'Unable to read a browser-compatible video. Export as H.264 MP4 or VP9 WebM and try again.');}
  const id=randomUUID(),poster=`${req.file.filename}.jpg`;
  try {
    await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-i',req.file.path,'-frames:v','1','-vf','scale=640:-2','-y',path.join(uploads,poster)],{timeout:20000});
    const [n,d]=metadata.streams[0].avg_frame_rate.split('/').map(Number);
    let filename=req.file.filename,posterRef=poster;
    const connected=(await drive.status()).connected;
    if(connected){
      const uploaded=await drive.upload(req.file.path,path.basename(req.file.originalname).slice(0,200),path.extname(req.file.originalname).toLowerCase()==='.webm'?'video/webm':'video/mp4',req.file.size);
      filename=`${drivePrefix}${uploaded.id}`;
      posterRef=`${inlinePosterPrefix}${readFileSync(path.join(uploads,poster)).toString('base64')}`;
      try{await store.createAsset({id,project_id:req.params.id,name:path.basename(req.file.originalname).slice(0,200),filename,size:req.file.size,duration:Number(metadata.format.duration),fps:Number.isFinite(n/d)&&n/d>0?n/d:25,poster:posterRef});}
      catch(error){await drive.removeNewUpload(uploaded.id).catch(()=>{});throw error;}
      for(const file of [req.file.path,path.join(uploads,poster)])if(existsSync(file))unlinkSync(file);
    }else{
      if(store.remote)throw Object.assign(new Error('Connect Google Drive before uploading a video.'),{status:503,publicMessage:'Connect Google Drive before uploading a video.'});
      await store.createAsset({id,project_id:req.params.id,name:path.basename(req.file.originalname).slice(0,200),filename,size:req.file.size,duration:Number(metadata.format.duration),fps:Number.isFinite(n/d)&&n/d>0?n/d:25,poster:posterRef});
    }
    res.status(201).json({...publicAsset(await store.asset(id)),comment_count:0});
  }catch(error){for(const file of [req.file.path,path.join(uploads,poster)])if(existsSync(file))unlinkSync(file);next(error);}
});
// Drive authorization is owner-only. The callback uses a one-time, expiring state
// plus PKCE; it does not rely on cookies being sent from Google's origin.
app.get('/api/drive/status',requireOwner,async(req,res)=>res.json(await drive.status()));
app.post('/api/drive/connect',requireOwner,async(req,res)=>res.json(await drive.connect()));
app.delete('/api/drive/connect',requireOwner,async(req,res)=>{await drive.disconnect();res.status(204).end();});
app.get('/api/drive/files',requireOwner,async(req,res)=>res.json(await drive.list(req.query.pageToken)));
app.get('/api/drive/callback',async(req,res)=>{
  try{await drive.complete(req.query.state,req.query.code);res.redirect(303,'/?drive=connected');}
  catch(error){console.error('Drive callback failed:',error.publicMessage||'authorization unavailable');res.redirect(303,'/?drive=error');}
});
app.post('/api/projects/:id/drive-import',async(req,res)=>{
  if(!(await store.project(req.params.id)))return fail(res,404,'Project not found.');
  const file=await drive.metadata(req.body?.fileId),id=randomUUID();
  const filename=path.join(uploads,`import-${id}`),poster=path.join(uploads,`import-${id}.jpg`);
  try{
    await drive.download(file.id,filename);
    const {stdout}=await promisify(execFile)('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=avg_frame_rate,codec_name:format=duration','-of','json',filename],{timeout:20000,maxBuffer:65536});
    const metadata=JSON.parse(stdout);
    if(!metadata.streams?.length||!['h264','vp8','vp9','av1'].includes(metadata.streams[0].codec_name)||!Number.isFinite(Number(metadata.format?.duration))||Number(metadata.format.duration)<=0)return fail(res,400,'Export the Drive video as browser-compatible H.264 MP4 or VP9 WebM and try again.');
    await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-i',filename,'-frames:v','1','-vf','scale=640:-2','-y',poster],{timeout:20000});
    const [n,d]=metadata.streams[0].avg_frame_rate.split('/').map(Number),ext=file.mimeType==='video/webm'?'.webm':'.mp4';
    let name=path.basename(file.name).slice(0,190);if(!name.toLowerCase().endsWith(ext))name+=ext;
    await store.createAsset({id,project_id:req.params.id,name,filename:`${drivePrefix}${file.id}`,size:Number(file.size),duration:Number(metadata.format.duration),fps:Number.isFinite(n/d)&&n/d>0?n/d:25,poster:`${inlinePosterPrefix}${readFileSync(poster).toString('base64')}`});
    res.status(201).json({...publicAsset(await store.asset(id)),comment_count:0});
  }finally{for(const filePath of [filename,poster])if(existsSync(filePath))unlinkSync(filePath);}
});
const assetRouter=express.Router();
assetRouter.use('/:assetId',async(req,res,next)=>{
  req.asset=await store.asset(req.params.assetId);
  if(!req.asset)return fail(res,404,'Video not found.');next();
});
assetRouter.get('/:assetId',async(req,res)=>res.json(publicAsset(req.asset)));
assetRouter.post('/:assetId/share',async(req,res)=>{
  const token=randomBytes(24).toString('hex'),expiresAt=Date.now()+7*86400000;
  await store.createReview(hash(token),req.asset.id,expiresAt);
  res.status(201).json({token,expiresAt});
});
assetRouter.delete('/:assetId/share',async(req,res)=>{await store.deleteReviews(req.asset.id);res.status(204).end();});
const changeStatus=async(req,res)=>{
  if(!['In review','Approved','Changes requested'].includes(req.body?.status))return fail(res,400,'Invalid review status.');
  await store.status(req.asset.id,req.body.status);res.json({...publicAsset(req.asset),status:req.body.status});
};
const serveVideo=async(req,res)=>{
  if(req.asset.filename?.startsWith(drivePrefix))return proxyMedia(signal=>drive.media(req.asset.filename.slice(drivePrefix.length),{range:req.get('range'),signal}),req,res,req.asset.name.toLowerCase().endsWith('.webm')?'video/webm':'video/mp4');
  const filename=req.asset.filename?path.join(uploads,req.asset.filename):path.join(root,'public','demo.mp4');
  if(!existsSync(filename))return fail(res,404,'Video is unavailable. Run npm run prepare:demo to restore the sample.');
  res.type(req.asset.name.toLowerCase().endsWith('.webm')?'video/webm':'video/mp4');
  res.sendFile(filename);
};
const servePoster=async(req,res)=>{
  if(req.asset.poster?.startsWith(inlinePosterPrefix))return res.type('image/jpeg').send(Buffer.from(req.asset.poster.slice(inlinePosterPrefix.length),'base64'));
  const filename=req.asset.filename&&req.asset.poster?path.join(uploads,req.asset.poster):path.join(root,'public','demo-poster.svg');
  if(!existsSync(filename))return res.status(404).end();res.sendFile(filename);
};
const listComments=async(req,res)=>res.json((await store.comments(req.asset.id)).map(serializeComment));
const validPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const addComment=async(req,res)=>{
  const {body,time,author,annotations=[],hotspot=null}=req.body || {};
  if(typeof body!=='string'||!body.trim()||body.length>4000||typeof author!=='string'||!author.trim()||author.length>80||!Number.isFinite(time)||time<0||time>=req.asset.duration)return fail(res,400,'Enter your name, a comment, and a timestamp within the video.');
  if(!Array.isArray(annotations)||annotations.length>100||!annotations.every(s=>s&&/^#[0-9a-f]{6}$/i.test(s.color)&&Array.isArray(s.points)&&s.points.length>0&&s.points.length<=1500&&s.points.every(validPoint))||JSON.stringify(annotations).length>100000||hotspot!==null&&!validPoint(hotspot))return fail(res,400,'Drawing or hotspot is invalid or too large. Undo some strokes and try again.');
  const id=randomUUID();await store.createComment({id,asset_id:req.asset.id,author:author.trim(),body:body.trim(),time,frame:Math.round(time*req.asset.fps),annotations:JSON.stringify(annotations),hotspot:hotspot?JSON.stringify(hotspot):null});
  res.status(201).json(serializeComment(await store.comment(id)));
};
assetRouter.patch('/:assetId',changeStatus);
assetRouter.get('/:assetId/video',serveVideo);
assetRouter.get('/:assetId/poster',servePoster);
assetRouter.get('/:assetId/comments',listComments);
assetRouter.post('/:assetId/comments',addComment);
assetRouter.patch('/:assetId/comments/:commentId',async(req,res)=>{
  if(typeof req.body?.resolved!=='boolean')return fail(res,400,'Resolved must be true or false.');
  const result=await store.resolve(req.asset.id,req.params.commentId,req.body.resolved);
  if(!result)return fail(res,404,'Comment not found.');res.json(serializeComment(await store.comment(req.params.commentId)));
});
app.use('/api/assets',requireOwner,assetRouter);
const guest=express.Router({mergeParams:true});
guest.use(async(req,res,next)=>{
  const review=await store.review(hash(req.params.token),Date.now());
  if(!review)return fail(res,404,'This invitation has expired or been revoked. Ask the team for a new link.');
  req.asset=await store.asset(review.asset_id);next();
});
guest.get('/',async(req,res)=>res.json({asset:publicAsset(req.asset),project:await store.project(req.asset.project_id)}));
guest.get('/video',serveVideo);guest.get('/poster',servePoster);guest.get('/comments',listComments);guest.post('/comments',addComment);guest.patch('/status',changeStatus);
app.use('/api/reviews/:token',guest);
app.use('/api',async(req,res)=>fail(res,404,'Endpoint not found.'));
app.use(express.static(path.join(root,'dist')));
app.get('/{*splat}',async(req,res)=>{
  if(existsSync(path.join(root,'dist/index.html')))return res.sendFile(path.join(root,'dist/index.html'));
  res.status(404).send('Run npm run build or use npm run dev.');
});
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  if(err instanceof multer.MulterError)return fail(res,400,err.code==='LIMIT_FILE_SIZE'?`Video must be smaller than ${maxUploadMB} MB.`:'Upload one video at a time.');
  if(err.type==='entity.too.large')return fail(res,413,'This drawing is too large. Undo some strokes and try again.');
  if(err instanceof SyntaxError)return fail(res,400,'Invalid JSON.');
  console.error(err.message);
  if(err.publicMessage)return fail(res,err.status||500,err.publicMessage);
  if(err.status===409)return fail(res,409,'That record already exists. Refresh and try again.');
  if(err.status===503)return fail(res,503,'The database is unavailable. Check the Supabase configuration and schema.');
  if(err.status===404)return fail(res,404,'The video source is unavailable. Check its storage permissions.');
  fail(res,500,'Something went wrong. Please try again.');
});
const server=app.listen(Number(process.env.PORT||3001),process.env.HOST||'127.0.0.1',()=>console.log(`Pipelife review listening on ${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
