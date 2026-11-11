/* Material Master ERP attribute engine. Pure ES5-compatible logic shared verbatim
 * by the browser and the GAS bundle. No I/O; server is the authority. */
var MaterialMasterRules = (function () {
  'use strict';
  var VERSION='erp-attribute-v1';
  function fold(s){return String(s===undefined||s===null?'':s).normalize('NFKC').trim().replace(/\s+/g,' ');}
  function key(s){return fold(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toUpperCase();}
  function numeric(s){
    var value=fold(s).replace(',','.');
    if(!/^\d+(?:\.\d{1,3})?$/.test(value))return null;
    var n=Number(value);
    if(!Number.isFinite(n)||n<=0||n>1000000)return null;
    return String(Number(n.toFixed(3)));
  }
  function findSubtype(config,group,id){
    var set=config&&config.formSchemas&&config.formSchemas[group];
    return Array.isArray(set)?set.filter(function(x){return x.id===id;})[0]||null:null;
  }
  function safeText(raw,max){
    if(typeof raw!=='string')return null;
    var v=fold(raw);
    if(v.length>max||/[\u0000-\u001f\u007f<>]/.test(v)||/^[=+\-@']/.test(v))return null;
    return v;
  }
  function validate(config,data,allowIncomplete){
    var problems=[],attributes={},group=String(data&&data.categoryId||''),sub=String(data&&data.subtypeId||'');
    var spec=findSubtype(config,group,sub);
    if(!spec)return {ok:false,complete:false,errors:['Chọn nhóm và chủng loại vật tư hợp lệ.'],attributes:{},subtype:null};
    if(!data||!data.attributes||Array.isArray(data.attributes)||typeof data.attributes!=='object')
      return {ok:false,complete:false,errors:['Thiếu cấu trúc thuộc tính kỹ thuật.'],attributes:{},subtype:spec};
    var keys=Object.keys(data.attributes),whitelist=spec.fields.map(function(f){return f.id;});
    if(keys.some(function(k){return whitelist.indexOf(k)<0;}))problems.push('Có trường kỹ thuật không được phép.');
    spec.fields.forEach(function(f){
      var raw=data.attributes[f.id],value=raw===undefined||raw===null?'':String(raw).trim();
      if(!value){attributes[f.id]='';if(f.required&&!allowIncomplete)problems.push('Thiếu '+f.label+'.');return;}
      if(f.kind==='number'){
        var n=numeric(value);
        if(n===null)problems.push(f.label+' phải là số dương, tối đa 3 chữ số thập phân.');
        if(n!==null&&f.id==='hardness'&&(Number(n)<1||Number(n)>100))problems.push('Độ cứng Shore A phải từ 1 đến 100.');
        attributes[f.id]=n===null?'':n;
      } else {
        var text=safeText(value,100);
        if(text===null)problems.push('Giá trị '+f.label+' không hợp lệ.');
        if(text!==null&&f.kind==='select'&&f.options&&f.options.every(function(x){return key(x)!==key(text);})){problems.push('Giá trị '+f.label+' không nằm trong danh mục.');}
        attributes[f.id]=text===null?'':text;
      }
    });
    if(attributes.innerDiameter&&attributes.outerDiameter&&Number(attributes.innerDiameter)>=Number(attributes.outerDiameter))problems.push('Đường kính trong phải nhỏ hơn đường kính ngoài.');
    if(attributes.wall&&attributes.outerDiameter&&2*Number(attributes.wall)>=Number(attributes.outerDiameter))problems.push('Thành ống phải nhỏ hơn bán kính ngoài.');
    var complete=spec.fields.filter(function(f){return f.required;}).every(function(f){return Boolean(attributes[f.id]);});
    var erp=String(data.materialType||spec.defaultMaterialType||'ROH');
    if(['ROH','HALB','HIBE'].indexOf(erp)<0)problems.push('Material Type không hợp lệ.');
    return {ok:problems.length===0&&(allowIncomplete||complete),complete:complete,errors:problems,attributes:attributes,subtype:spec,materialType:erp};
  }
  function dims(sub,a){
    var v=function(k){return a[k]||'—';};
    switch(sub){
      case 'STEEL_PLATE':case 'RUBBER_SHEET':case 'SLIDE_PLATE':return v('thickness')+'x'+v('width')+'x'+v('length');
      case 'STEEL_ROUND':return 'D'+v('diameter')+'x'+v('length');
      case 'STEEL_TUBE':return 'D'+v('outerDiameter')+'x'+v('wall')+'x'+v('length');
      case 'STEEL_SECTION':return v('profile')+v('size')+'x'+v('length');
      case 'RUBBER_PAD':return v('width')+'x'+v('length')+'x'+v('thickness');
      case 'RUBBER_RING':return 'D'+v('outerDiameter')+'x'+v('innerDiameter')+'x'+v('thickness');
      case 'SLIDE_DISC':return 'D'+v('diameter')+'x'+v('thickness');
      case 'HEX_BOLT':case 'SOCKET_BOLT':return 'M'+v('diameter')+'x'+v('length');
    }
    return '';
  }
  function displayName(sub,a){
    var v=function(k){return a[k]||'…';}, suff=a.standard?' · '+a.standard:'';
    var pre={STEEL_PLATE:'Thép tấm',STEEL_ROUND:'Thép tròn đặc',STEEL_TUBE:'Thép ống',STEEL_SECTION:'Thép hình',RUBBER_SHEET:'Cao su tấm',RUBBER_PAD:'Đệm cao su',RUBBER_RING:'Vòng cao su',SLIDE_PLATE:'Tấm trượt',SLIDE_DISC:'Đĩa trượt',HEX_BOLT:'Bu lông lục giác ngoài',SOCKET_BOLT:'Bu lông lục giác chìm'}[sub]||'Vật tư';
    switch(sub){
      case 'STEEL_PLATE':return pre+' '+v('grade')+' · '+v('thickness')+'x'+v('width')+'x'+v('length')+' mm'+suff;
      case 'STEEL_ROUND':return pre+' '+v('grade')+' · Ø'+v('diameter')+'x'+v('length')+' mm'+suff;
      case 'STEEL_TUBE':return pre+' '+v('grade')+' · Ø'+v('outerDiameter')+'x'+v('wall')+'x'+v('length')+' mm'+suff;
      case 'STEEL_SECTION':return pre+' '+v('profile')+' '+v('size')+' '+v('grade')+' · L'+v('length')+' mm'+suff;
      case 'RUBBER_SHEET':return pre+' '+v('compound')+' · '+v('hardness')+' Shore A · '+v('thickness')+'x'+v('width')+'x'+v('length')+' mm';
      case 'RUBBER_PAD':return pre+' '+v('compound')+' · '+v('hardness')+' Shore A · '+v('width')+'x'+v('length')+'x'+v('thickness')+' mm';
      case 'RUBBER_RING':return pre+' '+v('compound')+' · '+v('hardness')+' Shore A · Ø'+v('outerDiameter')+'xØ'+v('innerDiameter')+'x'+v('thickness')+' mm';
      case 'SLIDE_PLATE':return pre+' '+v('compound')+' · '+v('thickness')+'x'+v('width')+'x'+v('length')+' mm · '+v('surface');
      case 'SLIDE_DISC':return pre+' '+v('compound')+' · Ø'+v('diameter')+'x'+v('thickness')+' mm · '+v('surface');
      case 'HEX_BOLT':case 'SOCKET_BOLT':return pre+' '+v('standard')+' · '+v('strength')+' · M'+v('diameter')+'x'+v('length')+' · '+v('finish');
    }
    return pre;
  }
  function build(config,data){
    var check=validate(config,data,false);
    if(!check.ok||!check.complete)throw new Error(check.errors[0]||'Thiếu thuộc tính nhận dạng vật tư.');
    var a=check.attributes,s=check.subtype;
    var name=displayName(s.id,a);
    if(name.length>160)throw new Error('Tên sinh tự động quá dài (tối đa 160 ký tự).');
    var detail= a.hardness?'Độ cứng: '+a.hardness+' Shore A':'';
    if(a.surface)detail+=(detail?'; ':'')+'Bề mặt: '+a.surface;
    if(a.finish)detail+=(detail?'; ':'')+'Hoàn thiện: '+a.finish;
    return {name:name,categoryId:data.categoryId,unit:s.unit,materialType:check.materialType,
      grade:a.grade||a.compound||a.strength||'',standard:a.standard||'',dimensions:dims(s.id,a),
      technicalSpecification:detail,notes:safeText(data.notes||'',500)||'',
      attributesJson:JSON.stringify({version:VERSION,subtypeId:s.id,attributes:a})};
  }
  function inferOldSubtype(m){
    var cat=String(m.categoryId||''),n=key(m.name||'');
    if(cat==='THEP'){
      if(n.indexOf('THEP TAM')>=0)return 'STEEL_PLATE';
      if(n.indexOf('THEP TRON')>=0)return 'STEEL_ROUND';
      if(n.indexOf('THEP ONG')>=0)return 'STEEL_TUBE';
      if(n.indexOf('THEP HINH')>=0)return 'STEEL_SECTION';
    }
    if(cat==='CAO_SU'){
      if(n.indexOf('VONG')>=0)return 'RUBBER_RING';
      if(n.indexOf('DEM')>=0)return 'RUBBER_PAD';
      if(n.indexOf('CAO SU TAM')>=0)return 'RUBBER_SHEET';
    }
    if(cat==='TAM_TRUOT'){
      if(n.indexOf('TRON')>=0||/D\d+/i.test(String(m.dimensions||'')))return 'SLIDE_DISC';
      return 'SLIDE_PLATE';
    }
    if(cat==='BU_LONG'){
      if(n.indexOf('LUC GIAC CHIM')>=0)return 'SOCKET_BOLT';
      if(n.indexOf('BU LONG')>=0||n.indexOf('BULONG')>=0)return 'HEX_BOLT';
    }
    return '';
  }
  function fromExisting(config,m){
    try{
      if(m.attributesJson){
        var v=JSON.parse(m.attributesJson);
        if(v.version===VERSION&&v.attributes&&findSubtype(config,m.categoryId,v.subtypeId))
          return {categoryId:m.categoryId,subtypeId:v.subtypeId,attributes:v.attributes,legacy:false};
      }
    }catch(_){ /* legacy row with no structured attributes */ }
    var subtype=inferOldSubtype(m);
    if(!subtype)return null;
    var dimsText=fold(m.dimensions||'').replace(/[×X]/g,'x');
    var tokens=(dimsText.match(/\d+(?:[.,]\d+)?/g)||[]).map(function(n){return numeric(n)||'';});
    var a={},g=fold(m.grade||''),std=fold(m.standard||'');
    if(['STEEL_PLATE','STEEL_ROUND','STEEL_TUBE','STEEL_SECTION'].indexOf(subtype)>=0)a.grade=g;
    if(['RUBBER_SHEET','RUBBER_PAD','RUBBER_RING','SLIDE_PLATE','SLIDE_DISC'].indexOf(subtype)>=0)a.compound=g;
    if(['HEX_BOLT','SOCKET_BOLT'].indexOf(subtype)>=0){
      a.strength=g; if(subtype==='HEX_BOLT'&&std)a.standard=std;
    }
    if(std)a.standard=std;
    if(subtype==='STEEL_PLATE'||subtype==='RUBBER_SHEET'||subtype==='SLIDE_PLATE'){
      a.thickness=tokens[0]||'';a.width=tokens[1]||'';a.length=tokens[2]||'';
    }else if(subtype==='STEEL_ROUND'){
      a.diameter=tokens[0]||'';a.length=tokens[1]||'';
    }else if(subtype==='STEEL_TUBE'){
      a.outerDiameter=tokens[0]||'';a.wall=tokens[1]||'';a.length=tokens[2]||'';
    }else if(subtype==='STEEL_SECTION'){
      a.length=tokens[tokens.length-1]||'';
    }else if(subtype==='RUBBER_PAD'){
      a.width=tokens[0]||'';a.length=tokens[1]||'';a.thickness=tokens[2]||'';
    }else if(subtype==='RUBBER_RING'){
      a.outerDiameter=tokens[0]||'';a.innerDiameter=tokens[1]||'';a.thickness=tokens[2]||'';
    }else if(subtype==='SLIDE_DISC'){
      a.diameter=tokens[0]||'';a.thickness=tokens[1]||'';
    }else if(subtype==='HEX_BOLT'||subtype==='SOCKET_BOLT'){
      a.diameter=tokens[0]||'';a.length=tokens[1]||'';
    }
    return {categoryId:m.categoryId,subtypeId:subtype,attributes:a,legacy:true};
  }
  function compare(config,candidate,other){
    if(candidate.categoryId!==other.categoryId)return null;
    var a=fromExisting(config,other);
    if(!a||a.subtypeId!==candidate.subtypeId)return null;
    var spec=findSubtype(config,candidate.categoryId,candidate.subtypeId),mine=candidate.attributes;
    var comparisons=0,matches=0,unknown=0,requiredEqual=true,mismatches=0;
    spec.fields.forEach(function(f){
      if(f.identity===false)return;
      var cv=mine[f.id]||'',ov=a.attributes[f.id]||'';
      if(!cv)return;
      if(!ov){unknown++;return;}
      comparisons++;
      var ok=key(cv)===key(ov);
      if(ok)matches++;else{mismatches++;if(f.required)requiredEqual=false;}
    });
    var totalIdentity=spec.fields.filter(function(f){return f.identity!==false;}).length;
    var exact=mismatches===0&&spec.fields.every(function(f){
      if(f.identity===false)return true;
      var cv=mine[f.id]||'',ov=a.attributes[f.id]||'';
      if(!cv&&!ov)return true;
      return Boolean(cv&&ov&&key(cv)===key(ov));
    });
    // Legacy rows may omit optional standard. If both are omitted, that
    // attribute should be treated as equal rather than unknown.
    if(!exact&&a.legacy){
      exact=mismatches===0&&spec.fields.every(function(f){
        if(f.identity===false)return true;
        var cv=mine[f.id]||'',ov=a.attributes[f.id]||'';
        if(!cv&&!ov)return true;
        return cv&&ov&&key(cv)===key(ov);
      });
    }
    if(exact)return {level:'exact',score:100,code:other.code,name:other.name,reason:'Trùng toàn bộ thuộc tính nhận dạng'};
    var denom=Math.max(1,comparisons+unknown),score=matches/denom;
    if(matches>=2&&(score>=0.4||mismatches<=1))return {level:'similar',score:Math.round(score*90),code:other.code,name:other.name,reason:a.legacy&&unknown?'Mã lịch sử thiếu một số thuộc tính; cần đối chiếu':'Có '+matches+' thuộc tính trùng'};
    return null;
  }
  function checkMatches(config,data,materials){
    var v=validate(config,data,true);
    if(!v.subtype)return {level:'idle',exact:[],similar:[],complete:false,errors:v.errors};
    var present=v.subtype.fields.filter(function(f){return !!v.attributes[f.id];}).length;
    if(present<2)return {level:'idle',exact:[],similar:[],complete:false,errors:v.errors};
    var candidate={categoryId:data.categoryId,subtypeId:data.subtypeId,attributes:v.attributes};
    var found=[];
    (materials||[]).forEach(function(other){var res=compare(config,candidate,other);if(res)found.push(res);});
    found.sort(function(a,b){return (a.level==='exact'?-1:0)-(b.level==='exact'?-1:0)||b.score-a.score;});
    var exact=found.filter(function(x){return x.level==='exact';}),similar=found.filter(function(x){return x.level==='similar';});
    return {level:exact.length?'exact':similar.length?'similar':(v.complete&&v.ok?'none':'incomplete'),exact:exact.slice(0,6),similar:similar.slice(0,5),complete:v.complete&&v.ok,errors:v.errors};
  }
  return {VERSION:VERSION,validate:validate,build:build,findSubtype:findSubtype,checkMatches:checkMatches,fromExisting:fromExisting,numeric:numeric,fold:fold,displayName:displayName};
})();
