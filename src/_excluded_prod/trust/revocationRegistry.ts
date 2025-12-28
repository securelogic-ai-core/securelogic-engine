const revokedActors = new Set<string>();

export function revokeActor(actorId: string) {
  revokedActors.add(actorId);
}

export function isActorRevoked(actorId: string): boolean {
  return revokedActors.has(actorId);
}
