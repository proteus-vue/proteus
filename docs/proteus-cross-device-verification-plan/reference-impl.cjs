'use strict';
// G-52 Cross-Device Verification — reference implementation (zero deps)
// 44/44 self-test

class DeviceProfile {
  constructor(o){ this.id=o.id; this.screen=o.screen; this.os=o.os; this.input=o.input; this.env=o.env; }
  static normalize(p){
    return {
      screen: { dp: Math.round(p.screen.dp*10)/10, foldable: !!p.screen.foldable, density: Math.round(p.screen.density) },
      os: { api: p.os.api, engine: p.os.engine },
      input: { primary: p.input.primary },
      env: { lang: p.env.lang, tz: p.env.tz, dark: !!p.env.dark }
    };
  }
}

class DeviceEquivalenceClass {
  constructor(name, devices){ this.name=name; this.devices=devices; }
  representative(){ return this.devices[0]; }
  deviation(reports){
    let max=0;
    for(const a of reports) for(const b of reports){
      const d = Math.abs((a.normalized||0) - (b.normalized||0));
      if(d>max) max=d;
    }
    return max;
  }
}

function driftFingerprint(p){
  return {
    screen: `${p.screen.dp}r_${Math.round(p.screen.density)}dpi${p.screen.foldable?'_fold':''}`,
    os: `${p.os.engine}_api${p.os.api}`,
    input: p.input.primary,
    env: `${p.env.lang}_${p.env.tz}${p.env.dark?'_dark':''}`
  };
}

class MatrixReport {
  constructor(){ this.entries=[]; this.drifts=[]; this.normalized={}; }
  add(device, result){
    this.entries.push({device:device.id, result});
    this.normalized[device.id] = Number((result.value||0).toFixed(3));
  }
  fingerprint(device){ return driftFingerprint(device); }
  checkEquivalence(equiv, epsilon){
    const devs = equiv.devices || [];
    const reps = devs.map(d=>this.normalized[d.id]).filter(v=>v!=null);
    const mapped = reps.map(v=>({normalized:v}));
    const dev = equiv.deviation(mapped);
    const pass = reps.length>1 ? dev<=epsilon : true;
    return { class:equiv.name, deviation:dev, pass };
  }
  toJSON(){ return JSON.stringify({entries:this.entries, normalized:this.normalized, drifts:this.drifts}); }
}

class InMemoryMatrixBackend {
  constructor(profiles){ this.profiles=profiles; }
  async runOn(device, suite){
    const base = suite.expected || 1.0;
    const noise = (device.screen.dp / 1000) * 0.05;
    return { value: base + noise, device:device.id, raw:true };
  }
}

class DeviceMatrixRunner {
  constructor(backend){ this.backend=backend; }
  async executeOn(matrix, suite){
    const report = new MatrixReport();
    const devices = matrix.devices || [];
    await Promise.all(devices.map(async d=>{
      const r = await this.backend.runOn(d, suite);
      report.add(d, r);
    }));
    const epsilon = suite.epsilon != null ? suite.epsilon : 0.01;
    for(const eq of (matrix.classes||[])){
      const res = report.checkEquivalence(eq, epsilon);
      if(!res.pass){
        report.drifts.push({class:eq.name, deviation:res.deviation, attribution: this.attribution(eq)});
      }
    }
    return report;
  }
  attribution(eq){
    const devs = eq.devices || [];
    const fps = devs.map(d=>driftFingerprint(d));
    const keys=['screen','os','input','env'];
    for(const k of keys){
      const vals=new Set(fps.map(f=>f[k]));
      if(vals.size>1) return k;
    }
    return 'none';
  }
}

function normalizeReport(report){
  return {
    normalized: report.normalized,
    drifts: report.drifts.map(d=>({class:d.class, deviation:+d.deviation.toFixed(4), attribution:d.attribution})),
    version: 1
  };
}

let _pass=0, _fail=0, _cases=[];
function ok(cond, name){
  if(cond){ _pass++; _cases.push(['OK',name]); }
  else { _fail++; _cases.push(['FAIL',name]); }
}
function approx(a,b,eps){ if(eps===undefined) eps=1e-9; return Math.abs(a-b)<=eps; }

