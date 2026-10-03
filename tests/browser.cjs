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
  glowContrast: () => {
    pauseAnimation();
    const point=hiddenRecords.screenPosition(), selected=hiddenRecords.selected;
    const gl=renderer.getContext(), rect=renderer.domElement.getBoundingClientRect();
    const ratio=renderer.domElement.width/rect.width;
    const x=Math.floor((point.x-rect.left)*ratio)-6;
    const y=Math.floor(renderer.domElement.height-(point.y-rect.top)*ratio)-6;
    const pixels=new Uint8Array(12*12*4);
    const measure=material=>{
      selected.cloud.material=material;
      renderer.setRenderTarget(null);
      renderer.render(scene,camera);
      gl.readPixels(x,y,12,12,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let white=0;
      for(let i=0;i<pixels.length;i+=4) if(pixels[i]>245&&pixels[i+1]>245&&pixels[i+2]>245)white++;
      return white;
    };
    const normal=measure(hiddenRecords.active.original), glow=measure(hiddenRecords.active.material);
    startAnimation();
    return {normal,glow};
  },
  record: () => typeof hiddenRecords === 'undefined' ? null : ({
    title:hiddenRecords.record?.title, record:hiddenRecords.record,
    selected:hiddenRecords.selected?.index, screen:hiddenRecords.screenPosition(),
    materialActive:hiddenRecords.selected?.cloud.material===hiddenRecords.active?.material
  }),
  microphone: () => ({
    state:document.querySelector('#microphone-controls').dataset.state,
    pending:microphonePending,context:audioContext?.state,
    streamActive:microphoneStream?.active,track:microphoneStream?.getAudioTracks()[0]?.readyState,
    sameContext:audioContext===window.__heldMicrophoneContext,
    sameStream:microphoneStream===window.__heldMicrophoneStream
  }),
  holdMicrophone: () => {
    window.__heldMicrophoneContext=audioContext;
    window.__heldMicrophoneStream=microphoneStream;
  },
  suspendMicrophone: async () => {
    await audioContext.suspend(); updateMicrophoneState();
  },
  closeMicrophoneContext: async () => {
    await audioContext.close(); updateMicrophoneState();
  },
  endMicrophoneTrack: () => {
    const track=microphoneStream.getAudioTracks()[0];
    track.stop(); track.dispatchEvent(new Event('ended'));
  },
  retargetContinuity: word => {
    const shape = () => {
      const t=textMorph.source ? textMorph.textProgress : 1;
      const a=textMorph.source ? textMorph.scaleFor(textMorph.source)*(1-t) : 0;
      const b=textMorph.scaleFor(textMorph.text)*t;
      return pointClouds.flatMap((_,index)=>Array.from(textMorph.text.targets[index].slice(0,30),
        (v,i)=>v*b+(textMorph.source ? textMorph.source.targets[index][i]*a : 0)));
    };
    const before=shape(), blend=textMorph.blend;
    textMorph.search(word);
    const after=shape();
    return {error:Math.max(...before.map((v,i)=>Math.abs(v-after[i]))),blendChange:textMorph.blend-blend};
  },
  verifyReturn: () => {
    frameCount=1; renderSchedule=null; lastPointUpdate=null;
    animate(performance.now()); pauseAnimation();
    const t=lastPointUpdate*0.001;
    const strength=Math.max(0,smoothAudioLevel-0.01)*20;
    let mismatches=0;
    for(const p of pointClouds) {
      const u=p.userData, a=p.geometry.attributes.position.array;
      for(let i=0;i<u.randomOffsets.length;i++) {
        const j=i*3,o=u.randomOffsets[i],s=strength*u.scaleCompensation;
        const moves=[Math.sin(t*1.2+o)*0.08,Math.sin(t*1.2*0.73+o*1.7)*0.08,Math.cos(t*1.2*0.91+o*2.3)*0.08];
        for(let k=0;k<3;k++) if(a[j+k]!==Math.fround(u.originalPositions[j+k]+moves[k]+u.scatterDirections[j+k]*s))mismatches++;
      }
    }
    startAnimation(); return mismatches;
  },
  morph: () => ({blend:textMorph.blend, cache:textMorph.cache.size, word:textMorph.word, progress:textMorph.textProgress,
    targets:textMorph.text?.targets.map(t=>t.length),
    originals:pointClouds.map(p=>p.userData.originalPositions.reduce((a,b)=>a+b,0)),
    finite:pointClouds.every(p=>p.geometry.attributes.position.array.every(Number.isFinite)),
    culling:pointClouds.map(p=>p.frustumCulled)}),
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
    const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary'}[path.extname(file)];
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
  await page.waitForFunction(()=>window.__check?.snapshot().ready,null,{timeout:90000}).catch(async error=>{
    console.error('Load diagnostics',errors,await page.locator('body').innerText());
    throw error;
  });
  await page.waitForTimeout(200);
  assert.deepEqual(errors,[],`load errors: ${errors.join('\n')}`);
  return {context,page,errors};
}

