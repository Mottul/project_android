/**
 * File System Access API pieces that TypeScript's DOM library does not declare
 * yet: the pickers themselves and the permission methods on a handle.
 *
 * Everything here is optional at runtime. Firefox and Safari ship none of it,
 * which is exactly why every call site has a picker-based fallback.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface OpenFilePickerOptions {
  multiple?: boolean
  excludeAcceptAllOption?: boolean
  types?: FilePickerAcceptType[]
  id?: string
  startIn?: string | FileSystemHandle
}

interface SaveFilePickerOptions {
  suggestedName?: string
  excludeAcceptAllOption?: boolean
  types?: FilePickerAcceptType[]
  id?: string
  startIn?: string | FileSystemHandle
}

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite'
  id?: string
  startIn?: string | FileSystemHandle
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  launchQueue?: {
    setConsumer(consumer: (params: { files: FileSystemFileHandle[] }) => void): void
  }
}

/** `<input type="file" webkitdirectory>` reports the path it was picked from. */
interface File {
  readonly webkitRelativePath: string
}

interface HTMLInputElement {
  webkitdirectory: boolean
}
