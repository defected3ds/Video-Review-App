import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync } from 'node:fs';
const run=promisify(execFile);
let working=Promise.resolve();

// Serialize encodes to keep the free server's CPU and memory bounded.
export async function withVideoWork(action){
  const previous=working;let release;working=new Promise(resolve=>{release=resolve;});
  await previous;try{return await action();}finally{release();}
}

export async function reviewCopy(source,output,{duration,fps,extension}){
  const scale="scale=w='if(gte(iw,ih),min(1280,iw),min(720,iw))':h='if(gte(iw,ih),min(720,ih),min(1280,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2";
  try{
    await run('ffmpeg',['-nostdin','-v','error','-i',source,'-map','0:v:0','-map','0:a:0?','-sn','-dn','-map_metadata','-1','-vf',scale,'-r',String(fps),'-c:v','libx264','-preset','veryfast','-crf','28','-maxrate','1500k','-bufsize','3000k','-pix_fmt','yuv420p','-threads','2','-filter_threads','1','-c:a','aac','-b:a','96k','-ac','2','-movflags','+faststart','-y',output],{timeout:180000,maxBuffer:65536});
    const {stdout}=await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=avg_frame_rate,codec_name:format=duration','-of','json',output],{timeout:20000,maxBuffer:65536});
    const metadata=JSON.parse(stdout),[a,b]=metadata.streams[0].avg_frame_rate.split('/').map(Number);
    if(metadata.streams[0].codec_name!=='h264'||Math.abs(a/b-fps)>.001||Math.abs(Number(metadata.format.duration)-duration)>Math.max(.15,2/fps))throw new Error('Review timing changed');
    const size=statSync(output).size,originalSize=statSync(source).size;
    // Already small inputs should not become larger merely to use this preset.
    return size<originalSize?{path:output,size,extension:'.mp4'}:{path:source,size:originalSize,extension};
  }catch{
    throw Object.assign(new Error('Unable to create a smaller review video within the processing limit. Try a shorter video or upload a 720p H.264 MP4.'),{status:422,publicMessage:'Unable to create a smaller review video within the processing limit. Try a shorter video or upload a 720p H.264 MP4.'});
  }
}
