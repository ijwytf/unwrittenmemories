// Event-sequence regressions, not a substitute for a physical iPhone keyboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage();
    const source = process.argv.includes('--baseline')
      ? require('node:child_process').execFileSync('git',['show','HEAD:search-input.js'],{cwd:path.join(__dirname,'..'),encoding:'utf8'})
      : fs.readFileSync(path.join(__dirname,'../search-input.js'),'utf8');
    await page.route('http://127.0.0.1:8123/**', route => route.fulfill({
      contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',
      body:route.request().url().endsWith('.js')?source:
        '<script type="module">import {createSearchInput} from "./search-input.js";window.calls=[];window.field=createSearchInput(value=>calls.push(value));field.disabled=false;</script>',
    }));
    await page.goto('http://127.0.0.1:8123/');
    await page.waitForFunction(()=>window.field);
    const input=page.locator('input');
    // The old handler deletes the very first unflagged ㅂ and moves the caret.
    for(const word of ['보은','괴산','단양','옥천','기억','우리 집']) {
      await input.fill('');
      const values=await input.evaluate((element,word)=>{
        const sequence=['ㄱ','ㅂ','보','보ㅇ','보으','보은',word];
        return sequence.map(value=>{
          element.value=value;
          element.setSelectionRange(value.length,value.length);
          element.dispatchEvent(new InputEvent('input',{bubbles:true,data:value,inputType:'insertText',isComposing:false}));
          return [element.value,element.selectionStart];
        });
      },word);
      assert.deepEqual(values,['ㄱ','ㅂ','보','보ㅇ','보으','보은',word].map(value=>[value,value.length]));
      const count=await page.evaluate(()=>calls.length);
      await input.press('Enter');
      assert.deepEqual(await page.evaluate(()=>calls.slice(-1)),[word]);
      assert.equal(await page.evaluate(()=>calls.length),count+1);
    }
    await input.fill('');
    await input.evaluate(element=>{
      element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      element.value='우리 집들아';
      element.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'아'}));
      element.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
      element.form.requestSubmit();
      element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'아'}));
      element.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:false}));
    });
    assert.equal(await input.inputValue(),'우리 집들아','compositionend must not rewrite a focused edit');
    await input.press('Enter');
    assert.equal(await input.inputValue(),'우리 집들');
    assert.equal(await page.evaluate(()=>calls.at(-1)),'우리 집들');
    for(const [word,expected] of [
      ['memory','memory'],['heritage','heritage'],['heritages','heritage'],
      ['보은memory','보은'],['memory보은','memory'],
      ['보은 memory','보은'],['memory 보은','memory'],
      ['보은123!?','보은'],['',''],
    ]) {
      await input.fill(word);
      const count=await page.evaluate(()=>calls.length);
      await input.press('Enter');
      assert.equal(await page.evaluate(()=>calls.length),count+1);
      assert.equal(await page.evaluate(()=>calls.at(-1)),expected);
    }
    console.log('PASS unflagged jamo/caret preservation, composition boundaries, single submit, Korean/English limits, mixed-script filtering and empty return');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
