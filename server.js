/* Servidor local para Sequía en vivo. No requiere instalar paquetes. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const INDEX = path.join(__dirname, 'index.html');
const PUBLIC_URL_FILE = path.join(__dirname, 'public-url.txt');
const INTERNET_MODE = process.argv.includes('--internet');
const rooms = new Map();

const questions = [
  { type:'order', phase:'ARMA LA CAUSA · 1/3', icon:'🌧️', title:'La lluvia desaparece', prompt:'Construye la cadena que explica cómo una sequía afecta a los cultivos.', instruction:'Toca las tarjetas para colocarlas en orden: de la causa al efecto.', cards:[
    ['rain','🌧️','Menos precipitaciones'],['water','💧','Menor disponibilidad de agua'],['soil','🌱','Menor humedad del suelo'],['crop','🌾','Afectación de cultivos']], order:['rain','water','soil','crop'], explanation:'Cuando llueve menos durante meses, baja el agua disponible. El suelo pierde humedad y los cultivos tienen dificultades para crecer.' },
  { type:'order', phase:'ARMA LA CAUSA · 2/3', icon:'☀️', title:'El calor agrava el problema', prompt:'Ordena esta cadena para descubrir por qué las altas temperaturas empeoran una sequía.', instruction:'Arma el recorrido desde el calor hasta la producción agrícola.', cards:[
    ['heat','☀️','Temperaturas elevadas'],['evap','💨','Mayor evaporación'],['dry','🌱','Suelo más seco'],['stress','🌾','Estrés en cultivos'],['low','📉','Menor producción']], order:['heat','evap','dry','stress','low'], explanation:'El calor hace que el agua se evapore más rápido. Así se seca el suelo, los cultivos sufren estrés y su producción puede disminuir.' },
  { type:'order', phase:'ARMA LA CAUSA · 3/3', icon:'🌳', title:'Las acciones humanas cuentan', prompt:'Organiza las tarjetas para mostrar cómo la deforestación aumenta la vulnerabilidad ante una sequía.', instruction:'Busca qué cambio inicia el problema y qué consecuencia deja al final.', cards:[
    ['forest','🌳','Deforestación'],['degrade','🌱','Degradación del suelo'],['retain','💧','Menor retención de humedad'],['risk','🏜️','Mayor vulnerabilidad ante periodos secos']], order:['forest','degrade','retain','risk'], explanation:'Los árboles ayudan a proteger el suelo. Al perderlos, el suelo se degrada y retiene menos humedad cuando llegan periodos secos.' },
  { type:'scenario', phase:'¿QUÉ PASARÍA SI...? · 1/3', icon:'🏙️', title:'NO LLUEVE DURANTE 6 MESES', prompt:'Imagina que eres parte del equipo que abastece una ciudad. ¿Qué señal deberías vigilar primero?', instruction:'Elige la consecuencia más directa para orientar una decisión.', options:[
    ['a','🚿','Baja el nivel de embalses y puede disminuir el suministro de agua',true],['b','🛟','Los embalses se llenan sin lluvia',false],['c','🌊','Los ríos aumentan su caudal',false],['d','🌧️','La lluvia queda garantizada para la próxima semana',false]], explanation:'El agua de embalses, ríos y acuíferos puede disminuir. Identificarlo temprano permite promover ahorro y planificar el abastecimiento.' },
  { type:'scenario', phase:'¿QUÉ PASARÍA SI...? · 2/3', icon:'🌾', title:'LA SEQUÍA DURA UN AÑO MÁS', prompt:'Una familia agricultora debe priorizar una preocupación. ¿Cuál es la más probable?', instruction:'Relaciona la falta prolongada de humedad con una consecuencia real.', options:[
    ['a','📉','Los cultivos pueden reducir su producción o perderse',true],['b','🐟','Los ríos aumentan automáticamente su caudal',false],['c','❄️','Las lluvias se convierten en nevadas abundantes',false],['d','🍅','Las cosechas crecen más sin riego',false]], explanation:'Con poca humedad durante tanto tiempo, las plantas no pueden crecer normalmente. Esto puede afectar alimentos, empleo e ingresos de la comunidad.' },
  { type:'scenario', phase:'¿QUÉ PASARÍA SI...? · 3/3', icon:'🔥', title:'SEQUÍA + OLA DE CALOR', prompt:'Ahora hay sequía y, además, una ola de calor. ¿Qué decisión explica mejor el riesgo de incendios?', instruction:'Elige la conexión científica que hace más urgente actuar.', options:[
    ['a','💨','Más evaporación seca la vegetación y aumenta el material inflamable',true],['b','💧','El calor crea agua nueva para apagar incendios',false],['c','🧊','La temperatura alta congela el suelo',false],['d','🌿','Las plantas necesitan menos agua y se recuperan solas',false]], explanation:'El calor acelera la evaporación y deja vegetación más seca. Por eso el riesgo de incendios puede aumentar y se deben reforzar la prevención y el uso responsable del agua.' }
];

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const item of list || []) {
    if (item.family === 'IPv4' && !item.internal) return item.address;
  }
  return 'localhost';
}
function publicUrl() {
  try { const value=fs.readFileSync(PUBLIC_URL_FILE,'utf8').trim(); return /^https:\/\/[a-z0-9.-]+/i.test(value) ? value : ''; }
  catch { return ''; }
}
function joinUrl() { return publicUrl() || `http://${lanAddress()}:${PORT}`; }
function clean(text, max=22) { return String(text || '').replace(/[<>]/g,'').trim().slice(0,max); }
function roomCode() { let c; do { c=String(Math.floor(100000+Math.random()*900000)); } while(rooms.has(c)); return c; }
function publicQuestion(index) { const q=questions[index]; if(!q)return null; const base={index,total:questions.length,type:q.type,phase:q.phase,icon:q.icon,title:q.title,prompt:q.prompt,instruction:q.instruction,explanation:q.explanation}; return q.type==='order' ? {...base,cards:q.cards.map(([id,icon,text])=>({id,icon,text}))} : {...base,options:q.options.map(([id,icon,text])=>({id,icon,text}))}; }
function hostDetails(room) { const q=questions[room.index]; const answers=[...room.answers.values()]; let results=null; if(room.state==='results'&&q){results=q.type==='order'?{kind:'order',correctOrder:q.order.map(id=>q.cards.find(c=>c[0]===id)).map(([,icon,text])=>({icon,text})),submissions:answers.map(a=>({name:room.players.get(a.playerId)?.name||'Estudiante',correct:a.correct,sequence:a.sequence.map(id=>q.cards.find(c=>c[0]===id)?.[2]).filter(Boolean)}))}:{kind:'scenario',options:q.options.map(([id,icon,text,correct])=>({id,icon,text,correct,count:answers.filter(a=>a.optionId===id).length,names:answers.filter(a=>a.optionId===id).map(a=>room.players.get(a.playerId)?.name).filter(Boolean)}))};} return { type:'host-state', state:room.state, index:room.index, total:questions.length, answers:answers.length, players:room.players.size, results, explanation:q?.explanation||'', leaderboard:[...room.players.values()].map(p=>({name:p.name,score:p.score})).sort((a,b)=>b.score-a.score).slice(0,8) }; }
function send(ws, message) { if (ws && !ws.destroyed) ws.send(JSON.stringify(message)); }
function broadcast(room, message, audience='all') { for (const p of room.players.values()) if (audience==='all'||audience==='players') send(p.ws,message); if (audience==='all'||audience==='host') send(room.host,message); }
function updateHost(room) { send(room.host, hostDetails(room)); }
function lobby(room) { broadcast(room,{type:'lobby',players:[...room.players.values()].map(p=>({name:p.name,score:p.score})),state:room.state}); updateHost(room); }
function beginQuestion(room) { room.index++; room.answers.clear(); if (room.index>=questions.length) { room.state='final'; broadcast(room,{type:'final',leaderboard:hostDetails(room).leaderboard},'all'); return; } room.state='question'; room.startedAt=Date.now(); broadcast(room,{type:'question',question:publicQuestion(room.index)},'all'); updateHost(room); }
function createRoom(ws) { const code=roomCode(); const room={code,host:ws,players:new Map(),index:-1,state:'lobby',answers:new Map(),startedAt:0}; rooms.set(code,room); ws.roomCode=code; ws.role='host'; send(ws,{type:'room-created',code,joinUrl:joinUrl(),questions:questions.length}); lobby(room); }
function findRoom(ws) { return rooms.get(ws.roomCode); }
function handle(ws, msg) {
  const type=msg.type, room=findRoom(ws);
  if (type==='create-room') return createRoom(ws);
  if (type==='join-room') {
    const code=clean(msg.code,6), name=clean(msg.name); const r=rooms.get(code);
    if(!r) return send(ws,{type:'error',message:'No encontramos esa sala. Revisa el código.'});
    if(r.state==='final') return send(ws,{type:'error',message:'Esta partida ya terminó. Pide al presentador un código nuevo.'});
    if(!name) return send(ws,{type:'error',message:'Escribe tu nombre para unirte.'});
    const playerId=crypto.randomBytes(8).toString('hex'); ws.roomCode=code; ws.role='player'; ws.playerId=playerId; r.players.set(playerId,{name,ws,score:0}); send(ws,{type:'joined',name,code,state:r.state}); lobby(r);
    if(r.state==='question') send(ws,{type:'question',question:publicQuestion(r.index)});
    if(r.state==='results') { const q=questions[r.index]; send(ws,{type:'results',questionType:q.type,correctId:q.type==='scenario'?q.options.find(o=>o[3])[0]:null,correctOrder:q.type==='order'?q.order:null}); }
    return;
  }
  if(!room) return send(ws,{type:'error',message:'La conexión a la sala ya no está disponible.'});
  if(type==='start' && ws.role==='host' && room.state==='lobby') return beginQuestion(room);
  if(type==='next' && ws.role==='host' && (room.state==='results'||room.state==='question')) return beginQuestion(room);
  if(type==='reveal' && ws.role==='host' && room.state==='question') { room.state='results'; const q=questions[room.index]; broadcast(room,{type:'results',questionType:q.type,correctId:q.type==='scenario'?q.options.find(o=>o[3])[0]:null,correctOrder:q.type==='order'?q.order:null},'players'); updateHost(room); return; }
  if(type==='answer' && ws.role==='player' && room.state==='question' && !room.answers.has(ws.playerId)) {
    const q=questions[room.index]; let correct=false, optionId=null, sequence=[];
    if(q.type==='order'){sequence=Array.isArray(msg.sequence)?msg.sequence.map(x=>clean(x,20)):[]; if(sequence.length!==q.order.length||new Set(sequence).size!==q.order.length||!sequence.every(id=>q.cards.some(c=>c[0]===id)))return; correct=sequence.every((id,i)=>id===q.order[i]);}
    else {optionId=clean(msg.optionId,2);const valid=q.options.find(o=>o[0]===optionId);if(!valid)return;correct=valid[3];}
    if(correct) room.players.get(ws.playerId).score+=100;
    room.answers.set(ws.playerId,{playerId:ws.playerId,optionId,sequence,correct}); send(ws,{type:'answer-saved',correct}); updateHost(room); return;
  }
}

function makeSocket(socket) {
  socket.readyState=1; socket.buffer=Buffer.alloc(0);
  socket.send=(data)=>{ const payload=Buffer.from(data); const n=payload.length; let header; if(n<126) header=Buffer.from([0x81,n]); else if(n<65536){header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(n,2)} else {header=Buffer.alloc(10);header[0]=0x81;header[1]=127;header.writeBigUInt64BE(BigInt(n),2)} socket.write(Buffer.concat([header,payload])); };
  socket.on('data', chunk=>{ socket.buffer=Buffer.concat([socket.buffer,chunk]); while(socket.buffer.length>=2){const b1=socket.buffer[0],b2=socket.buffer[1],masked=!!(b2&128);let len=b2&127,pos=2;if(len===126){if(socket.buffer.length<4)return;len=socket.buffer.readUInt16BE(2);pos=4}else if(len===127){if(socket.buffer.length<10)return;len=Number(socket.buffer.readBigUInt64BE(2));pos=10}const full=pos+(masked?4:0)+len;if(socket.buffer.length<full)return;const mask=masked?socket.buffer.subarray(pos,pos+4):null;pos+=masked?4:0;let payload=socket.buffer.subarray(pos,pos+len);socket.buffer=socket.buffer.subarray(full);if(mask)payload=Buffer.from(payload.map((v,i)=>v^mask[i%4]));if((b1&15)===8){socket.end();return}if((b1&15)===1){try{handle(socket,JSON.parse(payload.toString()))}catch{send(socket,{type:'error',message:'No se pudo leer esa respuesta.'})}}} });
  // A phone closing its browser should remove only that player, never stop the game server.
  socket.on('error',()=>{});
  socket.on('close',()=>{const room=findRoom(socket);if(!room)return;if(socket.role==='player'){room.players.delete(socket.playerId);lobby(room)}if(socket.role==='host'){setTimeout(()=>{if(room.host===socket)rooms.delete(room.code)},15000)}});
}

const server=http.createServer((req,res)=>{
  if(req.url==='/api/config'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({address:lanAddress(),port:PORT,internetMode:INTERNET_MODE,publicReady:!!publicUrl(),joinUrl:joinUrl()}));}
  if(req.url==='/'||req.url==='/index.html'){fs.readFile(INDEX,(err,data)=>{if(err){res.writeHead(500);res.end('No se encontró index.html')}else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data)}});return}
  res.writeHead(404);res.end('No encontrado');
});
server.on('upgrade',(req,socket)=>{if(req.headers.upgrade!=='websocket'){socket.destroy();return}const key=req.headers['sec-websocket-key'];if(!key){socket.destroy();return}const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');makeSocket(socket);});
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`\nJuego listo. Abre en el TV: http://localhost:${PORT}`);
  if(!INTERNET_MODE) return console.log(`Los alumnos se unen en: http://${lanAddress()}:${PORT}\n`);
  try { fs.unlinkSync(PUBLIC_URL_FILE); } catch {}
  const cloudflared=path.join(__dirname,'cloudflared.exe');
  if(!fs.existsSync(cloudflared)) return console.log('\nFalta cloudflared.exe. Descárgalo desde https://developers.cloudflare.com/tunnel/downloads/ y colócalo junto a server.js.\n');
  console.log('Creando un enlace público temporal para celulares en cualquier red…');
  const tunnel=spawn(cloudflared,['tunnel','--url',`http://localhost:${PORT}`],{windowsHide:true});
  const readTunnel=(data)=>{ const text=data.toString(); const match=text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i); if(match && !publicUrl()){fs.writeFileSync(PUBLIC_URL_FILE,match[0]);console.log(`\nENLACE PÚBLICO LISTO: ${match[0]}\nAhora puedes crear la sala en el TV.\n`);} };
  tunnel.stdout.on('data',readTunnel); tunnel.stderr.on('data',readTunnel);
  tunnel.on('error',()=>console.log('\nNo se pudo iniciar cloudflared.\n'));
});
