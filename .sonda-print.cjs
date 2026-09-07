require('./desktop/main.cjs');
const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const S = process.env.SONDA_SAIDA;
const log = (...x) => process.stdout.write('SONDA ' + x.join(' ') + '\n');
const ANIM = 'data:text/html,' + encodeURIComponent(`<style>html,body{margin:0;background:#123}
canvas{width:100vw;height:100vh;display:block}</style><canvas id=c></canvas><script>
const c=document.getElementById('c');c.width=1280;c.height=720;const x=c.getContext('2d');let t=0;
function f(){t++;x.fillStyle='#123';x.fillRect(0,0,1280,720);
for(let i=0;i<160;i++){x.fillStyle='hsl('+((i*9+t*2)%360)+',80%,60%)';
x.fillRect((i*97+t*9)%1280,(i*53+t*5)%720,50,50);}
x.fillStyle='#fff';x.font='36px monospace';x.fillText('tela de teste '+t,40,80);requestAnimationFrame(f);}f();</script>`);
app.whenReady().then(async () => {
  await new Promise(r=>setTimeout(r,3000));
  session.defaultSession.setDisplayMediaRequestHandler(async (_p, cb) => {
    const [f] = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{width:0,height:0} });
    cb(f ? { video: f } : undefined);
  });
  const anim = new BrowserWindow({ width: 1280, height: 720, show: true, frame: false });
  await anim.loadURL(ANIM);
  const mk = async n => { const w = new BrowserWindow({width:1180,height:800,show:true,
    webPreferences:{contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'desktop','ponte.cjs')}});
    await w.loadURL('http://localhost:3000');
    await w.webContents.executeJavaScript(`document.getElementById('resolucao-tela').value='1080p';document.getElementById('nome').value='${n}';document.getElementById('form-entrar').requestSubmit();`, true);
    return w; };
  const A = await mk('ana'); await new Promise(r=>setTimeout(r,900));
  const B = await mk('beto'); await new Promise(r=>setTimeout(r,1200));
  await A.webContents.executeJavaScript(`document.getElementById('btn-tela').click()`, true);
  await new Promise(r=>setTimeout(r,14000));
  A.focus(); await new Promise(r=>setTimeout(r,400));
  await A.webContents.executeJavaScript(`document.getElementById('btn-conexao').click()`, true);
  await new Promise(r=>setTimeout(r,3000));
  const estado = await A.webContents.executeJavaScript(`(()=>{
    const p = document.getElementById('painel-conexao');
    return JSON.stringify({aberto: !p.hidden && getComputedStyle(p).display !== 'none',
      texto: (document.getElementById('conexao-lista')||{}).innerText,
      botao: document.getElementById('btn-conexao').getAttribute('aria-expanded')});})()`, true);
  log('painel:', estado);
  fs.writeFileSync(path.join(S, 'painel-conexao.png'), (await A.webContents.capturePage()).toPNG());
  log('print salvo');
  app.exit(0);
});
