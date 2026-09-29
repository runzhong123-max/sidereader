import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/theme.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { readTheme, applyTheme } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

test('appearance has only two states; invalid preferences safely restore bright mode', () => {
  for (const [value, expected] of [['dark','dark'],['light','light'],['system','light'],['','light']]) {
    const preferences = { getText: () => value };
    const root = { dataset: {}, style: {} };
    assert.equal(applyTheme(readTheme(preferences), root), expected);
    assert.equal(root.dataset.theme, expected);
    assert.equal(root.style.colorScheme, expected);
  }
});

const parse = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1],match[2].trim()]));
const reading = await readFile('src/reading-experience.css', 'utf8');
const themes = await readFile('src/theme.css', 'utf8');
const light = { ...parse(reading.slice(0,reading.indexOf('.compact-app'))), ...parse(themes.match(/:root \{([^}]+)\}/s)[1]) };
const dark = { ...light, ...parse(themes.match(/:root\[data-theme="dark"\] \{([^}]+)\}/s)[1]) };
function luminance(hex) {
  const rgb = hex.replace('#','').match(/../g).slice(0,3).map((part) => parseInt(part,16)/255).map((v) => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
function resolve(tokens, key) {
  const value = tokens[key];
  return value.startsWith('var(') ? resolve(tokens,value.slice(6,-1)) : value;
}
function contrast(tokens, foreground, background) {
  const values = [luminance(resolve(tokens,foreground)), luminance(resolve(tokens,background))].sort((a,b)=>b-a);
  return (values[0]+.05)/(values[1]+.05);
}
for (const [name,tokens] of [['light',light],['dark',dark]]) {
  test(`${name}: essential text, controls and feedback meet normal-text contrast`, () => {
    for (const bg of ['surface','canvas','soft','sage']) for (const fg of ['ink','secondary','green']) {
      assert.ok(contrast(tokens,fg,bg) >= 4.5, `${fg} on ${bg}`);
    }
    for (const [fg,bg] of [['on-accent','green'],['danger','danger-soft'],['warning','warning-soft'],['success','success-soft'],['link','surface']]) {
      assert.ok(contrast(tokens,fg,bg) >= 4.5, `${fg} on ${bg}`);
    }
  });
}
