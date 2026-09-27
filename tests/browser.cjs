// Requires Playwright and an installed Edge browser. No production test hooks.
// Run: node tests/browser.cjs (CDN access is required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium, devices } = require('playwright');
const root = path.resolve(__dirname, '..');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'unwritten-check-'));
const baseline = execFileSync('git', ['show', 'HEAD:main.js'], { cwd: root, encoding: 'utf8' });
const current = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

const probe = `
window.__check = {
  snapshot: () => ({
    ready: !!pointCloudGroup && pointClouds.length === 18,
    quality: typeof quality === 'undefined' ? 'desktop' : quality.name,
    count: pointClouds.reduce((sum,p) => sum+p.geometry.attributes.position.count,0),
    camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
      fov: camera.fov, near: camera.near, far: camera.far },
    aspect: camera.aspect,
    model: pointCloudGroup?.position.toArray(),
    clouds: pointClouds.map(p => ({name:p.name, position:p.position.toArray(),
      quaternion:p.quaternion.toArray(), scale:p.scale.toArray(),
      originals:Array.from(p.userData.originalPositions.slice(0,12)),
      offsets:Array.from(p.userData.randomOffsets.slice(0,3)),
      directions:Array.from(p.userData.scatterDirections.slice(0,6))})),
    effects: [bloomPass.strength,bloomPass.radius,bloomPass.threshold,saturationPass.uniforms.saturation.value],
    passes: composer.passes.map(p=>p.constructor.name),
    ratio:renderer.getPixelRatio(),canvas:[renderer.domElement.width,renderer.domElement.height],
    composer:[composer.renderTarget1.width,composer.renderTarget1.height],
    bloom:[bloomPass.renderTargetBright.width,bloomPass.renderTargetBright.height],
    imageMax:Math.max(...pointClouds.map(p=>p.material.map ? Math.max(p.material.map.image.width,p.material.map.image.height):0)),
    rendered:typeof renderedFrames === 'undefined' ? frameCount : renderedFrames,
    audio: {level:audioLevel,smooth:smoothAudioLevel,connected:!!analyser},
    rotation:pointCloudGroup?.rotation.y,
    dynamic:pointClouds.every(p=>p.geometry.attributes.position.usage===THREE.DynamicDrawUsage),
    hiddenVertices:(() => {let n=0;pointCloudGroup?.traverse(c=>{if(c.isMesh)n+=c.geometry.attributes.position?.count||0});return n})(),
    positionDelta:pointClouds.length ? pointClouds[0].geometry.attributes.position.array[0]-pointClouds[0].userData.originalPositions[0]:0
  }),
  still: () => {
    if(typeof pauseAnimation !== 'undefined') pauseAnimation();
    window.__stopBaseline=true;
    pointCloudGroup.rotation.y=0;
    pointClouds.forEach(p=>{p.geometry.attributes.position.array.set(p.userData.originalPositions);p.geometry.attributes.position.needsUpdate=true});
    afterimagePass.uniforms.damp.value=0;
    composer.render();
    const gl=renderer.getContext();
    const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
    gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let colored=0,brightness=0,hash=2166136261;
    for(let i=0;i<pixels.length;i+=4){
      const value=pixels[i]+pixels[i+1]+pixels[i+2];
      if(value>15)colored++;
      brightness+=value;
      hash=Math.imul(hash^value,16777619)>>>0;
    }
    const draw=()=>{composer.render();window.__staticFrame=requestAnimationFrame(draw)};
    window.__staticFrame=requestAnimationFrame(draw);
    return {colored,brightness,hash};
  },
  resume: () => {cancelAnimationFrame(window.__staticFrame);window.__stopBaseline=false;startAnimation()},
  hide: value => {
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>value});
    document.dispatchEvent(new Event('visibilitychange'));
  },
  loseContext: () => {
    const extension=renderer.getContext().getExtension('WEBGL_lose_context');
    if(!extension) return false;
    extension.loseContext();
    setTimeout(()=>extension.restoreContext(),300);
    return true;
  }
};`;

