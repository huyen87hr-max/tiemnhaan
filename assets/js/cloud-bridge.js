/* Material Master - browser transport based on Epsilon Class 1.
 * POST JSON with text/plain;charset=UTF-8 to avoid CORS preflight.
 * Owner-enabled public training LIST + CREATE intentionally needs no login.
 * Admin/private actions retain authentication; numbering/validation are always in GAS.
 * Never put passwords or tokens in GET/URLs or client persistent storage.
 */
(function(root){
  'use strict';
  const EXEC_URL='https://script.google.com/macros/s/AKfycbxUkt0m5s3r1HzEPySt6B0rFAqrAVkg6HsM3jsLNYXEcaabM2MwU22ACr07JO8So1w6/exec';
  const TIMEOUT_MS=35000;
  class MaterialMasterBridge {
    connect(){ return Promise.resolve(this); }
    async invoke(action,payload={},token=''){
      if(typeof action!=='string'||!/^[a-zA-Z0-9.]{1,48}$/.test(action))throw new Error('Tác vụ không hợp lệ.');
      const req={action:action,payload:payload};
      if(token)req.token=token;
      const controller=typeof AbortController==='function'?new AbortController():null;
      const timer=controller?root.setTimeout(()=>controller.abort(),TIMEOUT_MS):null;
      let response;
      try {
        response=await root.fetch(EXEC_URL,{
          method:'POST',
          headers:{'Content-Type':'text/plain;charset=UTF-8'},
          body:JSON.stringify(req),
          cache:'no-store',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer',
          signal:controller?controller.signal:undefined
        });
      }catch(_){
        const e=new Error('Không kết nối được Google Apps Script. Hãy kiểm tra bản triển khai và kết nối mạng.');
        e.code='NETWORK_ERROR';throw e;
      }finally{if(timer!==null)root.clearTimeout(timer);}
      if(!response.ok){const e=new Error('GAS trả về HTTP '+response.status);e.code='SERVER_ERROR';throw e;}
      let json;
      try{json=await response.json();}
      catch(_){const e=new Error('Không đọc được JSON từ GAS. Kiểm tra quyền truy cập và URL /exec.');e.code='INVALID_SERVER_RESPONSE';throw e;}
      if(!json||json.ok!==true){
        const err=json&&json.error;
        const e=new Error(typeof err==='object'&&err&&typeof err.message==='string'?err.message:typeof err==='string'?err:'Yêu cầu bị từ chối.');
        e.code=String((err&&typeof err==='object'&&err.code)||json?.code||'REQUEST_DENIED');
        throw e;
      }
      return json.data||{};
    }
    disconnect(){}
  }
  Object.defineProperty(root,'MaterialMasterBridge',{value:MaterialMasterBridge,writable:false,configurable:false});
})(window);
