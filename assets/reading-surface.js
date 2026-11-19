'use strict';
// Adapt a same-origin preview in memory; leave its HTML, scripts and assets on disk intact.
window.ReadingSurface=(()=>{
  let active=null;
  function destroy(){if(!active)return;active.observer?.disconnect();active.resizeObserver?.disconnect();active.frame.contentWindow?.removeEventListener('resize',active.schedule);active=null;}
  function attach(frame,{prefs,anchor='',onLayout,onLink,onHeadings}){
    destroy();const doc=frame.contentDocument;if(!doc?.body)return null;
    const record={frame,doc,headings:[],observer:null,resizeObserver:null,schedule:null,signature:'',ready:false,stylesReady:false,fontsReady:false};active=record;
    const staticReport=Boolean(doc.querySelector('main.report'));
    doc.body.classList.add(staticReport?'reader-static':'reader-generic');
    let css=doc.getElementById('reader-adapter-css');
    if(!css){css=doc.createElement('link');css.id='reader-adapter-css';css.rel='stylesheet';css.href=ReaderStatic.basePath+'assets/embedded.css';css.addEventListener('load',()=>{record.stylesReady=true;record.schedule?.();});css.addEventListener('error',()=>{record.stylesReady=true;record.schedule?.();});doc.head.append(css);}else record.stylesReady=Boolean(css.sheet);
    const firstTitle=doc.querySelector('h1');if(firstTitle)firstTitle.classList.add('reader-hidden-heading');
    // Generic reports can contain real tabs/search; retain those controls.
    if(!staticReport){
      const chrome=doc.querySelector('body>header');if(chrome){const tools=doc.createElement('details');tools.className='reader-original-tools';const summary=doc.createElement('summary');summary.textContent='原报告工具';tools.append(summary);chrome.before(tools);tools.append(chrome);}
      const navigation=doc.querySelector('body>aside,.shell>aside,.layout>aside');
      if(navigation){const tools=doc.createElement('details');tools.className='reader-original-tools';const summary=doc.createElement('summary');summary.textContent=navigation.querySelector('[role="tablist"]')?'章节与视图':'原报告目录';tools.append(summary);const main=doc.querySelector('main');main?.before(tools);tools.append(navigation);navigation.classList.add('reader-original-navigation');}
    }
    frame.setAttribute('scrolling','no');
    const api={
      updatePrefs(next){doc.documentElement.style.setProperty('--reader-size',next.size+'px');doc.documentElement.style.setProperty('--reader-font',next.font==='sans'?'"PingFang SC","Microsoft YaHei",sans-serif':'"Songti SC","STSong","SimSun",serif');record.schedule?.();},
      headings(){return record.headings;},
      top(element){return scrollY+frame.getBoundingClientRect().top+element.getBoundingClientRect().top;},
      find(id){return doc.getElementById(id);},
      jump(id,behavior='auto'){const target=doc.getElementById(id);if(!target)return false;frame.contentWindow.scrollTo(0,0);window.scrollTo({top:Math.max(0,api.top(target)-76),behavior});return true;},
      resize(){record.schedule?.();}
    };
    let queued=false;
    record.schedule=()=>{if(queued||active!==record||frame.offsetParent===null||!record.stylesReady||!record.fontsReady)return;queued=true;requestAnimationFrame(()=>{queued=false;if(active!==record||frame.offsetParent===null)return;
      const height=Math.ceil(Math.max(doc.body.scrollHeight,doc.body.getBoundingClientRect().height))+3;
      if(height>0&&Math.abs(frame.offsetHeight-height)>2)frame.style.height=height+'px';
      let n=0;record.headings=[...doc.querySelectorAll('h2,h3')].filter(h=>h.textContent.trim()&&h.getClientRects().length).map(h=>{if(!h.id)h.id='reader-section-'+(++n);return h;});
      const signature=record.headings.map(h=>h.id+':'+h.textContent).join('|');if(signature!==record.signature){record.signature=signature;onHeadings?.(record.headings,api);}
      onLayout?.(api);if(!record.ready){record.ready=true;if(anchor)requestAnimationFrame(()=>api.jump(anchor));}
    });};
    record.resizeObserver=new ResizeObserver(record.schedule);record.resizeObserver.observe(doc.body);
    record.observer=new MutationObserver(record.schedule);record.observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open','class','style']});
    doc.querySelectorAll('img').forEach(img=>{img.addEventListener('load',record.schedule);img.addEventListener('error',record.schedule);});
    doc.addEventListener('toggle',record.schedule,true);
    doc.addEventListener('click',event=>{const a=event.target.closest('a');if(!a)return;const raw=a.getAttribute('href');if(!raw)return;const u=new URL(a.href,doc.baseURI);if(u.origin===location.origin&&u.pathname===new URL(doc.URL).pathname&&u.hash){event.preventDefault();api.jump(decodeURIComponent(u.hash.slice(1)),matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth');return;}if(u.origin===location.origin&&u.pathname.startsWith(ReaderStatic.basePath+'files/')&&/\.(md|html|pdf)$/i.test(u.pathname)&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.button===0){event.preventDefault();onLink?.(decodeURIComponent(u.pathname.slice((ReaderStatic.basePath+'files/').length)),decodeURIComponent(u.hash.slice(1)));}});
    frame.contentWindow.addEventListener('resize',record.schedule);Promise.resolve(doc.fonts?.ready).then(()=>{record.fontsReady=true;record.schedule();});api.updatePrefs(prefs);record.schedule();return api;
  }
  return {attach,destroy};
})();
