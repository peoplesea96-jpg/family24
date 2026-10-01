// Versioned Korean temporal vocabulary. Values are rules, not fixed dates.
export const timeLexicon = {
  version: 1,
  relativeDays: {"그저께":-2,"그제":-2,"어제":-1,"금일":0,"오늘":0,"명일":1,"내일":1,"내일모레":2,"모레":2,"글피":3,"그글피":4},
  weeks: {"지지난":-2,"지난":-1,"이번":0,"금":0,"다음":1,"차":1,"다다음":2},
  months: {"지난달":-1,"이번달":0,"이달":0,"다음달":1,"내달":1,"다다음달":2},
  days: {"하루":1,"이틀":2,"사흘":3,"나흘":4,"닷새":5,"엿새":6,"이레":7,"여드레":8,"아흐레":9,"열흘":10,"열하루":11,"열이틀":12,"열사흘":13,"열나흘":14,"열닷새":15,"보름":15,"스무날":20},
  numbers: {"한":1,"두":2,"세":3,"네":4,"다섯":5,"여섯":6,"일곱":7,"여덟":8,"아홉":9,"열":10,"열한":11,"열두":12},
  clock: {"정오":"12:00","자정":"00:00"},
  ambiguous: ["보름","월초","월중","월말쯤","조만간","이따","나중에"],
};
const alternatives=o=>Object.keys(o).sort((a,b)=>b.length-a.length).join('|');
export const weekWords=alternatives(timeLexicon.weeks);
export const relativeWords=alternatives(timeLexicon.relativeDays);
const shift=(ds,n)=>{const d=new Date(ds+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const numeric=s=>timeLexicon.numbers[s]??Number(s);
export function normalizeKoreanTime(input,today){
 let text=input, warnings=[], durationMinutes=null;
 const date=(y,m,d)=>{
   const result=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
   const parsed=new Date(result+'T00:00:00Z');
   if(Number.isNaN(+parsed)||parsed.toISOString().slice(0,10)!==result)throw new Error('존재하지 않는 날짜입니다. 월과 일을 확인해 주세요.');
   return result;
 };
 const durationWords=`(?:${alternatives(timeLexicon.days)}|(?:${alternatives(timeLexicon.numbers)}|\\d+)\\s*(?:일|주일|주))`;
 const durationDays=s=>{
   const compact=s.replace(/\s/g,'');if(timeLexicon.days[compact])return timeLexicon.days[compact];
   const m=compact.match(/(.+?)(주일|주|일)$/);return numeric(m[1])*(m[2].startsWith('주')?7:1);
 };
 text=text.replace(new RegExp(`(${durationWords})\\s*(뒤|후|전)(?:에)?`,'g'),(_,term,direction)=>shift(today,durationDays(term)*(direction==='전'?-1:1)));
 text=text.replace(new RegExp(`(?<![가-힣])(${relativeWords})(?:날)?(?:에)?`,'g'),(_,term)=>shift(today,timeLexicon.relativeDays[term]));
 text=text.replace(new RegExp(`(${alternatives(timeLexicon.months).replaceAll('달','\\s*달')})\\s*(말일|마지막\\s*날|\\d{1,2}일)`,'g'),(_,term,day)=>{
   const d=new Date(today+'T00:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+timeLexicon.months[term.replace(/\s/g,'')]);
   const n=/일$/.test(day)&&/^\d/.test(day)?parseInt(day):new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
   return date(d.getUTCFullYear(),d.getUTCMonth()+1,n);
 });
 // Leave explicit numbered week ranges for the range parser.
 text=text.replace(new RegExp(`(?<![가-힣])(${weekWords})\\s*주(?!\\s*\\d)\\s*([월화수목금토일]요일|주말)?`,'g'),(_,term,weekday)=>{
   const monday=shift(today,-(new Date(today+'T00:00:00Z').getUTCDay()+6)%7+timeLexicon.weeks[term]*7);
   if(weekday==='주말')return `${shift(monday,5)}부터 ${shift(monday,6)}까지 `;
   if(!weekday)warnings.push('요일 없는 주 표현은 해당 주 월요일부터로 해석했습니다.');
   return shift(monday,weekday?'월화수목금토일'.indexOf(weekday[0]):0);
 });
 text=text.replace(new RegExp(`(?<![0-9~～–-])(?:(\\d{4}-\\d{2}-\\d{2})\\s*(?:부터)?\\s*)?(${durationWords})\\s*(?:동안|간)`,'g'),(_,start,term)=>{
   const days=durationDays(term);if(!Number.isInteger(days)||days<1||days>1000)throw new Error('기간은 1~1000일로 입력해 주세요.');
   if(!start)warnings.push('시작일 없는 기간은 오늘부터로 해석했습니다.');
   return `${start||today}부터 ${shift(start||today,days-1)}까지`;
 });

 // A day without a month means its next occurrence, including today.
 text=text.replace(/(^|\s)(\d{1,2})일(?:날)?(?:에)?(?=\s|$)/g,(match,space,raw,offset)=>{
   const prefix=text.slice(0,offset).trimEnd();
   if(/[월년주]$/.test(prefix))return match;
   const day=Number(raw);if(day<1||day>31)throw new Error('날짜는 1~31일로 입력해 주세요.');
   const month=new Date(today+'T00:00:00Z');month.setUTCDate(1);
   for(let i=0;i<13;i++){
     const year=month.getUTCFullYear(), mo=month.getUTCMonth();
     const last=new Date(Date.UTC(year,mo+1,0)).getUTCDate();
     if(day<=last){const ds=date(year,mo+1,day);if(ds>=today)return space+ds;}
     month.setUTCMonth(mo+1);
   }
   throw new Error('날짜를 확인해 주세요.');
 });
 const nm=`(?:${alternatives(timeLexicon.numbers)}|\\d+)`;
 text=text.replace(new RegExp(`(${nm})\\s*시간(?:\\s*(반|\\d+\\s*분))?\\s*(?:동안|간)`),(_,n,extra)=>{
   durationMinutes=numeric(n)*60+(extra==='반'?30:parseInt(extra||'0'));return '';
 });
 if(durationMinutes===null)text=text.replace(/(\d+)\s*분\s*동안/,(_,n)=>{durationMinutes=Number(n);return '';});
 if(durationMinutes!==null && (durationMinutes<=0||durationMinutes>=1440))throw new Error('시간 길이는 1분 이상 24시간 미만으로 입력해 주세요.');
 text=text.replace(new RegExp(`(${alternatives(timeLexicon.numbers)})\\s*시(?!간)`,'g'),(_,n)=>`${numeric(n)}시`);
 text=text.replace(/정오|자정/g,s=>timeLexicon.clock[s]);
 text=text.replace(/새벽\s*(?=\d)/g,'오전 ');
 text=text.replace(/낮\s*(?=\d)/g,'오후 ');
 if(timeLexicon.ambiguous.some(term=>text.includes(term)))warnings.push('정확한 날짜가 필요한 표현이 있습니다. 보름은 ‘보름 뒤’ 또는 ‘보름 동안’처럼 입력해 주세요. 음력 보름은 자동 변환하지 않습니다.');
 return {text,warnings,durationMinutes};
}
