import { describe, expect, it } from "vitest";
import { assertNativeBinary, describeNativeBinary, parseNativeTarget, vercelNativeTarget } from "../scripts/lib/native-binary";

function elf(machine: number, bits = 2, endian = 1): Uint8Array {
  const header = new Uint8Array(64);
  header.set([0x7f, 0x45, 0x4c, 0x46, bits, endian]);
  new DataView(header.buffer).setUint16(18, machine, true);
  return header;
}

function pe(machine: number): Uint8Array {
  const header = new Uint8Array(256);
  const view = new DataView(header.buffer);
  header.set([0x4d, 0x5a]);
  view.setUint32(60, 128, true);
  view.setUint32(128, 0x50450000, false);
  view.setUint16(132, machine, true);
  return header;
}

function machO(magic: number): Uint8Array {
  const header = new Uint8Array(32);
  new DataView(header.buffer).setUint32(0, magic, false);
  return header;
}

describe("native binary format", () => {
  it("accepts a little-endian 64-bit x86-64 ELF for the Vercel target", () => {
    expect(describeNativeBinary(elf(0x3e))).toBe("ELF x64");
    expect(() => assertNativeBinary("argon2.glibc.node", elf(0x3e), vercelNativeTarget)).not.toThrow();
  });

  it("rejects Windows PE binaries with an informative message", () => {
    expect(() => assertNativeBinary("argon2.node", pe(0x8664), vercelNativeTarget)).toThrow(/argon2\.node is Windows PE x64, but this deployment targets linux-x64/);
  });

  it.each([0xfeedfacf, 0xcffaedfe, 0xcafebabe])("rejects macOS Mach-O magic %s", (magic) => {
    expect(() => assertNativeBinary("bcrypt.node", machO(magic), vercelNativeTarget)).toThrow(/macOS Mach-O/);
  });

  it("rejects ELF binaries for another architecture, class, or byte order", () => {
    expect(() => assertNativeBinary("a.node", elf(0xb7), vercelNativeTarget)).toThrow(/ELF arm64/);
    expect(() => assertNativeBinary("a.node", elf(0x3e, 1), vercelNativeTarget)).toThrow(/32-bit/);
    expect(() => assertNativeBinary("a.node", elf(0x3e, 2, 2), vercelNativeTarget)).toThrow(/big-endian/);
  });

  it("does not accept a binary because of an empty or truncated file", () => {
    expect(() => assertNativeBinary("a.node", new Uint8Array(0), vercelNativeTarget)).toThrow(/unrecognized binary/);
    expect(() => assertNativeBinary("a.node", new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), vercelNativeTarget)).toThrow(/unrecognized binary/);
  });

  it("supports only Linux targets", () => {
    expect(parseNativeTarget("linux-x64")).toEqual(vercelNativeTarget);
    expect(() => parseNativeTarget("win32-x64")).toThrow(/Unsupported native target/);
  });
});