async function checkMorph(page, label) {
  const input=page.locator('#point-search-input');
  const search=async word=>{await input.fill(word);await input.press('Enter');};
  const bounds=await input.boundingBox();
  assert.ok(Math.abs(bounds.x+bounds.width/2-page.viewportSize().width/2)<1,'search must be horizontally centered');
  const original=await page.evaluate(()=>window.__check.morph());
  const micRequests=await page.evaluate(()=>window.__micRequests);
  await input.fill('memory보은123!');
  await input.blur();
  assert.equal(await input.inputValue(),'memory');
  await input.fill('나의 기억들');
  await input.blur();
  assert.equal(await input.inputValue(),'나의 기억');
  await input.fill('heritages');
  assert.equal(await input.inputValue(),'heritage');
  await input.fill('');
  await input.evaluate(element=>{
    element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    element.value='보으';
    element.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
    element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
    element.form.requestSubmit();
  });
  assert.equal(await input.inputValue(),'보으');
  assert.equal((await page.evaluate(()=>window.__check.morph())).blend,0);
  await input.evaluate(element=>{
    element.value='보은';
    element.dispatchEvent(new CompositionEvent('compositionend',{data:'은',bubbles:true}));
    element.dispatchEvent(new InputEvent('input',{bubbles:true}));
  });
  assert.equal(await input.inputValue(),'보은');
  assert.equal(await page.evaluate(()=>window.__micRequests),micRequests);
  await input.press('Enter');
  await page.waitForFunction(()=>window.__check.morph().blend>0);
  assert.equal((await page.evaluate(()=>window.__check.morph())).word,'보은');
  await search('');
  await page.waitForFunction(()=>window.__check.morph().blend===0);
  await page.evaluate(()=>{if(window.__tone)window.__tone.gain.gain.value=0});
  for(let cycle=0;cycle<2;cycle++) {
    await search('보은');
    await page.waitForFunction(()=>window.__check.morph().blend===1);
    const text=await page.evaluate(()=>window.__check.morph());
    assert.equal(text.targets.length,18);
    assert.ok(text.cache<=2);
    assert.ok(text.finite);
    assert.deepEqual(text.originals,original.originals);
    assert.ok(text.culling.every(v=>v===false));
    if(cycle===0) {
      await page.waitForTimeout(1500);
      await page.screenshot({path:path.join(artifacts,`${label}-text.png`)});
      if(label==='mobile') {
        const viewport=page.viewportSize();
        await page.setViewportSize({width:390,height:844});
        await page.waitForTimeout(700);
        await page.screenshot({path:path.join(artifacts,'mobile-text-portrait.png')});
        await page.setViewportSize(viewport);
      }
      await page.evaluate(()=>{if(window.__tone)window.__tone.gain.gain.value=0.7});
      await page.waitForFunction(()=>window.__check.snapshot().audio.level>0.01);
      assert.equal((await page.evaluate(()=>window.__check.morph())).blend,1);
      await page.evaluate(()=>{if(window.__tone)window.__tone.gain.gain.value=0});
    }
    for(const word of ['기억','괴산','집','heritage']) {
      await search(word);
      assert.equal((await page.evaluate(()=>window.__check.morph())).blend,1,'word changes must not return through 3D');
      await page.waitForFunction(()=>window.__check.morph().progress===1);
      assert.equal((await page.evaluate(()=>window.__check.morph())).word,word);
    }
    if(cycle===0) await page.screenshot({path:path.join(artifacts,`${label}-heritage.png`)});
    await search('   ');
    await page.waitForFunction(()=>window.__check.morph().blend===0);
    const restored=await page.evaluate(()=>window.__check.morph());
    assert.deepEqual(restored.originals,original.originals);
    assert.deepEqual(restored.culling,original.culling);
    assert.ok(restored.finite);
    assert.equal(await page.evaluate(()=>window.__check.verifyReturn()),0,'all positions must exactly match original animation formula on return');
  }
  await search('보은');
  await page.waitForFunction(()=>window.__check.morph().blend>0.1);
  await search('기억');
  await page.waitForFunction(()=>window.__check.morph().progress>0.1);
  const continuity=await page.evaluate(()=>window.__check.retargetContinuity('memory'));
  assert.ok(continuity.error<0.000001,'retargeting must preserve current text coordinates');
  assert.equal(continuity.blendChange,0);
  await search('');
  await page.waitForFunction(()=>window.__check.morph().blend===0);
  assert.equal(await page.evaluate(()=>document.activeElement.id==='point-search-input'),false);
  console.log(`PASS ${label} all-cloud text morph, audio, repeated return, reversal and immutable originals`);
}

