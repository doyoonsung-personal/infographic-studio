import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNarration, spokenText, cueTimes, computeTimeline, clipKey, estimateSeconds } from '../public/js/timeline.js';
import { lintComposition, checkScenes, extractTexts } from '../public/js/lint.js';
import { assembleDocument, styleKey } from '../public/js/assemble.js';

test('parseNarration strips markers and records cue positions', () => {
  const r = parseNarration('원두값은 {1}1년 만에 {2}38% 올랐습니다');
  assert.equal(r.text, '원두값은 1년 만에 38% 올랐습니다');
  assert.equal(r.text[r.cues['1']], '1');
  assert.equal(r.text.slice(r.cues['2'], r.cues['2'] + 3), '38%');
});

test('parseNarration collapses spaces and handles leading markers', () => {
  const r = parseNarration('  {1}Hello   {2} world  ');
  assert.equal(r.text, 'Hello world');
  assert.equal(r.cues['1'], 0);
  assert.equal(r.text.slice(r.cues['2']), 'world');
});

test('spokenText of plain text is unchanged', () => {
  assert.equal(spokenText('no markers here'), 'no markers here');
});

test('cueTimes maps cues onto alignment start times', () => {
  const narration = 'ab {1}cd';
  const text = spokenText(narration); // "ab cd"
  const alignment = { chars: text.split(''), starts: [0, 0.1, 0.2, 0.3, 0.4] };
  assert.deepEqual(cueTimes(narration, alignment), { 1: 0.3 });
});

test('computeTimeline uses fresh clips and estimates the rest', () => {
  const scenes = [
    { id: 's1', narration: '{1}하나 둘 셋', onscreen: '' },
    { id: 's2', narration: '넷 다섯', onscreen: '' },
  ];
  const p = {
    brief: { format: 'animated', ratio: '9:16', language: 'ko' },
    script: { scenes },
    voice: { enabled: true, voiceRef: 'v1', speed: 1, clips: {
      s1: { blobId: 'b_1', duration: 2, key: clipKey(scenes[0].narration, 'v1', 1), alignment: { chars: '하나 둘 셋'.split(''), starts: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] } },
      s2: { blobId: 'b_2', duration: 1.5, key: 'stale', alignment: null },
    } },
  };
  const tl = computeTimeline(p);
  assert.equal(tl.width, 1080);
  assert.equal(tl.height, 1920);
  assert.equal(tl.scenes[0].voice.blobId, 'b_1');
  assert.equal(tl.scenes[0].cues['1'], 0.45); // LEAD_IN 0.35 + 0.1
  assert.equal(tl.scenes[1].voice, null, 'stale clip is not used');
  assert.equal(tl.scenes[1].start, tl.scenes[0].end);
  assert.ok(Math.abs(tl.duration - tl.scenes[1].end) < 1e-6);
});

test('static projects have a single page scene', () => {
  const tl = computeTimeline({ brief: { format: 'static', ratio: 'a4' }, script: { scenes: [{ id: 's1' }, { id: 's2' }] } });
  assert.equal(tl.static, true);
  assert.equal(tl.duration, 0);
  assert.deepEqual(tl.scenes.map((s) => s.id), ['page']);
});

test('estimateSeconds is positive for Korean and English', () => {
  assert.ok(estimateSeconds('한국어 문장입니다', 'ko') > 1);
  assert.ok(estimateSeconds('one two three four five', 'en') > 1);
});

test('lint flags real-time APIs only inside code, not in on-screen words', () => {
  const ok = lintComposition('<section class="scene" data-scene="s1"><p>import tariffs and transition: costs</p></section><script type="application/json" id="texts">{}</script>');
  assert.equal(ok.ok, true, ok.errors.join('; '));
  const bad = lintComposition('<style>.a{transition: opacity 1s}</style><section class="scene" data-scene="s1"></section><script>setTimeout(()=>{},1); Math.random()</script>');
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /transition/.test(e)));
  assert.ok(bad.errors.some((e) => /setTimeout/.test(e)));
  assert.ok(bad.errors.some((e) => /Math.random/.test(e)));
});

test('lint catches duplicate scenes, remote assets and bad #texts', () => {
  const r = lintComposition('<section class="scene" data-scene="s1"></section><section class="scene" data-scene="s1"><img src="https://x/y.png"></section><script type="application/json" id="texts">{bad</script>');
  assert.ok(r.errors.some((e) => /duplicate/.test(e)));
  assert.ok(r.errors.some((e) => /remote/.test(e)));
  assert.ok(r.errors.some((e) => /#texts/.test(e)));
});

test('checkScenes reports missing and extra ids', () => {
  assert.deepEqual(checkScenes(['s1', 'x'], { scenes: [{ id: 's1' }, { id: 's2' }] }), { missing: ['s2'], extra: ['x'] });
});

test('extractTexts and assembleDocument', () => {
  const frag = '<section class="scene" data-scene="s1"><h1 data-text="t">Hi</h1></section><script type="application/json" id="texts">{"t":"Hi"}</script>';
  assert.deepEqual(extractTexts(frag), { t: 'Hi' });
  const doc = assembleDocument(frag, { runtime: '/*rt*/', timeline: { width: 1080, height: 1080, duration: 3, scenes: [] }, colors: { accent: '#123456' }, texts: { t: '</script>' } });
  assert.ok(doc.includes('width:1080px'));
  assert.ok(doc.includes('--accent:#123456'));
  assert.ok(!doc.includes('"t":"</script>"'), 'texts are escaped inside the inline script');
});

test('styleKey is stable regardless of key order', () => {
  assert.equal(styleKey({ colors: { a: '1', b: '2' }, font: 'sans' }), styleKey({ font: 'sans', colors: { b: '2', a: '1' } }));
});
