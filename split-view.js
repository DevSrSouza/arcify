export const SPLIT_VIEW_ID_NONE = -1;
const TAB_GROUP_ID_NONE = -1;
const SPLIT_ROLE_CLASSES = ['split-start', 'split-end', 'split-lone'];

export function supportsSplitView(chromeApi = globalThis.chrome) {
    return typeof chromeApi?.tabs?.createSplit === 'function';
}

export function isSplitDropZone(rect, clientY) {
    const edge = rect.height / 4;
    return clientY > rect.top + edge && clientY < rect.bottom - edge;
}

export function splitRoles(splitIds) {
    const roles = splitIds.map(id => (id === SPLIT_VIEW_ID_NONE ? null : 'lone'));
    for (let i = 0; i < splitIds.length - 1; i++) {
        if (roles[i] === 'lone' && splitIds[i] === splitIds[i + 1]) {
            roles[i] = 'start';
            roles[i + 1] = 'end';
            i++;
        }
    }
    return roles;
}

export function placeAfter(ids, anchorId, movedId) {
    const anchorIndex = ids.indexOf(anchorId);
    const movedIndex = ids.indexOf(movedId);
    if (anchorIndex === -1 || movedIndex === -1 || movedIndex === anchorIndex + 1) return ids;
    const next = ids.filter(id => id !== movedId);
    next.splice(next.indexOf(anchorId) + 1, 0, movedId);
    return next;
}

function canSplit(dragged, target) {
    return dragged.id !== target.id &&
        dragged.windowId === target.windowId &&
        !dragged.pinned && !target.pinned &&
        dragged.splitViewId === SPLIT_VIEW_ID_NONE &&
        target.splitViewId === SPLIT_VIEW_ID_NONE;
}

async function joinTargetGroup(dragged, target, chromeApi) {
    if (dragged.groupId === target.groupId) return;
    if (target.groupId === TAB_GROUP_ID_NONE) await chromeApi.tabs.ungroup(dragged.id);
    else await chromeApi.tabs.group({ tabIds: dragged.id, groupId: target.groupId });
}

async function moveNextTo(draggedId, targetId, chromeApi) {
    const [dragged, target] = await Promise.all([chromeApi.tabs.get(draggedId), chromeApi.tabs.get(targetId)]);
    const index = dragged.index < target.index ? target.index : target.index + 1;
    if (dragged.index !== index) await chromeApi.tabs.move(draggedId, { index });
}

export async function splitTabs(draggedId, targetId, chromeApi = globalThis.chrome) {
    const [dragged, target] = await Promise.all([chromeApi.tabs.get(draggedId), chromeApi.tabs.get(targetId)]);
    if (!canSplit(dragged, target)) throw new Error('These tabs cannot be shown in split view.');
    await joinTargetGroup(dragged, target, chromeApi);
    await moveNextTo(draggedId, targetId, chromeApi);
    return chromeApi.tabs.createSplit([targetId, draggedId]);
}

export async function splitWithActiveTab(tabId, chromeApi = globalThis.chrome) {
    const [active] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (!active) throw new Error('There is no current tab to split with.');
    return splitTabs(tabId, active.id, chromeApi);
}

export function separateSplit(splitViewId, chromeApi = globalThis.chrome) {
    return chromeApi.tabs.unsplit(splitViewId);
}

function splitIdOf(element, splitIdByTabId) {
    if (!element.classList.contains('tab') || !element.dataset.tabId) return SPLIT_VIEW_ID_NONE;
    return splitIdByTabId.get(Number(element.dataset.tabId)) ?? SPLIT_VIEW_ID_NONE;
}

function markRow(element, splitViewId, role) {
    element.classList.remove(...SPLIT_ROLE_CLASSES);
    if (role) element.classList.add(`split-${role}`);
    if (splitViewId === SPLIT_VIEW_ID_NONE) delete element.dataset.splitViewId;
    else element.dataset.splitViewId = String(splitViewId);
}

export function applySplitViewClasses(root, splitIdByTabId) {
    const containers = new Set([...root.querySelectorAll('.tab')].map(tab => tab.parentElement));
    for (const container of containers) {
        const rows = [...container.children];
        const ids = rows.map(row => splitIdOf(row, splitIdByTabId));
        splitRoles(ids).forEach((role, i) => markRow(rows[i], ids[i], role));
    }
}
