import {normalizeKoreanTime,timeLexicon,weekWords} from "./korean-time.mjs";
// Deterministic Korean date/time parser for the local prototype.
const fixedHolidays = {
  "개천절": "10-03", "한글날": "10-09", "삼일절": "03-01", "3·1절": "03-01",
  "어린이날": "05-05", "현충일": "06-06", "광복절": "08-15",
  "크리스마스": "12-25", "성탄절": "12-25", "신정": "01-01",
};
export function parseNote(input, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const base = new Date(today + "T00:00:00Z");
  let text = input.trim(), day = "", start = "", ambiguous = null, warnings = [];
  const relative = text.match(/오늘|내일|모레/);
  const exact = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const weekday = text.match(/(이번|다음)\s*주\s*([월화수목금토일])요일/);
  const holiday = text.match(/(?:(올해|내년|작년|\d{4}년)\s*)?(개천절|한글날|삼일절|3·1절|어린이날|현충일|광복절|크리스마스|성탄절|신정)(?:날)?(?:에)?/);
  if (exact) {
    const candidate = `${exact[1]}-${exact[2].padStart(2,"0")}-${exact[3].padStart(2,"0")}`;
    const parsed = new Date(candidate + "T00:00:00Z");
    if (!Number.isNaN(+parsed) && parsed.toISOString().slice(0,10) === candidate) day = candidate;
    else warnings.push("날짜가 올바르지 않습니다. 직접 선택해 주세요.");
    text = text.replace(exact[0], " ");
  } else if (holiday && !/대체\s*(공휴일|휴일)/.test(text)) {
    const year = Number(today.slice(0,4));
    const chosenYear = holiday[1]?.endsWith("년") && /^\d/.test(holiday[1])
      ? Number(holiday[1].slice(0,4)) : year + (holiday[1]==="내년"?1:holiday[1]==="작년"?-1:0);
    day = `${chosenYear}-${fixedHolidays[holiday[2]]}`;
    text = text.replace(holiday[0], " ");
  } else if (relative) {
    base.setUTCDate(base.getUTCDate() + ({오늘:0,내일:1,모레:2})[relative[0]]);
    day = base.toISOString().slice(0,10); text = text.replace(relative[0], " ");
  } else if (weekday) {
    const offset = "월화수목금토일".indexOf(weekday[2]) - (base.getUTCDay()+6)%7 + (weekday[1]==="다음"?7:0);
    base.setUTCDate(base.getUTCDate()+offset); day=base.toISOString().slice(0,10); text=text.replace(weekday[0]," ");
  }
  const time = text.match(/(?:(오전|오후|아침|저녁|밤)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(반|\d{1,2}분))?)/);
  if (time) {
    let hour=Number(time[2]), minute=time[3]?Number(time[3]):time[4]==="반"?30:parseInt(time[4]||"0");
    if (hour>23 || minute>59 || (time[1] && (hour<1 || hour>12))) warnings.push("시간이 올바르지 않습니다. 직접 선택해 주세요.");
    else if (!time[1] && !time[3] && hour>=1 && hour<=12) {
      ambiguous={am:`${String(hour%12).padStart(2,"0")}:${String(minute).padStart(2,"0")}`,pm:`${String(hour%12+12).padStart(2,"0")}:${String(minute).padStart(2,"0")}`};
      warnings.push("오전인지 오후인지 선택해 주세요.");
    } else {
      if (time[1]) hour=hour%12+(["오후","저녁","밤"].includes(time[1])?12:0);
      start=`${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
    }
    text=text.replace(time[0]+(text.slice(time.index+time[0].length).startsWith("에")?"에":"")," ");
  }
  if (!day) warnings.push("날짜를 선택해 주세요.");
  if (!start && !ambiguous) warnings.push("시작 시간을 선택해 주세요.");

  return {title:text.replace(/\s+/g," ").trim(),date:day,start,ambiguous,warnings,base:today};
}
export function endAfterHour(start) {
  if (!/^\d{2}:\d{2}$/.test(start)) return "";
  const [h,m]=start.split(":").map(Number);
  return h<23?`${String(h+1).padStart(2,"0")}:${String(m).padStart(2,"0")}`:"";
}

// A memo is a collection of separately reviewable schedules. Ranges use a
// bounded daily series, so every day retains the requested working hours.
export function parseNotes(input, now = new Date()) {
  const lines=input.split(/\n|;|그리고/).map(s=>s.trim()).filter(Boolean);
  if(lines.length>20) throw new Error("한 번에 최대 20개 일정까지 입력해 주세요.");
  return lines.map(line=>{
    let text=line, repeat={freq:"none"}, until="", count="";
    const today=parseNote("오늘",now).date;
    const normalized=normalizeKoreanTime(text,today);text=normalized.text;
    const shift=(ds,n)=>{const d=new Date(ds+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
    const resolve=phrase=>{
      const md=phrase.match(/^(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일$/);
      return parseNote(md?`${md[1]||today.slice(0,4)}-${md[2]}-${md[3]}`:phrase,now).date;
    };
    // Resolve omitted months before the ordinary date/time parser runs.
    // A week qualifier anchors the start date even across month/year boundaries.
    const shortRange=text.match(/(?:(다다음|지지난|이번|다음|지난|금|차)\s*주\s*)?(?:(\d{1,2})월\s*)?(\d{1,2})\s*일?\s*(?:[~～–-]|일부터)\s*(?:(\d{1,2})월\s*)?(\d{1,2})\s*일(?:\s*까지)?(?:\s*동안)?/);
    if(shortRange){
      const [,week,month,first,endMonth,last]=shortRange;
      const valid=(year,mo,day)=>resolve(`${year}년 ${mo}월 ${day}일`);
      let start="", finish="";
      if(week){
        const monday=shift(today,-(new Date(today+"T00:00:00Z").getUTCDay()+6)%7+timeLexicon.weeks[week]*7);
        for(let i=0;i<7;i++){
          const ds=shift(monday,i);
          if(Number(ds.slice(8))===Number(first)&&(!month||Number(ds.slice(5,7))===Number(month)))start=ds;
        }
        if(!start)throw new Error("입력한 날짜가 지정한 주에 없습니다. 월과 날짜를 확인해 주세요.");
      } else start=valid(today.slice(0,4),month||today.slice(5,7),first);
      if(start){
        let year=Number(start.slice(0,4)), mo=Number(endMonth||start.slice(5,7));
        if(!endMonth&&Number(last)<Number(first))mo++;
        if(mo===13){mo=1;year++;}
        if(endMonth&&mo<Number(start.slice(5,7)))year++;
        finish=valid(year,mo,last);
      }
      if(!start||!finish||finish<start)throw new Error("기간의 시작일과 종료일을 확인해 주세요.");
      text=text.replace(shortRange[0],`${start}부터 ${finish}까지`);
    }
    const token="(?:\\d{4}-\\d{1,2}-\\d{1,2}|(?:\\d{4}년\\s*)?\\d{1,2}월\\s*\\d{1,2}일|(?:이번|다음)\\s*주\\s*[월화수목금토일]요일|[월화수목금토일]요일|오늘|내일|모레)";
    const range=text.match(new RegExp(`(${token})부터\\s*(${token})까지`));
    let rangeStart="";
    if(range){
      rangeStart=resolve(range[1]);
      if(/^[월화수목금토일]요일$/.test(range[2]) && rangeStart){
        const weekday="일월화수목금토".indexOf(range[2][0]);
        until=shift(rangeStart,(weekday-new Date(rangeStart+"T00:00:00Z").getUTCDay()+7)%7);
      } else until=resolve(range[2]);
      if(!rangeStart||!until||until<rangeStart) throw new Error("기간의 시작일과 종료일을 확인해 주세요.");
      text=text.replace(range[0],rangeStart);repeat={freq:"daily",interval:1,until};
    }
    const recurrence=text.match(/매일|매주\s*([월화수목금토일])요일|매월/);
    if(recurrence){
      repeat={freq:recurrence[0]==="매일"?"daily":recurrence[0]==="매월"?"monthly":"weekly",interval:1};
      text=text.replace(recurrence[0],"");
      if(recurrence[1]) {
        const wd="일월화수목금토".indexOf(recurrence[1]);repeat.weekdays=[wd];
        rangeStart=rangeStart||shift(today,(wd-new Date(today+"T00:00:00Z").getUTCDay()+7)%7);
      }
      const cm=text.match(/(\d+)\s*회/);if(cm){count=Number(cm[1]);if(count<1||count>1000)throw new Error("반복 횟수는 1~1000회로 입력해 주세요.");text=text.replace(cm[0],"");}
      const um=text.match(new RegExp(`(${token})까지`));if(um){until=resolve(um[1]);text=text.replace(um[0],"");if(!until)throw new Error("반복 종료일을 확인해 주세요.");}
      if(until)repeat.until=until;
      if(count)repeat.count=count;
    }
    const timeToken="(?:(?:오전|오후|아침|저녁|밤)\\s*)?\\d{1,2}(?::\\d{2}|시(?:\\s*(?:반|\\d{1,2}분))?)";
    const times=text.match(new RegExp(`(${timeToken})\\s*(?:부터|~|[-–])\\s*(${timeToken})\\s*(?:까지)?`));
    let end="", endAmbiguous=null;
    if(times){
      let last=times[2];
      const meridiem=times[1].match(/오전|오후|아침|저녁|밤/);
      if(meridiem&&!/오전|오후|아침|저녁|밤|:/.test(last))last=meridiem[0]+last;
      const ep=parseNote(`오늘 ${last}`,now);end=ep.start;endAmbiguous=ep.ambiguous;
      text=text.replace(times[0],times[1]);
    }
    text=text.replace(new RegExp(`(${token})(?:날)?(?:에)?`),(s,phrase)=>resolve(phrase)||s);
    text=text.replace(/(\d{1,2}(?::\d{2}|시(?:\s*(?:반|\d{1,2}분))?))\s*부터(?=\s|$)/g,"$1");
    const hasTime=/\d{1,2}(?::\d{2}|시)|오전|오후|아침|저녁|밤|새벽|정오|자정|\d+\s*(?:시간|분)/.test(text)||normalized.durationMinutes!==null;
    let parsed=parseNote(text,now);
    parsed.allDay=!hasTime;
    if(parsed.allDay)parsed.warnings=parsed.warnings.filter(w=>w!=="시작 시간을 선택해 주세요.");
    parsed.warnings.push(...normalized.warnings);
    if(normalized.durationMinutes!==null){
      const finish=start=>{const [h,m]=start.split(":").map(Number);const total=h*60+m+normalized.durationMinutes;return total<1440?`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`:"";};
      if(parsed.start)end=finish(parsed.start);
      if(parsed.ambiguous)endAmbiguous={am:finish(parsed.ambiguous.am),pm:finish(parsed.ambiguous.pm)};
      if(parsed.start&&!end)parsed.warnings.push("자정을 넘는 일정은 날짜별로 나누어 주세요.");
    }
    if(!parsed.date && repeat.freq!=="none")parsed={...parsed,date:rangeStart||today,warnings:parsed.warnings.filter(w=>!w.includes("날짜"))};
    if(recurrence && !repeat.count && !repeat.until)repeat.count=12;
    if(repeat.count && (repeat.count<1||repeat.count>1000))throw new Error("반복 횟수는 1~1000회로 입력해 주세요.");
    if(repeat.until && repeat.until<parsed.date)throw new Error("반복 종료일이 시작일보다 빠릅니다.");
    if(/부터|까지|매주|매월|매일/.test(parsed.title))parsed.warnings.push("해석하지 못한 기간 표현이 있습니다. 날짜와 반복 설정을 직접 확인해 주세요.");
    return {...parsed,end:times||normalized.durationMinutes!==null?end:endAfterHour(parsed.start),endAmbiguous,repeat};
  });
}
