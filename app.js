// =====================
// VERTALINGEN
// =====================
const { UI, SPEECH_LANGS, WHISPER_LANGS } = window.KashfI18n;
const { filterTranscript, buildTranslationPayload, insertPassageInOrder, isCurrentSession, MERGE_CONFIG, decidePendingTranscript } = window.KashfPipeline;
const { KhutbahBuffer, evaluateShortTranscript } = window.KashfKhutbahBuffer;
const { ReadingPacer } = window.KashfReadingPacer;

const preferences={interfaceLanguage:'nl',sourceLanguage:'ar',targetLanguage:'nl'};
const session={mode:'khutbah',paused:false,ended:false,id:null,lastTranscript:'',translationAbortController:null,pendingTranscript:null,pendingTimer:null};
let outLang=preferences.targetLanguage, srcLang=preferences.sourceLanguage, paused=session.paused;
let processingEl=null, lastTranslation='', allTranslations=[];
let wakeLock=null, doNotDisturbShown=false, reminderIndex=0, reminderInterval=null;
const audioController=new window.KashfAudioController({speechLanguages:SPEECH_LANGS});
let khutbahBuffer=null;
let readingPacer=null;
let readingRenderToken=0;

function generateSessionId(){
  return (window.crypto&&window.crypto.randomUUID)?window.crypto.randomUUID():'session-'+Date.now()+'-'+Math.random().toString(36).slice(2);
}
function abortTranslation(){
  if(session.translationAbortController)session.translationAbortController.abort();
  session.translationAbortController=null;
}
function isDevelopmentHost(){return location.hostname==='localhost'||location.hostname==='127.0.0.1'||location.hostname.endsWith('.vercel.app');}
function logLifecycle(event,metadata){window.KashfLifecycle.log(event,metadata);}
function logTranscriptRejection(reason){if(isDevelopmentHost())console.info('[Kashf transcript] rejected',{reason:reason});}
function clearPendingTranscript(){clearTimeout(session.pendingTimer);session.pendingTimer=null;session.pendingTranscript=null;}
function isKhutbahMode(){return session.mode==='khutbah';}
const UNSAFE_TRANSLATION_PATTERNS=[
  /\bi (?:cannot|can't|am unable to) (?:provide )?(?:a )?(?:reliable )?translat(?:e|ion)\b/i,
  /\b(?:the|this|new) passage (?:appears|seems) to be\b/i,
  /\bpossible transcription error\b/i,
  /\bplease (?:verify|check) (?:the )?(?:audio|transcript|source|input)\b/i,
  /\b(?:as an ai|i notice that|linguistic analysis|source input)\b/i
];
function isValidTranslationText(value){
  if(typeof value!=='string')return false;
  var text=value.replace(/\s+/g,' ').trim();
  return !!text&&text!=='NO_TRANSLATION'&&!UNSAFE_TRANSLATION_PATTERNS.some(function(pattern){return pattern.test(text);});
}
function validSessionTranslations(){return allTranslations.filter(function(passage){return passage&&isValidTranslationText(passage.translation);});}
function selectMode(mode,button){
  session.mode=mode==='lecture'?'lecture':'khutbah';
  document.querySelectorAll('[data-mode]').forEach(function(option){
    option.classList.toggle('active',option===button);
    option.setAttribute('aria-pressed',option===button?'true':'false');
  });
}
function selectAndStartMode(mode,button){selectMode(mode,button);showStartTip();}
function createKhutbahBuffer(){
  return new KhutbahBuffer({onFlush:translateKhutbahUnit,onLifecycle:logLifecycle});
}
function createReadingPacer(){
  return new ReadingPacer({
    onShow:renderCurrentReadingPassage,
    onState:logReadingState,
    onLifecycle:logLifecycle
  });
}

function u(k){return(UI[outLang]||UI.nl)[k]||k;}

// =====================
// SPLASH
// =====================
function dismissSplashNormally(){
  var s=document.getElementById('splash');
  var a=document.getElementById('splash-arabic');
  if(!s||!a)return;
  setTimeout(function(){a.style.opacity='1';},400);
  setTimeout(function(){s.style.opacity='0';},2200);
  setTimeout(function(){
    s.style.display='none';
    s.style.pointerEvents='none';
    s.dataset.dismissed='true';
    clearTimeout(window.__kashfSplashFailsafe);
  },3100);
}
if(document.readyState==='complete')dismissSplashNormally();
else window.addEventListener('load',dismissSplashNormally,{once:true});

// =====================
// SESSIE TELLER
// =====================
var sessionCount=parseInt(localStorage.getItem('kashf_sessions')||'0');
function updateCounter(){
  var el=document.getElementById('session-counter');
  var txt=document.getElementById('counter-txt');
  if(sessionCount>0){
    el.style.display='inline-flex';
    txt.textContent=sessionCount+' '+u('sessions');
  }
}
updateCounter();

// =====================
// HERINNERING (wisselt af)
// =====================
function startReminders(){
  var el=document.getElementById('reminder-el');
  if(!el) return;
  var count=5;
  el.textContent=u('reminder1');
  el.style.opacity='1';
  reminderInterval=setInterval(function(){
    el.style.opacity='0';
    setTimeout(function(){
      reminderIndex=(reminderIndex+1)%count;
      var key='reminder'+(reminderIndex+1);
      el.textContent=u(key)||u('reminder1');
      el.style.opacity='1';
    },800);
  },7000);
}
startReminders();

// =====================
// TAAL
// =====================
function toggleDrop(){document.getElementById('lang-drop').classList.toggle('open');}
document.addEventListener('click',function(e){
  if(!e.target.closest('.lang-sel'))document.getElementById('lang-drop').classList.remove('open');
  if(!e.target.closest('.src-other'))document.getElementById('src-drop').classList.remove('open');
});

function setLang(lang,flag,code,el){
  setInterfaceLanguage(lang);
  setTargetLanguage(lang);
  document.getElementById('cur-flag').innerHTML=flag;
  document.getElementById('cur-code').textContent=code;
  document.querySelectorAll('.lang-opt').forEach(function(b){b.classList.remove('active');});
  el.classList.add('active');
  document.getElementById('lang-drop').classList.remove('open');
  updateUI();
}

function setInterfaceLanguage(lang){preferences.interfaceLanguage=lang;}
function setTargetLanguage(lang){preferences.targetLanguage=lang;outLang=lang;}

function updateUI(){
  document.getElementById('h-title').textContent=u('title');
  document.getElementById('h-sub').textContent=u('sub');
  document.getElementById('src-lbl').textContent=u('srcLbl');
  document.getElementById('btn-other').innerHTML=u('otherLang')+' &#9662;';
  document.getElementById('pause-btn').textContent=paused?u('resume'):u('pause');
  document.getElementById('heard-txt').textContent=u('heard');
  document.getElementById('disclaimer-txt').textContent=u('disclaimer');
  document.getElementById('empty-txt')&&(document.getElementById('empty-txt').textContent=u('emptyTxt'));
  document.getElementById('empty-sub')&&(document.getElementById('empty-sub').textContent=u('emptySub'));
  document.getElementById('confirm-text').textContent=u('confirmStop');
  document.getElementById('confirm-no').textContent=u('confirmNo');
  document.getElementById('confirm-yes').textContent=u('confirmYes');
  document.getElementById('thanks-title').textContent=u('thanks');
  document.getElementById('thanks-sub').textContent=u('thanksSub');
  document.getElementById('thanks-close').textContent=u('thanksClose');
  updateCounter();
  var el=document.getElementById('reminder-el');
  if(el){var key='reminder'+(reminderIndex+1);el.textContent=u(key)||u('reminder1');}
}

// =====================
// PREEKTAAL
// =====================
function selectArabic(btn){
  srcLang='ar';
  preferences.sourceLanguage=srcLang;
  document.getElementById('btn-ar').classList.add('active');
  document.getElementById('btn-other').classList.remove('active');
  document.querySelectorAll('.src-opt').forEach(function(b){b.classList.remove('active');});
  document.getElementById('btn-other').innerHTML=u('otherLang')+' &#9662;';
}
function toggleSrcDrop(){document.getElementById('src-drop').classList.toggle('open');}
function setSrcOther(lang,label,el){
  srcLang=lang;
  preferences.sourceLanguage=srcLang;
  document.getElementById('btn-ar').classList.remove('active');
  document.getElementById('btn-other').classList.add('active');
  document.getElementById('btn-other').innerHTML=label+' &#9662;';
  document.querySelectorAll('.src-opt').forEach(function(b){b.classList.remove('active');});
  el.classList.add('active');
  document.getElementById('src-drop').classList.remove('open');
}

// =====================
// WAKE LOCK
// =====================
async function requestWakeLock(){
  try{if('wakeLock' in navigator){wakeLock=await navigator.wakeLock.request('screen');}}catch(e){}
}
function releaseWakeLock(){if(wakeLock){try{wakeLock.release();}catch(_){}wakeLock=null;}}
document.addEventListener('visibilitychange',async function(){
  if(document.visibilityState==='visible'&&audioController.isActive&&!paused) await requestWakeLock();
});

// =====================
// SCHERMORIËNTATIE
// =====================
function lockOrientation(){
  try{
    if(screen.orientation&&screen.orientation.lock) screen.orientation.lock('portrait').catch(function(){});
  }catch(e){}
}

// =====================
// SESSIE
// =====================
function startSession(){
  document.querySelector('.app').classList.add('session-active');
  document.querySelector('.app').classList.remove('session-ended');
  document.querySelector('meta[name="theme-color"]').setAttribute('content','#123F35');
  document.getElementById('home').classList.add('hidden');
  document.getElementById('live').classList.remove('hidden');
  document.getElementById('trans-feed').innerHTML='';
  addEmptyState();
  session.id=generateSessionId();session.lastTranscript='';session.paused=false;session.ended=false;clearPendingTranscript();
  khutbahBuffer=isKhutbahMode()?createKhutbahBuffer():null;
  readingPacer=isKhutbahMode()?createReadingPacer():null;
  lastTranslation='';allTranslations=[];paused=false;
  history.pushState({page:'live'},'','#live');
  lockOrientation();
  requestWakeLock();
  showDoNotDisturb();
  setKhutbahScrollLock(isKhutbahMode());
  startAudio();
}

function addEmptyState(){
  var es=document.createElement('div');
  es.className='empty-state';es.id='empty-state';
  es.innerHTML='<p id="empty-txt">'+u('emptyTxt')+'</p><p id="empty-sub">'+u('emptySub')+'</p>';
  document.getElementById('trans-feed').appendChild(es);
}

function askConfirmStop(){
  if(session.ended){goBack();return;}
  document.getElementById('confirm-modal').style.display='flex';
}
function closeConfirm(){
  document.getElementById('confirm-modal').style.display='none';
}
async function confirmStop(){
  document.getElementById('confirm-modal').style.display='none';
  audioController.stop();
  if(khutbahBuffer)await khutbahBuffer.flush('STOP_FLUSH');
  if(readingPacer)readingPacer.stop();
  clearPendingTranscript();
  session.ended=true;
  document.querySelector('.app').classList.remove('session-active');
  document.querySelector('.app').classList.add('session-ended');
  document.querySelector('meta[name="theme-color"]').setAttribute('content','#F8F5EE');
  releaseWakeLock();
  setKhutbahScrollLock(false);
  renderFeed();
  // Teller verhogen
  sessionCount++;
  localStorage.setItem('kashf_sessions',sessionCount);
  showThanks();
}
function showThanks(){
  document.getElementById('thanks-modal').style.display='flex';
}
function closeThanks(){
  document.getElementById('thanks-modal').style.display='none';
  if(!session.ended)goBack();
}

function goBack(){
  paused=false;session.paused=false;
  audioController.stop();
  abortTranslation();
  clearPendingTranscript();
  if(khutbahBuffer)khutbahBuffer.stop();
  khutbahBuffer=null;
  if(readingPacer)readingPacer.stop();
  readingPacer=null;
  session.id=null;
  releaseWakeLock();
  setKhutbahScrollLock(false);
  doNotDisturbShown=false;
  document.querySelector('.app').classList.remove('session-active','session-ended');
  document.querySelector('meta[name="theme-color"]').setAttribute('content','#F8F5EE');
  document.getElementById('live').classList.add('hidden');
  document.getElementById('home').classList.remove('hidden');
  history.replaceState({page:'home'},'','');
  updateCounter();
}

window.addEventListener('popstate',function(){
  if(!document.getElementById('live').classList.contains('hidden')) askConfirmStop();
});

function keepKhutbahAtLive(){
  if(!isKhutbahMode()||session.ended)return;
  var feed=document.getElementById('trans-feed');
  feed.scrollTop=feed.scrollHeight;
}
function blockKhutbahScroll(event){
  if(isKhutbahMode()&&!session.ended){event.preventDefault();keepKhutbahAtLive();}
}
function setKhutbahScrollLock(enabled){
  var feed=document.getElementById('trans-feed');
  feed.classList.toggle('khutbah-scroll-locked',enabled);
  feed.removeEventListener('wheel',blockKhutbahScroll);
  feed.removeEventListener('touchmove',blockKhutbahScroll);
  if(enabled){
    feed.addEventListener('wheel',blockKhutbahScroll,{passive:false});
    feed.addEventListener('touchmove',blockKhutbahScroll,{passive:false});
    keepKhutbahAtLive();
  }
  document.getElementById('download-btn').style.display=enabled?'none':'';
}

async function togglePause(){
  if(!paused){
    paused=true;session.paused=true;
    audioController.pause();
    flushPendingTranscript();
    if(khutbahBuffer)await khutbahBuffer.pause();
    if(readingPacer)readingPacer.pause();
    releaseWakeLock();
    setStatus('paused',u('paused'));
    document.getElementById('pause-btn').textContent=u('resume');
  }else{
    paused=false;session.paused=false;
    document.getElementById('pause-btn').textContent=u('pause');
    requestWakeLock();
    if(readingPacer)readingPacer.resume();
    startAudio();
  }
}

// =====================
// NIET STOREN
// =====================
function showDoNotDisturb(){
  if(doNotDisturbShown) return;
  doNotDisturbShown=true;
  var t=document.getElementById('err-toast');
  t.style.background='#FFF9EE';t.style.color='#8A6A00';t.style.borderColor='#F0D070';
  t.style.display='block';t.textContent=u('doNotDisturb');
  setTimeout(function(){t.style.display='none';t.style.background='';t.style.color='';t.style.borderColor='';},5000);
}

// =====================
// VERTALEN
// =====================
function startAudio(){
  var activeSessionId=session.id;
  var sequenceStart=allTranslations.length?allTranslations[allTranslations.length-1].sequenceNumber+1:0;
  audioController.start({sessionId:activeSessionId,sourceLanguage:srcLang,sequenceStart:sequenceStart},{
    onStatus:function(status){
      if(status==='processing'){setStatus('processing',u('processing'));showProcessing();}
      else{setStatus('listening',u('listening'));hideProcessing();}
    },
    onInterim:function(text){document.getElementById('heard-txt').textContent=text;},
    onTranscript:async function(text,metadata){
      if(!isCurrentSession(session.id,metadata.sessionId))return;
      document.getElementById('heard-txt').textContent=text;
      var filtered=filterTranscript(text,session.lastTranscript);
      if(!filtered.accepted){logTranscriptRejection(filtered.code);return;}
      var shortDecision=evaluateShortTranscript(filtered.text,metadata);
      if(!shortDecision.accepted){logLifecycle('WHISPER_REJECT',{...metadata,rejectReason:shortDecision.reason});logTranscriptRejection(shortDecision.reason);return;}
      session.lastTranscript=filtered.text;
      if(isKhutbahMode())await khutbahBuffer.add({text:filtered.text,...metadata});
      else await queueTranscriptForTranslation(filtered.text,metadata);
    },
    onRejected:function(reason){logTranscriptRejection(reason);},
    onError:function(code){
      hideProcessing();
      var messages={
        MIC_PERMISSION_DENIED:'Geef Kashf microfoontoegang om live te vertalen.',
        NETWORK_ERROR:u('connErr'),
        TRANSCRIPTION_ERROR:'De spraak kon niet betrouwbaar worden verwerkt.'
      };
      showErr(messages[code]||u('connErr'));
    }
  });
}

async function translateKhutbahUnit(unit){
  if(!isCurrentSession(session.id,unit.sessionId))return;
  await translatePassage(unit.transcript,{
    sessionId:unit.sessionId,
    sequenceNumber:unit.sequenceNumber,
    timestamp:unit.timestamp,
    startedAt:unit.startedAt,
    endedAt:unit.endedAt,
    transcriptChunks:unit.transcriptChunks,
    mergedChunkCount:unit.mergedChunkCount,
    bufferDurationMs:unit.bufferDurationMs,
    liveLatencyMs:unit.liveLatencyMs,
    transcriptLatencyMs:unit.transcriptLatencyMs,
    flushReason:unit.flushReason
  });
}

async function queueTranscriptForTranslation(text,metadata){
  var pending=session.pendingTranscript;
  var decision=decidePendingTranscript(pending&&pending.text,text);
  clearTimeout(session.pendingTimer);
  if(decision.hold){
    session.pendingTranscript={text:decision.text,metadata:pending?pending.metadata:metadata};
    session.pendingTimer=setTimeout(flushPendingTranscript,MERGE_CONFIG.maximumWaitMs);
    return;
  }
  session.pendingTranscript=null;session.pendingTimer=null;
  session.lastTranscript=decision.text;
  await translatePassage(decision.text,pending?pending.metadata:metadata);
}

async function flushPendingTranscript(){
  var pending=session.pendingTranscript;
  clearPendingTranscript();
  if(!pending||!isCurrentSession(session.id,pending.metadata.sessionId))return;
  session.lastTranscript=pending.text;
  await translatePassage(pending.text,pending.metadata);
}

async function translatePassage(text,metadata){
  if(!isCurrentSession(session.id,metadata.sessionId))return;
  showProcessing();
  setStatus('processing',u('processing'));
  var controller=new AbortController();
  var translationStartedAt=Date.now();
  logLifecycle('TRANSLATION_START',{sessionId:metadata.sessionId,sequenceNumber:metadata.sequenceNumber,timestamp:translationStartedAt,flushReason:metadata.flushReason||'DIRECT_MODE'});
  session.translationAbortController=controller;
  try{
    var payload=buildTranslationPayload({transcript:text,sourceLanguage:srcLang,targetLanguage:outLang,passages:validSessionTranslations()});
    var res=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify(payload)});
    var data=await res.json().catch(function(){return {};});
    if(!isCurrentSession(session.id,metadata.sessionId))return;
    if(!res.ok){
      var code=data.error&&data.error.code;
      throw new Error(code||'TRANSLATION_ERROR');
    }
    var tx=data.translation&&data.translation.trim();
    var translationCompletedAt=Date.now();
    logLifecycle('TRANSLATION_DONE',{sessionId:metadata.sessionId,sequenceNumber:metadata.sequenceNumber,timestamp:translationCompletedAt,translationLagMs:translationCompletedAt-(metadata.startedAt||translationStartedAt),flushReason:metadata.flushReason||'DIRECT_MODE'});
    hideProcessing();
    if(isValidTranslationText(tx)){
      lastTranslation=tx;
      addPassage({
        sessionId:metadata.sessionId,
        sequenceNumber:metadata.sequenceNumber,
        timestamp:metadata.timestamp,
        originalTranscript:text,
        translation:tx,
        sourceLanguage:srcLang,
        targetLanguage:outLang
        ,audioStartedAt:metadata.startedAt||null
        ,audioEndedAt:metadata.endedAt||null
        ,transcriptChunks:metadata.transcriptChunks||[{sequenceNumber:metadata.sequenceNumber,text:text}]
        ,mergedChunkCount:metadata.mergedChunkCount||1
        ,bufferDurationMs:metadata.bufferDurationMs||0
        ,transcriptLatencyMs:metadata.transcriptLatencyMs||null
        ,translationLatencyMs:translationCompletedAt-translationStartedAt
        ,liveLatencyMs:Date.now()-(metadata.startedAt||Date.now())
        ,flushReason:metadata.flushReason||'DIRECT_MODE'
      });
      logTranslationUnit(allTranslations[allTranslations.length-1]);
    }
  }catch(e){
    if(e.name==='AbortError')return;
    hideProcessing();
    showErr(e.message==='NETWORK_ERROR'?u('connErr'):u('overload'));
  }
  if(session.translationAbortController===controller)session.translationAbortController=null;
  if(!paused) setStatus('listening',u('listening'));
}

