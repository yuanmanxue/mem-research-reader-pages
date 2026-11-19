'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const readStore = (key, fallback) => {try {return JSON.parse(localStorage.getItem('thesis-reader:'+key)) ?? fallback;} catch {return fallback;}};
  const writeStore = (key, value) => {try {localStorage.setItem('thesis-reader:'+key, JSON.stringify(value));} catch {}};
  const state = {catalog:null, category:'all', view:'recommended', q:'', special:'', limit:24,facets:{kind:'all',language:'all',reading:'all',value:'all',topic:'all'},
    favorites:readStore('favorites',[]), history:readStore('history',[]), positions:readStore('positions',{}),
    prefs:readStore('prefs',{size:18,font:'serif'}), current:null, currentVersion:null, pdfReturn:null, loading:false,librarySnapshot:history.state?.library||readStore('librarySnapshot',null),framePath:null,frameVersion:null,currentType:null};
  let toastTimer, searchTimer, scrollTimer, syncBusy=false, docRequest=0,frameAPI=null,pendingPosition=null,readyAnchor='';
  history.scrollRestoration='manual';
  const labels = {literature:'文献研读',historical:'论文研读与范文',originals:'全部论文原文','degree-papers':'学位论文','journal-papers':'期刊论文','proposal-journals':'选题报告引用期刊',methods:'方法与研究设计',analysis:'案例与分析成果',figures:'图表与流程',writing:'文稿与评审',project:'项目与索引'};
  const categoryIcons={literature:'notebook',historical:'archive',originals:'files','degree-papers':'graduation','journal-papers':'journal','proposal-journals':'journal',methods:'compass',analysis:'chart',figures:'flow',writing:'pen',project:'folder'};
  const dates = value => new Date(value).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}).replace(/\//g,'.');
  const docURL = path => ReaderStatic.basePath+'?doc='+encodeURIComponent(path);
  const sourceURL = reference => {const [path,anchor]=reference.split('#');return ReaderStatic.basePath+'files/'+path.split('/').map(encodeURIComponent).join('/')+(anchor?'#'+encodeURIComponent(anchor):'');};
  const libraryURL = () => {const p=new URLSearchParams();if(state.category!=='all')p.set('category',state.category);for(const [key,value] of Object.entries(state.facets))if(value!=='all')p.set(key,value);if(state.q)p.set('q',state.q);if(state.special)p.set('shelf',state.special);if(state.view!=='all')p.set('view',state.view);if($('sort')?.value!=='recommended')p.set('sort',$('sort').value);if($('unindexed')?.checked)p.set('unindexed','1');return ReaderStatic.basePath+(p.size?'?'+p.toString():'');};
  const paperCollection = () => ['originals','degree-papers','journal-papers'].includes(state.category);
  const defaultSort = () => paperCollection()?'value':'recommended';
  function resetFacets(){state.facets={kind:'all',language:'all',reading:'all',value:'all',topic:'all'};}
  function loadFacets(params){state.facets={kind:state.catalog.paper_types.some(x=>x.id===params.get('kind'))?params.get('kind'):'all',language:state.catalog.languages.some(x=>x.id===params.get('language'))?params.get('language'):'all',reading:['linked','unlinked'].includes(params.get('reading'))?params.get('reading'):'all',value:(state.catalog.reference_levels||[]).some(x=>x.id===params.get('value'))?params.get('value'):'all',topic:(state.catalog.reference_topics||[]).includes(params.get('topic'))?params.get('topic'):'all'};}
  function paperBadges(item){const types=(item.paper_types||[]).map(id=>state.catalog.paper_types.find(t=>t.id===id)?.label).filter(Boolean);const languages=(item.languages||[]).map(id=>state.catalog.languages.find(l=>l.id===id)?.label).filter(Boolean);return [...types.slice(0,2),...(types.length>2?['多种文献类型']:[]),...languages,...(item.type==='pdf'?[item.has_reading_record?'有研读关联':'仅收录原文']:[]),...(item.reference?[item.reference.label,...item.reference.topics]:[])].map(label=>`<span title="${esc(item.label_basis||'语言指原文语言，非阅读笔记语言')}">${esc(label)}</span>`).join('');}
  // CommonMark punctuation boundaries can leave Chinese **emphasis** literal.
  // An inline token keeps code spans/blocks intact and supports Chinese prose.
  marked.use({extensions:[{name:'cjkStrong',level:'inline',start(src){return src.indexOf('**');},
    tokenizer(src){const m=/^\*\*(?=\S)([^\n]+?\S)\*\*/.exec(src);if(m)return {type:'cjkStrong',raw:m[0],tokens:this.lexer.inlineTokens(m[1])};},
    renderer(token){return '<strong>'+this.parser.parseInline(token.tokens)+'</strong>';}}]});
  const itemFor = path => state.catalog?.items.find(x => x.path===path);

  function captureLibrary(){const row=[...$('cards').querySelectorAll('.card')].find(el=>{const r=el.getBoundingClientRect();return r.bottom>130&&r.top<innerHeight;});const first=row?.querySelector('h3 a');return {anchor:first?.dataset.doc||'',offset:row?.getBoundingClientRect().top||0,category:state.category,view:state.view,q:state.q,special:state.special,facets:{...state.facets},limit:state.limit,sort:$('sort').value,sortVersion:1,unindexed:$('unindexed').checked,scroll:scrollY};}
  function rememberLibrary(){state.librarySnapshot=captureLibrary();writeStore('librarySnapshot',state.librarySnapshot);history.replaceState({library:state.librarySnapshot},'',libraryURL());}
  function applyLibrary(saved){if(!saved)return;state.category=saved.category||'all';state.view=saved.view||'all';state.q=saved.q||'';state.special=saved.special||'';state.facets={kind:'all',language:'all',reading:'all',value:'all',topic:'all',...saved.facets};state.limit=saved.limit||24;$('search').value=state.q;$('sort').value=(!saved.sortVersion&&paperCollection()&&saved.sort==='recommended')?'value':saved.sort||defaultSort();$('unindexed').checked=Boolean(saved.unindexed);}
  function routeLibrary(params){const c=params.get('category');state.category=state.catalog.categories.some(x=>x.id===c)?c:'all';loadFacets(params);state.q=params.get('q')||'';state.special=['favorites','recent'].includes(params.get('shelf'))?params.get('shelf'):'';state.view=['recommended','fortnight'].includes(params.get('view'))?params.get('view'):'all';state.limit=24;$('search').value=state.q;$('sort').value=['value','recommended','updated','title'].includes(params.get('sort'))?params.get('sort'):defaultSort();$('unindexed').checked=params.has('unindexed');}
  function readingHeadings(){return state.currentType==='html'?(frameAPI?.headings()||[]):[...$('document-body').querySelectorAll('h2,h3')];}
  function headingTop(h){return state.currentType==='html'?frameAPI.top(h):scrollY+h.getBoundingClientRect().top;}
  function savePosition(){if(!state.current)return;const headings=readingHeadings();let nearest;for(const h of headings)if(headingTop(h)<scrollY+110)nearest=h;const pos={scroll:scrollY,width:document.documentElement.clientWidth,version:state.currentVersion,anchor:nearest?.id||'',offset:nearest?scrollY-headingTop(nearest):0};state.positions[state.current]=pos;writeStore('positions',state.positions);}
  function restorePosition(){if(!pendingPosition||pendingPosition.path!==state.current)return;let target=pendingPosition.scroll||0;const id=pendingPosition.anchor;const h=id&&(state.currentType==='html'?frameAPI?.find(id):document.getElementById(id));if(h&&((pendingPosition.width&&pendingPosition.width!==document.documentElement.clientWidth)||(pendingPosition.version&&pendingPosition.version!==state.currentVersion)))target=Math.max(0,headingTop(h)+(pendingPosition.offset||0));const max=document.documentElement.scrollHeight-innerHeight;if(max+4<target&&state.currentType==='html')return;window.scrollTo({top:target,behavior:'instant'});pendingPosition=null;}
  function saveBeforeNavigation(){clearTimeout(scrollTimer);savePosition();if(!state.current&&!new URLSearchParams(location.search).has('doc'))rememberLibrary();ReaderControls.close();}
  function renderToc(headings){$('toc-links').innerHTML=headings.slice(0,110).map(h=>`<a href="#${encodeURIComponent(h.id)}" data-anchor-only="${esc(h.id)}" class="${h.tagName==='H3'?'level3':''}">${esc(h.textContent)}</a>`).join('');$('reader-toc').hidden=!headings.length;}
  function setLibraryAddress(){history.replaceState({library:captureLibrary()},'',libraryURL());}

  function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,2700); }
  async function api(path) {return ReaderStatic.request(path);}
  function savePrefs() {writeStore('prefs',state.prefs);document.documentElement.style.setProperty('--read-size',state.prefs.size+'px');document.documentElement.style.setProperty('--reading-font',state.prefs.font==='sans'?'"PingFang SC","Microsoft YaHei",sans-serif':'"Songti SC","STSong","SimSun",serif');$('font-family').value=state.prefs.font;$('font-size-label').textContent=state.prefs.size;frameAPI?.updatePrefs(state.prefs);ReaderControls.refresh();}
  function toggleFavorite(path) {state.favorites=state.favorites.includes(path)?state.favorites.filter(x=>x!==path):[...state.favorites,path];writeStore('favorites',state.favorites);$('favorite-count').textContent=state.favorites.length;renderCards();updateReaderStar();}
  function updateReaderStar() {const yes=state.favorites.includes(state.current);$('reader-star').innerHTML=icon('star')+(yes?' 已收藏':' 收藏');$('reader-star').setAttribute('aria-pressed',String(yes));}
  function matchesCategory(item, category){
    if(category==='all')return true;
    const collection=state.catalog.categories?.find(x=>x.id===category);
    if(collection?.collection)return item.collections?.includes(category)||false;
    return collection?.paper_type?item.type==='pdf'&&item.paper_types?.includes(collection.paper_type):item.category===category;
  }
  function updateNav() {
    const count = category => state.catalog.items.filter(x=>matchesCategory(x,category)).length;
    const scroll=$('sidebar-scroll').scrollTop;
    $('category-nav').innerHTML=`<a href="${ReaderStatic.basePath}" class="nav-item" data-category="all">${icon('grid')}<span>全部资料</span><small>${count('all')}</small></a>`+
      state.catalog.categories.map(x=>`<a href="${ReaderStatic.basePath}?category=${x.id}" class="nav-item${x.parent?' nav-subitem':''}" data-category="${x.id}">${icon(categoryIcons[x.id]||'folder')}<span>${esc(x.label)}</span><small>${count(x.id)}</small></a>`).join('');
    document.querySelectorAll('[data-category]').forEach(b=>{const active=b.dataset.category===state.category&&!state.special;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    $('sidebar-scroll').scrollTop=scroll;
    $('favorites').classList.toggle('active',state.special==='favorites');$('recent').classList.toggle('active',state.special==='recent');
    $('favorites').setAttribute('aria-pressed',String(state.special==='favorites'));$('recent').setAttribute('aria-pressed',String(state.special==='recent'));
    $('favorite-count').textContent=state.favorites.length;
  }
  function chooseCategory(category){saveBeforeNavigation();state.category=category;state.special='';state.limit=24;state.view='all';state.q='';resetFacets();$('sort').value=defaultSort();$('search').value='';$('unindexed').checked=false;showLibrary(true,{restore:false});updateNav();document.querySelector(`[data-category="${category}"]`)?.focus({preventScroll:true});}
  function chooseShelf(shelf){saveBeforeNavigation();state.special=shelf;state.category='all';resetFacets();$('sort').value='recommended';state.view='all';state.q='';state.limit=24;$('search').value='';$('unindexed').checked=false;showLibrary(true,{restore:false});}
  function filteredItems({ignoreValue=false}={}) {
    const terms=state.q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let items=state.catalog.items.filter(x=>
      matchesCategory(x,state.category)&&
      (!state.facets||state.facets.kind==='all'||x.paper_types?.includes(state.facets.kind))&&
      (!state.facets||state.facets.language==='all'||x.languages?.includes(state.facets.language))&&
      (!state.facets||state.facets.reading==='all'||x.type==='pdf'&&(state.facets.reading==='linked'?x.has_reading_record:!x.has_reading_record))&&
      (ignoreValue||!state.facets?.value||state.facets.value==='all'||(x.reference?.level||'unassessed')===state.facets.value)&&
      (!state.facets?.topic||state.facets.topic==='all'||x.reference?.topics?.includes(state.facets.topic))&&
      (!state.special||state.special==='favorites'&&state.favorites.includes(x.path)||state.special==='recent'&&state.history.some(h=>h.path===x.path))&&
      (!terms.length||terms.every(q=>(x.title+' '+x.summary+' '+x.search_text+' '+x.tags.join(' ')+' '+(x.reference?.reason||'')+' '+(x.reference?.label||'')).toLocaleLowerCase().includes(q)))&&
      (!$('unindexed').checked||!x.indexed));
    if(!state.q&&!state.special&&!$('unindexed').checked&&state.view==='recommended')items=items.filter(x=>x.featured);
    if(state.view==='fortnight')items=items.filter(x=>Date.now()-new Date(x.modified).getTime()<14*86400000);
    const sort=$('sort').value;
    items.sort((a,b)=>{
      if(state.special==='recent')return state.history.findIndex(x=>x.path===a.path)-state.history.findIndex(x=>x.path===b.path);
      if(sort==='updated'||state.view==='fortnight')return new Date(b.modified)-new Date(a.modified);
      if(sort==='title')return a.title.localeCompare(b.title,'zh-CN');
      if(state.category==='proposal-journals'&&sort==='recommended')return a.citation.number-b.citation.number;
      if(sort==='value')return (a.reference?.rank??3)-(b.reference?.rank??3)||(a.reference?.order??999)-(b.reference?.order??999)||a.title.localeCompare(b.title,'zh-CN');
      return a.order-b.order||a.title.localeCompare(b.title,'zh-CN');
    });return items;
  }
  function listMetadata(item){
    const bits=[];const collection=state.catalog.categories.find(x=>x.id===state.category);
    if(state.category==='proposal-journals'&&item.citation)bits.push('参考文献 ['+item.citation.number+']', item.citation.publication);
    if(state.category==='all')bits.push(labels[item.category]);
    if(item.paper_id&&item.type!=='pdf')bits.push(item.kind);if(item.publication&&state.category!=='proposal-journals')bits.push(item.publication);
    if(item.type==='pdf'&&!collection?.paper_type&&item.paper_types?.length===1)bits.push(state.catalog.paper_types.find(x=>x.id===item.paper_types[0])?.label);
    if(state.facets.language==='all'&&item.languages?.length===1&&item.kind!=='索引 / 主表')bits.push(state.catalog.languages.find(x=>x.id===item.languages[0])?.label);
    if(state.view==='fortnight')bits.push('更新 '+dates(item.modified));
    return [...new Set(bits.filter(Boolean))].map(esc).join('<span aria-hidden="true">·</span>');
  }
  function importantNotice(item){return item.notice||item.originals?.find(s=>s.notice)?.notice||(item.paper_types?.includes('unknown')?'文献类型待核':'');}
  function readingLink(item, className='card-reading'){
    const reading=item.reading;if(!reading)return '';
    return `<a class="${className}" href="${docURL(reading.path)}${reading.anchor?'#'+encodeURIComponent(reading.anchor):''}" data-doc="${esc(reading.path)}" data-source-anchor="${esc(reading.anchor||'')}" title="${esc(reading.title||'中文研读')}" aria-label="${esc(reading.label||'中文研读')}：${esc(item.title)}">${esc(reading.label||'中文研读')} ${icon('arrow')}</a>`;
  }
  function translationLink(item, className='card-reading'){
    const translation=item.translation;if(!translation)return '';
    return `<a class="${className}" href="${docURL(translation.path)}" data-doc="${esc(translation.path)}" title="${esc(translation.title||'全文中文译文')}" aria-label="全文译文：${esc(item.title)}">全文译文 ${icon('arrow')}</a>`;
  }
  function originalFileActions(item){if(item.type!=='pdf')return '';return `<span class="paper-file-actions"><a class="file-action" href="${sourceURL(item.path)}" download>下载原文</a></span>`;} 
  async function revealOriginal(button){
    if(button.disabled)return;button.disabled=true;
    try{const response=await fetch('/api/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:button.dataset.reveal})});const data=await response.json();if(!response.ok)throw Error(data.error||'暂时无法定位原文');toast('已在文件夹中定位原文：'+data.filename);}
    catch(error){toast(error.message);}finally{button.disabled=false;}
  }
  function translatedTitle(item){
    if(!item.title_zh||item.title_zh===item.title)return '';
    return `<p class="translated-title-line" lang="zh-CN">${esc(item.title_zh)}</p>`;
  }
  function referenceCard(item){
    if(state.category==='proposal-journals'&&item.citation){const c=item.citation;return `<p class="reference-reason">正文位置：${esc(c.location)}。${esc(c.use)}</p><a class="text-button" href="https://doi.org/${encodeURI(c.doi)}" target="_blank" rel="noopener noreferrer">出版来源 ${icon('arrow')}</a>`;}
    if(item.type!=='pdf')return '';
    const r=item.reference||{level:'unassessed',label:'待评估',topics:[],reason:'尚无针对当前方向的阅读评价。'};
    const badge=`<span class="value-badge value-${esc(r.level)}">${esc(r.label)}</span>`;
    const topics=(r.topics||[]).map(t=>`<button type="button" class="topic-tag" data-paper-topic="${esc(t)}" aria-label="筛选研究主题：${esc(t)}">${esc(t)}</button>`).join('');
    const evidence=r.evidence_path?`<details class="reference-evidence"><summary>参考依据</summary><div><p>${esc(r.reading_scope||'阅读范围见原笔记。')}</p>${r.limit?`<p>${esc(r.limit)}</p>`:''}<a href="${docURL(r.evidence_path.split('#')[0])+(r.evidence_path.includes('#')?'#'+encodeURIComponent(r.evidence_path.split('#')[1]):'')}" data-local-path="${esc(r.evidence_path.split('#')[0])}" data-anchor="${esc(r.evidence_path.split('#')[1]||'')}">查看研读判断与来源 →</a></div></details>`:'';
    return `<div class="reference-tags">${badge}${topics}</div><p class="reference-reason">${esc(r.reason)}</p>${evidence}`;
  }
  function renderReferenceFilters(){
    $('reference-tools').hidden=!paperCollection();
    $('paper-topic').value=state.facets.topic||'all';
    if(!paperCollection())return;
    const candidates=filteredItems({ignoreValue:true});
    const levels=[{id:'all',label:'全部价值层级'},...(state.catalog.reference_levels||[])];
    $('reference-tabs').innerHTML=levels.map(x=>{
      const count=x.id==='all'?candidates.length:candidates.filter(p=>(p.reference?.level||'unassessed')===x.id).length;
      return `<button type="button" data-value="${x.id}" aria-pressed="${String(state.facets.value===x.id)}">${esc(x.label)}<span>${count}</span></button>`;
    }).join('');
  }
  function renderCards(){
    if(!state.catalog)return;const items=filteredItems();const collection=state.catalog.categories.find(x=>x.id===state.category);const isHome=state.category==='all'&&!state.special&&!state.q;
    if(!state.current)$('breadcrumb').innerHTML='研究资料 <span>/</span> '+esc(state.special==='favorites'?'收藏':state.special==='recent'?'最近打开':state.category==='all'?'资料库':labels[state.category]);
    $('page-title').textContent=state.special==='favorites'?'收藏的资料':state.special==='recent'?'最近打开':state.category==='all'?'全部资料':labels[state.category];
    $('page-description').hidden=state.category!=='proposal-journals';
    $('page-description').textContent=state.category==='proposal-journals'?collection.description:'';
    $('sort').querySelector('option[value="recommended"]').textContent=state.category==='proposal-journals'?'引用顺序':'阅读顺序';
    $('paper-kind-label').hidden=Boolean(collection?.paper_type);$('paper-reading-label').hidden=!['originals','degree-papers','journal-papers','all'].includes(state.category);
    $('paper-kind').value=state.facets.kind;$('paper-language').value=state.facets.language;$('paper-reading').value=state.facets.reading;
    $('language-tabs').hidden=!['all','originals','degree-papers','journal-papers','proposal-journals','literature','historical','methods'].includes(state.category);
    document.querySelectorAll('[data-language]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.language===state.facets.language));if(b.dataset.language==='unknown')b.hidden=!state.catalog.items.some(x=>x.languages?.includes('unknown'));});
    document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===state.view);b.setAttribute('aria-pressed',String(b.dataset.view===state.view));});
    renderReferenceFilters();
    $('featured').hidden=true;$('results-count').textContent=items.length+' 份资料';
    const n=Number(state.facets.kind!=='all')+Number(state.facets.reading!=='all')+Number($('unindexed').checked)+Number(state.facets.topic!=='all');$('filter-count').hidden=!n;$('filter-count').textContent=n||'';
    const listKey=JSON.stringify([state.catalog.revision,state.category,state.view,state.q,state.special,state.facets,state.limit,$('sort').value,$('unindexed').checked,state.favorites]);
    if(state.listRenderKey!==listKey){state.listRenderKey=listKey;$('cards').innerHTML=items.slice(0,state.limit).map(x=>{const available=x.originals?.filter(s=>s.status==='available')||[];const source=available.length===1?available[0]:null;const notice=importantNotice(x);const meta=listMetadata(x);return `<article class="card"><div class="card-info"><h3><a href="${docURL(x.path)}" data-doc="${esc(x.path)}" title="${esc(x.title)}">${esc(x.title.replace(/\s+·\s+/g,' '))}</a></h3>${translatedTitle(x)}${meta||notice?`<div class="card-meta">${meta}${notice?`<span class="status">${esc(notice.includes('不采用')?'不采用':notice)}</span>`:''}</div>`:''}${referenceCard(x)}${x.type!=='pdf'?`<p class="card-summary">${esc(x.summary.slice(0,125))}${x.summary.length>125?'…':''}</p>`:''}</div><div class="card-actions">${originalFileActions(x)}${translationLink(x)}${readingLink(x)}${source?`<a class="card-open" href="${docURL(source.path)}" data-doc="${esc(source.path)}" data-source-anchor="${esc(source.anchor)}" aria-label="查看 ${esc(x.title)} 的论文原文"><span class="open-label">原文</span>${icon('arrow')}</a>`:''}<button class="star-button ${state.favorites.includes(x.path)?'saved':''}" data-star="${esc(x.path)}" aria-label="${state.favorites.includes(x.path)?'取消收藏':'收藏'} ${esc(x.title)}" aria-pressed="${state.favorites.includes(x.path)}">${icon('star')}</button></div></article>`;}).join('');}
    $('empty').hidden=items.length>0;$('load-more').hidden=items.length<=state.limit;
    const last=state.history.find(x=>itemFor(x.path));$('continue-reading').hidden=!last||!isHome;
    if(last)$('continue-reading').innerHTML=`${icon('book')}<span>继续阅读</span><a href="${docURL(last.path)}" data-doc="${esc(last.path)}">${esc(itemFor(last.path).title)}</a>`;
    ReaderControls.refresh();
  }
  function showLibrary(push=true,{restore=true}={}){
    PdfPreview.close();
    if(state.current)savePosition();docRequest++;state.current=null;state.currentType=null;pendingPosition=null;
    const saved=restore?state.librarySnapshot:null;if(saved)applyLibrary(saved);
    $('library-view').hidden=false;$('reader-view').hidden=true;$('document-update').hidden=true;$('error').hidden=true;document.body.classList.remove('html-reading','pdf-reading','focus-reading','nav-open');$('focus-mode').setAttribute('aria-pressed','false');
    ReaderControls.close();const priorListKey=state.listRenderKey;renderCards();const reused=priorListKey===state.listRenderKey;updateNav();document.title='论文研究资料阅读台';
    if(push)history.pushState({library:saved||captureLibrary()},'',libraryURL());
    requestAnimationFrame(()=>{const a=saved?.anchor&&[...$('cards').querySelectorAll('h3 a')].find(el=>el.dataset.doc===saved.anchor);if(a&&!reused){a.closest('.card').scrollIntoView({block:'start',behavior:'instant'});window.scrollBy({top:-(saved.offset||0),behavior:'instant'});}else window.scrollTo({top:saved?.scroll||0,behavior:'instant'});if(a)a.focus({preventScroll:true});});
  }

  function normalize(path){const parts=[];for(const p of path.replace(/\\/g,'/').split('/')){if(!p||p==='.')continue;if(p==='..'){if(!parts.length)throw Error('来源超出项目目录');parts.pop();}else parts.push(p);}return parts.join('/');}
  function localTarget(raw, base){
    if(!raw)return null;
    if(raw.startsWith('#'))return {path:base,anchor:decodeURIComponent(raw.slice(1))};
    if(/^(https?:|mailto:|tel:)/i.test(raw))return {external:raw};
    if(/^[a-z][a-z0-9+.-]*:/i.test(raw)&&!raw.startsWith('file:'))return null;
    let value=raw.replace(/^file:\/\//,'');let [p,hash]=value.split('#');p=decodeURIComponent(p.split('?')[0]);
    if(p.startsWith(ReaderStatic.basePath+'files/'))p=p.slice((ReaderStatic.basePath+'files/').length);
    else if(p.startsWith('/Users/')){const marker='/毕业论文/';if(!p.includes(marker))return null;p=p.split(marker).slice(1).join(marker);}
    else if(!p.startsWith('/'))p=base.split('/').slice(0,-1).join('/')+'/'+p;
    else p=p.slice(1);
    try{return {path:normalize(p),anchor:decodeURIComponent(hash||'')};}catch{return null;}
  }
  function sanitize(html){
    const fragment=new DOMParser().parseFromString(html,'text/html');
    const permitted=new Set('p h1 h2 h3 h4 h5 h6 a ul ol li blockquote pre code em strong del table thead tbody tfoot tr th td hr br img details summary sup sub span div input label dl dt dd kbd mark figure figcaption'.split(' '));
    fragment.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,svg,math,template').forEach(n=>n.remove());
    for(const node of [...fragment.body.querySelectorAll('*')]){
      if(!permitted.has(node.localName)){node.replaceWith(...node.childNodes);continue;}
      for(const a of [...node.attributes])if(!['href','src','alt','title','id','colspan','rowspan','start','type','checked','disabled','open'].includes(a.name))node.removeAttribute(a.name);
      if(node.localName==='input'){node.type='checkbox';node.disabled=true;}
      if(node.localName==='a'){
        const target=localTarget(node.getAttribute('href'),state.current.split('#')[0]);
        if(!target){node.removeAttribute('href');continue;}
        if(target.external){node.href=target.external;node.target='_blank';node.rel='noopener noreferrer';}
        else{node.href=docURL(target.path)+(target.anchor?'#'+encodeURIComponent(target.anchor):'');node.dataset.localPath=target.path;node.dataset.anchor=target.anchor;}
      }
      if(node.localName==='img'){
        const src=node.getAttribute('src')||'';const target=localTarget(src,state.current.split('#')[0]);
        if(/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src))continue;
        if(target?.external&&/^https?:/i.test(target.external)){node.src=target.external;node.referrerPolicy='no-referrer';}
        else if(target?.path)node.src=sourceURL(target.path);
        else node.removeAttribute('src');
        node.loading='lazy';
      }
    }return fragment.body.innerHTML;
  }
  function slug(text){return text.toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}_\-\s]/gu,'').replace(/\s+/g,'-');}
  function prepareDocument(){const body=$('document-body');body.querySelector('h1')?.remove();const ids=new Set([...body.querySelectorAll('[id]')].map(x=>x.id));const headings=[...body.querySelectorAll('h2,h3,h4')];for(const h of headings){if(!h.id){let id=slug(h.textContent)||'section',n=1,unique=id;while(ids.has(unique))unique=id+'-'+n++;h.id=unique;ids.add(unique);}}renderToc(headings.filter(h=>h.tagName!=='H4'));body.querySelectorAll('table').forEach(t=>{const wrap=document.createElement('div');wrap.className='table-scroll';t.before(wrap);wrap.append(t);});}
  function jumpAnchor(anchor){pendingPosition=null;const behavior=matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';if(state.currentType==='html')return frameAPI?.jump(anchor,behavior);document.getElementById(anchor)?.scrollIntoView({behavior,block:'start'});}

  function renderOriginals(item){
    const sources=item.originals||[];
    $('document-originals').hidden=!sources.length;
    const sourceLink=s=>`<div class="original-row">${s.status==='available'?`<a href="${docURL(s.path)}" data-doc="${esc(s.path)}" data-source-anchor="${esc(s.anchor)}">${esc(s.label)} <small>PDF原文 →</small></a>`:`<span>${esc(s.label)} · 本地来源文件缺失</span>`}${s.notice?`<small class="source-notice">${esc(s.notice)}</small>`:''}</div>`;
    $('document-originals').innerHTML='<div class="original-label">原文与出处</div>'+sources.slice(0,3).map(sourceLink).join('')+(sources.length>3?`<details><summary>展开其余 ${sources.length-3} 份来源</summary>${sources.slice(3).map(sourceLink).join('')}</details>`:'');
    const notes=item.related_notes||[];
    const reference=item.reference;
    $('related-notes').hidden=!notes.length&&!reference?.evidence_path;
    $('related-notes').innerHTML='<div class="original-label">相关研读与索引</div>'+notes.map(n=>`<a href="${docURL(n.path)}" data-doc="${esc(n.path)}">${esc(n.title)} →</a>`).join('');
    if(reference?.evidence_path){const [path,anchor]=reference.evidence_path.split('#');$('related-notes').innerHTML+=`<div class="original-label">参考价值与依据</div><p>${esc(reference.reason)}</p><p>${esc(reference.limit)}</p><a href="${docURL(path)}" data-local-path="${esc(path)}" data-anchor="${esc(anchor||'')}">查看参考价值判断的研读依据 →</a>`;}
  }
  function restoreFrameLayout(){if(state.currentType!=='html'||state.framePath!==state.current)return;if(readyAnchor){const anchor=readyAnchor;readyAnchor='';jumpAnchor(anchor);}else restorePosition();}
  function attachFrame(){
    if(!/\.html$/i.test((state.framePath||'').split('#')[0]))return;
    frameAPI=ReadingSurface.attach($('document-frame'),{prefs:state.prefs,onHeadings:headings=>{if(state.currentType==='html'&&state.framePath===state.current)renderToc(headings);},onLayout:restoreFrameLayout,onLink:(path,anchor)=>showDocument(path,{anchor})});
  }
  async function showDocument(path,{push=true,anchor='',sync=false}={}){
    if(!sync)saveBeforeNavigation();const request=++docRequest,previous=state.current===path,previousVersion=state.currentVersion;
    $('error').hidden=true;ReaderControls.close();
    try{
      const doc=await api('/api/document?path='+encodeURIComponent(path));if(request!==docRequest)return;
      if(state.current!==path||doc.type!=='pdf')PdfPreview.close();
      const item=itemFor(path)||{path,title:path.split('/').pop(),category:doc.type==='pdf'?'originals':'project',summary:'',indexed_by:[],characters:0,originals:[]};
      if(doc.type==='pdf'&&state.current!==path&&!sync)state.pdfReturn=state.current&&!/\.pdf$/i.test(state.current)?state.current:item.related_notes?.find(n=>!n.index)?.path;
      state.current=path;state.currentType=doc.type;state.currentVersion=doc.version;state.currentCatalogRevision=state.catalog.revision;
      $('library-view').hidden=true;$('reader-view').hidden=false;if(!sync)$('document-details').open=false;document.body.classList.remove('nav-open');document.body.classList.toggle('html-reading',doc.type==='html');document.body.classList.toggle('pdf-reading',doc.type==='pdf');
      if(push)history.pushState({library:state.librarySnapshot},'',docURL(path)+(anchor?'#'+encodeURIComponent(anchor):''));
      $('document-title').textContent=item.title.replace(/\s+·\s+/g,' ');$('document-summary').textContent=item.summary;$('document-summary').hidden=doc.type==='pdf';
      $('document-translated-title').hidden=!item.title_zh||item.title_zh===item.title;$('document-translated-title').textContent=item.title_zh?'中文译名：'+item.title_zh:'';
      $('reader-reading').innerHTML=readingLink(item,'primary-reading');$('reader-reading').hidden=!item.reading;
      $('reader-translation').innerHTML=translationLink(item,'primary-reading');$('reader-translation').hidden=!item.translation;
      $('reader-file-actions').innerHTML=originalFileActions(item);$('reader-file-actions').hidden=doc.type!=='pdf';
      $('document-details-label').textContent=doc.type==='pdf'?'原文信息':'资料来源';
      $('pdf-fullscreen').hidden=doc.type!=='pdf';$('frame-note-text').textContent=item.title;
      $('publication-line').hidden=!item.publication;$('publication-line').textContent=item.publication||'';
      const notice=importantNotice(item);$('document-notice').hidden=!notice;$('document-notice').textContent=notice;
      $('document-scope').textContent=item.reading_scope?'已登记阅读范围：'+item.reading_scope:'';
      $('document-labels').innerHTML=paperBadges(item);$('document-labels').hidden=doc.type==='pdf';$('document-date').textContent='修改日期 '+new Date(doc.modified).toLocaleDateString('zh-CN');$('document-length').textContent=doc.type==='md'?'约 '+Math.max(1,Math.ceil(item.characters/650))+' 分钟阅读':'';
      $('document-source').href=sourceURL(path);$('document-source').textContent=doc.type==='pdf'?'独立窗口打开PDF ↗':'查看原始资料 ↗';$('source-path').textContent=doc.source_path||path;renderOriginals(item);$('related-links-details').hidden=$('related-notes').hidden;
      const availableOriginals=item.originals?.filter(s=>s.status==='available')||[];const original=availableOriginals.length===1?availableOriginals[0]:null;$('reader-original').hidden=!original;$('reader-original').href=original?docURL(original.path):'#';if(original){$('reader-original').dataset.doc=original.path;$('reader-original').dataset.sourceAnchor=original.anchor||'';}else delete $('reader-original').dataset.doc;
      $('pdf-return').hidden=doc.type!=='pdf'||!state.pdfReturn||Boolean(item.reading);$('pdf-return').dataset.doc=state.pdfReturn||'';$('pdf-return').href=docURL(state.pdfReturn||'');
      $('document-parent').hidden=!doc.source_anchor;$('document-parent').href=docURL(doc.source_path)+'#'+encodeURIComponent(doc.source_anchor||'');$('document-parent').dataset.doc=doc.source_path||path;$('document-parent').dataset.sourceAnchor=doc.source_anchor||'';
      $('source-indexes').innerHTML=item.indexed_by.length?item.indexed_by.map(p=>`<a href="${docURL(p)}" data-doc="${esc(p)}">${esc(p)}</a>`).join(''):'通过本地目录收录。';
      $('breadcrumb').innerHTML='研究资料 <span>/</span> '+esc(labels[item.category]);updateReaderStar();document.title=item.title+' · 论文阅读台';
      if(sync&&previous&&previousVersion===doc.version)return;
      if(!sync){state.history=[{path,openedAt:Date.now()},...state.history.filter(x=>x.path!==path)].slice(0,50);writeStore('history',state.history);}
      pendingPosition={path,...state.positions[path],scroll:state.positions[path]?.scroll||0};readyAnchor=anchor||(state.positions[path]?'':doc.source_anchor||'');if(readyAnchor)pendingPosition=null;
      $('document-body').hidden=doc.type!=='md';$('document-frame-wrap').hidden=doc.type==='md';$('reader-toc').hidden=doc.type==='pdf';
      if(doc.type==='md'){
        $('document-body').innerHTML=sanitize(marked.parse(doc.content,{gfm:true,breaks:false}));prepareDocument();
        requestAnimationFrame(()=>{if(readyAnchor)jumpAnchor(readyAnchor);else restorePosition();});
      }else{
        $('document-body').innerHTML='';$('toc-links').innerHTML='';$('frame-download').hidden=doc.type!=='pdf';$('frame-download').href=doc.url+'?download=1';$('frame-open').href=doc.url+(readyAnchor?'#'+encodeURI(readyAnchor):'');$('document-frame').title=doc.type==='pdf'?'论文PDF原文':'长文阅读';
        if(state.framePath===path&&state.frameVersion===doc.version){if(doc.type==='html'){renderToc(frameAPI?.headings()||[]);frameAPI?.resize();requestAnimationFrame(restoreFrameLayout);}else requestAnimationFrame(restorePosition);}
        else{
          ReadingSurface.destroy();frameAPI=null;state.framePath=path;state.frameVersion=doc.version;$('document-frame').style.height=doc.type==='pdf'?'100%':'1px';
          $('document-frame').src=doc.url.split('#')[0]+(doc.type==='pdf'&&readyAnchor?'#'+encodeURI(readyAnchor):'');
        }
      }
      if(sync){$('document-update').hidden=false;}else $('document-update').hidden=true;
      ReaderControls.refresh();
    }catch(error){if(request!==docRequest)return;$('error').textContent=error.message;$('error').hidden=false;}
  }

  async function loadCatalog(initial=false){
    const data=await api('/api/catalog');state.catalog=data;
    $('paper-kind').innerHTML='<option value="all">全部类型</option>'+data.paper_types.map(x=>`<option value="${x.id}">${esc(x.label)}</option>`).join('');
    $('paper-topic').innerHTML='<option value="all">全部研究主题</option>'+(data.reference_topics||[]).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    $('reference-context').textContent=data.reference_context||'';
    $('reference-policy').textContent=data.reference_policy||'';
    $('paper-language').innerHTML='<option value="all">全部语言</option>'+data.languages.map(x=>`<option value="${x.id}">${esc(x.label)}</option>`).join('');
    if(initial){const params=new URLSearchParams(location.search);if(!params.has('doc')){routeLibrary(params);if(history.state?.library)applyLibrary(history.state.library);}else if(history.state?.library)applyLibrary(history.state.library);}
    updateNav();renderCards();
    $('sync-status').textContent='已同步 '+new Date(data.synced_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
    document.querySelector('.sync-line').classList.remove('offline');
    if(initial){const path=new URLSearchParams(location.search).get('doc');if(path)await showDocument(path,{push:false,anchor:decodeURIComponent(location.hash.slice(1))});else if(history.state?.library)requestAnimationFrame(()=>window.scrollTo({top:history.state.library.scroll||0,behavior:'instant'}));}
  }
  async function sync(){if(syncBusy||!state.catalog||document.hidden)return;syncBusy=true;try{const data=await api('/api/revision');if(data.revision!==state.catalog.revision){const current=state.current,request=docRequest;await loadCatalog();if(current&&state.current===current&&docRequest===request)await showDocument(current,{push:false,sync:true});}else{$('sync-status').textContent='同步正常 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}document.querySelector('.sync-line').classList.remove('offline');}catch{$('sync-status').textContent='资料暂时无法读取 · 请刷新重试';document.querySelector('.sync-line').classList.add('offline');}finally{syncBusy=false;}}
  document.addEventListener('click',event=>{
    const reveal=event.target.closest('[data-reveal]');if(reveal){event.preventDefault();revealOriginal(reveal);return;}
    const star=event.target.closest('[data-star]');if(star){toggleFavorite(star.dataset.star);return;}
    const doc=event.target.closest('[data-doc]');if(doc){if(event.metaKey||event.ctrlKey||event.shiftKey||event.button!==0)return;event.preventDefault();showDocument(doc.dataset.doc,{anchor:doc.dataset.sourceAnchor||''});return;}
    const category=event.target.closest('[data-category]');if(category){if(event.metaKey||event.ctrlKey||event.shiftKey||event.button!==0)return;event.preventDefault();chooseCategory(category.dataset.category);return;}
    const route=event.target.closest('[data-route]');if(route){chooseCategory(route.dataset.route);return;}
    const view=event.target.closest('[data-view]');if(view){state.view=view.dataset.view;state.limit=24;renderCards();setLibraryAddress();return;}
    const lang=event.target.closest('[data-language]');if(lang){$('paper-language').value=lang.dataset.language;$('paper-language').dispatchEvent(new Event('change'));return;}
    const local=event.target.closest('[data-local-path]');if(local){event.preventDefault();const path=local.dataset.localPath,anchor=local.dataset.anchor;
      if((path===state.current||path===state.current?.split('#')[0])&&anchor&&!/\.pdf$/i.test(path)){jumpAnchor(anchor);history.replaceState({},'',docURL(path)+'#'+encodeURIComponent(anchor));}
      else if(/\.(md|html|pdf)$/i.test(path))showDocument(path,{anchor});
      else window.open(sourceURL(path)+(anchor?'#'+encodeURIComponent(anchor):''),'_blank','noopener');return;}
    const value=event.target.closest('[data-value]');if(value){state.facets.value=value.dataset.value;state.limit=24;renderCards();setLibraryAddress();document.querySelector(`[data-value="${state.facets.value}"]`)?.focus({preventScroll:true});return;}
    const topic=event.target.closest('[data-paper-topic]');if(topic){state.facets.topic=topic.dataset.paperTopic;state.view='all';state.limit=24;renderCards();setLibraryAddress();return;}
    const section=event.target.closest('[data-anchor-only]');if(section){event.preventDefault();jumpAnchor(section.dataset.anchorOnly);return;}
    const project=event.target.closest('[data-project-link]');if(project){event.preventDefault();showDocument('资料库说明.md');return;}
  });
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=$('search').value.trim();state.limit=24;renderCards();setLibraryAddress();},120);});
  $('sort').addEventListener('change',()=>{renderCards();setLibraryAddress();});$('unindexed').addEventListener('change',()=>{state.limit=24;renderCards();setLibraryAddress();});
  for(const [id,key] of [['paper-kind','kind'],['paper-language','language'],['paper-reading','reading'],['paper-topic','topic']])$(id).addEventListener('change',()=>{state.facets[key]=$(id).value;state.view='all';state.limit=24;setLibraryAddress();renderCards();});
  $('search-focus').onclick=()=>{if(state.current)showLibrary();$('search').focus();};
  $('load-more').onclick=()=>{state.limit+=24;renderCards();setLibraryAddress();};
  $('reset-filters').onclick=()=>{state.facets.kind='all';state.facets.reading='all';state.facets.topic='all';state.facets.value='all';$('unindexed').checked=false;renderCards();setLibraryAddress();};
  $('clear-search').onclick=()=>{state.q='';state.special='';state.view='all';resetFacets();$('search').value='';$('unindexed').checked=false;updateNav();renderCards();setLibraryAddress();};
  $('start-reading').onclick=()=>showDocument('资料库说明.md');
  $('favorites').onclick=()=>chooseShelf('favorites');
  $('recent').onclick=()=>chooseShelf('recent');
  $('back-library').onclick=()=>showLibrary(true,{restore:true});$('reader-star').onclick=()=>state.current&&toggleFavorite(state.current);
  $('font-up').onclick=()=>{state.prefs.size=Math.min(24,state.prefs.size+1);savePrefs();};$('font-down').onclick=()=>{state.prefs.size=Math.max(15,state.prefs.size-1);savePrefs();};
  $('font-family').onchange=()=>{state.prefs.font=$('font-family').value;savePrefs();};
  $('focus-mode').onclick=()=>{const active=document.body.classList.toggle('focus-reading');$('focus-mode').setAttribute('aria-pressed',String(active));};
  $('menu').onclick=()=>document.body.classList.toggle('nav-open');$('to-top').onclick=e=>{e.preventDefault();pendingPosition=null;window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
  $('show-index-health').onclick=()=>{const el=$('index-health');el.hidden=!el.hidden;const {missing_links:missing,linked_not_listed:excluded=[],source_link_gaps:gaps=[]}=state.catalog;el.innerHTML=`<h3>索引状态</h3><p>已收录 ${state.catalog.source_count} 份MD/HTML、${state.catalog.section_count||0} 条逐篇研读章节及 ${state.catalog.original_count||0} 份本地原文PDF（其中 ${state.catalog.linked_original_count||0} 份有研读关联）。它们是阅读入口，不表示相同数量的独立论文或已读全文。</p><p>现有索引中 ${missing.length} 条本地链接缺失；${gaps.length} 份关联PDF未找到。另有 ${excluded.length} 份已链接文件按范围规则未单独列入资料卡片，下方可查看。</p><p>原文库覆盖02文献与03历史论文原文目录的PDF文件；语言和类型标签依据既有题录及归档目录，未重新逐篇核验正文与版本，也未扫描归档。收藏与更新时间不表示学术核验或采用状态。</p>`+missing.slice(0,35).map(x=>`<p><a href="${docURL(x.source)}" data-doc="${esc(x.source)}">${esc(x.source)}</a><br>→ ${esc(x.target)}</p>`).join('')+gaps.slice(0,20).map(x=>`<p>PDF来源缺失：${esc(x.path)}</p>`).join('')+excluded.map(x=>`<p><a href="${docURL(x.path)}" data-doc="${esc(x.path)}">${esc(x.path)}</a><br>${esc(x.reason)} · 文件仍在本地</p>`).join('');};
  // A report can finish loading after its reader was closed. Keep its adapter
  // ready for reopening; callbacks update the page only while it is active.
  $('document-frame').addEventListener('load',attachFrame);

  window.addEventListener('popstate',()=>{savePosition();const params=new URLSearchParams(location.search),path=params.get('doc');if(path){if(history.state?.library)state.librarySnapshot=history.state.library;showDocument(path,{push:false,anchor:decodeURIComponent(location.hash.slice(1))});}else{if(history.state?.library){state.librarySnapshot=history.state.library;showLibrary(false,{restore:true});}else{routeLibrary(params);showLibrary(false,{restore:false});}}});

  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('search-focus').click();}if(e.key==='Escape')document.body.classList.remove('nav-open');});
  window.addEventListener('scroll',()=>{if(!state.current)return;clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{savePosition();const headings=readingHeadings();let active=headings[0]?.id;for(const h of headings)if(headingTop(h)<scrollY+150)active=h.id;$('toc-links').querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.dataset.anchorOnly===active));},120);},{passive:true});
  for(const name of ['wheel','touchstart'])window.addEventListener(name,()=>pendingPosition=null,{passive:true});
  window.addEventListener('pagehide',()=>{savePosition();if(!state.current)rememberLibrary();});

  PdfPreview.init();savePrefs();loadCatalog(true).catch(e=>{$('error').textContent='暂时无法读取资料：'+e.message;$('error').hidden=false;$('results-count').textContent='请刷新页面重试';});setInterval(sync,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
})();
