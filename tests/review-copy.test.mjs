import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCopy, withVideoWork } from '../server/review-copy.mjs';

test('720p review copies reduce a high-bitrate video, retain audio, frame rate and timing, and front-load playback metadata',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pvr-review-copy-')),source=path.join(dir,'original.mp4'),output=path.join(dir,'review.mp4');
  try{
    execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=25:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-preset','ultrafast','-crf','12','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-shortest','-y',source],{timeout:20000});
    const copy=await reviewCopy(source,output,{fps:25,duration:2,extension:'.mp4'});
    assert.equal(copy.path,output);assert.ok(copy.size<statSync(source).size*.5,'Review copy should be substantially smaller than the high-bitrate source');
    const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=width,height,codec_type,codec_name,avg_frame_rate,nb_frames:format=duration','-of','json',output],{encoding:'utf8'}));
    const video=metadata.streams.find(s=>s.codec_type==='video');assert.equal(video.codec_name,'h264');assert.equal(video.width,1280);assert.equal(video.height,720);assert.equal(video.avg_frame_rate,'25/1');assert.equal(video.nb_frames,'50');assert.ok(Math.abs(Number(metadata.format.duration)-2)<.05);assert.ok(metadata.streams.some(s=>s.codec_name==='aac'));
    const {readFileSync}=await import('node:fs'),bytes=readFileSync(output);assert.ok(bytes.indexOf(Buffer.from('moov'))<bytes.indexOf(Buffer.from('mdat')),'MP4 metadata must precede video data for efficient startup');
    console.log(`Review fixture: ${(statSync(source).size/1e6).toFixed(2)} MB → ${(copy.size/1e6).toFixed(2)} MB`);
    const again=await reviewCopy(copy.path,path.join(dir,'again.mp4'),{fps:25,duration:2,extension:'.mp4'});assert.ok(again.size<=copy.size,'Already small videos must not grow');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('video encoding work is serialized and a failure releases the next operation',async()=>{
  const order=[];let release;
  const first=withVideoWork(async()=>{order.push('first');await new Promise(resolve=>{release=resolve;});throw new Error('Expected processing failure');});
  const rejected=assert.rejects(first,/Expected processing failure/);
  const second=withVideoWork(async()=>{order.push('second');return 2;});
  await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(order,['first']);release();await rejected;assert.equal(await second,2);assert.deepEqual(order,['first','second']);
});