function logTranslationUnit(passage){
  if(!isDevelopmentHost()||!passage)return;
  console.info('[Kashf unit]',{
    transcriptChunks:passage.transcriptChunks,
    mergedChunkCount:passage.mergedChunkCount,
    originalTranscript:passage.originalTranscript,
    translation:passage.translation,
    audioStartedAt:passage.audioStartedAt,
    audioEndedAt:passage.audioEndedAt,
    bufferDurationMs:passage.bufferDurationMs,
    transcriptLatencyMs:passage.transcriptLatencyMs,
    translationLatencyMs:passage.translationLatencyMs,
    liveLatencyMs:passage.liveLatencyMs,
    flushReason:passage.flushReason,
    rejectReason:null
  });
}

// =====================
// FEED
// =====================
function addPassage(passage){
  if(!isCurrentSession(session.id,passage.sessionId)||!isValidTranslationText(passage.translation))return;
  allTranslations=insertPassageInOrder(allTranslations,passage);
  if(isKhutbahMode()&&!session.ended&&readingPacer)readingPacer.enqueueUnit(passage);
  else renderFeed();
}

function renderCurrentReadingPassage(readingPassage){
  if(!isKhutbahMode()||session.ended)return;
  var feed=document.getElementById('trans-feed');
  var token=++readingRenderToken;
  var previous=feed.querySelector('.reading-current');
  if(previous)previous.classList.add('reading-leaving');
  setTimeout(function(){
    if(token!==readingRenderToken)return;
    feed.innerHTML='';
    var entry=document.createElement('div');
    entry.className='trans-entry trans-new reading-current reading-entering';
    entry.dataset.readingPassageId=readingPassage.id;
    entry.innerHTML='<p class="trans-text">'+esc(readingPassage.translation)+'</p><div class="reader-divider" aria-hidden="true"><span></span><img src="assets/sakura-divider-transparent.png" alt=""><span></span></div>';
    feed.appendChild(entry);
    feed.scrollTop=0;
    requestAnimationFrame(function(){entry.classList.remove('reading-entering');});
  },previous?850:0);
}

