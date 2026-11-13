import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {preparation,componentPhases,acceptance} from '../deployment/flow.mjs';
import {tutorialFor} from '../deployment/component-tutorial.mjs';
import {walkCards,walkIssues} from '../deployment/companion-flow.mjs';
import {commandKeys} from '../deployment/command-params.mjs';

const profile=JSON.parse(await readFile(new URL('../universe/profile.json',import.meta.url),'utf8'));
const steps=[...preparation,...componentPhases(profile),...acceptance].flatMap(phase=>phase.steps);
for(const step of steps) step.tutorial=tutorialFor(step,profile.components.find(c=>'component-'+c.id===step.id));

test('62 步在新装及复用路线都有操作、反馈和复验；复用不出现对应安装命令',()=>{
  assert.equal(steps.length,62);
  for(const scope of [{cluster:'new',manager:'new'},{cluster:'reuse',manager:'new'},{cluster:'reuse',manager:'reuse'}]) {
    for(const step of steps) {
      const cards=walkCards(step,scope);
      assert.ok(cards.length,step.id);
      for(const card of cards) {
        assert.ok(card.target&&card.sample&&card.normal,step.id);
        if(card.text) commandKeys(card.text);
        if(card.change) assert.equal(card.mode==='newManager'?scope.manager:scope.cluster,'new',step.id);
        for(const issue of walkIssues(step,card,scope)) {
          assert.ok(issue.check&&issue.fix&&issue.verify,step.id);
          if(issue.diagnostic) commandKeys(issue.diagnostic.text);
          if(issue.diagnostic?.change) assert.equal(scope.cluster,'new',step.id);
        }
      }
    }
  }
});

test('Hermes 的 EM 访问问题和公共配置新建决策进入独立分支',()=>{
  const fresh={cluster:'new',manager:'new'};
  const reused={cluster:'reuse',manager:'reuse'};
  const step=steps.find(item=>item.id==='em-bind');
  const card=walkCards(step,fresh).find(item=>item.title.includes('实际访问端'));
  const timeout=walkIssues(step,card,fresh).find(item=>item.signal.includes('电脑超时'));
  assert.match(timeout.diagnostic.text,/Test-NetConnection/);
  assert.match(timeout.diagnostic.sample,/TcpTestSucceeded : True/);
  const common=steps.find(item=>item.id==='common');
  const current=walkCards(common,fresh)[0];
  assert.ok(walkIssues(common,current,fresh).some(item=>item.diagnostic?.text==='kubectl create namespace {{ns}}'));
  assert.ok(walkIssues(common,current,reused).every(item=>!item.diagnostic?.change));
});
