import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWeek,weekOf,wallTime,localDate,publicLife} from '../src/life.js';
test('varied weeks remain contiguous across DST with meals, breaks and sleep',()=>{
  for(const week of ['2026-03-02','2026-10-26','2026-11-02'])for(let seed=0;seed<100;seed++){
    const blocks=generateWeek(week,String(seed));
    assert.deepEqual(blocks,generateWeek(week,String(seed)));
    for(let i=0;i<blocks.length;i++){assert.ok(blocks[i].end>blocks[i].start);if(i)assert.equal(blocks[i-1].end,blocks[i].start);}
    assert.equal(localDate(blocks[0].start),week);
    assert.ok(blocks.some(b=>b.kind==='meeting'));assert.ok(blocks.some(b=>b.kind==='lab'));assert.ok(blocks.some(b=>b.kind==='rest'));
    const sleeps=[];for(const b of blocks){const last=sleeps.at(-1);if(b.kind==='sleep'){if(last?.end===b.start)last.end=b.end;else sleeps.push({...b});}}
    for(const b of sleeps.slice(1,-1))assert.ok(b.end-b.start>=7*3600000);
    const next=generateWeek('2026-11-09','next');assert.ok(next.length);
  }
});
test('Berkeley dates and privacy projection',()=>{
  assert.equal(weekOf(Date.parse('2026-10-26T03:00:00Z')),'2026-10-19');
  assert.equal(new Date(wallTime('2026-11-01',480)).toISOString(),'2026-11-01T16:00:00.000Z');
  assert.deepEqual(Object.keys(publicLife(generateWeek('2026-10-19','x')[0])).sort(),['available','fictional','location','title']);
});
