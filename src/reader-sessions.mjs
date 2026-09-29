const clone = (snapshot) => snapshot && ({ ...snapshot, anchor: snapshot.anchor ? { ...snapshot.anchor } : null });

/** Transient reading state belongs to a view, while transfer preserves its passage. */
export function createReaderSessions() {
  const snapshots = new Map(), revisions = new Map(), captures = new Map(), listeners = new Map();
  const revision = (key) => key ? revisions.get(key) || 0 : 0;
  const get = (key) => key ? clone(snapshots.get(key)) : undefined;
  const save = (key, snapshot) => {
    if (!key || !snapshot || (snapshot.transferRevision || 0) !== revision(key)) return false;
    snapshots.set(key, clone({ ...snapshot, sessionId: key }));
    return true;
  };
  const capture = (key) => {
    const read = captures.get(key);
    if (read) save(key, read());
    return get(key);
  };
  const restore = (key, snapshot, options = {}) => {
    if (!key || !snapshot?.sourceId || (options.sourceId && snapshot.sourceId !== options.sourceId)) return;
    const transferRevision = revision(key) + 1;
    const next = { ...clone(snapshot), sessionId: key, transferRevision,
      navigationKey: options.navigationKey, evidenceText: options.evidenceText };
    revisions.set(key, transferRevision);
    snapshots.set(key, clone(next));
    listeners.get(key)?.forEach((listener) => listener());
    return clone(next);
  };
  return {
    get, save, revision, capture, restore,
    register(key, capture) {
      if (!key) return () => {};
      captures.set(key, capture);
      return () => { if (captures.get(key) === capture) captures.delete(key); };
    },
    subscribe(key, listener) {
      if (!key) return () => {};
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
      return () => {
        const group = listeners.get(key);
        group?.delete(listener);
        if (!group?.size) listeners.delete(key);
      };
    },
    copy(fromKey, toKey, options = {}) {
      if (!fromKey || !toKey || fromKey === toKey) return;
      return restore(toKey, capture(fromKey), options);
    },
  };
}

const readerSessions = createReaderSessions();
export const getReaderSession = readerSessions.get;
export const saveReaderSession = readerSessions.save;
export const readerSessionRevision = readerSessions.revision;
export const registerReaderSession = readerSessions.register;
export const subscribeReaderSession = readerSessions.subscribe;
export const copyReaderSession = readerSessions.copy;
export const captureReaderSession = readerSessions.capture;
export const restoreReaderSession = readerSessions.restore;
