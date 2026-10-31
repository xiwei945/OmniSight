// 猫耳键盘模型与键位的契约：`keyboard.glb` 里每个**键帽节点**必须正好落在一个 `key_id` 上。
//
// 这把键盘的节点是 `Esc_r0_choco`、`LShift_r4_cream` 这种「图例名_行_配色分区」，与数据库里
// 的 `key_id`（`esc`、`shift_left`）不是一套命名。**翻译表在前端**（`domain/keyboard-cat.ts`），
// 所以这条用例是它唯一的防线：漏一个键的表现不是报错，而是那颗键永远显示 0。
//
// 布局 id 从 `layouts.json` 读（由 tests/unit/test_frontend_js.py 从后端现场导出）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KEY_ID_BY_LABEL,
  heatRamp,
  inkFor,
  modelLevels,
  parseNodeName,
} from '../../frontend/src/domain/keyboard-cat.ts';
import type { LayoutResponse } from '../../frontend/src/types/api.d.ts';

const GLB = new URL('../../src/omnisight/presentation/static/assets/keyboard.glb', import.meta.url);

interface GlbNode {
  name?: string;
  mesh?: number;
}

function glbNodes(): GlbNode[] {
  const buffer = readFileSync(GLB);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as {
    nodes?: GlbNode[];
  };
  return json.nodes ?? [];
}

function ansiLayoutKeyIds(): string[] {
  const layouts: Record<string, LayoutResponse> = JSON.parse(
    readFileSync(new URL('./layouts.json', import.meta.url), 'utf8'),
  );
  const rows = layouts.ansi104?.rows ?? [];
  return rows.flat().filter((slot) => slot.id !== 'gap').map((slot) => slot.id);
}

test('模型里的键帽节点正好覆盖 ANSI 104 的每一个键', () => {
  const keyIds = glbNodes()
    .map((node) => parseNodeName(node.name)?.keyId)
    .filter((id): id is string => Boolean(id));
  assert.equal(keyIds.length, 104, `键帽节点解析出 ${keyIds.length} 个 key_id，应为 104`);
  assert.deepEqual([...keyIds].sort(), [...ansiLayoutKeyIds()].sort());
});

test('外壳与底板节点不参与键位映射', () => {
  const shell = glbNodes()
    .map((node) => node.name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => parseNodeName(name) === null);
  // 104 个键帽之外还剩：Case_Floor / Case_Top / Case_Wall_* / Plate / KeyboardRoot。
  assert.deepEqual(
    [...shell].sort(),
    [
      'Case_Floor',
      'Case_Top',
      'Case_Wall_Back',
      'Case_Wall_Front',
      'Case_Wall_Left',
      'Case_Wall_Right',
      'KeyboardRoot',
      'Plate',
    ],
  );
});

test('翻译表不含重复 key_id——两个键抢一个 id 会让其中一颗永远不亮', () => {
  const values = Object.values(KEY_ID_BY_LABEL);
  assert.equal(new Set(values).size, values.length);
  assert.equal(values.length, 104);
});

test('parseNodeName 只认真实节点名，改一位就不认', () => {
  assert.deepEqual(parseNodeName('Esc_r0_choco'), { keyId: 'esc', zone: 'choco', label: 'Esc' });
  assert.deepEqual(parseNodeName('LShift_r4_cream'), {
    keyId: 'shift_left',
    zone: 'cream',
    label: 'LShift',
  });
  assert.deepEqual(parseNodeName('Num7_r1_cream'), {
    keyId: 'numpad_7',
    zone: 'cream',
    label: 'Num7',
  });
  assert.equal(parseNodeName('Case_Floor'), null);
  assert.equal(parseNodeName('Plate'), null);
  assert.equal(parseNodeName(null), null);
  // 图例名认识、但 key_id 不在表里（例如 F13 没有物理键帽）
  assert.equal(parseNodeName('UnknownKey_r1_cream'), null);
});

test('modelLevels 把热力值折成五档，缺数据的键不在表里', () => {
  const levels = modelLevels(
    {
      keys: [
        { id: 'key_q', press_count: 0 },
        { id: 'key_w', press_count: 800 },
        { id: 'key_e', press_count: 400 },
      ],
      scale: { min: 0, p95: 800, max: 2400 },
    } as never,
    'press_count',
  );
  assert.equal(levels.get('key_q'), 0);
  assert.equal(levels.get('key_w'), 5);
  assert.equal(levels.get('key_e'), 3);
  assert.equal(levels.get('key_r'), undefined);
});

test('热力色阶六档，读不到 CSS 时退回拿铁那一套', () => {
  const ramp = heatRamp(() => '');
  assert.equal(ramp.length, 6);
  assert.equal(new Set(ramp).size, 6);
  const fromCss = heatRamp((name) => (name === '--heat-1' ? '#123456' : ''));
  assert.equal(fromCss[1], '#123456');
});

test('键面字色按亮度翻转：浅底深字、深底白字', () => {
  assert.equal(inkFor('#f2ece1'), '#3a322b');
  assert.equal(inkFor('#4a240c'), '#fff8ef');
  assert.equal(inkFor('oops'), '#3a322b');
});
