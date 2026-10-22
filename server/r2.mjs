import { S3Client, ListObjectsV2Command, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export const r2Prefix='r2:';
export const r2MaxBytes=10_000_000_000;
export const playbackLifetime=300;
const problem=(message,status=503)=>Object.assign(new Error(message),{status,publicMessage:message});
export class R2Storage{
  constructor({accountId=process.env.R2_ACCOUNT_ID,accessKeyId=process.env.R2_ACCESS_KEY_ID,secretAccessKey=process.env.R2_SECRET_ACCESS_KEY,bucket=process.env.R2_BUCKET_NAME,endpoint,allowLocal=false,client}={}){
    this.requested=Boolean(accountId||accessKeyId||secretAccessKey||bucket);
    this.configured=Boolean(accountId&&/^[a-f0-9]{32}$/.test(accountId)&&accessKeyId&&secretAccessKey&&bucket&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket));
    this.bucket=bucket;
    if(!this.configured)return;
    const target=new URL(endpoint||`https://${accountId}.r2.cloudflarestorage.com`);
    if(target.origin!==`https://${accountId}.r2.cloudflarestorage.com`&&!(allowLocal&&target.protocol==='http:'&&target.hostname==='127.0.0.1'))throw problem('Invalid Cloudflare R2 storage endpoint.');
    if(target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw problem('Invalid Cloudflare R2 storage endpoint.');
    this.client=client||new S3Client({region:'auto',endpoint:target.origin,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey},maxAttempts:2,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  }
  ready(){if(!this.configured)throw problem('Finish the Cloudflare R2 settings in Render: R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');}
  async send(command,{signal}={}){
    this.ready();try{return await this.client.send(command,{abortSignal:signal||AbortSignal.timeout(30000)});}catch(error){
      if(signal?.aborted)throw error;
      throw problem('Cloudflare R2 could not complete the request. Check the bucket, account ID, and bucket-restricted Object Read & Write token in Render.');
    }
  }
  reference(value){
    if(typeof value!=='string'||!value.startsWith(r2Prefix))throw problem('Invalid stored R2 video reference.');
    const key=Buffer.from(value.slice(r2Prefix.length),'base64url').toString();
    if(!/^pvr\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.(mp4|webm)$/.test(key)||key.length>500)throw problem('Invalid stored R2 video reference.');
    return key;
  }
  async inspect(){
    let usedBytes=0,cursor;const seen=new Set();
    do{
      const page=await this.send(new ListObjectsV2Command({Bucket:this.bucket,MaxKeys:1000,...(cursor?{ContinuationToken:cursor}:{})}));
      for(const object of page.Contents||[]){if(!Number.isSafeInteger(object.Size)||object.Size<0)throw problem('Unable to check the R2 storage allowance.');usedBytes+=object.Size;}
      cursor=page.IsTruncated?page.NextContinuationToken:null;
      if(page.IsTruncated&&(!cursor||seen.has(cursor)))throw problem('Unable to check the R2 storage allowance.');
      if(cursor)seen.add(cursor);
    }while(cursor);
    return{usedBytes,maxBytes:r2MaxBytes};
  }
  async status(){
    if(!this.configured)return{provider:'r2',configured:false,connected:false,maxBytes:r2MaxBytes,message:this.requested?'Finish the four R2 settings in Render.':null};
    try{return{provider:'r2',configured:true,connected:true,...await this.inspect(),playbackLinkSeconds:playbackLifetime};}
    catch(error){return{provider:'r2',configured:true,connected:false,maxBytes:r2MaxBytes,message:error.publicMessage};}
  }
  async upload(filename,key,type,size){
    this.ready();this.reference(r2Prefix+Buffer.from(key).toString('base64url'));
    const previous=this.uploading||Promise.resolve();let release;this.uploading=new Promise(resolve=>{release=resolve;});await previous;
    try{
      if(!Number.isSafeInteger(size)||size<=0)throw problem('Invalid review video size.',400);
      const {usedBytes}=await this.inspect();if(usedBytes+size>r2MaxBytes)throw problem('The 10 GB R2 bucket guard is reached. Remove unused cloud files before uploading.',413);
      const checksum=createHash('sha256'),md5=createHash('md5');for await(const bytes of createReadStream(filename)){checksum.update(bytes);md5.update(bytes);}
      const digest=checksum.digest('hex');
      await this.send(new PutObjectCommand({Bucket:this.bucket,Key:key,ContentLength:size,ContentMD5:md5.digest('base64'),ContentType:type,CacheControl:'private, no-store',Metadata:{sha256:digest},Body:createReadStream(filename)}),{signal:AbortSignal.timeout(180000)});
      try{
        const saved=await this.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}));
        if(saved.ContentLength!==size||saved.Metadata?.sha256!==digest)throw problem('Cloudflare did not confirm the saved review video.');
      }catch(error){await this.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key})).catch(()=>{});throw error;}
      return r2Prefix+Buffer.from(key).toString('base64url');
    }finally{release();}
  }
  async playback(reference){
    this.ready();const key=this.reference(reference);
    const url=await getSignedUrl(this.client,new GetObjectCommand({Bucket:this.bucket,Key:key,ResponseCacheControl:'private, no-store'}),{expiresIn:playbackLifetime});
    return{url,expiresAt:Date.now()+playbackLifetime*1000};
  }
  async media(reference,{range,signal}={}){
    const value=await this.send(new GetObjectCommand({Bucket:this.bucket,Key:this.reference(reference),...(range?{Range:range}:{})}),{signal});
    return new Response(value.Body.transformToWebStream(),{status:value.ContentRange?206:200,headers:{'content-type':value.ContentType||'video/mp4',...(value.ContentLength!==undefined?{'content-length':String(value.ContentLength)}:{}),...(value.ContentRange?{'content-range':value.ContentRange}:{})}});
  }
  async remove(reference){await this.send(new DeleteObjectCommand({Bucket:this.bucket,Key:this.reference(reference)}));}
}
