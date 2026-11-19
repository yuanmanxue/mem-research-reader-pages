'use strict';
// Small, keyboard-accessible select presentation. The select remains the value source.
window.ReaderControls=(()=>{
  const widgets=new Map();let opened=null;
  function close(){if(!opened)return;const w=opened;opened=null;w.trigger.setAttribute('aria-expanded','false');w.trigger.removeAttribute('aria-activedescendant');if(w.menu.hidePopover&&w.menu.matches(':popover-open'))w.menu.hidePopover();w.menu.hidden=true;}
  function update(w){
    const selected=w.select.selectedOptions[0];w.trigger.textContent=selected?.textContent||'';w.trigger.disabled=w.select.disabled;
    w.trigger.setAttribute('aria-label',(w.select.getAttribute('aria-label')||'选择')+'：'+w.trigger.textContent);
  }
  function options(w){return [...w.select.options].filter(o=>!o.disabled&&!o.hidden);}
  function highlight(w,index){const all=options(w);w.index=(index+all.length)%all.length;[...w.menu.children].forEach((n,i)=>n.classList.toggle('highlight',i===w.index));const active=w.menu.children[w.index];if(active){w.trigger.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}}
  function choose(w,index){const all=options(w);if(!all[index])return;w.select.value=all[index].value;w.select.dispatchEvent(new Event('change',{bubbles:true}));update(w);close();w.trigger.focus({preventScroll:true});}
  function open(w){
    if(opened===w){close();return;}close();opened=w;w.menu.replaceChildren();
    options(w).forEach((o,i)=>{const b=document.createElement('button');b.type='button';b.className='choice-option';b.id=w.select.id+'-option-'+i;b.setAttribute('role','option');b.setAttribute('aria-selected',String(o.selected));b.tabIndex=-1;b.textContent=o.textContent;if(o.selected){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const mark=document.createElementNS('http://www.w3.org/2000/svg','path');mark.setAttribute('d','M5 12l4 4L19 6');svg.append(mark);b.append(svg);}b.addEventListener('pointerdown',e=>e.preventDefault());b.addEventListener('click',()=>choose(w,i));w.menu.append(b);});
    w.trigger.setAttribute('aria-expanded','true');w.menu.hidden=false;if(w.menu.showPopover)w.menu.showPopover();
    const r=w.trigger.getBoundingClientRect();w.menu.style.minWidth=Math.max(r.width,160)+'px';const height=Math.min(w.menu.scrollHeight,340,innerHeight*.7);const top=r.bottom+6+height>innerHeight?Math.max(8,r.top-height-6):r.bottom+6;w.menu.style.top=top+'px';w.menu.style.left=Math.max(8,Math.min(r.left,innerWidth-w.menu.offsetWidth-8))+'px';
    highlight(w,Math.max(0,options(w).findIndex(o=>o.selected)));
  }
  function refresh(){
    document.querySelectorAll('select[data-choice]').forEach(select=>{
      let w=widgets.get(select);if(!w){
        const wrap=document.createElement('span');wrap.className='choice';select.before(wrap);wrap.append(select);select.hidden=true;select.tabIndex=-1;
        const trigger=document.createElement('button');trigger.type='button';trigger.className='choice-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',select.id+'-menu');wrap.append(trigger);
        const menu=document.createElement('div');menu.id=select.id+'-menu';menu.className='choice-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',select.getAttribute('aria-label')||'选择');menu.hidden=true;menu.setAttribute('popover','manual');document.body.append(menu);
        w={select,trigger,menu,index:0};widgets.set(select,w);trigger.addEventListener('click',()=>open(w));
        trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(e.key)){e.preventDefault();if(opened!==w){open(w);return;}if(e.key==='Enter'||e.key===' '){choose(w,w.index);return;}highlight(w,e.key==='Home'?0:e.key==='End'?options(w).length-1:w.index+(e.key==='ArrowDown'?1:-1));}else if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='Tab')close();});
        select.addEventListener('change',()=>update(w));
      }update(w);
    });
  }
  document.addEventListener('pointerdown',e=>{if(opened?.menu.contains(e.target))return;if(opened&&!opened.trigger.contains(e.target))close();document.querySelectorAll('.filter-panel[open],.reading-settings[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();document.querySelectorAll('.filter-panel[open],.reading-settings[open]').forEach(d=>d.open=false);}});
  window.addEventListener('resize',close);window.addEventListener('scroll',close,{passive:true});
  return {refresh,close};
})();
