export interface FrameworkControl {
  id: string;
  framework: string;
  title: string;
  description: string;
  keywords: string[];
  domain: string;
}

export class ControlRetrievalEngine {

  /**
   * retrieve()
   * 
   * Deterministic retrieval of control objects based solely on
   * activated control IDs. No modification, transformation, or
   * enrichment occurs here.
   */
  static retrieve(
    activatedControlIds: string[],
    catalog: FrameworkControl[]
  ): FrameworkControl[] {

    if (!Array.isArray(activatedControlIds)) {
      throw new Error("activatedControlIds must be an array of strings.");
    }

    const lookup = new Map<string, FrameworkControl>();

    for (const ctrl of catalog) {
      lookup.set(ctrl.id, ctrl);
    }

    const result: FrameworkControl[] = [];

    for (const id of activatedControlIds) {
      const found = lookup.get(id);
      if (found) result.push(found);
    }

    return result;
  }

}
