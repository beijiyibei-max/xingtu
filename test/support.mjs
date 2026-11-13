import {spawn} from 'node:child_process';
import {mkdtemp,mkdir} from 'node:fs/promises';
import net from 'node:net';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const token='test-only-random-development-token-33';
export const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):process.platform==='win32'?'D:/Java/Java-install/bin/java.exe':'java';
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));return port;}
export async function startServer(options={}){
 await mkdir(join(root,'test/runtime'),{recursive:true});
 const data=options.data||await mkdtemp(join(root,'test/runtime/server-')),port=await freePort(),base='http://127.0.0.1:'+port;
 const jar=process.env.XT_TEST_JAR||join(root,'dist/xingtu-server.jar');
 const proc=spawn(java,[...(process.platform==='win32'?['-Djdk.net.unixdomain.tmpdir='+root]:[]),'-Dfile.encoding=UTF-8','-jar',jar],{windowsHide:true,env:{...process.env,XT_DATA_DIR:data,XT_PORT:String(port),XT_BIND:'127.0.0.1',XT_ACCESS_TOKEN:token,XT_ACCESS_TOKEN_FILE:'',XT_COOKIE_SECURE:'false',XT_PUBLIC_ORIGIN:'',XT_LEGACY_MODE:'demo',...options.env},stdio:['ignore','pipe','pipe']});
 let output='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);
 const stop=async()=>{if(proc.exitCode!==null)return;const closed=once(proc,'exit');proc.kill();await closed;};
 const call=async(path,{method='GET',body,cookie='',bearer=false,origin=base,raw=false,headers={}}={})=>{const response=await fetch(base+path,{method,redirect:'manual',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(bearer?{Authorization:'Bearer '+token}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{}),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,text,headers:response.headers};};
 try{let ready=false;for(let i=0;i<100;i++){if(proc.exitCode!==null)throw Error(output);try{if((await call('/healthz')).status===200){ready=true;break;}}catch{}await sleep(80);}if(!ready)throw Error('服务未启动：'+output);}
 catch(error){await stop();throw error;}
 return {base,data,port,proc,stop,call,output:()=>output};
}
