import { invoke } from '@tauri-apps/api/core'

export type ScreenshotImportCapability = {
  available: boolean
  backend: string
  unavailableReason: string | null
}

export type RuntimeCapabilities = {
  platform: string
  screenshotImport: ScreenshotImportCapability
}

export const conservativeRuntimeCapabilities: RuntimeCapabilities = {
  platform: 'unknown',
  screenshotImport: {
    available: false,
    backend: 'none',
    unavailableReason: '无法确认本地截图识别能力',
  },
}

export function normalizeRuntimeCapabilities(value: unknown): RuntimeCapabilities {
  if (!value || typeof value !== 'object') return structuredClone(conservativeRuntimeCapabilities)

  const record = value as Record<string, unknown>
  const screenshotImport = record.screenshotImport
  if (!screenshotImport || typeof screenshotImport !== 'object') {
    return structuredClone(conservativeRuntimeCapabilities)
  }

  const screenshotRecord = screenshotImport as Record<string, unknown>
  if (screenshotRecord.available !== true) {
    return {
      platform: typeof record.platform === 'string' && record.platform ? record.platform : 'unknown',
      screenshotImport: {
        available: false,
        backend: typeof screenshotRecord.backend === 'string' && screenshotRecord.backend
          ? screenshotRecord.backend
          : 'none',
        unavailableReason: typeof screenshotRecord.unavailableReason === 'string'
          ? screenshotRecord.unavailableReason
          : conservativeRuntimeCapabilities.screenshotImport.unavailableReason,
      },
    }
  }

  if (typeof screenshotRecord.backend !== 'string' || !screenshotRecord.backend.trim()) {
    return structuredClone(conservativeRuntimeCapabilities)
  }

  return {
    platform: typeof record.platform === 'string' && record.platform ? record.platform : 'unknown',
    screenshotImport: {
      available: true,
      backend: screenshotRecord.backend,
      unavailableReason: null,
    },
  }
}

export async function readRuntimeCapabilities(
  invokeCommand: typeof invoke = invoke,
): Promise<RuntimeCapabilities> {
  try {
    return normalizeRuntimeCapabilities(await invokeCommand<unknown>('get_runtime_capabilities'))
  } catch {
    return structuredClone(conservativeRuntimeCapabilities)
  }
}

export function canUseScreenshotImport(capabilities: RuntimeCapabilities | null): boolean {
  return capabilities?.screenshotImport.available === true
}