function instrument(source) {
  // Same random stream for old/new main.js, independent of UUID allocation in Three.js.
  return `let testSeed=12345;const testRandom=()=>{testSeed=(1664525*testSeed+1013904223)>>>0;return testSeed/4294967296};\n`
    + source.replaceAll('Math.random()', 'testRandom()')
      .replace('function animate() {','function animate() { if(window.__stopBaseline) return;')
      .replace('new MeshSurfaceSampler(child).build()', 'new MeshSurfaceSampler(child).setRandomGenerator(testRandom).build()')
      .replaceAll('requestAnimationFrame(animate);', 'window.__stopBaseline ? null : requestAnimationFrame(animate);')
    + probe;
}

const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile()){res.writeHead(404).end();return}
    const type={'.html':'text/html','.js':'text/javascript','.glb':'model/gltf-binary'}[path.extname(file)];
    res.writeHead(200,{'Content-Type':type||'application/octet-stream','Content-Length':stat.size});
    fs.createReadStream(file).pipe(res);
  });
});

async function open(browser, url, mobile, source=current, audio='tone') {
  const context=await browser.newContext(mobile
    ? {...devices['iPhone 13'],defaultBrowserType:undefined}
    : {viewport:{width:1280,height:720},deviceScaleFactor:2});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('404')) errors.push(msg.text())});
  page.on('requestfailed',request=>errors.push(request.url()+': '+request.failure()?.errorText));
  await page.addInitScript(mode=>{
    window.__micRequests=0;
    if(mode==='native') {
      const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async constraints=>{
        window.__micRequests++;
        const stream=await capture(constraints);
        window.__tone={stream};
        return stream;
      };
      return;
    }
    if(mode==='resume-waits-for-capture') {
      const resume=AudioContext.prototype.resume;
      AudioContext.prototype.resume=function(){
        if(window.__micRequests===0) return new Promise(()=>{});
        return resume.call(this);
      };
    }
    navigator.mediaDevices.getUserMedia=async()=>{
      window.__micRequests++;
      await new Promise(resolve=>setTimeout(resolve,80));
      if(mode==='denied') throw new DOMException('Test permission denial','NotAllowedError');
      const context=new AudioContext();
      const osc=context.createOscillator();
      const gain=context.createGain();
      const destination=context.createMediaStreamDestination();
      osc.frequency.value=220;gain.gain.value=0.7;
      osc.connect(gain).connect(destination);osc.start();
      await context.resume();
      window.__tone={context,osc,gain,stream:destination.stream};
      return destination.stream;
    };
  },audio);
  await page.route('**/main.js',route=>route.fulfill({contentType:'text/javascript',body:instrument(source)}));
  await page.goto(url);
  await page.waitForFunction(()=>window.__check?.snapshot().ready,null,{timeout:90000});
  await page.waitForTimeout(200);
  assert.deepEqual(errors,[],`load errors: ${errors.join('\n')}`);
  return {context,page,errors};
}

