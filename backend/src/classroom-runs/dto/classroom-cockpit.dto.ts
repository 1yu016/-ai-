import type { ClassroomCockpitService } from '../classroom-cockpit.service';
/** Version 1 wire contract, inferred from the explicit allowlisted projection. */
export type ClassroomCockpitResponse = Awaited<
  ReturnType<ClassroomCockpitService['get']>
>;
