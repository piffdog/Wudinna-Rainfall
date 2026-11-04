const fs = require("fs/promises");
const path = require("path");
const Papa = require("papaparse");
const OUT = path.join(__dirname,"..","data","current-year.json");
const START="2026-11-01", END="2027-10-31";
function axis(date) {
 const [y,m,d]=date.split("-").map(Number);
 const monthIndex = m>=11?m-11:m+1;
 const days=new Date(Date.UTC(y,m,0)).getUTCDate();
 return monthIndex+(d-1)/days;
}
function isoTodayAdelaide(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Adelaide",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function csvUrl(y,m){const ym=`${y}${String(m).padStart(2,"0")}`;return `https://www.bom.gov.au/climate/dwo/${ym}/text/IDCJDW5073.${ym}.csv`;}
async function fetchCsv(url){let error;for(let i=0;i<4;i++){
 try{const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/csv,text/plain,*/*"}});if(!r.ok)throw Error(`HTTP ${r.status}: ${url}`);return new TextDecoder("windows-1252").decode(await r.arrayBuffer());}catch(e){error=e;if(i<3)await new Promise(r=>setTimeout(r,(i+1)*2000));}
}throw error;}
function parse(csv,ym){
 const lines=csv.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").split("\n");
 const ix=lines.findIndex(line=>/^\s*,\s*"Date"\s*,/.test(line));
 if(ix<0)throw Error(`Cannot find BOM header for ${ym}`);
 const table=lines.slice(ix).map(line=>line.startsWith(",")?line.slice(1):line).join("\n");
 const p=Papa.parse(table,{header:true,skipEmptyLines:true});
 if(p.errors.length)throw Error(`CSV parse error for ${ym}: ${JSON.stringify(p.errors.slice(0,2))}`);
 const keys=Object.keys(p.data[0]||{});const dk=keys.find(k=>k.trim()==="Date"),rk=keys.find(k=>k.trim()==="Rainfall (mm)");
 if(!dk||!rk)throw Error(`Missing BOM columns in ${ym}`);
 return p.data.filter(r=>/^\d{4}-\d{1,2}-\d{1,2}$/.test(r[dk]||""))
 .map(r=>{const [y,m,d]=r[dk].split("-").map(Number);const date=`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;const raw=String(r[rk]??"").trim();return {date,rainfall_mm:raw===""?null:Number(raw)};});
}
async function main(){
 const existing=JSON.parse(await fs.readFile(OUT,"utf8"));
 if(existing.rainfallYearEndingOctober!==2027)throw Error("Unexpected rainfall year in current JSON");
 const now=isoTodayAdelaide();const last=now<END?now:END;
 const all=[];
 for(let y=2026,m=11; y<2027 || (y===2027&&m<=10);){
  const ym=`${y}-${String(m).padStart(2,"0")}`;
  if(`${ym}-01`>last)break;
  const url=csvUrl(y,m);console.log(`Fetching BOM daily data: ${url}`);
  const rows=parse(await fetchCsv(url),ym);all.push(...rows);
  m++;if(m===13){m=1;y++;}
 }
 const rows=all.filter(r=>r.date>=START&&r.date<=last&&r.rainfall_mm!==null&&Number.isFinite(r.rainfall_mm)).sort((a,b)=>a.date.localeCompare(b.date));
 if(!rows.length)throw Error("No current-year observations available; retaining existing JSON");
 if(rows.some(r=>r.rainfall_mm===null || !Number.isFinite(r.rainfall_mm)))throw Error("Missing/non-numeric BOM rainfall observation: retaining existing JSON");
 const seen=new Set();let total=0;
 const daily=rows.map(r=>{if(seen.has(r.date))throw Error(`Duplicate date ${r.date}`);seen.add(r.date);total+=r.rainfall_mm;return {date:r.date,rainfall_mm:Math.round(r.rainfall_mm*10)/10,cumulative_mm:Math.round(total*10)/10,x:axis(r.date)};});
 const prev=existing.daily||[];
 if(prev.length&&daily[daily.length-1].date<prev[prev.length-1].date)throw Error("BOM returned older data: retaining existing JSON");
 const output={station:"018083",stationName:"Wudinna Aero",rainfallYearEndingOctober:2027,startDate:START,endDate:END,updatedAt:new Date().toISOString(),source:"BOM Daily Weather Observations station 018083",daily};
 await fs.writeFile(OUT,JSON.stringify(output,null,2)+"\n");
 console.log(`Wrote ${daily.length} daily rows; Latest: ${daily[daily.length-1].date} = ${daily[daily.length-1].cumulative_mm}mm`);
}
main().catch(e=>{console.error(e);process.exit(1);});
