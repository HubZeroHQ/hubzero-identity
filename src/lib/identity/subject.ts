import { monotonicFactory } from "ulid";
import { asIdentitySubject, type IdentitySubject } from "@/domain/identity";

const createUlid = monotonicFactory();

export function generateIdentitySubject(now?: Date): IdentitySubject {
  const ulid = createUlid(now?.getTime());
  return asIdentitySubject(`hz_${ulid}`);
}