async function checkRecords(page, label) {
  const before = await page.evaluate(()=>window.__check.snapshot());
  const input = page.locator('#point-search-input');
  const submit = async word => { await input.fill(word); await input.press('Enter'); };
  const ready = async () => {
    await page.waitForFunction(()=>window.__check.record().materialActive && !document.querySelector('#record-point').hidden);
  };
  const openNote = async () => {
    const point = await page.evaluate(()=>window.__check.record().screen);
    if (label==='mobile') await page.touchscreen.tap(point.x,point.y);
    else await page.mouse.click(point.x,point.y);
    await page.waitForFunction(()=>document.querySelector('#record-note').classList.contains('is-open'));
    await page.waitForTimeout(650);
  };
  const checkBounds = async () => {
    const bounds = await page.locator('#record-note').boundingBox();
    // Bounding boxes are CSS coordinates, also when mobile emulation auto-zooms.
    const view=await page.evaluate(()=>({width:visualViewport.width,height:visualViewport.height,x:visualViewport.offsetLeft,y:visualViewport.offsetTop,scale:visualViewport.scale}));
    const inside=bounds.x>=view.x && bounds.y>=view.y && bounds.x+bounds.width<=view.x+view.width+1 && bounds.y+bounds.height<=view.y+view.height+1;
    if(!inside) await page.screenshot({path:path.join(artifacts,`${label}-record-bounds-failed.png`)});
    assert.ok(inside,JSON.stringify({bounds,view}));
    assert.ok(bounds.height<=view.height*.69);
    assert.ok(bounds.width<=view.width*.88);
  };
  await page.evaluate(()=>{if(window.__tone?.gain)window.__tone.gain.gain.value=0});
  await submit('어업');
  await ready();
  const first = await page.evaluate(()=>window.__check.record());
  assert.ok(first.record.keywords.includes('어업'));
  const contrast=await page.evaluate(()=>window.__check.glowContrast());
  assert.ok(contrast.glow>contrast.normal,`selected point must visibly glow: ${JSON.stringify(contrast)}`);
  await page.screenshot({path:path.join(artifacts,`${label}-record-point.png`)});
  await openNote();
  assert.equal(await page.locator('#record-title').textContent(),first.title);
  assert.equal(await page.locator('.record-region').textContent(),first.record.region);
  const paragraphs = await page.locator('.record-content p').allTextContents();
  assert.deepEqual(paragraphs,first.record.content.split(/\r\n|\r|\n/));
  await checkBounds();
  await page.screenshot({path:path.join(artifacts,`${label}-record.png`)});
  await page.locator('#record-close').click();
  await page.waitForFunction(()=>document.querySelector('#record-note').hidden);
  assert.equal(await page.evaluate(()=>window.__check.morph().word),'어업');
  await openNote();
  assert.equal(await page.locator('#record-title').textContent(),first.title,'reopening a session must preserve its record');
  await submit('어업'); // New search safely removes even an open paper.
  await ready();
  assert.equal(await page.locator('#record-note').evaluate(el=>el.hidden),true);
  assert.notEqual(await page.evaluate(()=>window.__check.record().title),first.title);
  await submit('어촌계');
  await ready();
  assert.ok(await page.evaluate(()=>window.__check.record().record.keywords.includes('어촌계')));
  await openNote();
  const scrolled = await page.locator('.record-scroll').evaluate(el=>{
    el.scrollTop=el.scrollHeight;
    return {top:el.scrollTop,overflow:el.scrollHeight>el.clientHeight};
  });
  assert.ok(scrolled.overflow && scrolled.top>0,'long record must scroll internally');
  await page.locator('#credits-toggle').click();
  assert.equal(await page.locator('#record-note').evaluate(el=>el.hidden),true);
  assert.equal(await page.locator('#record-point').isVisible(),false);
  await page.locator('#gallery-open').click();
  assert.equal(await page.locator('#record-point').isVisible(),false);
  await page.locator('#gallery-close').click();
  await page.locator('#credits-toggle').click();
  await ready();
  // Restore portrait for a real mobile paper; then rotate while reading.
  if(label==='mobile') {
    await page.setViewportSize({width:390,height:844});
    // Let the existing 30fps morph loop project targets into the new aspect.
    await page.waitForTimeout(120);
  }
  await openNote();
  await checkBounds();
  await page.screenshot({path:path.join(artifacts,`${label}-record-long.png`)});
  if(label==='mobile') {
    await page.setViewportSize({width:844,height:390});
    await page.waitForTimeout(100);
    await checkBounds();
  }
  await submit('memory');
  await page.waitForFunction(()=>window.__check.morph().word==='memory' && window.__check.morph().progress===1);
  assert.equal(await page.evaluate(()=>window.__check.record().record),null);
  assert.equal(await page.locator('#record-point').isVisible(),false);
  assert.equal(await page.locator('#record-note').isVisible(),false);
  await submit('');
  await page.waitForFunction(()=>window.__check.morph().blend===0);
  assert.equal(await page.evaluate(()=>window.__check.verifyReturn()),0);
  const after = await page.evaluate(()=>window.__check.snapshot());
  for(const key of ['count','clouds','effects','passes','camera']) assert.deepEqual(after[key],before[key],`record regression: ${key}`);
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.endsWith('/data/records.json')).length),1,'record data should only load once');
  console.log(`PASS ${label} records: existing vertex, keyword lookup, same-session reopen, new search, bounds, scroll, Credits/Gallery, exact return`);
}

