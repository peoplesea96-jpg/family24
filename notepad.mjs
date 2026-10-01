import {parseNotes,endAfterHour} from "./note-parser.mjs";
import {escape as esc} from "./core.mjs";
let root, key;
export function removeNotepad() { root?.remove(); root=null; key=null; }
export function mountNotepad(context) {
  const nextKey=`family24-note:${context.user}:${context.group}`;
  if (root?.isConnected && key===nextKey) return;
  removeNotepad(); key=nextKey;
  root=document.createElement("aside"); root.className="notepad";
  const panel=root;
  panel.innerHTML=`<section class="note-panel" hidden aria-label="일정 메모장"><header><div><strong>일정 메모장</strong><small>여러 줄로 적고, 확인 후 일정에 담으세요</small></div><button type="button" class="note-close" aria-label="메모장 닫기">×</button></header><div class="note-body"><p class="muted">${esc(context.name)}님의 개인 일정 · 한국 시간 기준</p><label class="field">일정 메모<textarea class="note-text" rows="3" maxlength="3000" placeholder="예: 내일 3시 미팅"></textarea></label><div class="note-examples"><button type="button">내일 3시 미팅</button><button type="button">다음 주 월요일 오후 2시 운동</button></div><button type="button" class="primary note-send">보내기</button><small class="muted">닫아도 메모는 이 탭에 남습니다. 자동 저장 전에 확인합니다.</small><div class="note-result" aria-live="polite"></div></div></section><button type="button" class="primary note-toggle" aria-expanded="false">✎ 메모장</button>`;
  document.body.append(panel);
  const q=s=>panel.querySelector(s), input=q('.note-text'), result=q('.note-result');
  try { input.value=sessionStorage.getItem(nextKey)||""; } catch {}
  input.oninput=()=>{try {sessionStorage.setItem(nextKey,input.value);}catch{} result.innerHTML="";};
  function toggle(open) { q('.note-panel').hidden=!open; q('.note-toggle').setAttribute('aria-expanded',String(open)); if(open) input.focus(); else q('.note-toggle').focus(); }
  q('.note-toggle').onclick=()=>toggle(q('.note-panel').hidden);
  q('.note-close').onclick=()=>toggle(false);
  panel.onkeydown=e=>{if(e.key==='Escape') toggle(false);};
  panel.querySelectorAll('.note-examples button').forEach(b=>b.onclick=()=>{input.value=b.textContent;input.oninput();});
  q('.note-send').onclick=()=>{
    if (!input.value.trim()) {result.textContent="일정을 먼저 적어 주세요.";return;}
    let entries;
    try {entries=parseNotes(input.value);} catch(err){result.textContent=err.message;return;}
    const names={none:'반복 없음',daily:'매일',weekly:'매주',monthly:'매월'};
    result.innerHTML=`<form class="note-confirm"><h3>${entries.length}개 일정 확인</h3><p class="muted">${esc(entries[0].base)} 기준 · 기간은 각 날짜에 같은 시간으로 등록 · 종료 조건 없는 반복은 기본 12회</p>${entries.map((p,i)=>`<fieldset data-entry="${i}"><legend>일정 ${i+1}</legend><p class="note-warning">${p.warnings.map(esc).join('<br>')}</p><label class="field">제목<input name="title" required maxlength="120" value="${esc(p.title)}"></label><label class="field">날짜<input name="date" type="date" required min="1900-01-01" max="2100-12-31" value="${p.date}"></label>${p.ambiguous?`<div>${['am','pm'].map(k=>`<button type="button" data-time="${p.ambiguous[k]}">${k==='am'?'오전':'오후'} ${p.ambiguous[k]}</button>`).join('')}</div>`:''}<label><input type="checkbox" name="allDay" ${p.allDay?'checked':''}> 종일 일정</label><div class="note-times"><label class="field">시작<input name="start" type="time" required value="${p.start}"></label><label class="field">종료<input name="end" type="time" required value="${p.end}"></label></div><label class="field">반복<select name="freq">${Object.entries(names).map(([v,n])=>`<option value="${v}" ${p.repeat.freq===v?'selected':''}>${n}</option>`).join('')}</select></label><div class="note-times"><label class="field">반복 종료일<input name="until" type="date" value="${p.repeat.until||''}"></label><label class="field">총 횟수<input name="count" type="number" min="1" max="1000" value="${p.repeat.count||''}"></label></div><label class="field">공개 범위<select name="visibility"><option value="private">나만 보기</option><option value="family">가족 전체</option></select></label><p class="note-conflicts muted"></p></fieldset>`).join('')}<p class="form-error" role="alert"></p><button type="submit" class="primary">확인하고 모두 저장</button></form>`;
    const form=q('.note-confirm'), boxes=[...form.querySelectorAll('fieldset')];
    const read=box=>{
      const d=Object.fromEntries([...box.querySelectorAll('[name]')].map(el=>[el.name,el.value]));
      if(box.querySelector('[name="allDay"]').checked){d.start="";d.end="";}
      delete d.allDay;
      d.repeat={freq:d.freq,interval:1};
      if(d.freq!=='none'){if(d.until)d.repeat.until=d.until;if(d.count)d.repeat.count=Number(d.count);}
      delete d.freq;delete d.until;delete d.count;return d;
    };
    boxes.forEach((box,i)=>{
      const field=n=>box.querySelector(`[name="${n}"]`);
      const conflict=()=>{const n=context.conflicts(read(box));box.querySelector('.note-conflicts').textContent=n?`첫 날짜에 겹치는 내 일정 ${n}건이 있습니다.`:'';};
      const toggleAllDay=()=>{for(const n of ["start","end"]){field(n).disabled=field("allDay").checked;field(n).required=!field("allDay").checked;}conflict();};
      field("allDay").onchange=toggleAllDay;toggleAllDay();
      box.onchange=conflict;
      box.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>{
        field('allDay').checked=false;toggleAllDay();
        field('start').value=b.dataset.time;
        field('end').value=entries[i].endAmbiguous?.[b.dataset.time===entries[i].ambiguous.am?'am':'pm']||entries[i].end||endAfterHour(b.dataset.time);conflict();
      });conflict();
    });
    form.onsubmit=async e=>{
      e.preventDefault();e.stopPropagation();
      const error=form.querySelector('.form-error'), data=boxes.filter(b=>!b.disabled).map(read);
      for(const d of data){
        if((d.start||d.end)&&(!d.start||!d.end||d.end<=d.start)){error.textContent='종료 시간은 시작 시간 이후여야 합니다. 자정을 넘는 일정은 나누어 주세요.';return;}
        if(d.repeat.freq!=='none'&&!d.repeat.count&&!d.repeat.until){error.textContent='반복 종료일 또는 총 횟수를 입력해 주세요.';return;}
        if(d.repeat.until&&d.repeat.until<d.date){error.textContent='반복 종료일이 시작일보다 빠릅니다.';return;}
      }
      const save=form.querySelector('[type="submit"]');save.disabled=true;input.disabled=true;q('.note-send').disabled=true;
      const ids=form.savedIds||[];form.savedIds=ids;
      try {
        for(const box of boxes.filter(b=>!b.disabled)){
          const id=await context.save(read(box));ids.push(id);box.disabled=true;
          box.querySelector('legend').textContent+=' · 저장 완료';
        }
        try {sessionStorage.removeItem(nextKey);}catch{}
        input.value='';result.innerHTML=`<div class="note-success"><strong>${ids.length}개 일정을 등록했습니다</strong><p>반복·기간 일정은 캘린더의 각 해당 날짜에서 볼 수 있습니다.</p><button type="button" class="note-undo">전체 등록 취소</button></div>`;
        q('.note-undo').onclick=async()=>{const b=q('.note-undo');b.disabled=true;try {while(ids.length){await context.undo(ids[ids.length-1]);ids.pop();}result.textContent='등록을 취소했습니다. 휴지통에서 복구할 수 있습니다.';}catch(err){b.disabled=false;result.append(document.createTextNode(err.message));}};
      } catch(err) {error.textContent=`${ids.length}개 저장 완료. ${err.message} 저장 버튼을 다시 누르면 남은 일정만 저장합니다.`;save.disabled=false;}
      finally {input.disabled=false;q('.note-send').disabled=false;}
    };
  };
}