async function run() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'msedge',args:['--autoplay-policy=no-user-gesture-required']});
  try {
    const old=await open(browser,url,false,baseline);
    const oldState=await old.page.evaluate(()=>window.__check.snapshot());
    const beforePixels=await old.page.evaluate(()=>window.__check.still());
    await old.page.screenshot({path:path.join(artifacts,'desktop-before.png')});
    await old.context.close();
    console.log('PASS baseline loaded',oldState.count);

    const pc=await open(browser,url,false);
    const pcState=await pc.page.evaluate(()=>window.__check.snapshot());
    for(const key of ['count','camera','model','clouds','effects','passes','ratio','canvas','composer','bloom','imageMax']) {
      assert.deepEqual(pcState[key],oldState[key],`desktop regression: ${key}`);
    }
    assert.equal(pcState.hiddenVertices,0);
    assert.equal(pcState.dynamic,true);
    const afterPixels=await pc.page.evaluate(()=>window.__check.still());
    console.log('Desktop pixel summaries', {beforePixels,afterPixels});
    assert.deepEqual(afterPixels,beforePixels,'desktop static rendering changed');
    await pc.page.screenshot({path:path.join(artifacts,'desktop-after.png')});
    console.log('PASS desktop framing, transforms, sampled points, effects and resolution identical');
    await pc.page.evaluate(()=>{window.__check.resume();document.body.click();document.body.click();document.body.click()});
    await pc.page.waitForFunction(()=>window.__check.snapshot().audio.level>0.01);
    assert.equal(await pc.page.evaluate(()=>window.__micRequests),1);
    await pc.page.setViewportSize({width:1000,height:700});
    await pc.page.waitForTimeout(150);
    const resizedPc=await pc.page.evaluate(()=>window.__check.snapshot());
    assert.deepEqual(resizedPc.canvas,[1100,770]);
    assert.deepEqual(resizedPc.composer.map(Math.floor),resizedPc.canvas);
    assert.equal(resizedPc.aspect,1000/700);
    assert.deepEqual(resizedPc.camera,oldState.camera);
    assert.deepEqual(pc.errors,[]);
    await pc.context.close();
    console.log('PASS desktop microphone reacts; repeated clicks create one stream');

    const mobile=await open(browser,url,true);
    const m=mobile.page;
    const mobileState=await m.evaluate(()=>window.__check.snapshot());
    assert.equal(mobileState.quality,'mobile');
    assert.ok(mobileState.count<100000);
    assert.equal(mobileState.imageMax,2048);
    assert.deepEqual(mobileState.camera,oldState.camera);
    assert.deepEqual(mobileState.model,oldState.model);
    assert.deepEqual(mobileState.effects,oldState.effects);
    assert.deepEqual(mobileState.passes,oldState.passes);
    assert.equal(mobileState.hiddenVertices,0);
    assert.ok(mobileState.canvas[0]*mobileState.canvas[1]<=800000);
    const begin=await m.evaluate(()=>({frame:window.__check.snapshot().rendered,time:performance.now()}));
    await m.waitForTimeout(1200);
    const end=await m.evaluate(()=>({frame:window.__check.snapshot().rendered,time:performance.now()}));
    const fps=(end.frame-begin.frame)*1000/(end.time-begin.time);
    assert.ok(fps<=32,`mobile frame cap: ${fps}`);
    await m.screenshot({path:path.join(artifacts,'mobile-portrait.png')});
    await m.setViewportSize({width:844,height:390});
    await m.waitForTimeout(200);
    const landscape=await m.evaluate(()=>window.__check.snapshot());
    assert.deepEqual(landscape.canvas,landscape.composer);
    assert.deepEqual(landscape.canvas,[844,390]);
    assert.equal(landscape.aspect,844/390);
    assert.deepEqual(landscape.bloom,[Math.round(Math.round(844*0.65)/2),Math.round(Math.round(390*0.65)/2)]);
    assert.deepEqual(landscape.camera,oldState.camera);
    await m.screenshot({path:path.join(artifacts,'mobile-landscape.png')});
    console.log('PASS mobile model, point budget, effects, orientation; observed FPS',fps.toFixed(1));

    await m.locator('#microphone-controls button').tap();
    await m.evaluate(()=>document.body.click());
    await m.waitForFunction(()=>window.__check.snapshot().audio.level>0.01);
    assert.equal(await m.evaluate(()=>window.__micRequests),1);
    await m.waitForFunction(()=>document.querySelector('#microphone-controls').dataset.state==='running');
    const sound=await m.evaluate(()=>window.__check.snapshot());
    assert.ok(Math.abs(sound.positionDelta)>0.08,'audio must scatter points beyond noise alone');
    await m.evaluate(()=>window.__tone.gain.gain.value=0);
    await m.waitForTimeout(1500);
    const quiet=await m.evaluate(()=>window.__check.snapshot());
    assert.ok(quiet.audio.smooth<sound.audio.smooth,'release must decay');
    await m.evaluate(()=>window.__check.hide(true));
    const paused=await m.evaluate(()=>window.__check.snapshot().rendered);
    await m.waitForTimeout(200);
    assert.equal(await m.evaluate(()=>window.__check.snapshot().rendered),paused);
    await m.evaluate(()=>window.__check.hide(false));
    await m.waitForFunction(frame=>window.__check.snapshot().rendered>frame,paused);
    if(await m.evaluate(()=>window.__check.loseContext())) {
      await m.waitForTimeout(900);
      const restored=await m.evaluate(()=>window.__check.snapshot().rendered);
      await m.waitForFunction(frame=>window.__check.snapshot().rendered>frame,restored);
    }
    await m.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await m.evaluate(()=>window.__tone.stream.getTracks().every(t=>t.readyState==='ended')),true);
    assert.deepEqual(mobile.errors,[]);
    await mobile.context.close();
    console.log('PASS mobile audio attack/release, hide/resume, GPU recovery and track cleanup');

    const denied=await open(browser,url,true,current,'denied');
    await denied.page.locator('#microphone-controls button').tap();
    await denied.page.waitForFunction(()=>document.querySelector('#microphone-message').textContent.includes('권한이 차단'));
    await denied.page.locator('#microphone-controls button').tap();
    await denied.page.waitForFunction(()=>window.__micRequests===2);
    await denied.context.close();
    console.log('PASS denied microphone has visible feedback and can retry');

    const waiting=await open(browser,url,true,current,'resume-waits-for-capture');
    await waiting.page.locator('#microphone-controls button').tap();
    await waiting.page.waitForFunction(()=>window.__check.snapshot().audio.level>0.01);
    assert.equal(await waiting.page.evaluate(()=>window.__micRequests),1);
    await waiting.page.waitForFunction(()=>document.querySelector('#microphone-controls').dataset.state==='running');
    await waiting.page.locator('#microphone-controls button').tap();
    assert.equal(await waiting.page.evaluate(()=>window.__tone.stream.getTracks().every(t=>t.readyState==='ended')),true);
    await waiting.page.locator('#microphone-controls button').tap();
    await waiting.page.waitForFunction(()=>window.__micRequests===2 && window.__check.snapshot().audio.level>0.01);
    assert.deepEqual(waiting.errors,[]);
    await waiting.context.close();
    console.log('PASS microphone request is not blocked by pending audio resume; touch toggle reconnects');

    const insecure=await open(browser,url,true);
    await insecure.page.evaluate(()=>Object.defineProperty(window,'isSecureContext',{value:false,configurable:true}));
    await insecure.page.locator('#microphone-controls button').tap();
    assert.equal(await insecure.page.evaluate(()=>window.__micRequests),0);
    assert.match(await insecure.page.locator('#microphone-message').innerText(),/HTTPS/);
    await insecure.context.close();
    console.log('PASS insecure connections display HTTPS guidance');

    // Real browser capture API with a fake device, without disabling autoplay
    // policy. This tests trusted touch activation rather than script-only clicks.
    const captureBrowser=await chromium.launch({headless:true,channel:'msedge',args:[
      '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'
    ]});
    try {
      const native=await open(captureBrowser,url,true,current,'native');
      await native.page.locator('#microphone-controls button').tap();
      await native.page.waitForFunction(()=>window.__check.snapshot().audio.level>0.01);
      await native.page.waitForFunction(()=>document.querySelector('#microphone-controls').dataset.state==='running');
      assert.equal(await native.page.evaluate(()=>window.__micRequests),1);
      await native.page.screenshot({path:path.join(artifacts,'mobile-microphone.png')});
      assert.deepEqual(native.errors,[]);
      await native.context.close();
    } finally {
      await captureBrowser.close();
    }
    console.log('PASS trusted touch starts native capture under default autoplay policy (fake device)');

    const failedContext=await browser.newContext({...devices['iPhone 13']});
    const failed=await failedContext.newPage();
    let requestedDesktop=false;
    failed.on('request',request=>{if(request.url().endsWith('/ptc.glb')) requestedDesktop=true});
    await failed.route('**/ptc-mobile.glb',route=>route.fulfill({status:503,body:'Test unavailable asset'}));
    await failed.goto(url);
    await failed.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('작품을 불러오지 못했습니다'));
    assert.equal(requestedDesktop,false,'failed mobile asset must not silently load the much larger desktop asset');
    await failedContext.close();
    console.log('PASS model load failure displays feedback without a heavy fallback');
    console.log('Screenshots:',artifacts);
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1});
