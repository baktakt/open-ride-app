// One USB open per manager, even when startup, StrictMode and a device dialog overlap.
const initializations = new WeakMap();
const restores = new WeakMap();
export const ANT_DEVICE_KEY = 'openride_last_ant_device';
export const EMULATOR_DEVICE_KEY = 'openride_last_emulator_device';

export function initializeTrainerOnce(manager, open) {
  if (manager.dongleStatus === 'connected') return Promise.resolve(true);
  if (initializations.has(manager)) return initializations.get(manager);
  const task = Promise.resolve().then(open).finally(() => initializations.delete(manager));
  initializations.set(manager, task);
  return task;
}

export function restoreTrainerSession(manager, { storage, deviceKey, initialize = () => manager.initialize() }) {
  if (manager.connectionStatus === 'connected') return Promise.resolve(true);
  if (restores.has(manager)) return restores.get(manager);
  const task = (async () => {
    if (!await initialize()) return false;
    const raw = storage.getItem(deviceKey);
    const id = Number(raw);
    if (!raw || !Number.isInteger(id) || id <= 0 || id > (deviceKey === EMULATOR_DEVICE_KEY ? 1000000000 : 65535)) return false;
    if (['connected', 'connecting'].includes(manager.connectionStatus) || manager.scanStatus === 'scanning') return true;
    return await manager.connect(id);
  })().finally(() => restores.delete(manager));
  restores.set(manager, task);
  return task;
}
