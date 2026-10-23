// Fictional Berkeley life. Persisted weeks, never generated from client presence.
export const ZONE='America/Los_Angeles';
const MIN=60000;
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function localDate(ms){const p=dateFormat.formatToParts(ms);return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');}
export function addDays(date,n){return new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function weekOf(ms){const d=localDate(ms),day=new Date(d+'T12:00:00Z').getUTCDay();return addDays(d,-((day+6)%7));}
// Convert local wall time using Intl offsets; generated transitions are outside DST's 01–03 gap.
export function wallTime(date,minutes){
  const base=Date.parse(date+'T00:00:00Z')+minutes*MIN;
  let at=base;
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){const p=fmt.formatToParts(at),get=k=>p.find(x=>x.type===k).value;const represented=Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`);at+=base-represented;}
  return at;
}
function seeded(seed){let x=2166136261;for(const c of seed)x=Math.imul(x^c.charCodeAt(0),16777619);return ()=>{x+=0x6D2B79F5;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
export function generateWeek(week,seed){
  const random=seeded(seed),pick=(a,b)=>a+Math.floor(random()*(b-a+1));const blocks=[];
  const lateDay=pick(0,4),earlyDay=(lateDay+pick(1,4))%5;
  // Fixed bounds across all weeks guarantee >=8h wall-clock overnight rest (>=7h across spring DST), including week boundaries.
  for(let day=0;day<7;day++){
    const date=addDays(week,day),wake=pick(450,510),bed=pick(1350,1410),off=day>=5||(day===0&&day!==lateDay&&day!==earlyDay&&random()<0.12);let evening=1260;
    const put=(a,b,kind,title,available)=>{if(b>a)blocks.push({start:wallTime(date,a),end:wallTime(date,b),kind,title,available});};
    put(0,wake,'sleep','Asleep · Berkeley',false);
    put(wake,wake+60,'morning','Breakfast and quiet morning · Berkeley',true);
    if(off){
      put(wake+60,720,'personal','Reading or errands · Berkeley',true);
      put(720,780,'meal','Lunch · Berkeley',true);
      put(780,1050,'rest',day===5?'A walk and personal time · Berkeley':'Day off · Quiet time at home',true);
      put(1050,1140,'personal','Personal projects · Berkeley',true);
    }else{
      const end=day===lateDay?pick(1170,1230):day===earlyDay?pick(960,1020):pick(1050,1140);
      put(wake+60,570,'commute','On the way to the lab · Berkeley',false);
      put(570,660,'lab','Laboratory work · Phone away',false);
      put(660,675,'break','Taking a short break · Berkeley',true);
      put(675,735,day===2?'meeting':'research',day===2?'Research meeting · Phone silent':'Focused research · Berkeley',false);
      put(735,795,'meal','Lunch break · Berkeley',true);
      const event=random()<0.15;
      put(795,900,event?'unexpected':'lab',event?'An experiment needs attention · Berkeley':'Laboratory work · Phone away',false);
      put(900,920,'break','Taking a short break · Berkeley',true);
      put(920,end,'research',end>1170?'Working late at the lab · Berkeley':'Research and analysis · Berkeley',false);
      put(end,end+45,'commute','Heading home · Phone away',false);
      evening=Math.max(1260,end+105);
      put(end+45,evening,'rest','Dinner and unwinding · Berkeley',true);
    }
    if(off)put(1140,1260,'rest','Dinner and unwinding · Berkeley',true);
    put(evening,bed,'personal','Quiet evening at home · Berkeley',true);
    put(bed,1440,'sleep','Asleep · Berkeley',false);
  }
  return blocks;
}
export async function storedWeek(env,week){
  const read=()=>env.DB.prepare('SELECT blocks FROM life_weeks WHERE character_id=? AND week_start=?').bind('gura',week).first();
  let row=await read();
  if(!row){const seed=crypto.randomUUID(),blocks=generateWeek(week,seed);
    await env.DB.prepare('INSERT OR IGNORE INTO life_weeks(character_id,week_start,version,blocks,created_at) VALUES (?,?,?,?,?)').bind('gura',week,1,JSON.stringify(blocks),Date.now()).run();
    // Concurrent first readers use the winning persisted schedule.
    row=await read();
  }
  return JSON.parse(row.blocks);
}
export async function currentLife(env,ms=Date.now()){
  const blocks=await storedWeek(env,weekOf(ms));
  const block=blocks.find(b=>b.start<=ms&&ms<b.end);if(!block)throw Error('Life schedule unavailable');return block;
}
export async function nextLifeAvailable(env,ms){
  for(let w=0;w<3;w++){
    const blocks=await storedWeek(env,weekOf(ms));
    const block=blocks.find(b=>b.available&&b.end>ms);if(block)return Math.max(ms,block.start);
    ms=wallTime(addDays(weekOf(ms),7),0);
  }
  throw Error('Life schedule unavailable');
}
export async function lifeDueAt(env,now,random=Math.random){return nextLifeAvailable(env,now+30000+Math.floor(random()*(10800000-30000)));}
export function publicLife(block){return {title:block.title,available:block.available,location:'Berkeley, California',fictional:true};}
