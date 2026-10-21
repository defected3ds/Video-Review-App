import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const output=fileURLToPath(new URL('../public/demo.mp4',import.meta.url));
if(!existsSync(output)) {
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=0x003087:s=1280x720:r=25:d=8','-vf',"drawgrid=w=80:h=80:t=1:c=0x46bfee@0.15,drawbox=x=755:y=346:w=155:h=110:c=0x22b7e9@0.5:t=2,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='PIPELIFE':x=88:y=88:fontsize=35:fontcolor=white,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='A closer look.':x=88:y=275:fontsize=65:fontcolor=white,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='Every frame. Every detail. Every perspective.':x=92:y=365:fontsize=24:fontcolor=0xa8dcf3,drawbox=x=90:y=445:w=70:h=5:c=0x22bdf3:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='SAMPLE VIDEO  /  TRY A PIN OR PENCIL COMMENT':x=90:y=610:fontsize=16:fontcolor=0x96c6e6,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{pts\\:hms}':x=940:y=610:fontsize=18:fontcolor=0xa8dcf3",'-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-movflags','+faststart','-threads','2','-y',output],{stdio:'inherit'});
}
console.log('Sample video ready.');
