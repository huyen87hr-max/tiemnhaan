/*
 * Epsilon.Blue Soft | Material Master — Training Edition
 * Opt-in public training uses GAS backend, native Google Sheets as master data.
 * NO login / NO private admin APIs from browser; this is an intentionally public sandbox.
 * JSON is configuration only. Never locally issue material codes.
 * User-supplied values render via textContent/createTextNode (not innerHTML).
 */
(() => {
  'use strict';

  const CONFIG_URL = './assets/data/config.json';
  const bridge = new window.MaterialMasterBridge();
  const barcode = window.MaterialBarcode; // Offline Code 128 renderer; never generates material IDs.
  const SCHEMA_VERSION = '3.0';
  const rules = window.MaterialMasterRules;
  const STATUS = Object.freeze({active:'Đang sử dụng',draft:'Bản nháp',inactive:'Ngừng sử dụng'});
  const CATEGORY_ICONS = {THEP:'▥',CAO_SU:'◉',TAM_TRUOT:'▱',BU_LONG:'⬡'};
  const CATEGORY_COLORS = {
    THEP:['#3263e8','#e9f0ff'],CAO_SU:['#873ed8','#f3e9ff'],
    TAM_TRUOT:['#139aab','#e2f9fa'],BU_LONG:['#ec991a','#fff3d9']
  };
  const fieldKeys = ['categoryId','materialType','name','unit','grade','standard','dimensions','technicalSpecification','notes'];
  const el = id => document.getElementById(id);
  let seed = null;
  let state = {materials:[], audit:[], updatedAt:null, baseVersion:''};
  let user = null; // Public training user is not an authenticated identity.
  let isConnected = false;
  let isSchemaReady = false;
  let refreshTimer = null;
  let pendingCreate = null;
  let lastActorName = '';
  let lastSyncAt = null;
  let selectedId = null;
  let editingId = null;
  let currentPage = 'dashboard';
  let page = 1;
  let busy = false;
  let pendingConfirmation = null;
  let lastSubmittedStatus = 'active';
  let toastTimeouts = new Set();

  function txt(input, max = 500) {
    return String(input ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0,max);
  }
  function canonical(input) {
    return txt(input,250).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D')
      .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  }
  function codeKey(value){return txt(value,64).normalize('NFKC').toLocaleUpperCase('vi-VN');}
  function exactSignature(m){return [m.categoryId,canonical(m.name),canonical(m.unit),canonical(m.grade),canonical(m.standard),canonical(m.dimensions)].join('|');}
  function safeDate(value) {
    if (!value) return 'Chưa có';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Chưa có' : new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
  }
  function now(){return new Date().toISOString();}
  function node(tag, className, content) {
    const e=document.createElement(tag);
    if(className)e.className=className;
    if(content!==undefined)e.textContent=String(content);
    return e;
  }
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+name);svg.appendChild(use);return svg;}
  function category(id){return seed?.categories.find(c=>c.id===id)||null;}
  function allCodesUnique(records){return new Set(records.map(m=>codeKey(m.code))).size===records.length;}
  function isObject(v){return !!v && typeof v==='object' && !Array.isArray(v);}

  function newRequestId() {
    if (!window.crypto?.getRandomValues) throw new Error('Trình duyệt không hỗ trợ cấp định danh yêu cầu an toàn.');
    const bytes = new Uint8Array(16);window.crypto.getRandomValues(bytes);
    return 'mmreq_' + Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }
  function safeServerMaterial(raw) {
    if (!isObject(raw)) throw new Error('Bản ghi từ server không hợp lệ.');
    const m={};
    for (const key of ['id','code','name','categoryId','unit','materialType','grade','standard','dimensions','technicalSpecification','notes','status','codeOrigin','origin','createdAt','updatedAt','createdBy','updatedBy','requestId','attributesJson']) {
      m[key]=txt(raw[key],key==='attributesJson'?3500:key==='technicalSpecification'||key==='notes'?500:key==='name'||key==='dimensions'?160:100);
    }
    m.revision=Number(raw.revision)||1;
    if (!m.code||!m.id||!m.name||!m.unit||!category(m.categoryId)||!STATUS[m.status]) throw new Error('Danh mục từ server có bản ghi thiếu trường hợp lệ.');
    return m;
  }
  function replaceFromServer(raw) {
    if (!Array.isArray(raw)) throw new Error('GAS không trả về danh sách hợp lệ.');
    const items=raw.map(safeServerMaterial);
    if (!allCodesUnique(items)) throw new Error('Dữ liệu Google Sheets có mã bị trùng.');
    state.materials=items;
    state.updatedAt=lastSyncAt=now();
    renderAll();
  }
  async function callServer(action,payload={}) {
    const allowed={'materials.list':'training.list','materials.create':'training.create'};
    if (!Object.prototype.hasOwnProperty.call(allowed,action)) {
      const error=new Error('Chỉ hỗ trợ xem danh mục và tạo mã mới trong chế độ đào tạo.');
      error.code='FORBIDDEN';throw error;
    }
    return bridge.invoke(allowed[action],payload);
  }
  async function refreshCloud(silent=false) {
    if (!isConnected) return;
    try {
      const result=await callServer('materials.list');
      replaceFromServer(result.materials);
      if (!silent)toast('Đã đồng bộ danh mục',`${state.materials.length} mã từ Google Sheets.`);
    }catch(err){if(!silent)toast('Không thể làm mới',err.message,'error',6500);}
  }
  async function connectTraining(){
    const btn=el('retryConnection');btn.hidden=true;
    el('connectionError').hidden=true;
    el('bridgeStatus').textContent='Đang kết nối Google Apps Script...';
    try {
      await bridge.connect();
      const status=await bridge.invoke('training.status');
      isSchemaReady=status.attributeSchemaVersion===rules.VERSION;
      if (!status.enabled) {
        throw new Error('Chế độ đào tạo chưa được bật trong GAS. Chủ bảng chạy mmEnableTrainingMode() rồi cập nhật bản triển khai.');
      }
      const listing=await bridge.invoke('training.list');
      replaceFromServer(listing.materials);
      isConnected=true;
      user={userId:'PUBLIC_TRAINING',displayName:'Học viên',role:'TRAINING'};
      const sheetLink=el('masterSheetLink');
      if(sheetLink && typeof status.spreadsheetUrl==='string' && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(status.spreadsheetUrl)) {
        sheetLink.href=status.spreadsheetUrl;
        sheetLink.hidden=false;
      }
      el('accountDisplay').textContent='Đào tạo · Không cần đăng nhập';
      el('logoutButton').hidden=true;
      el('detailEditButton').hidden=true;
      el('detailStatusButton').hidden=true;
      el('authScreen').hidden=true;
      const warn=el('backendUpgradeNotice');if(warn)warn.hidden=isSchemaReady;
      if(refreshTimer)clearInterval(refreshTimer);
      refreshTimer=setInterval(()=>{if(!document.hidden&&!busy&&isConnected)void refreshCloud(true);},30000);
      navigate('dashboard');
      toast(isSchemaReady?'Danh mục đã sẵn sàng':'Cần cập nhật GAS',isSchemaReady?`${state.materials.length} mã vật tư trên Google Sheets. Không cần đăng nhập.`:'Danh mục vẫn xem được; tạo mã theo thuộc tính cần triển khai Code.gs mới.',isSchemaReady?'success':'warning',isSchemaReady?4400:8500);
    }catch(err){
      isConnected=false;user=null;
      el('bridgeStatus').textContent='Chưa thể mở danh mục dùng chung.';
      el('connectionError').textContent=err?.code==='ACTION_NOT_ALLOWED'
        ?'GAS chưa được cập nhật chế độ không đăng nhập. Chủ bảng cần dán Code.gs mới và triển khai phiên bản mới.'
        :(err instanceof Error?err.message:'Không kết nối được GAS.');
      el('connectionError').hidden=false;
      btn.hidden=false;
    }
  }
  function showNotice(msg){el('errorNotice').hidden=false;el('errorNotice').textContent=msg;}
  function toast(title,message,type='success',duration=4400){
    const box=node('div','toast '+(type==='success'?'':'toast-'+type));
    const sym=icon(type==='error'?'alert':type==='warning'?'info':'check');
    const content=node('div');content.append(node('strong','',title),node('p','',message));
    const close=node('button');close.type='button';close.setAttribute('aria-label','Đóng thông báo');close.append(icon('x'));close.addEventListener('click',()=>box.remove());
    box.append(sym,content,close);el('toastStack').append(box);
    const t=setTimeout(()=>{box.remove();toastTimeouts.delete(t);},duration);toastTimeouts.add(t);
  }
  function setBusy(flag,button,working='Đang xử lý...'){
    busy=flag;
    if(!button)return;
    if(flag){button.dataset.originalText=button.textContent;button.textContent=working;button.classList.add('is-busy');}
    else{button.textContent=button.dataset.originalText||button.textContent;button.classList.remove('is-busy');}
    button.disabled=flag;
  }
  function confirmAction(title,message,action,affirmative='Xác nhận'){
    const d=el('confirmDialog');el('confirmTitle').textContent=title;el('confirmMessage').textContent=message;
    el('confirmYes').textContent=affirmative;pendingConfirmation=action;
    if(!d.open)d.showModal();
  }
  function navigate(target){
    if(!['dashboard','catalog','editor','data','guide'].includes(target))return;
    currentPage=target;
    document.querySelectorAll('.page').forEach(s=>s.hidden=s.dataset.page!==target);
    document.querySelectorAll('.nav-item').forEach(b=>{const active=b.dataset.navigate===target;b.classList.toggle('is-active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    if(target==='editor' && !editingId)clearEditor(false);
    if(target==='catalog')renderCatalog();
    if(target==='data')renderData();
    window.scrollTo({top:0,behavior:'auto'});
  }
  function countChanges(){return state.materials.filter(m=>m.codeOrigin==='SYSTEM_GENERATED').length;}
  function renderStats(){
    el('statTotal').textContent=state.materials.length.toLocaleString('vi-VN');
    el('statActive').textContent=state.materials.filter(x=>x.status==='active').length.toLocaleString('vi-VN');
    el('statDraft').textContent=state.materials.filter(x=>x.status==='draft').length.toLocaleString('vi-VN');
    el('statChanges').textContent=countChanges().toLocaleString('vi-VN');
    el('dashboardSource').textContent=`Google Sheets · ${state.materials.length} mã dùng chung · cập nhật định kỳ`;
    const root=el('groupCards');root.replaceChildren();
    seed.categories.forEach(cat=>{
      const count=state.materials.filter(m=>m.categoryId===cat.id).length;
      const btn=node('button','group-card');btn.type='button';const [fg,bg]=CATEGORY_COLORS[cat.id]||['#3263e8','#e9f0ff'];btn.style.setProperty('--group-color',fg);btn.style.setProperty('--group-bg',bg);
      btn.append(node('span','group-icon',CATEGORY_ICONS[cat.id]||'▦'),node('strong','group-title',cat.name));
      const bottom=node('span','group-bottom');const number=node('span');number.append(node('strong','group-count',count.toLocaleString('vi-VN')),node('span','group-unit','mã vật tư'));
      const arrow=node('span','group-arrow');arrow.append(icon('arrow'));bottom.append(number,arrow);btn.append(bottom);
      btn.addEventListener('click',()=>{el('filterCategory').value=cat.id;page=1;navigate('catalog');});root.append(btn);
    });
  }
  function populateCategories(){
    const select=el('materialCategory'),filter=el('filterCategory');
    select.replaceChildren(node('option','','Chọn nhóm vật tư'));
    select.firstChild.value='';select.firstChild.disabled=true;
    filter.replaceChildren(node('option','','Tất cả nhóm'));filter.firstChild.value='';
    seed.categories.forEach(cat=>{
      const a=node('option','',cat.name);a.value=cat.id;select.append(a);
      const b=node('option','',cat.name);b.value=cat.id;filter.append(b);
    });
  }
  function filteredMaterials(){
    const q=canonical(el('searchInput').value),cat=el('filterCategory').value,status=el('filterStatus').value;
    const rows=state.materials.filter(m=>(!cat||m.categoryId===cat)&&(!status||m.status===status)&&(!q||canonical([m.code,m.name,m.unit,m.grade,m.standard,m.dimensions,m.technicalSpecification].join(' ')).includes(q)));
    const sorting=el('sortBy').value;
    const collator=new Intl.Collator('vi',{numeric:true,sensitivity:'base'});
    rows.sort((a,b)=>{
      if(sorting==='updated')return (b.updatedAt||'').localeCompare(a.updatedAt||'')||collator.compare(a.code,b.code);
      if(sorting==='name')return collator.compare(a.name,b.name)||collator.compare(a.code,b.code);
      if(sorting==='category')return collator.compare(category(a.categoryId)?.name||'',category(b.categoryId)?.name||'')||collator.compare(a.code,b.code);
      return collator.compare(a.code,b.code);
    });
    return rows;
  }
  function renderCatalog(){
    const rows=filteredMaterials();const perPage=Number(el('pageSize').value)||20;
    const totalPages=Math.max(1,Math.ceil(rows.length/perPage));page=Math.max(1,Math.min(totalPages,page));
    el('listCount').textContent=`${rows.length.toLocaleString('vi-VN')} vật tư`;
    el('listHint').textContent=`Trong ${state.materials.length.toLocaleString('vi-VN')} bản ghi hiện có`;
    el('paginationInfo').textContent=rows.length?`Hiển thị ${(page-1)*perPage+1}–${Math.min(page*perPage,rows.length)} / ${rows.length}`:'Không có bản ghi phù hợp';
    el('pageLabel').textContent=`${page} / ${totalPages}`;el('prevPage').disabled=page===1;el('nextPage').disabled=page>=totalPages;
    const tbody=el('materialRows');tbody.replaceChildren();
    if(!rows.length){const tr=node('tr');const td=node('td','empty-table','Không tìm thấy vật tư phù hợp. Hãy đổi bộ lọc hoặc từ khóa.');td.colSpan=6;tr.append(td);tbody.append(tr);return;}
    rows.slice((page-1)*perPage,page*perPage).forEach(m=>{
      const tr=node('tr');
      const code=node('td');code.append(node('span','code-text',m.code));
      const name=node('td');name.append(node('div','material-name',m.name));
      if(m.dimensions||m.grade||m.standard)name.append(node('span','material-hint',[m.dimensions,m.grade,m.standard].filter(Boolean).join(' · ')));
      const group=node('td');group.append(node('span','tag tag-group',category(m.categoryId)?.name||m.categoryId));
      const unit=node('td','',m.unit);
      const status=node('td');status.append(node('span','tag tag-'+m.status,STATUS[m.status]));
      const act=node('td','cell-action');const button=node('button','table-action','Chi tiết');button.type='button';button.addEventListener('click',()=>showDetail(m.id));act.append(button);
      tr.append(code,name,group,unit,status,act);tbody.append(tr);
    });
  }
  function row(label,textValue,wide=false){const e=node('div','detail-field'+(wide?' detail-wide':''));e.append(node('label','',label),node('div','',textValue||'—'));return e;}
  function showDetail(id){
    const m=state.materials.find(x=>x.id===id);if(!m)return;
    selectedId=id;el('detailTitle').textContent=m.code;
    const body=el('detailBody');body.replaceChildren();
    const grid=node('div','detail-grid');
    grid.append(row('Tên vật tư',m.name,true),row('Nhóm vật tư',category(m.categoryId)?.name),row('Trạng thái',STATUS[m.status]),
      row('Loại vật tư',m.materialType||'Chưa phân loại'),row('Đơn vị tính cơ sở',m.unit),row('Mác / chủng loại',m.grade),row('Tiêu chuẩn',m.standard),
      row('Kích thước / quy cách',m.dimensions,true),row('Đặc tính kỹ thuật',m.technicalSpecification,true),row('Ghi chú',m.notes,true),
      row('Nguồn dữ liệu',m.codeOrigin==='SYSTEM_GENERATED'?'Mã do GAS tự cấp':'Mã lịch sử từ Excel'),
      row('Cập nhật gần nhất',safeDate(m.updatedAt)));
    body.append(makeBarcodeDetail(m), grid);
    const statusBtn=el('detailStatusButton');
    statusBtn.textContent=m.status==='inactive'?'Kích hoạt lại':m.status==='draft'?'Kích hoạt mã':'Ngừng sử dụng';
    el('detailEditButton').hidden=user?.role!=='ADMIN';
    el('detailStatusButton').hidden=user?.role!=='ADMIN';
    if(!el('detailDialog').open)el('detailDialog').showModal();
  }
  function renderEditorBarcode(){
    const preview=el('editorBarcodeVisual');
    const code=el('materialCode').value.trim();
    const previouslySaved=editingId?state.materials.find(m=>m.id===editingId):null;
    const canPrint=Boolean(previouslySaved && previouslySaved.code===code);
    el('editorBarcodeCode').textContent=code||'—';
    let result={ok:false};
    if (!code) preview.replaceChildren(node('span','barcode-placeholder','Mã vạch sẽ xuất hiện khi có mã vật tư.'));
    else if (!barcode) preview.replaceChildren(node('span','barcode-error-message','Chưa tải được bộ mã hóa barcode.'));
    else result=barcode.render(preview,code,{barHeight:74});
    el('editorPrintBarcode').disabled=!canPrint||!result.ok;
    el('editorBarcodeHint').textContent=!code?'GAS chỉ cấp mã khi lưu thành công. Khi đó barcode mới được tạo để in nhãn.'
      :!result.ok?'Mã này chưa thể in nguyên vẹn bằng Code 128. Không tự thay thế ký tự trong mã gốc.'
      :canPrint?'Mã vật tư đã được lưu. Có thể in nhãn và dán lên vật tư.'
      :'Chỉ là hình xem trước. Mã in chính thức phải là mã đã được lưu thành công.';
  }

  function makeBarcodeDetail(m){
    const card=node('section','barcode-detail-card');
    const head=node('div','barcode-detail-head');
    const title=node('div');title.append(node('small','','CODE 128 · MATERIAL LABEL'),node('h3','','Mã vạch vật tư'));
    head.append(title,node('span','barcode-preview-pill','TỪ MÃ GỐC'));
    const frame=node('div','barcode-preview-surface');
    const bars=node('div','barcode-bars');
    const ok=barcode?barcode.render(bars,m.code,{barHeight:80}):{ok:false};
    if(!barcode)bars.append(node('span','barcode-error-message','Thiếu bộ mã hóa barcode.'));
    frame.append(bars,node('strong','barcode-human',m.code));
    const info=node('p','barcode-explain'+(requiresExtendedScan(m.code)?' barcode-scan-warning':''),
      !ok.ok?'Không thể tạo barcode nguyên vẹn cho mã này; vui lòng kiểm tra các ký tự đặc biệt.'
      :requiresExtendedScan(m.code)?'Mã có ký tự mở rộng (như Ð). Máy quét phải hỗ trợ Code 128 FNC4 / Latin-1; hãy kiểm thử trước khi dán nhãn.'
      :'Barcode mã hóa đúng mã vật tư; dùng máy quét Code 128 để tra cứu trong hệ thống.');
    card.append(head,frame,info);
    el('detailPrintBarcode').disabled=!ok.ok;
    el('detailDownloadBarcode').disabled=!ok.ok;
    return card;
  }

  function requiresExtendedScan(code){return /[^\x20-\x7E]/.test(code);}
  function getSavedMaterial(id){return state.materials.find(m=>m.id===id)||null;}
  function appendPrintLabel(m){
    const area=el('barcodePrintArea');area.replaceChildren();
    const label=node('div','barcode-print-label');
    const header=node('div','print-label-header');
    header.append(node('span','','EPSILON.BLUE SOFT  /  MATERIAL MASTER'),node('span','',m.status==='active'?'CODE 128':STATUS[m.status]));
    label.append(header,node('strong','print-label-name',m.name));
    const holder=node('div','print-label-barcode');
    holder.append(barcode.makeSvg(m.code,{barHeight:68}));
    label.append(holder,node('strong','print-label-code',m.code));
    const footer=node('div','print-label-footer');
    footer.append(node('span','',category(m.categoryId)?.name||m.categoryId),node('span','',`ĐVT: ${m.unit}`));
    label.append(footer);area.append(label);
    return area;
  }

  let restoreDetailAfterPrint=false;
  function printMaterialBarcode(m,extendedConfirmed=false){
    if (!m || !barcode) {toast('Không thể in barcode','Chưa có vật tư đã lưu hoặc thiếu bộ mã hóa.','error');return;}
    if (requiresExtendedScan(m.code) && !extendedConfirmed) {
      confirmAction('Kiểm thử máy quét trước khi dán nhãn',
        'Mã '+m.code+' có ký tự mở rộng, ví dụ Ð. Barcode Code 128 dùng FNC4; một số máy quét không được cấu hình để giải mã ký tự này và có thể trả dữ liệu khác mã gốc. Chỉ in để thử với thiết bị thực tế.',
        ()=>printMaterialBarcode(m,true),'In để kiểm thử');
      return;
    }
    try {
      const area=appendPrintLabel(m);
      const dialog=el('detailDialog');restoreDetailAfterPrint=dialog.open;
      if (dialog.open) dialog.close();
      area.hidden=false;
      // Native print UI: no upload, remote API or browser popup is required.
      window.print();
    } catch(err){
      el('barcodePrintArea').hidden=true;
      toast('Không tạo được nhãn in',err instanceof Error?err.message:'Không hỗ trợ ký tự trong mã.','error');
    }
  }

  function downloadBarcodeSvg(m){
    if(!m||!barcode)return;
    try {
      const svg=barcode.makeSvg(m.code,{barHeight:90});
      svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
      const markup='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(svg);
      const blob=new Blob([markup],{type:'image/svg+xml;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;
      link.download='Material_Barcode_'+m.code.replace(/[^A-Za-z0-9_-]+/g,'_')+'.svg';
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
      toast('Đã tạo mã vạch SVG',requiresExtendedScan(m.code)?'SVG có ký tự mở rộng: cần thử trên máy quét hỗ trợ FNC4 trước khi sử dụng.':'Ảnh vector giữ nét khi phóng to và in nhãn.',requiresExtendedScan(m.code)?'warning':'success');
    } catch(err){toast('Không tải được mã vạch',err instanceof Error?err.message:'Mã không được hỗ trợ.','error');}
  }

  function refreshCode(){
    const original=editingId?state.materials.find(m=>m.id===editingId):null;
    const input=el('materialCode');input.readOnly=true;
    input.value=original?.code||'';
    input.placeholder='GAS cấp mã khi lưu thành công';
    el('codeHint').textContent=original?'Mã chính thức không thể sửa sau khi được cấp.':'Mã do server cấp theo dải A000001, A000002... Không cho nhập hoặc đặt trước.';
    renderEditorBarcode();
  }
  function currentSubtype(){
    return rules&&seed?rules.findSubtype(seed,el('materialCategory').value,el('materialSubtype').value):null;
  }
  function refreshSubtypeOptions(){
    const cat=el('materialCategory').value,selector=el('materialSubtype');
    selector.replaceChildren();
    const first=node('option','','Chọn chủng loại kỹ thuật');first.value='';selector.append(first);
    (seed?.formSchemas?.[cat]||[]).forEach(s=>{const opt=node('option','',s.label);opt.value=s.id;selector.append(opt);});
    selector.value='';
    renderAttributeFields();
  }
  function renderAttributeFields(){
    const box=el('dynamicTechnicalFields');box.replaceChildren();
    const subtype=currentSubtype();
    if(!subtype){
      const empty=node('div','attribute-empty');
      empty.append(icon('box'),node('strong','','Bắt đầu bằng nhóm và chủng loại'),node('span','','Chương trình sẽ hiển thị các thuộc tính kỹ thuật tương ứng.'));
      box.append(empty);el('attributeSectionHint').textContent='Chọn chủng loại vật tư để mở biểu mẫu kỹ thuật.';
      renderSuggestions();return;
    }
    el('materialType').value=subtype.defaultMaterialType||'ROH';
    el('attributeSectionHint').textContent=subtype.hint||'Khai báo thuộc tính nhận dạng vật tư; trường có dấu * là bắt buộc.';
    subtype.fields.forEach(field=>{
      const label=node('label','field attribute-field');
      const heading=node('span','attribute-label',field.label+(field.required?' *':''));
      label.append(heading);
      let input;
      if(field.kind==='select'){
        input=node('select');
        const opt=node('option','','Chọn '+field.label.toLowerCase());opt.value='';input.append(opt);
        (field.options||[]).forEach(value=>{const option=node('option','',value);option.value=value;input.append(option);});
      }else{
        input=node('input');input.type=field.kind==='number'?'text':'text';
        input.inputMode=field.kind==='number'?'decimal':'text';
        input.autocomplete='off';input.maxLength=100;
        input.placeholder=field.kind==='number'?'VD: 20':field.hint||('Nhập '+field.label.toLowerCase());
        if(field.kind==='suggest'&&Array.isArray(field.options)){
          const choices=node('datalist');choices.id='mm_attr_options_'+field.id;
          field.options.forEach(value=>{const opt=node('option');opt.value=value;choices.append(opt);});
          input.setAttribute('list',choices.id);label.append(choices);
        }
      }
      input.dataset.attr=field.id;
      input.setAttribute('aria-label',field.label);
      input.addEventListener(field.kind==='select'?'change':'input',()=>{pendingCreate=null;renderSuggestions();});
      const wrap=node('div','attribute-input-wrap');wrap.append(input);
      if(field.unit)wrap.append(node('span','attribute-unit',field.unit));
      label.append(wrap);if(field.hint)label.append(node('small','',field.hint));
      box.append(label);
    });
    renderSuggestions();
  }
  function clearEditor(render=true){
    editingId=null;pendingCreate=null;
    el('materialForm').reset();
    const actorInput=el('materialActorName');if(actorInput)actorInput.value=lastActorName;
    el('materialCategory').disabled=false;
    el('editorHeading').textContent='Tạo mã vật tư mới';
    el('editorLead').textContent='Chọn nhóm, nhập thuộc tính, hệ thống tự tạo tên và kiểm tra trùng.';
    el('saveActive').textContent='Lưu & cấp mã';el('saveActive').disabled=true;
    refreshCode();refreshSubtypeOptions();
    if(render)renderSuggestions();
  }
  function loadEditor(_id){
    toast('Dữ liệu chỉ đọc','Chế độ đào tạo chỉ tạo mã mới; dữ liệu lịch sử không chỉnh sửa từ Web App.','warning');
  }
  function candidateFromForm(){
    const attributes={};
    el('dynamicTechnicalFields').querySelectorAll('[data-attr]').forEach(input=>{attributes[input.dataset.attr]=input.value.trim();});
    return {categoryId:el('materialCategory').value,subtypeId:el('materialSubtype').value,materialType:el('materialType').value,
      attributes:attributes,notes:el('materialNotes').value.trim()};
  }
  function checkCandidate(m){
    const validated=rules.validate(seed,m,false);
    if(!validated.ok||!validated.complete)return validated.errors[0]||'Vui lòng hoàn tất các trường kỹ thuật bắt buộc.';
    try{rules.build(seed,m);}catch(err){return err.message;}
    return null;
  }
  function renderSuggestions(){
    const list=el('duplicateSuggestions');list.replaceChildren();
    const status=el('duplicateStatus');
    if(!seed||!rules){el('saveActive').disabled=true;return;}
    const data=candidateFromForm(),spec=currentSubtype();
    const valid=rules.validate(seed,data,true);
    const required=spec?spec.fields.filter(f=>f.required):[];
    const present=required.filter(f=>Boolean(valid.attributes[f.id])).length;
    el('attributeProgress').textContent=present+' / '+required.length+' trường bắt buộc';
    el('attributeProgressFill').style.width=(required.length?Math.round(100*present/required.length):0)+'%';
    const fields=['materialName','materialGrade','materialStandard','materialDimensions','materialSpec','materialUnit'];
    fields.forEach(id=>el(id).value='');
    if(spec){
      el('materialUnit').value=spec.unit;
      if(Object.values(valid.attributes).some(Boolean)){
        el('materialName').value=rules.displayName(spec.id,valid.attributes);
        if(valid.complete&&valid.ok){
          try{
            const normalized=rules.build(seed,data);
            el('materialName').value=normalized.name;el('materialGrade').value=normalized.grade;
            el('materialStandard').value=normalized.standard;el('materialDimensions').value=normalized.dimensions;
            el('materialSpec').value=normalized.technicalSpecification;
          }catch(err){valid.errors.push(err.message);}
        }
      }
    }
    const checked=rules.checkMatches(seed,data,state.materials);
    let resultLevel=checked.level,topMsg='',subMsg='';
    if(!spec||!present){resultLevel='idle';topMsg='Chưa bắt đầu đối chiếu';subMsg='Chọn chủng loại và nhập thuộc tính kỹ thuật.';}
    else if(valid.errors.length){resultLevel='invalid';topMsg='Có trường cần kiểm tra';subMsg=valid.errors[0];}
    else if(checked.level==='exact'){topMsg='Đã tồn tại vật tư trùng hoàn toàn';subMsg='Không cấp mã mới. Nhấn mã bên dưới để xem thông tin và barcode.';}
    else if(checked.level==='similar'){topMsg='Có vật tư gần giống';subMsg='Hãy xem những mã tương tự trước khi quyết định tạo mới.';}
    else if(valid.complete){resultLevel='none';topMsg='Không phát hiện mã trùng';subMsg='Có thể tạo mã; GAS sẽ kiểm tra lại dữ liệu mới nhất khi lưu.';}
    else{resultLevel='incomplete';topMsg='Đang lọc dữ liệu theo thuộc tính';subMsg='Hoàn thành tất cả trường * để có kết quả chính xác hơn.';}
    status.className='duplicate-status status-'+resultLevel;
    status.replaceChildren(node('strong','',topMsg),node('span','',subMsg));
    const matches=[...(checked.exact||[]),...(checked.similar||[])].slice(0,6);
    if(!matches.length)list.append(node('div','suggestion-empty',checked.level==='none'?'Danh mục hiện không có vật tư cùng bộ thuộc tính.':'Mã có đặc điểm giống sẽ xuất hiện ở đây.'));
    matches.forEach(match=>{
      const original=state.materials.find(m=>m.code===match.code);
      const btn=node('button','suggestion-item '+(match.level==='exact'?'is-exact':'is-similar'));btn.type='button';
      const code=node('span','matched-code',match.code),name=node('span','matched-name',match.name);
      const reason=node('span','match-reason',match.level==='exact'?'Trùng toàn bộ thuộc tính nhận dạng':match.reason);
      btn.append(code,name,reason);
      btn.addEventListener('click',()=>{if(original)showDetail(original.id);});list.append(btn);
    });
    if(!busy)el('saveActive').disabled=(!isConnected||!isSchemaReady||!valid.complete||!valid.ok||checked.exact.length>0||!spec);
  }
  function changedIdentity(old,m){return ['grade','standard','dimensions','technicalSpecification'].some(k=>canonical(old[k])!==canonical(m[k]));}
  async function saveMaterial(){
    if(busy||!isConnected)return;
    if(!isSchemaReady){toast('Cần cập nhật GAS','Anh chạy mmSetup() rồi triển khai phiên bản mới để sử dụng biểu mẫu này.','warning');return;}
    const original=editingId?state.materials.find(m=>m.id===editingId):null;
    if(original){toast('Không hỗ trợ chỉnh sửa','Chỉ tạo mã mới trong chế độ đào tạo.','warning');return;}
    const material=candidateFromForm(),issue=checkCandidate(material);
    const matches=rules.checkMatches(seed,material,state.materials);
    if(matches.exact.length){toast('Vật tư đã tồn tại','Mã ' + matches.exact[0].code + ' trùng thuộc tính; không cấp mã mới.','warning',6500);renderSuggestions();return;}
    if(issue){toast('Thông tin chưa hợp lệ',issue,'error',6500);renderSuggestions();return;}
    const button=el('saveActive');
    const actorName=el('materialActorName')?.value.trim()||'';
    const fingerprint=JSON.stringify(material)+'|'+actorName;
    const reqId=pendingCreate?.fingerprint===fingerprint?pendingCreate.requestId:newRequestId();
    pendingCreate={fingerprint,requestId:reqId};
    const payload={material,requestId:reqId,actorName};
    const action='materials.create';
    setBusy(true,button,original?'Đang cập nhật...':'Đang cấp mã...');
    try {
      const response=await callServer(action,payload);
      const saved=safeServerMaterial(response.material);
      if(original){const index=state.materials.findIndex(m=>m.id===original.id);if(index>=0)state.materials[index]=saved;}
      else if(!state.materials.some(m=>m.code===saved.code))state.materials.push(saved);
      pendingCreate=null;state.updatedAt=lastSyncAt=now();
      if(actorName)lastActorName=actorName;
      renderAll();clearEditor(false);page=1;navigate('catalog');showDetail(saved.id);
      toast('Đã lưu trên Google Sheets',`${saved.code} · barcode đã sẵn sàng để in.`);
      void refreshCloud(true);
    } catch(err){
      toast('Không thể lưu vật tư',err instanceof Error?err.message:'Lỗi không xác định.','error',8000);
      if(err.code==='STALE_REVISION'||err.code==='DUPLICATE_MATERIAL')void refreshCloud(true);
    } finally {setBusy(false,button);renderSuggestions();}
  }
  function changeStatus(id){
    if(user?.role!=='ADMIN'){toast('Không đủ quyền','Chỉ Admin được thay đổi trạng thái.','warning');return;}
    const m=state.materials.find(x=>x.id===id);if(!m)return;
    const next=m.status==='active'?'inactive':'active';
    confirmAction('Xác nhận trạng thái',`Cập nhật ${m.code} thành ${STATUS[next]}? Mã vật tư không đổi.`,async()=>{
      if(busy)return;busy=true;
      try {
        const data=await callServer('materials.setStatus',{code:m.code,expectedRevision:m.revision,status:next,requestId:newRequestId()});
        const saved=safeServerMaterial(data.material);
        const ix=state.materials.findIndex(x=>x.id===m.id);if(ix>=0)state.materials[ix]=saved;
        if(el('detailDialog').open)el('detailDialog').close();
        renderAll();toast('Đã cập nhật trạng thái',`${m.code} · ${STATUS[next]}`);void refreshCloud(true);
      }catch(err){toast('Không thể cập nhật',err.message,'error',6500);void refreshCloud(true);}
      finally{busy=false;}
    },'Xác nhận');
  }
  function exportData(){
    if(!isConnected){toast('Chưa có dữ liệu','Hãy kết nối Google Sheets trước khi xuất.','warning');return;}
    const out={schemaVersion:SCHEMA_VERSION,source:'Material Master Google Sheets',exportedAt:now(),categories:seed.categories,materials:state.materials};
    const blob=new Blob([JSON.stringify(out,null,2)+'\n'],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='material-master-export.json';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);toast('Đã xuất dữ liệu','Đây là bản sao chỉ đọc; không thay đổi Google Sheets.');
  }
  function renderData(){
    el('sourceType').textContent='Google Sheets qua GAS';
    el('sourceVersion').textContent='Material Master Cloud · A000001+';
    el('sourceTotal').textContent=state.materials.length.toLocaleString('vi-VN')+' mã';
    el('sourceChanges').textContent=countChanges().toLocaleString('vi-VN')+' mã tự động';
    el('sourceUpdated').textContent=safeDate(lastSyncAt);
    const list=el('auditEntries');list.replaceChildren();
    if(user?.role!=='ADMIN'){list.append(node('p','subtle','Chế độ đào tạo không cung cấp nhật ký công khai. Chủ Google Sheets có thể xem tab AUDIT_LOG.'));return;}
    if(!state.audit.length){list.append(node('p','subtle','Chưa có thao tác được ghi nhận.'));return;}
    for(const item of state.audit.slice().reverse().slice(0,20)){
      const line=node('div','audit-item'),symbol=node('span','audit-icon');symbol.append(icon('clock'));
      const body=node('div','audit-text');body.append(node('strong','',`${item.action} · ${item.materialCode}`),node('p','',item.actorId||''));
      line.append(symbol,body,node('span','audit-time',safeDate(item.at)));list.append(line);
    }
  }
  function renderAll(){renderStats();renderCatalog();renderData();if(currentPage==='editor')renderSuggestions();}
  function attachEvents(){
    document.querySelectorAll('[data-navigate]').forEach(button=>button.addEventListener('click',event=>{
      if(!isConnected && button.dataset.navigate!=='guide'){toast('Chưa kết nối','Hãy kết nối GAS trước.','warning');event.preventDefault();return;}
      if(button.dataset.navigate==='editor')clearEditor();
      navigate(button.dataset.navigate);if(button.tagName==='A')event.preventDefault();
    }));
    el('brandLink').addEventListener('click',event=>{event.preventDefault();if(isConnected)navigate('dashboard');});
    ['searchInput','filterCategory','filterStatus','sortBy','pageSize'].forEach(id=>el(id).addEventListener(id==='searchInput'?'input':'change',()=>{page=1;renderCatalog();}));
    el('prevPage').addEventListener('click',()=>{page--;renderCatalog();});
    el('nextPage').addEventListener('click',()=>{page++;renderCatalog();});
    el('newMaterialButton').addEventListener('click',()=>clearEditor());
    el('materialCategory').addEventListener('change',()=>{pendingCreate=null;refreshSubtypeOptions();});
    el('materialSubtype').addEventListener('change',()=>{pendingCreate=null;renderAttributeFields();});
    el('materialType').addEventListener('change',()=>{pendingCreate=null;renderSuggestions();});
    el('editorPrintBarcode').addEventListener('click',()=>{const m=getSavedMaterial(editingId);if(m&&m.code===el('materialCode').value)printMaterialBarcode(m);});
    el('materialNotes').addEventListener('input',()=>{pendingCreate=null;});
    el('materialForm').addEventListener('submit',event=>{event.preventDefault();void saveMaterial();});
    el('closeDetail').addEventListener('click',()=>el('detailDialog').close());
    el('detailEditButton').addEventListener('click',()=>{if(selectedId)loadEditor(selectedId);});
    el('detailStatusButton').addEventListener('click',()=>{if(selectedId){const id=selectedId;el('detailDialog').close();changeStatus(id);}});
    el('detailPrintBarcode').addEventListener('click',()=>printMaterialBarcode(getSavedMaterial(selectedId)));
    el('detailDownloadBarcode').addEventListener('click',()=>downloadBarcodeSvg(getSavedMaterial(selectedId)));
    window.addEventListener('afterprint',()=>{el('barcodePrintArea').hidden=true;if(restoreDetailAfterPrint){restoreDetailAfterPrint=false;const d=el('detailDialog');if(!d.open && selectedId)d.showModal();}});
    ['exportFull','catalogExport'].forEach(id=>el(id)?.addEventListener('click',exportData));
    el('refreshCloud')?.addEventListener('click',()=>void refreshCloud(false));
    el('retryConnection').addEventListener('click',()=>void connectTraining());
    el('confirmCancel').addEventListener('click',()=>{pendingConfirmation=null;el('confirmDialog').close();});
    el('confirmYes').addEventListener('click',()=>{const cb=pendingConfirmation;pendingConfirmation=null;el('confirmDialog').close();if(typeof cb==='function')void cb();});
    el('confirmDialog').addEventListener('cancel',()=>{pendingConfirmation=null;});
    window.addEventListener('keydown',event=>{
      if(event.key==='/'&&isConnected && !(event.target instanceof HTMLInputElement)&&!(event.target instanceof HTMLTextAreaElement)&&!(event.target instanceof HTMLSelectElement)){
        event.preventDefault();navigate('catalog');el('searchInput').focus();
      }
    });
  }
  async function init(){
    el('footerYear').textContent=new Date().getFullYear();
    attachEvents();
    el('authScreen').hidden=false;
    try {
      const result=await fetch(CONFIG_URL,{cache:'no-store'});
      if(!result.ok)throw new Error('Thiếu config.json (HTTP '+result.status+').');
      const config=await result.json();
      if(!Array.isArray(config.categories)||config.categories.length!==4)throw new Error('Danh mục nhóm trong config.json không hợp lệ.');
      if(!rules||!config.formSchemas||config.erpFormVersion!==rules.VERSION)throw new Error('Bộ quy tắc kỹ thuật chưa tải đúng phiên bản.');
      seed={categories:config.categories,datasetVersion:config.datasetVersion||'cloud-config',materials:[],formSchemas:config.formSchemas};
      state={materials:[],audit:[],updatedAt:null,baseVersion:seed.datasetVersion};
      populateCategories();clearEditor();renderAll();
      // Standard units now derive from the chosen subtype; no free-form unit field.
    }catch(err){showNotice('Không tải được cấu hình Material Master: '+err.message);return;}
    await connectTraining();
    if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
      window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
    }
  }
  void init();
})();
