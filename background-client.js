/* Background is opt-in until the reviewed Worker is deployed. No API keys here. */
(() => {
  const URL_KEY='parallel-background-url-v1', CID_KEY='parallel-conversation-id-v1';
  const ARCHIVE_CID='parallel-archive-conversation-id-v1';
  let base=localStorage.getItem(URL_KEY)||'', busy=false, publicKey=null;
  let cid=localStorage.getItem(CID_KEY)||crypto.randomUUID();localStorage.setItem(CID_KEY,cid);
  if(localStorage.getItem(archiveKey)&&!localStorage.getItem(ARCHIVE_CID))localStorage.setItem(ARCHIVE_CID,crypto.randomUUID());
  const panel=document.createElement('div');panel.className='memory-box';
  panel.innerHTML='<h3>Background messages</h3><p class="note">Sync this conversation and notebook to your private Worker so Gura can reply while Parallel is closed.</p><label for="bgUrl">Background Worker address</label><div class="memory-form"><input id="bgUrl" type="url" placeholder="https://parallel-background.chloerayn.workers.dev" aria-label="Background Worker address"><button type="button" id="bgConnect">Connect background service</button></div> <button type="button" class="action" id="bgPush">Enable notifications</button> <button type="button" class="action" id="bgUnpush">Disable notifications</button> <button type="button" class="action" id="bgRetry">Retry failed replies</button><p class="note" id="bgInfo" aria-live="polite"></p>';
  document.querySelector('.os-settings #osSettingsSlot').append(panel);
  document.getElementById('bgUrl').value=base;
  const info=text=>document.getElementById('bgInfo').textContent=text;
  async function api(path,data,method){
    if(!parallelPassword)throw Error('Unlock Parallel first.');
    const res=await fetch(base+path,{method:method||(data?'POST':'GET'),headers:{authorization:'Bearer '+parallelPassword,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
    const result=await res.json();if(!res.ok)throw Error(result.error||'Background connection failed');return result;
  }
  function stamp(list,conversation){
    for(const m of list){m.bgId ||= crypto.randomUUID();m.bgCid ||= conversation;}
  }
  function persist(list,active){
    if(active&&messages===list){save();return;}
    // A chat can move into the archive while an upload is awaiting the network.
    const archived=JSON.parse(localStorage.getItem(archiveKey)||'[]');
    if(!Array.isArray(archived))return;
    for(const item of archived){const updated=list.find(m=>m.bgId===item.bgId);if(updated){item.bgSynced=updated.bgSynced;item.bgQueued=updated.bgQueued;}}
    localStorage.setItem(archiveKey,JSON.stringify(archived));
  }
  function cancelLocal(){if(replyTimer){clearTimeout(replyTimer);replyTimer=null;}localStorage.removeItem('parallel-pending');}
  function prepare(){
    stamp(messages,cid);
    if(localStorage.getItem('parallel-pending')&&messages.at(-1)?.from==='me')messages.at(-1).bgPending=true;
    save();cancelLocal();
  }
  const bridge=window.parallelBackground={
    get enabled(){return !!base;},
    queue(){
      const m=messages.at(-1);stamp(messages,cid);m.bgPending=true;save();$('status').textContent='Sending to server… Keep Parallel open until saved.';void sync();
    },
    newConversation(){stamp(messages,cid);localStorage.setItem(archiveKey,JSON.stringify(messages));localStorage.setItem(ARCHIVE_CID,cid);cid=crypto.randomUUID();localStorage.setItem(CID_KEY,cid);},
    restoreConversation(){const current=cid;cid=localStorage.getItem(ARCHIVE_CID)||crypto.randomUUID();localStorage.setItem(ARCHIVE_CID,current);localStorage.setItem(CID_KEY,cid);},
  };
  async function upload(list,conversation,active){
    stamp(list,conversation);if(!active)localStorage.setItem(archiveKey,JSON.stringify(list));else persist(list,active);
    for(const m of list){
      if(m.bgSynced&&(!m.bgPending||m.bgQueued))continue;
      const queued=m.bgPending&&m.from==='me';
      const data={id:m.bgId,conversationId:m.bgCid,role:m.from==='me'?'user':'model',text:m.text||'',photo:m.photo||null,at:m.at,notes:memoryNotes};
      // Imported history is retained locally and uploaded without scheduling old replies.
      await api(queued?'/api/messages':'/api/history',data);
      m.bgSynced=true;if(queued)m.bgQueued=true;persist(list,active);
    }
  }
  async function sync(){
    if(!base||!parallelPassword||busy)return;busy=true;
    try{
      const active=messages, conversation=cid;
      await upload(active,conversation,true);
      const archived=JSON.parse(localStorage.getItem(archiveKey)||'[]');
      if(Array.isArray(archived)&&archived.length)await upload(archived,localStorage.getItem(ARCHIVE_CID)||'previous',false);
      let after=0,jobs=[],received=false;
      do{
        const result=await api('/api/messages?conversationId='+encodeURIComponent(conversation)+'&after='+after);
        jobs=result.jobs;
        for(const m of result.messages){
          after=Math.max(after,m.seq);
          if(!active.some(x=>x.bgId===m.id)){if(m.role==='model')received=true;active.push({from:m.role==='user'?'me':'them',text:m.text,photo:m.photo||undefined,at:m.created_at,bgId:m.id,bgCid:conversation,bgSynced:true});}
        }
        if(result.messages.length<100)break;
      }while(true);
      active.sort((a,b)=>a.at-b.at);
      if(messages===active){if(received)retroSound.play('incoming');render();$('status').textContent=active.some(m=>m.bgPending&&!m.bgQueued)?'Not yet saved on server · Retrying':jobs.some(j=>j.state==='failed')?'Reply failed. Use Retry failed replies in Settings.':jobs.length?'Saved on server · Reply scheduled':'';}
      info('Connected. Messages saved on server. Use Enable notifications to subscribe this device.');
    }catch(err){info(err.message+' Your local messages are kept; unsent messages retry when online.');if(messages.some(m=>m.bgPending&&!m.bgQueued))$('status').textContent='Not yet saved on server · Retrying when online';}
    finally{busy=false;}
  }
  $('bgConnect').addEventListener('click',async()=>{
    if(!parallelPassword){info('Unlock Parallel first.');return;}
    const entered=$('bgUrl').value.trim();
    if(aiRequestRunning){info('Wait for the current AI reply before connecting.');return;}
    const previous=base;
    try{
      const url=new URL(entered);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use an HTTPS Worker address.');
      base=url.origin;const status=await api('/api/status');publicKey=status.publicKey;
      localStorage.setItem(URL_KEY,base);prepare();await sync();
    }catch(err){base=previous;info(err.message);}
  });
  $('bgPush').addEventListener('click',async()=>{
    try{
      if(!base||!parallelPassword)throw Error('Connect and unlock the background service first.');
      if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw Error('On iPhone, add Parallel to your Home Screen, then open it from that icon (iOS 16.4 or later).');
      // Request immediately in this user gesture, before network calls (iOS requirement).
      const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications are blocked. Allow Parallel in iPhone notification settings.');
      const status=await api('/api/status');publicKey=status.publicKey;if(!publicKey)throw Error('Configure the Worker VAPID keys first.');
      const registration=await navigator.serviceWorker.ready;
      const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await api('/api/push',subscription.toJSON());info('Notifications enabled on this device.');
    }catch(err){info(err.message);}
  });
  $('bgUnpush').addEventListener('click',async()=>{
    try{const registration=await navigator.serviceWorker.ready,sub=await registration.pushManager.getSubscription();
      if(sub){await api('/api/push',{endpoint:sub.endpoint},'DELETE');await sub.unsubscribe();}info('Notifications disabled on this device.');
    }catch(err){info(err.message);}
  });
  $('bgRetry').addEventListener('click',async()=>{
    try{const result=await api('/api/messages?conversationId='+encodeURIComponent(cid));
      for(const j of result.jobs.filter(j=>j.state==='failed'))await api('/api/jobs/retry',{id:j.id});await sync();
    }catch(err){info(err.message);}
  });
  async function refreshSubscription(){
    if(!base||!parallelPassword||!('serviceWorker' in navigator))return;
    try{const sub=await (await navigator.serviceWorker.ready).pushManager.getSubscription();if(sub)await api('/api/push',sub.toJSON());}catch{}
  }
  if(base){prepare();info('Background service configured. Unlock to sync.');}
  // Login can finish after this script loads; no new secrets are persisted.
  let hadPassword=false;
  setInterval(()=>{if(parallelPassword&&!hadPassword){hadPassword=true;void refreshSubscription();}void sync();},30000);
  unlockForm.addEventListener('submit',()=>setTimeout(()=>{void sync();void refreshSubscription();},1500));
  window.addEventListener('online',()=>void sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){void sync();void refreshSubscription();}});
  navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='parallel-reply')void sync();});
  // Clicking a notification opens the right stored conversation without erasing the current one.
  const target=new URL(location.href).searchParams.get('conversation');
  if(base&&target&&target!==cid){
    const old=JSON.parse(localStorage.getItem(archiveKey)||'[]');
    if(localStorage.getItem(ARCHIVE_CID)===target&&Array.isArray(old)){
      localStorage.setItem(archiveKey,JSON.stringify(messages));bridge.restoreConversation();messages=old;render();
    }else info('A reply arrived in another conversation. Use Restore previous to open your saved chat.');
  }
  void sync();
})();
