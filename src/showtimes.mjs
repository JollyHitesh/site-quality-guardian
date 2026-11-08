// A limited UI plausibility check, NOT an independent cinema-source verification.
const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

export function berlinTimeParts(now=new Date(),timezone='Europe/Berlin') {
  const pieces=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const result=Object.fromEntries(pieces.map(p=>[p.type,Number(p.value)]));
  return {year:result.year,month:result.month,day:result.day,hour:result.hour,minute:result.minute};
}

export function nextScreeningPlausibility(text, now=new Date(), timezone='Europe/Berlin') {
  const match=String(text).match(/Next\s*:\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*[·•-]\s*(\d{1,2}):(\d{2})/i);
  if(!match)return {status:'NOT_DETECTED'};
  const nowP=berlinTimeParts(now,timezone);
  const month=months[match[2].toLowerCase()];
  const day=Number(match[1]),hour=Number(match[3]),minute=Number(match[4]);
  if(day<1||day>31||hour>23||minute>59) return {status:'UNPARSEABLE'};
  let year=nowP.year;
  if(nowP.month===12&&month===1)year++;
  if(nowP.month===1&&month===12)year--;
  // Compare local wall-clock numbers. This avoids making an implicit UTC assumption.
  const candidate=Date.UTC(year,month-1,day,hour,minute);
  const current=Date.UTC(nowP.year,nowP.month-1,nowP.day,nowP.hour,nowP.minute);
  const minutesUntil=Math.round((candidate-current)/60000);
  return {status:minutesUntil< -30?'PAST_NEXT_SHOWTIME':'PLAUSIBLE',minutesUntil,shown:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')} ${match[3]}:${match[4]}`,timeZone:timezone};
}
