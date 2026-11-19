'use strict';
window.ReaderStatic=(()=>{
  const base=new URL('./',document.baseURI);
  const basePath=base.pathname;
  let documentCache=null,revision=null;
  async function json(name){
    const response=await fetch(new URL(name,base),{cache:'no-store'});
    if(!response.ok)throw Error('读取静态资料失败（'+response.status+'）');
    return response.json();
  }
  async function request(path){
    const url=new URL(path,'https://reader.invalid');
    if(url.pathname==='/api/catalog'||url.pathname==='/api/revision'){
      const catalog=await json('data/catalog.json');
      if(revision!==catalog.revision){documentCache=null;revision=catalog.revision;}
      return catalog;
    }
    if(url.pathname==='/api/document'){
      const reference=url.searchParams.get('path')||'';
      if(!documentCache)documentCache=json('data/documents.json').catch(error=>{documentCache=null;throw error;});
      const documents=await documentCache;
      const doc=documents[reference];
      if(!doc)throw Error('该资料未包含在当前阅读库中');
      return {...doc,url:new URL(doc.url,base).pathname};
    }
    throw Error('静态阅读站不支持此操作');
  }
  return {basePath,request};
})();
