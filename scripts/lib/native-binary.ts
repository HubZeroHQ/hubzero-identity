export interface NativeTarget {
  platform: "linux";
  arch: "x64" | "arm64";
}

export const vercelNativeTarget: NativeTarget = { platform: "linux", arch: "x64" };

const elfMachines: Record<number, string> = { 0x03: "x86", 0x28: "arm", 0x3e: "x64", 0xb7: "arm64" };
const peMachines: Record<number, string> = { 0x014c: "x86", 0x8664: "x64", 0xaa64: "arm64" };

export function parseNativeTarget(value: string): NativeTarget {
  if (value === "linux-x64" || value === "linux-arm64") return { platform: "linux", arch: value === "linux-x64" ? "x64" : "arm64" };
  throw new Error(`Unsupported native target ${value}; expected linux-x64 or linux-arm64`);
}

export function formatNativeTarget(target: NativeTarget): string {
  return `${target.platform}-${target.arch}`;
}

/** Identifies a native module by its header bytes, never by its file name. */
export function describeNativeBinary(header: Uint8Array): string {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.length >= 20 && view.getUint32(0, false) === 0x7f454c46) {
    if (header[4] !== 2 || header[5] !== 1) return `ELF ${header[4] === 2 ? "64" : "32"}-bit ${header[5] === 1 ? "little" : "big"}-endian`;
    const machine = view.getUint16(18, true);
    return `ELF ${elfMachines[machine] ?? `machine 0x${machine.toString(16)}`}`;
  }
  if (header.length >= 64 && header[0] === 0x4d && header[1] === 0x5a) {
    const peOffset = view.getUint32(60, true);
    if (peOffset + 6 <= header.length && view.getUint32(peOffset, false) === 0x50450000) {
      const machine = view.getUint16(peOffset + 4, true);
      return `Windows PE ${peMachines[machine] ?? `machine 0x${machine.toString(16)}`}`;
    }
    return "Windows PE";
  }
  if (header.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(view.getUint32(0, false))) return "macOS Mach-O";
  return "unrecognized binary";
}

export function matchesNativeTarget(description: string, target: NativeTarget): boolean {
  return description === `ELF ${target.arch}`;
}

/** Throws unless the header is a native module that can load on the target. */
export function assertNativeBinary(file: string, header: Uint8Array, target: NativeTarget): void {
  const description = describeNativeBinary(header);
  if (!matchesNativeTarget(description, target)) {
    throw new Error(`${file} is ${description}, but this deployment targets ${formatNativeTarget(target)}. Build on ${formatNativeTarget(target)} (for example in a Linux container); this output cannot run on Vercel.`);
  }
}