async function checkNavigation(page,label) {
  const micRequests=await page.evaluate(()=>window.__micRequests);
  await page.locator('#credits-toggle').click();
  await page.waitForTimeout(750);
  assert.equal(await page.locator('#intro-content h1').textContent(),'쓰여지지 않은 마을, 쓰여지지 않은 기억들');
  assert.equal(await page.locator('#credits-dialog').isVisible(),false);
  const instagram=page.locator('.intro-instagram');
  assert.equal(await instagram.textContent(),'instagram @newlog.saelog_cb');
  assert.equal(await instagram.getAttribute('href'),'https://www.instagram.com/newlog.saelog_cb/');
  assert.equal(await instagram.getAttribute('target'),'_blank');
  assert.equal(await instagram.getAttribute('rel'),'noopener noreferrer');
  assert.ok((await page.locator('#gallery-open').textContent()).includes('사진첩'));
  assert.ok((await page.locator('#fragments-open').textContent()).startsWith('↓'));
  const typography=await page.locator('.intro-info p').evaluateAll(nodes=>nodes.map(n=>({size:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight})));
  assert.deepEqual(typography[0],typography[1]);
  const shapes=await page.evaluate(()=>['credits-toggle','credits-open'].map(id=>{
    const style=getComputedStyle(document.getElementById(id),'::before');
    return [style.width,style.height];
  }));
  assert.deepEqual(shapes[0],shapes[1]);
  await page.screenshot({path:path.join(artifacts,`${label}-intro.png`)});
  await page.locator('#credits-open').click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#intro-content').evaluate(n=>n.inert),true);
  assert.equal(await page.locator('#credits-content .credits-line').count(),10);
  assert.equal((await page.locator('#credits-content').textContent()).includes('ⓒ'),false);
  const creditBox=await page.locator('#credits-paper').boundingBox();
  const visual=await page.evaluate(()=>({width:visualViewport.width,height:visualViewport.height}));
  assert.ok(creditBox.width<visual.width && creditBox.height<visual.height);
  await page.screenshot({path:path.join(artifacts,`${label}-credits-paper.png`)});
  await page.locator('#credits-close').click();
  await page.waitForFunction(()=>document.querySelector('#credits-dialog').hidden);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'credits-open');
  await page.locator('#fragments-open').click();
  await checkCloud(page,label);
  if(label==='mobile') await page.locator('#fragments-close').tap();
  else await page.locator('#fragments-close').click();
  await page.locator('#credits-toggle').click();
  assert.equal(await page.locator('#point-search-input').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.__micRequests),micRequests);
  return;
  await page.waitForFunction(()=>document.querySelectorAll('.fragment-keyword:not([data-copy])').length===622);
  assert.equal(await page.locator('.fragment-regions').count(),0);
  await page.waitForTimeout(650);
  await page.mouse.move(0,0);
  await page.waitForTimeout(220);
  const keywords=await page.locator('.fragment-keyword:not([data-copy])').allTextContents();
  const records=JSON.parse(fs.readFileSync(path.join(root,'data/records.json'),'utf8'));
  const expected=[...new Set(records.flatMap(r=>r.keywords.map(k=>k.trim())).filter(Boolean))];
  assert.deepEqual([...new Set(keywords)].sort(),expected.sort());
  assert.ok(expected.every(keyword=>keywords.filter(value=>value===keyword).length===2));
  assert.equal(await page.locator('#point-search-input').isVisible(),false);
  const layout=await page.evaluate(()=>{
    const panel=document.querySelector('#memory-fragments');
    const lines=[...document.querySelectorAll('.fragment-line')];
    const uniform=new Set([...document.querySelectorAll('.fragment-keyword')].map(n=>{const s=getComputedStyle(n);return [s.fontSize,s.fontWeight].join('/')}));
    return {overflow:panel.scrollWidth>panel.clientWidth,rows:lines.length,uniform:uniform.size,
      clip:lines.every(line=>{const row=line.firstElementChild;return row.getBoundingClientRect().left<line.getBoundingClientRect().left && row.scrollWidth>line.clientWidth})};
  });
  assert.equal(layout.overflow,false);
  assert.equal(layout.uniform,1);
  assert.ok(layout.rows>5 && layout.clip);
  const returnButton=page.locator('#fragments-close');
  assert.equal(await returnButton.isVisible(),true);
  const returnStyle=await returnButton.evaluate(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {background:s.backgroundColor,border:s.borderTopWidth,shadow:s.boxShadow,color:s.color,tap:s.webkitTapHighlightColor,width:r.width,height:r.height,right:innerWidth-r.right}});
  assert.equal(returnStyle.background,'rgba(0, 0, 0, 0)');
  assert.equal(returnStyle.border,'0px');
  assert.equal(returnStyle.shadow,'none');
  assert.equal(returnStyle.color,'rgb(255, 255, 255)');
  assert.equal(returnStyle.tap,'rgba(0, 0, 0, 0)');
  assert.ok(returnStyle.width>=44 && returnStyle.height>=44 && returnStyle.right>=12);
  const spacing=await page.evaluate(()=>{
    const lines=[...document.querySelectorAll('.fragment-line')];
    const size=parseFloat(getComputedStyle(document.querySelector('#memory-fragments')).fontSize);
    return {size,step:lines[1].getBoundingClientRect().top-lines[0].getBoundingClientRect().top,
      overlap:lines.some((line,index)=>index && line.getBoundingClientRect().top<lines[index-1].getBoundingClientRect().bottom)};
  });
  assert.equal(spacing.overlap,false);
  assert.ok(Math.abs(spacing.step/spacing.size-1.25)<0.02);
  assert.equal(await page.locator('.fragment-keyword:not([data-copy])').first().evaluate(n=>getComputedStyle(n).color),'rgb(90, 90, 90)');
  await page.screenshot({path:path.join(artifacts,`${label}-fragments.png`)});
  if(label==='desktop') {
    await returnButton.hover();
    assert.equal(await returnButton.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
    const target=page.locator('.fragment-keyword:not([data-copy])').first();
    const rect=await target.boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y-15);
    await page.waitForTimeout(250);
    assert.notEqual(await target.evaluate(n=>getComputedStyle(n).color),'rgb(90, 90, 90)');
    await target.hover();
    await page.waitForTimeout(250);
    assert.equal(await target.evaluate(n=>getComputedStyle(n).color),'rgb(255, 255, 255)');
  }
  const fishing=page.locator('.fragment-keyword:not([data-copy])').filter({hasText:/^어업$/});
  assert.equal(await fishing.count(),2);
  if(label==='mobile') await fishing.first().tap(); else await fishing.first().click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#record-note').isVisible(),true);
  const firstTitle=await page.locator('#record-title').textContent();
  assert.ok(records.some(r=>r.title===firstTitle && r.keywords.includes('어업')));
  assert.equal(await page.locator('#record-note').count(),1);
  assert.equal(await page.evaluate(async()=>{const {getRecordNote}=await import('./record-note.js');return getRecordNote().element===document.querySelector('#record-note')}),true);
  await page.screenshot({path:path.join(artifacts,`${label}-fragment-record.png`)});
  await page.locator('#record-close').click();
  await page.waitForFunction(()=>document.querySelector('#record-note').hidden);
  if(label==='mobile') await fishing.last().tap(); else await fishing.last().click();
  await page.waitForTimeout(650);
  assert.notEqual(await page.locator('#record-title').textContent(),firstTitle);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('#record-note').hidden);
  if(label==='mobile') await returnButton.tap(); else await returnButton.click();
  assert.equal(await page.locator('#record-note').isVisible(),false);
  await page.locator('#fragments-open').click();
  await page.waitForTimeout(650);
  assert.deepEqual(await page.locator('.fragment-keyword:not([data-copy])').allTextContents(),keywords,'order must persist across visits');
  if(label==='mobile') await returnButton.tap(); else await returnButton.click();
  await page.locator('#credits-toggle').click();
  assert.equal(await page.locator('#point-search-input').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.__micRequests),micRequests,'new UI must not start microphone');
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.endsWith('/data/records.json')).length),1);
  console.log(`PASS ${label} Intro, Credits paper, 311 unique equal-weight keywords, clipping/proximity, shared record UI, return and input isolation`);
}

