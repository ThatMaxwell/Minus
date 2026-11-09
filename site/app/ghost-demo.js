// A pretend desktop for previewing the ghost cursor: two agents at work at once.
import { COLORS } from '../js/shape.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function play(onEvent, looks) {
  looks.set('scout', { id: 'scout', name: 'Scout', color: COLORS.mint, outfit: { head: 'cap' } });
  looks.set('inbox', { id: 'inbox', name: 'Inbox', color: COLORS.violet, outfit: { head: 'headphones' } });
  document.body.insertAdjacentHTML('afterbegin', `<style>
    html, body { background: radial-gradient(900px 600px at 15% 85%, rgba(95,207,166,.18), transparent 70%), radial-gradient(900px 600px at 90% 10%, rgba(245,169,79,.14), transparent 70%), linear-gradient(180deg, #1b1d21, #121316) !important; }
    .dw { position: absolute; border-radius: 12px; background: #f4f3ef; color: #19191b; font: 400 14px Geist, system-ui, sans-serif; box-shadow: 0 30px 70px -24px rgba(0,0,0,.8); overflow: hidden; }
    .dw .bar { height: 34px; display: flex; align-items: center; gap: 10px; padding: 0 12px; background: #e6e5e0; border-bottom: 1px solid #d9d8d2; }
    .dw .bar i { width: 10px; height: 10px; border-radius: 50%; background: #cfcdc6; } .dw .bar span { margin-left: 8px; font: 500 12px Geist; color: #6b6a66; }
    .dw .body { padding: 18px 20px; display: grid; gap: 8px; }
    .dw h4 { margin: 0 0 4px; font: 600 16px Geist; }
    .dw label { font-size: 12px; color: #8a8984; }
    .dw .in { height: 34px; border-radius: 8px; background: #fff; box-shadow: inset 0 0 0 1px #dddcd6; padding: 0 10px; display: flex; align-items: center; font-size: 14px; }
    .dw .btn { height: 36px; border-radius: 9px; background: #19191b; color: #fff; display: grid; place-items: center; font-weight: 600; margin-top: 6px; }
    .dw .mail { display: grid; grid-template-columns: 160px 1fr; height: calc(100% - 34px); }
    .dw .mail .list { background: #ecebe6; padding: 12px; display: grid; gap: 8px; align-content: start; }
    .dw .mail .list div { height: 44px; border-radius: 8px; background: #f8f7f3; }
    .dw .mail .list div.on { box-shadow: inset 3px 0 0 #9079f7; }
    .dw .area { height: 120px; border-radius: 8px; background: #fff; box-shadow: inset 0 0 0 1px #dddcd6; }
  </style>
  <div class="dw" style="left:70px;top:90px;width:430px;height:400px"><div class="bar"><i></i><i></i><i></i><span>crm.acme.example/leads/new</span></div>
    <div class="body"><h4>New lead</h4><label>Name</label><div class="in" id="d-name"></div><label>Company</label><div class="in" id="d-co"></div><label>Email</label><div class="in" id="d-mail"></div><div class="btn" id="d-save">Save lead</div></div></div>
  <div class="dw" id="d-inbox" style="left:560px;top:150px;width:560px;height:380px"><div class="bar"><i></i><i></i><i></i><span>Mail · Inbox</span></div>
    <div class="mail"><div class="list"><div class="on" id="d-msg"></div><div></div><div></div><div></div></div>
    <div class="body"><h4>Re: Webinar follow-up</h4><label>Reply</label><div class="area" id="d-reply"></div><div class="btn" id="d-send" style="width:120px">Send</div></div></div></div>`);
  const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const put = (id, t) => { document.getElementById(id).textContent = t; };
  const S = (e) => onEvent('scout', e), I = (e) => onEvent('inbox', e);
  for (;;) {
    ['d-name', 'd-co', 'd-mail', 'd-reply'].forEach((id) => put(id, ''));
    await wait(500);
    S({ kind: 'scan', ...r('d-name'), ...{ x: 70, y: 90, w: 430, h: 400 } });
    await wait(900);
    I({ kind: 'scan', x: 560, y: 150, w: 560, h: 380 });
    S({ kind: 'step', text: 'Type “Dana Okafor” in Name' }); S({ kind: 'point', action: 'type', text: 'Dana Okafor', ...r('d-name') });
    setTimeout(() => put('d-name', 'Dana Okafor'), 700);
    await wait(900);
    I({ kind: 'step', text: 'Open “Webinar follow-up”' }); I({ kind: 'point', action: 'click', ...r('d-msg') });
    await wait(500);
    S({ kind: 'step', text: 'Type “Northwind” in Company' }); S({ kind: 'point', action: 'type', text: 'Northwind', ...r('d-co') });
    setTimeout(() => put('d-co', 'Northwind'), 650);
    await wait(700);
    I({ kind: 'step', text: 'Write the reply' }); I({ kind: 'point', action: 'type', text: 'Thanks for joining! Here are the slides…', ...r('d-reply') });
    setTimeout(() => put('d-reply', 'Thanks for joining! Here are the slides…'), 1200);
    await wait(700);
    S({ kind: 'step', text: 'Type “dana@northwind.example” in Email' }); S({ kind: 'point', action: 'type', text: 'dana@northwind.example', ...r('d-mail') });
    setTimeout(() => put('d-mail', 'dana@northwind.example'), 800);
    await wait(1100);
    S({ kind: 'step', text: 'Click “Save lead”' }); S({ kind: 'point', action: 'click', ...r('d-save') });
    await wait(500);
    I({ kind: 'step', text: 'Press Ctrl+Enter' }); I({ kind: 'point', action: 'key', text: 'ctrl+enter', ...r('d-reply') });
    await wait(1200);
    S({ kind: 'done' }); I({ kind: 'done' });
    await wait(3200);
  }
}
