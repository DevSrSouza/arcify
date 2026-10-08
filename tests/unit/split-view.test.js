import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SPLIT_VIEW_ID_NONE,
    supportsSplitView,
    isSplitDropZone,
    splitRoles,
    placeAfter,
    splitTabs,
    splitWithActiveTab,
    separateSplit
} from '../../split-view.js';

function fakeChrome(tabs) {
    const byId = new Map(tabs.map(tab => [tab.id, { ...tab }]));
    const calls = [];
    const reindex = () => [...byId.values()].sort((a, b) => a.index - b.index).forEach((tab, i) => { tab.index = i; });
    return {
        calls,
        byId,
        tabs: {
            get: async id => ({ ...byId.get(id) }),
            group: async ({ tabIds, groupId }) => { calls.push(['group', tabIds, groupId]); byId.get(tabIds).groupId = groupId; return groupId; },
            ungroup: async id => { calls.push(['ungroup', id]); byId.get(id).groupId = -1; },
            move: async (id, { index }) => {
                calls.push(['move', id, index]);
                const ordered = [...byId.values()].sort((a, b) => a.index - b.index).filter(tab => tab.id !== id);
                ordered.splice(index, 0, byId.get(id));
                ordered.forEach((tab, i) => { tab.index = i; });
            },
            createSplit: async ids => { calls.push(['createSplit', ids]); reindex(); return 77; },
            unsplit: async id => { calls.push(['unsplit', id]); },
            query: async () => [...byId.values()].filter(tab => tab.active).map(tab => ({ ...tab }))
        }
    };
}

const tab = (id, index, extra = {}) => ({ id, index, windowId: 1, pinned: false, groupId: -1, splitViewId: SPLIT_VIEW_ID_NONE, ...extra });

test('detects split view support from the Chrome API surface', () => {
    assert.equal(supportsSplitView({ tabs: { createSplit() {} } }), true);
    assert.equal(supportsSplitView({ tabs: {} }), false);
    assert.equal(supportsSplitView(undefined), false);
});

test('only the middle half of a row is a split drop zone', () => {
    const rect = { top: 100, bottom: 140, height: 40 };
    assert.equal(isSplitDropZone(rect, 105), false);
    assert.equal(isSplitDropZone(rect, 120), true);
    assert.equal(isSplitDropZone(rect, 136), false);
});

test('pairs adjacent rows that share a split view', () => {
    assert.deepEqual(splitRoles([-1, 5, 5, -1, 8, -1, 8]), [null, 'start', 'end', null, 'lone', null, 'lone']);
    assert.deepEqual(splitRoles([3, 3, 3]), ['start', 'end', 'lone']);
});

test('places a tab right after its partner and keeps the array when already adjacent', () => {
    assert.deepEqual(placeAfter([1, 2, 3, 4], 1, 4), [1, 4, 2, 3]);
    assert.deepEqual(placeAfter([4, 2, 1], 1, 4), [2, 1, 4]);
    const adjacent = [1, 2, 3];
    assert.equal(placeAfter(adjacent, 1, 2), adjacent);
    const unrelated = [1, 2];
    assert.equal(placeAfter(unrelated, 1, 9), unrelated);
});

test('moves the dragged tab next to the target and splits them', async () => {
    const chromeApi = fakeChrome([tab(10, 0), tab(11, 1), tab(12, 2)]);
    assert.equal(await splitTabs(10, 12, chromeApi), 77);
    assert.deepEqual(chromeApi.calls, [['move', 10, 2], ['createSplit', [12, 10]]]);
});

test('joins the target tab group before the move', async () => {
    const chromeApi = fakeChrome([tab(10, 0), tab(11, 1, { groupId: 4 }), tab(12, 2, { groupId: 4 })]);
    await splitTabs(10, 11, chromeApi);
    assert.deepEqual(chromeApi.calls[0], ['group', 10, 4]);
    assert.deepEqual(chromeApi.calls.at(-1), ['createSplit', [11, 10]]);
});

test('leaves the tab group when the target has none', async () => {
    const chromeApi = fakeChrome([tab(10, 0, { groupId: 4 }), tab(11, 1)]);
    await splitTabs(10, 11, chromeApi);
    assert.deepEqual(chromeApi.calls[0], ['ungroup', 10]);
});

test('refuses tabs that Chrome cannot split', async () => {
    const cases = [
        [tab(10, 0), tab(11, 1, { splitViewId: 3 })],
        [tab(10, 0, { pinned: true }), tab(11, 1)],
        [tab(10, 0, { windowId: 2 }), tab(11, 1)]
    ];
    for (const tabs of cases) {
        const chromeApi = fakeChrome(tabs);
        await assert.rejects(splitTabs(10, 11, chromeApi), /cannot be shown in split view/);
        assert.deepEqual(chromeApi.calls, []);
    }
    await assert.rejects(splitTabs(10, 10, fakeChrome([tab(10, 0)])), /cannot be shown in split view/);
});

test('separates a split view', async () => {
    const chromeApi = fakeChrome([]);
    await separateSplit(77, chromeApi);
    assert.deepEqual(chromeApi.calls, [['unsplit', 77]]);
});

test('splits a tab to the right of the active tab', async () => {
    const chromeApi = fakeChrome([tab(10, 0, { active: true }), tab(11, 1), tab(12, 2)]);
    await splitWithActiveTab(12, chromeApi);
    assert.deepEqual(chromeApi.calls, [['move', 12, 1], ['createSplit', [10, 12]]]);
});