async function checkCloud(page,label) {
  await page.waitForFunction(()=>document.querySelectorAll('.fragment-keywords button').length===311);
  await page.waitForTimeout(650);
  const regions=page.locator('.fragment-regions button');
  assert.deepEqual(await regions.allTextContents(),['괴산','옥천','보은','단양']);
  const records=JSON.parse(fs.readFileSync(path.join(root,'data/records.json'),'utf8'));
  const expected=[...new Set(records.flatMap(r=>r.keywords.map(k=>k.trim())).filter(Boolean))];
  const keywordButtons=page.locator('.fragment-keywords button');
  const keywords=await keywordButtons.allTextContents();
  assert.equal(keywords.length,expected.length);
  assert.deepEqual([...keywords].sort(),expected.sort());
  const layout=await page.evaluate(()=>{
    const panel=document.querySelector('#memory-fragments');
    const center=document.querySelector('.fragment-regions').getBoundingClientRect();
    const words=document.querySelector('.fragment-keywords').getBoundingClientRect();
    const buttons=[...document.querySelectorAll('.fragment-regions button')];
    const rows=[...document.querySelectorAll('.fragment-keyword-row')];
    const size=n=>parseFloat(getComputedStyle(n).fontSize);
    const first=buttons[0].getBoundingClientRect();
    const last=buttons.at(-1).getBoundingClientRect();
    return {clear:center.bottom<words.top,top:center.top<words.top,
      regionSizes:buttons.map(size),size:size(document.querySelector('.fragment-keywords button')),
      sameRow:buttons.every(b=>Math.abs(b.getBoundingClientRect().top-first.top)<1),
      sameColumn:buttons.every(b=>Math.abs((b.getBoundingClientRect().left+b.getBoundingClientRect().right)/2-(first.left+first.right)/2)<1),
      centered:Math.abs((center.left+center.right)/2-innerWidth/2)<2,
      vertical:panel.scrollHeight>panel.clientHeight,overflow:panel.scrollWidth>innerWidth,
      gutter:words.left,otherGutter:innerWidth-words.right,
      distributed:rows.filter(r=>!r.classList.contains('is-last')).every(r=>{
        const box=r.getBoundingClientRect(), first=r.firstElementChild.getBoundingClientRect(), last=r.lastElementChild.getBoundingClientRect();
        return Math.abs(first.left-box.left)<2 && Math.abs(last.right-box.right)<2;
      }),
      lastNatural:getComputedStyle(rows.at(-1)).justifyContent==='flex-start',
      rowCount:rows.length,
      firstTop:first.top,lastBottom:last.bottom,
      minTouch:Math.min(...[...document.querySelectorAll('.fragment-keywords button')].map(b=>b.getBoundingClientRect().height))};
  });
  assert.ok(layout.clear && layout.top && layout.centered && layout.vertical && !layout.overflow);
  assert.ok(Math.abs(layout.gutter-layout.otherGutter)<2);
  assert.ok(layout.rowCount>5 && layout.distributed && layout.lastNatural);
  if(label==='mobile') {
    assert.ok(layout.sameColumn && !layout.sameRow && layout.size>=18 && layout.size<=22 && layout.minTouch>=44);
    assert.ok(layout.regionSizes.every(size=>size>=32 && size<=40));
  } else {
    assert.ok(layout.sameRow);
    assert.equal(layout.size,25.6);
    assert.ok(layout.regionSizes.every(size=>size===64));
  }
  await page.mouse.move(0,0);
  await page.waitForTimeout(220);
  await page.screenshot({path:path.join(artifacts,`${label}-keywords.png`)});
  const keyword=keywordButtons.last();
  const word=await keyword.textContent();
  assert.equal(await keyword.evaluate(n=>getComputedStyle(n).color),'rgb(90, 90, 90)');
  if(label==='mobile') await keyword.tap(); else await keyword.click();
  const title=await page.locator('#record-title').textContent();
  assert.ok(records.some(r=>r.title===title && r.keywords.includes(word)));
  await page.locator('#record-close').click();
  await page.waitForFunction(()=>document.querySelector('#record-note').hidden);
  for(const region of ['괴산','옥천','보은','단양']) {
    const button=regions.filter({hasText:region});
    if(label==='desktop') {
      await button.hover();
      await page.waitForTimeout(220);
      assert.equal(await button.evaluate(n=>getComputedStyle(n).color),'rgb(255, 255, 255)');
    }
    let previous;
    for(let i=0;i<2;i++) {
      if(label==='mobile') await button.tap(); else await button.click();
      assert.equal(await page.locator('.record-region').textContent(),region);
      const current=await page.locator('#record-title').textContent();
      assert.notEqual(current,previous);
      previous=current;
      await page.locator('#record-close').click();
      await page.waitForFunction(()=>document.querySelector('#record-note').hidden);
    }
  }
  assert.equal(await page.locator('#record-note').count(),1);
  console.log(`PASS ${label} all unique keywords, symmetric gutters, wrapping, scroll, regional header and record selection`);
}

