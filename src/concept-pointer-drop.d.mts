export function conceptDropTarget(projectId: string | undefined, x: number, y: number, excludedRoot?: Element | null, hitTest?: Pick<Document, "elementFromPoint">): HTMLElement | null;
export function markConceptDropTarget(previous: HTMLElement | null, next: HTMLElement | null): HTMLElement | null;
export function deliverConceptDrop(target: HTMLElement | null, projectId: string, conceptId: string): boolean;