function logReadingState(state){
  if(!isDevelopmentHost())return;
  console.info('[Kashf reading pacer]',{
    queueLength:state.queueLength,
    translationLagMs:state.translationLagMs,
    readingLagMs:state.readingLagMs,
    totalUserLagMs:state.totalUserLagMs,
    currentPassageId:state.current&&state.current.id,
    paused:state.paused
  });
}

function renderFeed(){
  var feed=document.getElementById('trans-feed');
  var empty=document.getElementById('empty-state');
  if(empty) empty.remove();
  feed.querySelectorAll('.trans-entry').forEach(function(entry){entry.remove();});
  var validTranslations=validSessionTranslations();
  allTranslations=validTranslations;
  validTranslations.forEach(function(passage,index){
    var entry=document.createElement('div');
    entry.className='trans-entry '+(index===allTranslations.length-1?'trans-new':'trans-old');
    var date=new Date(passage.timestamp);
    var ts=date.getHours()+':'+String(date.getMinutes()).padStart(2,'0');
    entry.innerHTML='<p class="trans-text">'+esc(passage.translation)+'</p><div class="trans-ts">'+ts+'</div>';
    feed.appendChild(entry);
  });
  keepKhutbahAtLive();
}

function feedback(btn,type,id){
  var btns=btn.parentElement.querySelectorAll('.fb-btn');
  btns.forEach(function(b){b.classList.remove('liked','disliked');});
  if(type==='up') btn.classList.add('liked');
  else btn.classList.add('disliked');
}