async function run() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'msedge',args:['--autoplay-policy=no-user-gesture-required']});
  try {
    if(process.argv.includes('--navigation-only')) {
      for(const label of ['desktop','mobile']) {
        const session=await open(browser,url,label==='mobile');
        await checkNavigation(session.page,label);
        assert.deepEqual(session.errors,[]);
        await session.context.close();
      }
      console.log('Screenshots:',artifacts);
      return;
    }
    if(process.argv.includes('--viewport-check')) {
      for(const [label,source] of [['baseline',baseline],['current',current]]) {
        const session=await open(browser,url,true,source);
        await session.page.setViewportSize({width:844,height:390});
        await session.page.waitForTimeout(200);
        await session.page.setViewportSize({width:390,height:844});
        await session.page.waitForTimeout(200);
        console.log(label,await session.page.evaluate(()=>({inner:innerWidth,client:document.documentElement.clientWidth,visual:visualViewport.width,scale:visualViewport.scale,canvas:document.querySelector('canvas').getBoundingClientRect().width})));
        await session.context.close();
      }
      return;
    }
    if (process.argv.includes('--records-only')) {
      for (const label of process.argv.includes('--mobile-only') ? ['mobile'] : ['desktop','mobile']) {
        const session = await open(browser,url,label==='mobile');
        assert.equal(await session.page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.endsWith('/data/records.json'))),false,'initial 3D load must not request record data');
        await session.page.route('**/data/records.json',async route=>{
          await new Promise(resolve=>setTimeout(resolve,500));
          await route.continue();
        });
        const input=session.page.locator('#point-search-input');
        await input.fill('어업'); await input.press('Enter');
        await input.fill('memory'); await input.press('Enter');
        await session.page.waitForTimeout(700);
        assert.equal(await session.page.evaluate(()=>window.__check.record().record),null,'stale async results must not activate a point');
        if(label==='mobile') {
          await session.page.setViewportSize({width:844,height:390});
          await session.page.waitForTimeout(120);
        }
        await checkRecords(session.page,label);
        assert.deepEqual(session.errors,[]);
        await session.context.close();
      }
      console.log('Screenshots:',artifacts);
      return;
    }
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
    await pc.page.locator('#credits-toggle').click();
    await pc.page.waitForTimeout(750);
    await pc.page.screenshot({path:path.join(artifacts,'credits-desktop.png')});
    await pc.page.locator('#gallery-open').click();
    await pc.page.waitForFunction(()=>document.querySelector('#gallery-image').naturalWidth>0,null,{timeout:60000});
    await pc.page.waitForTimeout(700);
    await pc.page.screenshot({path:path.join(artifacts,'gallery-desktop.png')});
    await pc.page.locator('#gallery-close').click();
    await pc.page.locator('#credits-toggle').click();
    console.log('PASS desktop framing, transforms, sampled points, effects and resolution identical');
    await pc.page.evaluate(()=>{window.__check.resume();document.body.click();document.body.click();document.body.click()});
    await pc.page.waitForFunction(()=>window.__check.snapshot().audio.level>0.01);
    assert.equal(await pc.page.evaluate(()=>window.__micRequests),1);
    await pc.page.evaluate(()=>window.__check.suspendMicrophone());
    await pc.page.waitForFunction(()=>window.__check.microphone().state==='paused');
    const restartUi=await pc.page.locator('#microphone-controls button').evaluate(button=>{
      button.click();
      const controls=button.closest('#microphone-controls');
      return {hidden:controls.hidden,state:controls.dataset.state};
    });
    assert.deepEqual(restartUi,{hidden:false,state:'pending'},'restart UI must remain visible until recovery succeeds');
    await pc.page.waitForFunction(()=>window.__check.microphone().state==='running');
    assert.equal(await pc.page.evaluate(()=>window.__micRequests),1,'desktop suspended context must reuse capture');
    await pc.page.setViewportSize({width:1000,height:700});
    await pc.page.waitForTimeout(150);
    const resizedPc=await pc.page.evaluate(()=>window.__check.snapshot());
    assert.deepEqual(resizedPc.canvas,[1100,770]);
    assert.deepEqual(resizedPc.composer.map(Math.floor),resizedPc.canvas);
    assert.equal(resizedPc.aspect,1000/700);
    assert.deepEqual(resizedPc.camera,oldState.camera);
    assert.deepEqual(pc.errors,[]);
    await checkMorph(pc.page,'desktop');
    await checkRecords(pc.page,'desktop');
    await checkNavigation(pc.page,'desktop');
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
    const galleryRequests=[];
    m.on('request',request=>{
      if(request.url().includes('/images/gallery/')) galleryRequests.push(decodeURI(request.url()));
    });
    const creditsViewport=m.viewportSize();
    await m.setViewportSize({width:390,height:400});
    await m.locator('#credits-toggle').tap();
    await m.waitForFunction(()=>document.body.classList.contains('credits-open'));
    await m.waitForTimeout(750);
    const creditsOpen=await m.evaluate(()=>({
      expanded:document.querySelector('#credits-toggle').getAttribute('aria-expanded'),
      hidden:document.querySelector('#credits').getAttribute('aria-hidden'),
      inert:document.querySelector('#credits').inert,
      background:getComputedStyle(document.querySelector('#credits')).backgroundColor,
      text:getComputedStyle(document.querySelector('#credits')).color,
      canvasOpacity:getComputedStyle(document.querySelector('canvas')).opacity,
      scrollable:document.querySelector('#intro-content').scrollHeight>document.querySelector('#intro-content').clientHeight,
      micRequests:window.__micRequests
    }));
    assert.deepEqual(creditsOpen,{
      expanded:'true',hidden:'false',inert:false,background:'rgb(255, 255, 255)',
      text:'rgb(0, 0, 0)',canvasOpacity:'0',scrollable:true,micRequests:0
    });
    await m.screenshot({path:path.join(artifacts,'credits-mobile.png'),fullPage:true});
    assert.equal(await m.locator('#point-search-input').isVisible(),false);
    await m.locator('#credits').tap({position:{x:20,y:300}});
    assert.equal(await m.evaluate(()=>window.__micRequests),0,'credits input reached microphone handler');
    assert.equal(galleryRequests.length,0,'gallery image loaded before gallery entry');
    await m.locator('#gallery-open').tap();
    assert.equal(await m.locator('#point-search-input').isVisible(),false);
    await m.waitForFunction(()=>document.body.classList.contains('gallery-open'));
    await m.waitForFunction(()=>{
      const image=document.querySelector('#gallery-image');
      return image.complete && image.naturalWidth>0;
    },null,{timeout:60000});
    assert.deepEqual(galleryRequests,['http://127.0.0.1:'+new URL(m.url()).port+'/images/gallery/괴산/괴산 (1).webp']);
    assert.equal(await m.locator('#gallery-counter').innerText(),'1 / 8');
    assert.equal(await m.locator('.gallery-region[aria-selected="true"]').innerText(),'괴산');
    await m.waitForTimeout(700);
    await m.screenshot({path:path.join(artifacts,'gallery-mobile.png')});
    await m.locator('#gallery-media').tap();
    assert.equal(await m.evaluate(()=>window.__micRequests),0,'gallery input reached microphone handler');
    await m.locator('#gallery-next').tap();
    assert.equal(await m.locator('#gallery-counter').innerText(),'2 / 8');
    await m.waitForFunction(()=>{const i=document.querySelector('#gallery-image');return i.complete&&i.naturalWidth>0});
    await m.locator('.gallery-region',{hasText:'보은'}).tap();
    assert.equal(await m.locator('#gallery-counter').innerText(),'1 / 9');
    await m.waitForFunction(()=>{const i=document.querySelector('#gallery-image');return i.complete&&i.naturalWidth>0});
    await m.evaluate(()=>{
      const media=document.querySelector('#gallery-media');
      const start=new Touch({identifier:1,target:media,clientX:60,clientY:200});
      const end=new Touch({identifier:1,target:media,clientX:150,clientY:202});
      media.dispatchEvent(new TouchEvent('touchstart',{changedTouches:[start],bubbles:true}));
      media.dispatchEvent(new TouchEvent('touchend',{changedTouches:[end],bubbles:true}));
    });
    assert.equal(await m.locator('#gallery-counter').innerText(),'9 / 9');
    await m.waitForFunction(()=>{const i=document.querySelector('#gallery-image');return i.complete&&i.naturalWidth>0});
    await m.locator('#gallery-close').tap();
    await m.waitForFunction(()=>!document.body.classList.contains('gallery-open'));
    assert.equal(await m.locator('#intro-content').getAttribute('aria-hidden'),'false');
    await m.locator('#credits-toggle').tap();
    await m.waitForFunction(()=>!document.body.classList.contains('credits-open'));
    assert.equal(await m.evaluate(()=>document.querySelector('#credits').inert),true);
    await m.setViewportSize(creditsViewport);
    console.log('PASS credits/gallery transitions, lazy loading, swipe and input isolation');
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
    await m.waitForFunction(()=>{
      const state=window.__check.snapshot();
      return state.audio.level>0.01 && Math.abs(state.positionDelta)>0.08;
    });
    assert.equal(await m.evaluate(()=>window.__micRequests),1);
    await m.waitForFunction(()=>document.querySelector('#microphone-controls').dataset.state==='running');
    const sound=await m.evaluate(()=>window.__check.snapshot());
    assert.ok(Math.abs(sound.positionDelta)>0.08,'audio must scatter points beyond noise alone');
    await m.evaluate(()=>{window.__check.holdMicrophone();return window.__check.suspendMicrophone()});
    await m.waitForFunction(()=>window.__check.microphone().state==='paused');
    await m.locator('#microphone-controls button').evaluate(button=>{button.click();button.click()});
    await m.waitForFunction(()=>window.__check.microphone().state==='running' && window.__check.snapshot().audio.level>0.01);
    let recovered=await m.evaluate(()=>window.__check.microphone());
    assert.equal(await m.evaluate(()=>window.__micRequests),1,'suspended context must reuse capture');
    assert.equal(recovered.sameContext,true,'suspended context must be resumed');
    assert.equal(recovered.sameStream,true,'live stream must be reused');

    await m.evaluate(()=>{window.__check.holdMicrophone();return window.__check.closeMicrophoneContext()});
    await m.waitForFunction(()=>window.__check.microphone().state==='paused');
    await m.locator('#microphone-controls button').tap();
    await m.waitForFunction(()=>window.__check.microphone().state==='running');
    recovered=await m.evaluate(()=>window.__check.microphone());
    assert.equal(await m.evaluate(()=>window.__micRequests),1,'closed context with live stream must not recapture');
    assert.equal(recovered.sameContext,false,'closed context must be replaced');
    assert.equal(recovered.sameStream,true,'live stream must connect to the replacement context');

    await m.evaluate(()=>{window.__check.holdMicrophone();window.__check.endMicrophoneTrack()});
    await m.waitForFunction(()=>window.__check.microphone().state==='error');
    await m.locator('#microphone-controls button').evaluate(button=>{button.click();button.click()});
    await m.waitForFunction(()=>window.__micRequests===2 && window.__check.microphone().state==='running' && window.__check.snapshot().audio.level>0.01);
    recovered=await m.evaluate(()=>window.__check.microphone());
    assert.equal(recovered.sameContext,false,'ended capture must create a usable context');
    assert.equal(recovered.sameStream,false,'ended capture must be replaced');
    console.log('PASS microphone restart reuses suspended/live resources, replaces ended/closed resources and deduplicates clicks');
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
    await m.waitForFunction(()=>window.__check.microphone().state==='paused');
    await m.locator('#microphone-controls button').tap();
    await m.waitForFunction(()=>window.__check.microphone().state==='running');
    assert.equal(await m.evaluate(()=>window.__micRequests),2,'visibility recovery must reuse the current live stream');
    if(await m.evaluate(()=>window.__check.loseContext())) {
      await m.waitForTimeout(900);
      const restored=await m.evaluate(()=>window.__check.snapshot().rendered);
      await m.waitForFunction(frame=>window.__check.snapshot().rendered>frame,restored);
    }
    await checkMorph(m,'mobile');
    await checkRecords(m,'mobile');
    await checkNavigation(m,'mobile');
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
