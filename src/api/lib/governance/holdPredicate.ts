/**
 * holdPredicate.ts — pure "is this object held?" decision.
 *
 * Separated from the store so the rule is testable without a database and,
 * more importantly, so there is exactly ONE of it. A hold that is evaluated
 * differently by the sweeper than by the owner-delete route is not a hold.
 */

/** An active hold as the store returns it. Released holds are never passed in. */
export interface ActiveHold {
  id: string;
  scopeType: "organization" | "data_class" | "subject_user" | "object";
  dataClass: string | null;
  subjectUserId: string | null;
  objectId: string | null;
}

export interface HoldTarget {
  dataClass: string;
  objectId: string;
  /** The data subject the object belongs to, when the class has one. */
  ownerUserId: string | null;
}

/**
 * Returns the id of the first hold covering `target`, or null.
 *
 * Returning the ID rather than a boolean is deliberate: a refusal has to be
 * explainable ("held under hold X"), and an audit event that says only "held"
 * cannot be reconciled against the hold register later.
 */
export function holdCovering(
  holds: readonly ActiveHold[],
  target: HoldTarget
): string | null {
  for (const h of holds) {
    switch (h.scopeType) {
      case "organization":
        return h.id;
      case "data_class":
        if (h.dataClass === target.dataClass) return h.id;
        break;
      case "subject_user":
        // A subject hold with no owner to match cannot cover an ownerless
        // object; it must not silently widen to the whole class.
        if (target.ownerUserId != null && h.subjectUserId === target.ownerUserId) return h.id;
        break;
      case "object":
        if (h.dataClass === target.dataClass && h.objectId === target.objectId) return h.id;
        break;
    }
  }
  return null;
}

export function isHeld(holds: readonly ActiveHold[], target: HoldTarget): boolean {
  return holdCovering(holds, target) !== null;
}

/**
 * Does a hold cover this DATA SUBJECT — the person, rather than one of their
 * objects?
 *
 * A separate predicate from holdCovering() on purpose. The scopes that protect
 * a person are `organization` and `subject_user`; a `data_class` or `object`
 * hold protects a THING, and must not incidentally block an unrelated erasure
 * of the human it happens to mention. Collapsing the two questions into one
 * function is how a hold on one conversation quietly becomes a hold on someone's
 * right to be forgotten.
 *
 * Used by the Art.17 account-deletion reaper: a held subject is not erased, and
 * the request stays pending until the hold is released.
 */
export function holdCoveringSubject(
  holds: readonly ActiveHold[],
  subjectUserId: string
): string | null {
  for (const h of holds) {
    if (h.scopeType === "organization") return h.id;
    if (h.scopeType === "subject_user" && h.subjectUserId === subjectUserId) return h.id;
  }
  return null;
}