function showProcessing(){
  var feed=document.getElementById('trans-feed');
  hideProcessing();
  processingEl=document.createElement('div');
  processingEl.className='processing-entry';processingEl.id='processing-entry';
  processingEl.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
  feed.insertBefore(processingEl,feed.firstChild);
}
function hideProcessing(){var el=document.getElementById('processing-entry');if(el)el.remove();processingEl=null;}
function setStatus(type,txt){document.getElementById('ldot').className='ldot '+type;document.getElementById('status-txt').textContent=txt;}
function showErr(msg){
  var t=document.getElementById('err-toast');
  t.style.background='';t.style.color='';t.style.borderColor='';
  t.style.display='block';t.textContent=msg;
  t.style.background='#FEF2F2';t.style.color='#C0392B';t.style.borderColor='#FECACA';
  setTimeout(function(){t.style.display='none';},5000);
}

// =====================
// PDF DOWNLOAD
// =====================
function downloadPDF(){
  var entries=validSessionTranslations();
  if(entries.length===0){showErr('Nog geen vertalingen.');return;}
  var now=new Date();
  var locale={nl:'nl-NL',en:'en-GB',fr:'fr-FR',de:'de-DE',es:'es-ES',ar_out:'ar-SA'}[outLang]||'nl-NL';
  var dateStr=now.toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  var srcLabel={ar:'Arabisch',tr:'Turks',ber:'Berber',ur:'Urdu',id:'Indonesisch',ms:'Maleis',so:'Somalisch',sw:'Swahili'}[srcLang]||srcLang;
  var langCode=document.getElementById('cur-code').textContent;

  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@400;500&display=swap" rel="stylesheet"><style>';
  html+='*{box-sizing:border-box;margin:0;padding:0}';
  html+='body{font-family:"Playfair Display",Georgia,serif;background:#FDFCFA;color:#2A2018;max-width:680px;margin:0 auto}';
  html+='.strip{background:#FDFCFA;padding:10px 48px;border-bottom:1px solid #F0E8D0;display:flex;justify-content:space-between}';
  html+='.strip span{font-family:"Inter",Arial,sans-serif;font-size:0.58rem;color:#C9A84C;letter-spacing:0.16em;text-transform:uppercase}';
  html+='.strip span:last-child{color:#D4C4A0}';
  html+='.header{padding:36px 48px 24px;border-bottom:1.5px solid #E8D5A3;text-align:center}';
  html+='.logo{font-size:2.6rem;font-weight:700;color:#B8964A;letter-spacing:0.04em;line-height:1}';
  html+='.subtitle{font-family:"Inter",Arial,sans-serif;font-size:0.6rem;color:#C8B890;letter-spacing:0.2em;text-transform:uppercase;margin-top:6px}';
  html+='.entries{padding:0 48px 40px}';
  html+='.entry{padding:20px 0;border-bottom:1px solid #F0E8D8}';
  html+='.entry:last-child{border-bottom:none}';
  html+='.trans{font-size:1.08rem;line-height:1.88;color:#2A2018}';
  html+='.ts{font-family:"Inter",Arial,sans-serif;font-size:0.58rem;color:#C8B890;margin-top:5px;letter-spacing:0.06em}';
  html+='.footer{border-top:1px solid #F0E8D0;padding:16px 48px;display:flex;justify-content:space-between}';
  html+='.footer span{font-family:"Inter",Arial,sans-serif;font-size:0.58rem;color:#C8B890;letter-spacing:0.12em;text-transform:uppercase}';
  html+='.thanks{text-align:center;padding:28px 48px;font-family:"Inter",Arial,sans-serif;font-size:0.78rem;color:#C8B890;font-style:italic}';
  html+='</style></head><body>';
  html+='<div class="strip"><span>'+dateStr.charAt(0).toUpperCase()+dateStr.slice(1)+'</span><span>'+srcLabel+' &rarr; '+langCode+'</span></div>';
  html+='<div class="header"><div class="logo">&#x643;&#x634;&#x641;</div><div class="subtitle">Kashf &middot; Live Vertaling</div></div>';
  html+='<div class="entries">';
  entries.forEach(function(e){
    var date=new Date(e.timestamp);
    var ts=date.getHours()+':'+String(date.getMinutes()).padStart(2,'0');
    html+='<div class="entry"><p class="trans">'+e.translation.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</p><p class="ts">'+ts+'</p></div>';
  });
  html+='</div>';
  html+='<div class="thanks">JazakAllah khayran &mdash; Allahu a\'lam</div>';
  html+='<div style="text-align:center;padding:28px 48px 20px;border-top:1px solid #F0E8D0">';html+='<p style="font-family:Georgia,serif;font-size:1.05rem;color:#B8964A;direction:rtl;line-height:2;margin-bottom:10px">\u0641\u064E\u062A\u064E\u0639\u064E\u0627\u0644\u0649 \u0627\u0644\u0644\u0651\u0647\u064F \u0627\u0644\u0652\u0645\u064E\u0644\u0650\u0643\u064F \u0627\u0644\u0652\u062D\u064E\u0642\u0651\u064F \u0648\u064E\u0642\u064F\u0644 \u0631\u064E\u0651\u0628\u0650 \u0632\u0650\u062F\u0652\u0646\u0650\u064A \u0639\u0650\u0644\u0652\u0645\u064B\u0627</p>';html+='<p style="font-family:Georgia,serif;font-size:0.8rem;color:#B8A070;font-style:italic;line-height:1.7;margin-bottom:16px">Moge Allah jouw kennis en begrip vermeerderen. Ta-Ha 20:114</p>';html+='<p style="font-family:Arial,sans-serif;font-size:0.65rem;color:#C8B890;letter-spacing:0.12em;text-transform:uppercase">JazakAllah khayran kashf.nl</p>';html+='</div>';
  html+='</body></html>';

  var blob=new Blob([html],{type:'text/html'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download='kashf-'+now.toISOString().slice(0,10)+'.html';a.click();
  URL.revokeObjectURL(url);
  var t=document.getElementById('err-toast');
  t.style.background='#F0FFF4';t.style.color='#276749';t.style.borderColor='#C6F6D5';
  t.style.display='block';t.textContent='\u2713 Opgeslagen! Open in browser \u2192 Afdrukken \u2192 PDF';
  setTimeout(function(){t.style.display='none';t.style.background='';t.style.color='';t.style.borderColor='';},4000);
}
function showStartTip(){
  if(!isKhutbahMode()){startSession();return;}
  var m=document.getElementById('start-tip-modal');
  m.style.display='flex';
  m.style.pointerEvents='auto';
}

function closeStartTip(){
  var m=document.getElementById('start-tip-modal');
  m.style.display='none';
  m.style.pointerEvents='none';
  startSession();
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
