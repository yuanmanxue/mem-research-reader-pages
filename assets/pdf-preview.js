'use strict';
// Expand the existing PDF iframe; never move or reload its document.
window.PdfPreview=(()=>{
  let pane,button,note,expanded=false,generation=0,background=[];
  function setExpanded(active){
    if(expanded===active)return;
    expanded=active;document.body.classList.toggle('pdf-preview-expanded',active);
    button.textContent=active?'退出全屏':'全屏阅读';button.setAttribute('aria-pressed',String(active));note.hidden=!active;
    if(active){
      // Keep keyboard focus within the enlarged preview, including the fallback
      // used when the browser does not permit native fullscreen.
      for(let branch=pane;branch.parentElement&&branch!==document.body;branch=branch.parentElement){
        for(const peer of branch.parentElement.children)if(peer!==branch&&!peer.inert){peer.inert=true;background.push(peer);}
      }
    }else{for(const peer of background)peer.inert=false;background=[];}
    if(button.offsetParent!==null)button.focus({preventScroll:true});
  }
  function leaveNative(){
    if(document.fullscreenElement!==pane||!document.exitFullscreen)return;
    try{Promise.resolve(document.exitFullscreen()).catch(()=>{});}catch{}
  }
  function close(){generation++;if(!pane)return;setExpanded(false);leaveNative();}
  function toggle(){
    if(button.hidden)return;
    if(expanded){close();return;}
    const request=++generation;setExpanded(true);
    // Requesting fullscreen keeps this same tab and the native PDF page state.
    // The fixed viewport presentation remains usable if the request is denied.
    try{if(pane.requestFullscreen)Promise.resolve(pane.requestFullscreen()).then(()=>{if(request!==generation||!expanded)leaveNative();}).catch(()=>{});}catch{}
  }
  function init(){
    pane=document.getElementById('document-frame-wrap');button=document.getElementById('pdf-fullscreen');note=document.getElementById('frame-note-text');
    button.addEventListener('click',toggle);
    document.addEventListener('fullscreenchange',()=>{if(expanded&&document.fullscreenElement!==pane)close();});
    document.addEventListener('keydown',event=>{if(expanded&&event.key==='Escape'&&!document.fullscreenElement){event.preventDefault();close();}});
  }
  return {init,close};
})();