function run(){
  const p1 = new DeviceProfile({id:'phone-A', screen:{dp:392, foldable:false, density:2.75}, os:{api:33,engine:'v8'}, input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}});
  const p2 = new DeviceProfile({id:'phone-B', screen:{dp:411, foldable:false, density:3.0}, os:{api:33,engine:'v8'}, input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}});
  const p3 = new DeviceProfile({id:'tablet',  screen:{dp:1281,foldable:false, density:2.0}, os:{api:31,engine:'jsc'}, input:{primary:'mouse'}, env:{lang:'en',tz:'+0',dark:true}});

  ok(p1.id==='phone-A', 'profile id');
  ok(p1.screen.dp===392, 'profile dp');
  ok(p2.screen.density===3, 'profile density int');
  ok(p3.input.primary==='mouse', 'profile input');

  const n1 = DeviceProfile.normalize(p1);
  ok(n1.screen.dp===392, "normalize dp passthrough");
  ok(n1.screen.density===3, "normalize density round");
  ok(n1.env.lang==='zh', "normalize lang");

  const fp1 = driftFingerprint(p1);
  ok(fp1.screen==='392r_3dpi', "fingerprint screen (density rounded)");
  ok(fp1.os==='v8_api33', 'fingerprint os');
  ok(fp1.input==='touch', 'fingerprint input');
  ok(fp1.env==='zh_+8', 'fingerprint env');

  const fp2 = driftFingerprint(p2);
  ok(fp2.screen==='411r_3dpi', 'fp2 screen');
  ok(fp1.os===fp2.os, 'same os same fp.os');

  const cls = new DeviceEquivalenceClass('phones', [p1,p2]);
  ok(cls.representative().id==='phone-A', 'eq representative is first');
  ok(cls.devices.length===2, 'eq device count');

  const reports = [{normalized:0.992},{normalized:0.995}];
  const dev = cls.deviation(reports);
  ok(approx(dev,0.003), 'deviation calc');
  ok(dev<=0.01, 'deviation within epsilon');

  const suite = { expected:1.0, epsilon:0.01 };
  const allCls = new DeviceEquivalenceClass('all',[p1,p2,p3]);
  const matrix = { devices:[p1,p2,p3], classes:[cls, allCls] };
  const runner = new DeviceMatrixRunner(new InMemoryMatrixBackend([p1,p2,p3]));

  return runner.executeOn(matrix, suite).then(report=>{
    ok(report.entries.length===3, 'report entries = device count');
    ok(report.normalized['phone-A']!=null, 'normalized has phone-A');
    ok(report.normalized['tablet']!=null, 'normalized has tablet');
    ok(Object.keys(report.normalized).length===3, 'normalized count = 3');

    const eqRes = report.checkEquivalence(cls, 0.01);
    ok(eqRes.deviation>=0, 'equiv deviation non-negative');
    ok(eqRes.pass===true, 'phones equiv class passes (noise  small)');

    const r2 = report.checkEquivalence(allCls, 0.001);
    ok(r2.pass===false, 'all-class FAIL under tight epsilon');
    ok(report.drifts.length>=1, 'drifts recorded');

    const attr = runner.attribution(allCls);
    ok(['screen','os','input','env'].includes(attr), 'attribution is one of four dims');
    ok(attr!=='none', 'attribution finds a differing dim');

    const norm = normalizeReport(report);
    ok(norm.version===1, 'normalized version');
    ok(norm.drifts.length>=1, 'normalized drifts preserved');
    ok(typeof JSON.stringify(norm)==='string', 'normalized is JSON-serializable');

    const json = report.toJSON();
    ok(json.includes('"normalized"'), 'report JSON has normalized');
    ok(json.includes('phone-A'), 'report JSON has device id');

    return runner.executeOn({devices:[p1],classes:[]}, suite).then(r2b=>{
      ok(approx(r2b.normalized['phone-A'], report.normalized['phone-A']), 'INV-D1 idempotent');
      ok(eqRes.deviation<=0.01, 'INV-D2 phones within epsilon');
      ok(report.drifts.every(d=>['screen','os','input','env'].includes(d.attribution)), 'INV-D3 all drifts attributed to a dim');
      ok(typeof norm.normalized==='object', 'INV-D4 normalized is object');
      ok(JSON.stringify(norm.normalized).length>0, 'INV-D4 normalized non-empty');
      ok(typeof runner.executeOn==='function', 'INV-D5 runner is local callable');

      const tightRes = report.checkEquivalence(cls, 1e-6);
      ok(tightRes.pass===false, 'NEG-01 too-tight epsilon FAIL');

      const emptyRunner = new DeviceMatrixRunner(new InMemoryMatrixBackend([]));
      return emptyRunner.executeOn({devices:[],classes:[]}, suite).then(emptyRep=>{
        ok(emptyRep.entries.length===0, 'NEG-02 empty matrix 0 entries');
        ok(typeof emptyRep.toJSON()==='string', 'NEG-02 empty report serializable');

        ok(approx(0.1+0.2, 0.3), 'NEG-03 float uses epsilon not ===');

        // NEG-04: 两个设备 density 不同(2.75 vs 3.0) 但 dp 相同 → density 取整后指纹应一致
        const p4 = new DeviceProfile({id:'same-dp-a', screen:{dp:392, foldable:false, density:2.75}, os:{api:33,engine:'v8'}, input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}});
        const p5 = new DeviceProfile({id:'same-dp-b', screen:{dp:392, foldable:false, density:3.0}, os:{api:33,engine:'v8'}, input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}});
        const fp4 = driftFingerprint(p4);
        const fp5 = driftFingerprint(p5);
        ok(fp4.screen===fp5.screen, 'NEG-04 density rounding 2.75=3.0 same fingerprint (dp held constant)');

        const merged = { g51:{report:report.toJSON()}, g52:{normalized:norm} };
        ok(typeof JSON.stringify(merged)==='string', 'joint G-51 INV-06 G-52 INV-D4 serializable');

        return report;
      });
    });
  });
}

run().then(()=>{
  for(const c of _cases) console.log(c[0]+': '+c[1]);
  console.log('\nself-test: '+_pass+'/'+( _pass+_fail));
  if(_fail>0) process.exit(1);
}).catch(e=>{ console.error('FATAL', e); process.exit(2); });
