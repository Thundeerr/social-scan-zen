import { randomBytes } from "node:crypto";

// Standalone page: no analytics or login redirects that could capture Telegram launch data.
export function telegramReviewPage() {
  const nonce = randomBytes(18).toString("base64");
  const html = String.raw`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Content Approver</title>
<style nonce="__NONCE__">
:root{color-scheme:dark;--bg:var(--tg-theme-bg-color,#11151d);--fg:var(--tg-theme-text-color,#f1f4f8);--button:var(--tg-theme-button-color,#7678ed)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui,sans-serif}main{max-width:600px;margin:auto;padding:22px 18px 48px}h1{font-size:24px;margin:0 0 6px}h2{font-size:20px}p{line-height:1.5}small,.muted{opacity:.7}section{border:1px solid #8885;border-radius:16px;padding:16px;margin:16px 0}button,select,textarea{font:inherit;border-radius:10px;padding:12px;color:var(--fg);background:var(--bg);border:1px solid #8887}button{cursor:pointer;min-height:46px}button.primary{background:var(--button);color:var(--tg-theme-button-text-color,white);border-color:transparent}button:disabled{opacity:.4;cursor:default}textarea{display:block;width:100%;resize:vertical;line-height:1.5;margin:8px 0}label{display:block;margin-top:14px}video{width:100%;max-height:48vh;border-radius:12px;background:#000}a{color:var(--tg-theme-link-color,#a8b4ff)}.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.card{display:block;text-align:left;width:100%;margin:10px 0}#notice{white-space:pre-wrap}#confirmation{border-color:var(--button)}[hidden]{display:none!important}#captionPreview{white-space:pre-wrap;overflow-wrap:anywhere}input[type=checkbox]{width:20px;height:20px;vertical-align:middle}select{max-width:100%}
</style><script nonce="__NONCE__" src="https://telegram.org/js/telegram-web-app.js"></script></head><body><main>
<h1>Content Approver</h1><p class="muted">Kiikii 🦇 · Tuuva ❄️</p><p id="notice" role="status">Telegram-Verbindung wird geprüft …</p>
<div id="app" hidden><div class="row"><button id="all">Alle Reels</button><button id="reload">Aktualisieren</button></div><div id="list"></div>
<div id="detail" hidden><h2 id="title"></h2><p id="state"></p><video id="video" controls playsinline preload="metadata"></video>
<section><h2>Caption & Hashtags</h2><label for="caption">Kompletter Post-Text inklusive Hashtags</label><textarea id="caption" rows="8" maxlength="2200"></textarea><small id="count"></small><div class="row"><button id="save" class="primary">Änderungen speichern</button></div><p class="muted">Nach einer Änderung ist eine neue Freigabe nötig.</p></section>
<section id="decisions"><h2>Reel prüfen</h2><label for="note">Änderungswunsch (optional)</label><textarea id="note" rows="2" maxlength="2000"></textarea><div class="row"><button id="approve" class="primary">Video & Caption freigeben</button><button id="changes">Änderung wünschen</button><button id="reject">Ablehnen</button></div></section>
<section id="publishing"><h2>Veröffentlichen</h2><p id="target"></p><p id="publishState"></p><a id="permalink" hidden target="_blank" rel="noopener noreferrer">Auf Instagram ansehen</a><div id="preparePanel"><label for="mode">Veröffentlichungsart</label><select id="mode"><option value="trial">Trial Reel</option><option value="normal">Normales Reel</option></select><div class="row"><button id="prepare">Veröffentlichung vorbereiten</button></div></div><div id="readyPanel" hidden><div class="row"><button id="showConfirm" class="primary">Posten …</button><button id="cancel">Vorbereitung zurücknehmen</button></div></div>
<section id="confirmation" hidden><h2>Letzte Prüfung</h2><p id="confirmText"></p><p id="captionPreview"></p><label><input id="checked" type="checkbox"> Genau dieses Video mit dieser Caption veröffentlichen.</label><div class="row"><button id="publish" class="primary">Jetzt veröffentlichen</button><button id="back">Zurück</button></div></section></section></div></div></main>
<script nonce="__NONCE__">
(() => {
const $=id=>document.getElementById(id),tg=window.Telegram&&window.Telegram.WebApp;
const launch=tg&&tg.initData;const focus=new URL(location.href).searchParams.get('item');
history.replaceState(null,'',location.pathname+location.search);
let items=[],item=null,pub=null,busy=false;
const states={pending:'Braucht Freigabe',approved:'Freigegeben',rejected:'Abgelehnt',changes:'Änderungen gewünscht',uploading:'Upload offen'};
const posts={approved:'Vorbereitet – wartet auf deinen Post-Befehl',scheduled:'Zum Posten eingereiht',publishing:'Wird veröffentlicht',published:'Veröffentlicht',failed:'Gestoppt – bitte prüfen'};
const notice=text=>$('notice').textContent=text;
const dirty=()=>item&&$('caption').value!==item.caption;
function controls(){document.querySelectorAll('button').forEach(b=>b.disabled=busy);if(!item)return;
$('save').disabled=busy||!dirty()||!!item.publish_post_id;
$('caption').disabled=busy||!!item.publish_post_id;
['approve','changes','reject'].forEach(id=>$(id).disabled=busy||dirty()||item.status!=='pending'||!!item.publish_post_id);
$('prepare').disabled=busy||dirty()||item.status!=='approved'||!pub||!pub.connected||pub.paused;
$('showConfirm').disabled=busy||dirty()||!pub||!pub.connected||pub.paused;
$('publish').disabled=busy||dirty()||!$('checked').checked||!pub||pub.status!=='approved'||!pub.connected||pub.paused;
$('count').textContent=$('caption').value.length+' / 2200 Zeichen';}
async function api(area,action){const r=await fetch('/api/public/telegram/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:launch,area,action})});const data=await r.json();if(!r.ok)throw Error(data.error||'Aktion nicht bestätigt. Bitte aktualisieren.');return data;}
async function run(fn){if(busy)return;busy=true;controls();notice('Einen Moment …');try{await fn();}catch(e){notice(e.message);}finally{busy=false;controls();}}
function list(){item=null;pub=null;$('detail').hidden=true;$('list').hidden=false;$('list').replaceChildren();for(const i of items){const b=document.createElement('button');b.className='card';b.textContent=(i.model==='kiikii'?'Kiikii 🦇':'Tuuva ❄️')+' · '+i.title+' · '+states[i.status];b.onclick=()=>run(()=>open(i.id));$('list').append(b);}if(!items.length)notice('Noch keine Reels zur Freigabe.');}
async function reload(){const data=await api('review',{action:'list'});items=data.items||[];}
async function open(id){await reload();item=items.find(i=>i.id===id);if(!item)throw Error('Reel nicht mehr verfügbar.');const ref={id:item.id,revision:item.revision};$('list').hidden=true;$('detail').hidden=false;$('title').textContent=(item.model==='kiikii'?'Kiikii 🦇':'Tuuva ❄️')+' · '+item.title;$('state').textContent=states[item.status]+' · Version '+item.revision;$('caption').value=item.caption;$('note').value='';$('confirmation').hidden=true;$('checked').checked=false;$('video').removeAttribute('src');
if(item.status!=='uploading'){const preview=await api('review',{action:'preview',...ref});$('video').src=preview.url;}
pub=await api('publish',{action:'status',...ref});$('target').textContent=pub.username?'Ziel: @'+pub.username:'Instagram für dieses Model noch nicht verbunden.';$('publishState').textContent=(posts[pub.status]||'Noch nicht vorbereitet.')+(pub.paused?' Publishing ist pausiert.':'')+(pub.error?' '+pub.error:'');$('permalink').hidden=!pub.permalink;if(pub.permalink)$('permalink').href=pub.permalink;$('preparePanel').hidden=!!pub.post_id;$('readyPanel').hidden=pub.status!=='approved';notice('Video, Caption und Zielkonto prüfen.');controls();}
async function review(action){await api('review',{...action,id:item.id,revision:item.revision});await open(item.id);}
async function publishAction(action){await api('publish',{...action,id:item.id,revision:item.revision});await open(item.id);}
$('all').onclick=()=>run(async()=>{if(dirty()&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;await reload();list();notice('Wähle ein Reel.');});
$('reload').onclick=()=>run(async()=>{if(dirty()&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;if(item)await open(item.id);else{await reload();list();notice('Aktualisiert.');}});
$('caption').oninput=()=>{$('confirmation').hidden=true;$('checked').checked=false;controls();};$('checked').onchange=controls;
$('save').onclick=()=>run(async()=>{await review({action:'edit',caption:$('caption').value});notice('Gespeichert. Bitte die neue Version freigeben.');});
$('approve').onclick=()=>run(()=>review({action:'decide',decision:'approved'}));
$('reject').onclick=()=>run(()=>review({action:'decide',decision:'rejected',note:$('note').value}));
$('changes').onclick=()=>run(async()=>{if(!$('note').value.trim())throw Error('Bitte den Änderungswunsch beschreiben.');await review({action:'decide',decision:'changes',note:$('note').value});});
$('prepare').onclick=()=>run(()=>publishAction({action:'prepare',publish_mode:$('mode').value}));
$('cancel').onclick=()=>run(()=>publishAction({action:'cancel'}));
$('showConfirm').onclick=()=>{$('confirmation').hidden=false;$('checked').checked=false;$('captionPreview').textContent=item.caption;$('confirmText').textContent='Auf @'+pub.username+' als '+(pub.publish_mode==='trial'?'Trial Reel posten? Keine automatische Übernahme in den Feed und keine Channel-Ankündigung.':'normales Reel posten? Channel-Ankündigung höchstens einmal täglich; Löschung nach 12 Stunden.');controls();};
$('back').onclick=()=>{$('confirmation').hidden=true;$('checked').checked=false;controls();};
$('publish').onclick=()=>run(()=>publishAction({action:'publish',confirmation:'PUBLISH',publish_mode:pub.publish_mode,ig_user_id:pub.ig_user_id}));
if(!launch){notice('Bitte über „In Telegram prüfen“ im privaten @KiikiiPrivateReviewBot öffnen.');return;}
tg.ready();tg.expand();tg.enableClosingConfirmation();$('app').hidden=false;
run(async()=>{await reload();if(focus&&items.some(i=>i.id===focus))await open(focus);else{list();notice('Wähle ein Reel.');}});
})();
</script></body></html>`;
  return new Response(html.replaceAll("__NONCE__", nonce), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://telegram.org; style-src 'nonce-${nonce}'; connect-src 'self'; media-src https://vkudzmoaqskmglfajzkz.supabase.co; img-src 'self' data:; frame-ancestors https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'none'`,
    },
  });
}
