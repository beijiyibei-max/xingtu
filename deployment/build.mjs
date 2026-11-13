import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {preparation,componentPhases,acceptance} from './flow.mjs';
import {tutorialFor} from './component-tutorial.mjs';
import {commandKeys} from './command-params.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const read = file => readFile(join(root,file),'utf8');
const esbuild = resolve(root,'../legacy/immersive/node_modules/esbuild/lib/main.js');
const {build} = await import(pathToFileURL(esbuild));
const profile = JSON.parse(await read('../universe/profile.json'));
const phases = [...preparation,...componentPhases(profile),...acceptance];
const steps = phases.flatMap(phase => phase.steps);
if (new Set(steps.map(step=>step.id)).size !== steps.length || steps.some(step=>!step.checks.length||!step.sources.length)) {
  throw Error('部署向导包含重复步骤或缺少验收/来源');
}
const components = new Map(profile.components.map(component=>['component-'+component.id,component]));
for (const step of steps) {
  step.tutorial = tutorialFor(step,components.get(step.id));
  for (const card of step.tutorial) {
    if (!card.title || !card.target || !card.normal || !card.sample || !card.errors?.length ||
        card.errors.some(item=>!item.signal||!item.check||!item.fix||!item.verify)) {
      throw Error('教学卡缺少判读或处理步骤：'+step.id);
    }
    if (card.kind==='terminal') commandKeys(card.text);
  }
}
const yamlLicense = await read('node_modules/yaml/LICENSE');
const hostProbe = (await read('../collector/xt-preflight.sh')).replace(/\r\n/g,'\n');
const output = await build({
  entryPoints:[join(root,'ui.mjs')],bundle:true,write:false,
  define:{DEPLOYMENT_FLOW:JSON.stringify(phases),HOST_PROBE:JSON.stringify(hostProbe)},format:'iife',target:['es2020'],charset:'utf8',
  banner:{js:'/*! yaml 2.9.1\n'+yamlLicense+'\n*/'},
});
const script = output.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const css = await read('style.css');
await writeFile(resolve(root,'../build/fixtures/deployment-assistant.json'),JSON.stringify(
  Object.fromEntries(steps.map(step=>[step.id,{title:step.title,sources:step.sources,
    guidance:step.tutorial.map(card=>({title:card.title,target:card.target,normal:card.normal,
      errors:card.errors.map(error=>({signal:error.signal,check:error.check,verify:error.verify}))}))}]))));
const hash = text => createHash('sha256').update(text.replace(/\r\n?/g,'\n')).digest('base64');
const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(css)}'; base-uri 'none'; form-action 'none'; connect-src 'none'`;
const html = (await read('template.html'))
  .replace('__DEPLOYMENT_CSP__',()=>csp)
  .replace('/*__DEPLOYMENT_CSS__*/',()=>css)
  .replace('/*__DEPLOYMENT_JS__*/',()=>script);
await Promise.all([
  writeFile(resolve(root,'../build/web/deployment.html'),html.replace("connect-src 'none'","connect-src 'self'")),
  writeFile(resolve(root,'../dist/数栈7.0部署向导.html'),html),
]);
console.log(`部署向导：${phases.length} 阶段、${steps.length} 项、${steps.reduce((n,step)=>n+step.tutorial.length,0)} 张教学卡（含 SOP 31 项）`);
