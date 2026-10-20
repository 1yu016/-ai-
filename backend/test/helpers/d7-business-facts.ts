// A browser login and Avatar resolve may legitimately write auth/usage logs.
// Compare authoritative classroom facts, not unrelated login counters. No exclusions inside this set.
export const D7_FACT_TABLES = ['classroom_run', 'classroom_operation_record', 'classroom_event', 'classroom_snapshot', 'student_reward_record', 'class_collective_reward_record', 'student_attendance_record', 'student_attendance_change', 'classroom_roll_call_record'] as const;
export function d7BusinessFacts(value: { summaries: Record<string, unknown> }) {
  return Object.fromEntries(D7_FACT_TABLES.map(table => {
    if (!Object.hasOwn(value.summaries, table)) throw Error(`Missing authoritative evidence table: ${table}`);
    return [table, value.summaries[table]];
  }));
}
