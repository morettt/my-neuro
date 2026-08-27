const bar=document.createElement('div');bar.className='window-bar';bar.innerHTML='<div class="window-drag"></div><button class="window-min">−</button><button class="window-close">×</button>';document.body.prepend(bar);
bar.querySelector('.window-min').addEventListener('click',()=>window.installer.minimizeWindow());
bar.querySelector('.window-close').addEventListener('click',()=>window.installer.closeWindow());

const edition='cloud';
const next=document.querySelector('#next');
const installDir=document.querySelector('#install-dir');
// 本地版模块列表暂时停用，保留供以后恢复：
// const modules=['live2d','bert','tts','asr'];
const labels={live2d:'Live2D',bert:'BERT',tts:'TTS',asr:'ASR'};
/* 旧版云端/本地版本选择逻辑，暂时停用：
document.querySelectorAll('.edition').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.edition').forEach(item=>item.classList.remove('selected'));
  button.classList.add('selected');edition=button.dataset.edition;next.disabled=false;
}));
*/
window.installer.getDefaultInstallDir().then(value=>{installDir.value=value}).catch(error=>{installDir.placeholder=error.message});
document.querySelector('#browse-dir').addEventListener('click',async()=>{
  const browse=document.querySelector('#browse-dir');
  browse.disabled=true;
  try{
    const selected=await window.installer.chooseInstallDir(installDir.value);
    if(selected)installDir.value=selected;
  }catch(error){
    window.alert(`无法打开文件夹选择窗口：${error.message}`);
  }finally{browse.disabled=false}
});

function show(id){document.querySelectorAll('.page').forEach(page=>page.classList.toggle('shown',page.id===id));next.hidden=id==='installing';/* 步骤条恢复时重新启用：const current=id==='done'?1:0;document.querySelectorAll('.step').forEach((step,index)=>{step.classList.toggle('active',index===current);step.classList.toggle('done',index<current)}) */}
function makeTrack(){const track=document.querySelector('#module-track');track.innerHTML='<div class="module-line"><span></span></div>';track.hidden=false;track.style.setProperty('--track-progress','0%');track.className='module-track single';const visibleModules=['live2d'];for(const name of visibleModules){const node=document.createElement('div');node.className='module-node pending';node.dataset.module=name;node.innerHTML=`<i><span></span></i><b>${labels[name]}</b><small>等待中</small>`;track.append(node)}}

next.addEventListener('click',async()=>{if(document.querySelector('#done').classList.contains('shown')){window.close();return}if(!installDir.value.trim()){installDir.focus();return}makeTrack();show('installing');await window.installer.start({edition,components:[],installDir:installDir.value.trim()})});
window.installer.onStatus(status=>{
  if(status.type==='progress'){const pct=Math.floor(status.overall);document.querySelector('#module-track').style.setProperty('--track-progress',`${Math.max(0,Math.min(100,status.overall))}%`);document.querySelector('#percent').textContent=`${pct}%`;document.querySelector('#task').textContent=status.label}
  if(status.type==='module-status'){const node=document.querySelector(`[data-module="${status.module}"]`);if(node){node.className=`module-node ${status.status}`;node.querySelector('small').textContent=status.status==='start'?'下载中':status.status==='done'?'已完成':'失败'}}
  if(status.type==='log'){const log=document.querySelector('#log');log.textContent+=status.message+'\n';log.scrollTop=log.scrollHeight}
  if(status.type==='done'){document.querySelector('#done-message').textContent='打开 live-2d 文件夹，双击“肥牛.exe”即可使用。';next.textContent='关闭';next.hidden=false;show('done')}
  if(status.type==='error'){document.querySelector('#done').classList.add('error');document.querySelector('#done-icon').textContent='×';document.querySelector('#done-title').textContent='安装失败';document.querySelector('#done-message').textContent=status.message;next.textContent='关闭';next.hidden=false;show('done')}
});
