import { invoke, isTauri } from '@tauri-apps/api/core';

namespace DesktopStartup {
  /** Browser development remains usable without the native startup handshake. */
  export async function complete(): Promise<void> {
    if (isTauri()) await invoke('finish_startup');
  }
}
export default DesktopStartup;
